import { z } from 'zod';
import { transaction } from '../../infra/db.js';
import { logger } from '../../shared/logger.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { assertSafe } from '../../shared/safety.js';
import { asId, toDatetime } from './mappers.js';
import { syncRepo } from './sync.repo.js';
import { human3Repo } from '../human3/human3.repo.js';
import { collectHuman3Texts, validateHuman3Snapshot } from '../human3/human3.rules.js';

/**
 * 客户端快照结构校验。passthrough 保留前端未来新增字段（pull 时原样还原）。
 * 边界处一律校验，绝不信任 localStorage 里被手工改过的数据。
 */
const clientId = z.union([z.string(), z.number()]).transform(String);
// 前端大量字段初值是 null（如 experiment.outcome、session.root_id），
// 统一把 null / undefined 收敛为空串，避免把合法的离线快照误判为脏数据。
const shortText = (max) => z.string().max(max).nullable().optional().transform((v) => v ?? '');
const objectLike = z.record(z.any()).optional().default({});

const hypothesisSchema = z.object({
  type: shortText(20), rank: z.any().optional(), confidence: z.any().optional(),
  reasoning: shortText(60), evidence_quote: shortText(500),
  evidence_from: shortText(40), disagreed: z.boolean().optional().default(false),
}).passthrough();

const reviewSchema = z.object({
  id: clientId.optional(), session_id: clientId.optional(), experiment_id: clientId.nullable().optional(),
  outcome: shortText(30), converge_to: shortText(20), basis: shortText(1000),
  evidence_id: clientId.nullable().optional(), next_action: shortText(30),
  created_at: z.any().optional(),
}).passthrough();

const sessionSchema = z.object({
  id: clientId,
  created_at: z.any().optional(),
  free_text: shortText(1000),
  answers: objectLike,
  q2_detail: shortText(300),
  rule_top: shortText(20), rule_second: shortText(20),
  rule_scores: z.any().optional(), rule_hits: z.any().optional(),
  why_guess: shortText(200), uncertainty: shortText(200), engine: shortText(10),
  round_no: z.number().int().min(1).max(3).optional().default(1),
  root_id: clientId.nullable().optional(),
  status: shortText(20), experiment_id: clientId.nullable().optional(),
  hypotheses: z.array(hypothesisSchema).max(3).optional().default([]),
  reviews: z.array(reviewSchema).max(20).optional().default([]),
}).passthrough();

const experimentSchema = z.object({
  id: clientId, session_id: clientId,
  type: shortText(20), template_key: shortText(20), title: shortText(200),
  actions: z.array(z.string().max(500)).max(10).optional().default([]),
  observation: shortText(300), duration_days: z.number().int().min(1).max(30).optional().default(7),
  branch: z.any().optional(), evidence_hint: shortText(20),
  started_at: z.any().nullable().optional(), ended_at: z.any().nullable().optional(),
  outcome: shortText(30),
}).passthrough();

const logSchema = z.object({
  id: clientId.optional(), experiment_id: clientId,
  day_no: z.coerce.number().int().min(1).max(7),
  slot: z.coerce.number().int().min(1).max(4),
  did_it: z.boolean().optional().default(false),
  note: shortText(500),
  energy: z.coerce.number().min(-2).max(2),
  created_at: z.any().optional(),
}).passthrough();

const evidenceSchema = z.object({
  id: clientId, type: shortText(20), content: z.string().min(1).max(300),
  source_exp_id: clientId, session_id: clientId.nullable().optional(),
  user_rejected: z.boolean().optional().default(false),
  rejected_at: z.any().nullable().optional(), created_at: z.any().optional(),
}).passthrough();

export const snapshotSchema = z.object({
  version: z.any().optional(),
  user: z.record(z.any()).optional(),
  sessions: z.array(sessionSchema).max(200).optional().default([]),
  experiments: z.array(experimentSchema).max(500).optional().default([]),
  logs: z.array(logSchema).max(2000).optional().default([]),
  evidence: z.array(evidenceSchema).max(500).optional().default([]),
  rejects: z.array(z.any()).max(500).optional().default([]),
  flags: z.record(z.any()).optional(),
  remind: z.record(z.any()).optional(),
  /* Human 3.0 顶层字段：显式声明 + passthrough，pull 时字段零丢失 */
  human3: z.record(z.any()).optional(),
}).passthrough();

/** 全量文本做危机信号复算：前端校验只是体验，服务端必须独立拦一次 */
export function assertSnapshotSafe(snap) {
  const texts = [];
  for (const s of snap.sessions) {
    texts.push(s.free_text, s.q2_detail, s.why_guess, s.uncertainty);
    for (const h of s.hypotheses) texts.push(h.reasoning, h.evidence_quote);
    for (const r of s.reviews) texts.push(r.basis);
  }
  for (const e of snap.experiments) texts.push(e.title, e.observation, ...e.actions);
  for (const l of snap.logs) texts.push(l.note);
  for (const ev of snap.evidence) texts.push(ev.content);
  /* Human 3.0 新增的 notes / dose / 参考画像也是自由文本，必须一并复算，
     递归收集而不是列字段名，避免以后加字段时开出绕过口 */
  texts.push(...collectHuman3Texts(snap));
  for (const t of texts) assertSafe(t, 'sync_snapshot');
}

/** 四象限坐标的结构红线：值域、份数上限、最小剂量必须指向真实实验 */
export function assertHuman3Rules(snap) {
  const problems = validateHuman3Snapshot(snap);
  if (problems.length) {
    throw new ValidationError('四象限坐标没有通过检查，本机数据没有上传', {
      fields: problems.slice(0, 10),
    });
  }
}

/** 产品两条铁律的服务端复算：证据必须绑定实验、必须来自有记录的实验、一次复盘最多 1 条 */
function assertEvidenceRules(snap) {
  const expIds = new Set(snap.experiments.map((e) => asId(e.id)));
  const expWithLogs = new Set(snap.logs.map((l) => asId(l.experiment_id)));
  const countByExp = new Map();

  for (const ev of snap.evidence) {
    const src = asId(ev.source_exp_id);
    if (!expIds.has(src)) {
      throw new ValidationError('证据必须能追溯到一次实验，这条证据的来源是空的');
    }
    if (!expWithLogs.has(src)) {
      throw new ValidationError('没有实验记录不允许产出证据：先记一次实验再收证据');
    }
    const n = (countByExp.get(src) || 0) + 1;
    if (n > 1) throw new ValidationError('一次复盘最多产出 1 条身份证据');
    countByExp.set(src, n);
  }
}

/** 丢掉引用了不存在父记录的孤立子记录，避免外键报错；返回丢弃数量 */
function dropOrphans(snap) {
  const sessionIds = new Set(snap.sessions.map((s) => asId(s.id)));
  const beforeE = snap.experiments.length;
  const experiments = snap.experiments.filter((e) => sessionIds.has(asId(e.session_id)));
  const expIds = new Set(experiments.map((e) => asId(e.id)));
  const beforeL = snap.logs.length;
  const logs = snap.logs.filter((l) => expIds.has(asId(l.experiment_id)));
  return {
    ...snap,
    experiments,
    logs,
    skipped: (beforeE - experiments.length) + (beforeL - logs.length),
  };
}

export const syncService = {
  async state(userId) {
    const meta = await syncRepo.getMeta(userId);
    const counts = await syncRepo.counts(userId);
    return {
      hasRemoteData: Boolean(meta),
      revision: meta ? Number(meta.revision) : 0,
      syncedAt: meta?.synced_at || null,
      counts: {
        sessions: Number(counts?.sessions || 0),
        hypotheses: Number(counts?.hypotheses || 0),
        experiments: Number(counts?.experiments || 0),
        evidence: Number(counts?.evidence || 0),
      },
    };
  },

  async pull(userId) {
    const remote = await syncRepo.getSnapshot(userId);
    if (!remote) return { hasRemoteData: false, snapshot: null, revision: 0, syncedAt: null };
    return {
      hasRemoteData: true,
      snapshot: remote.snapshot,
      revision: remote.revision,
      syncedAt: remote.syncedAt,
    };
  },

  async push(userId, { snapshot, baseRevision = 0, clientSentAt }) {
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new ValidationError('本机数据格式不对，没有上传', {
        fields: parsed.error.issues.slice(0, 10).map((i) => ({ field: i.path.join('.'), rule: i.code })),
      });
    }
    assertSnapshotSafe(parsed.data);
    const snap = dropOrphans(parsed.data);
    // 基于最终会落库的数据复算证据红线，避免孤立实验被丢弃后出现悬空证据
    assertEvidenceRules(snap);
    assertHuman3Rules(snap);

    const meta = await syncRepo.getMeta(userId);
    const currentRevision = meta ? Number(meta.revision) : 0;
    if (Number(baseRevision) !== currentRevision) {
      throw new ConflictError('云端数据在你之后被更新过，请先拉取再决定用哪一份', {
        serverRevision: currentRevision,
        clientRevision: Number(baseRevision),
        syncedAt: meta?.synced_at || null,
      });
    }
    const nextRevision = currentRevision + 1;

    const result = await transaction(async (q) => {
      // 事务内全量重建：重复 push 结果一致（幂等），中途失败整体回滚
      await syncRepo.deleteBusinessData(userId, q);
      const sessionMap = await syncRepo.insertSessions(userId, snap.sessions, q);
      const hypotheses = await syncRepo.insertHypotheses(snap.sessions, sessionMap, q);
      const templateMap = await syncRepo.templateIdMap(q);
      const experimentMap = await syncRepo.insertExperiments(snap.experiments, sessionMap, templateMap, q);
      const logs = await syncRepo.insertLogs(snap.logs, experimentMap, q);
      const evidenceMap = await syncRepo.insertEvidence(userId, snap.evidence, sessionMap, experimentMap, q);
      const reviews = await syncRepo.insertReviews(snap.sessions, sessionMap, experimentMap, evidenceMap, q);
      await syncRepo.upsertSnapshot(userId, JSON.stringify(snap), nextRevision, toDatetime(clientSentAt), q);
      return {
        sessions: sessionMap.size, hypotheses, experiments: experimentMap.size,
        logs, evidence: evidenceMap.size, reviews, skippedOrphans: snap.skipped,
      };
    });

    logger.info('sync.push_completed', { userId, revision: nextRevision, ...result });
    return { revision: nextRevision, syncedAt: new Date().toISOString(), applied: result };
  },

  /** 关闭云同步时清空云端副本；本机 localStorage 不受影响 */
  async clear(userId) {
    await transaction(async (q) => {
      await syncRepo.deleteBusinessData(userId, q);
      await syncRepo.deleteSnapshot(userId, q);
    });
    /* 匿名分布记录也随「关闭同步」一并删除。统计表是可选增强，
       若用户还没跑 002 迁移，静默跳过，不阻断主流程。 */
    try {
      await human3Repo.deleteForUser(userId);
    } catch (err) {
      logger.debug('human3.clear_skipped', { code: err?.code || null });
    }
    logger.info('sync.cleared', { userId });
    return { cleared: true };
  },
};
