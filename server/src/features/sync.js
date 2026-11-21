/**
 * sync.js —— 由 sync.repo.js + sync.service.js + sync.routes.js 合并而成。
 * 文件内按原分层顺序分区，各分区仍保持原 routes/service/repo 职责边界。
 */
import { Router } from 'express';
import { z } from 'zod';
import { ConflictError, ValidationError, assertSafe, asyncHandler, query as dbQuery, logger, ok, requireAuth, transaction, validateBody } from '../core.js';
import { collectHuman3Texts, human3Repo, validateHuman3Snapshot } from './human3.js';
import { asId, jsonOr, mapConfidence, mapEngine, mapEnum, mapEvidenceType, mapNextAction, mapOutcome, mapQ5, mapStatus, toDatetime, truncate } from './mappers.js';

// ==================== 分区：数据访问层（原 features/sync/sync.repo.js） ====================
/**
 * 同步仓储：整个 push 在一个事务里完成「按依赖顺序清空该用户业务数据 → 全量重建」。
 * 这是离线优先快照同步最可靠的幂等策略，且不动课程设计 19 张表的结构。
 * 完整快照另存 sync_snapshots，pull 时原样还原，前端字段零丢失。
 */
export const syncRepo = {
  async getMeta(userId) {
    const rows = await dbQuery(
      'SELECT revision, synced_at, client_sent_at FROM sync_snapshots WHERE user_id = ? LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  },

  async getSnapshot(userId) {
    const rows = await dbQuery(
      'SELECT snapshot, revision, synced_at, client_sent_at FROM sync_snapshots WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) return null;
    let snapshot;
    try { snapshot = JSON.parse(rows[0].snapshot); } catch { snapshot = null; }
    return { snapshot, revision: Number(rows[0].revision), syncedAt: rows[0].synced_at, clientSentAt: rows[0].client_sent_at };
  },

  async counts(userId) {
    const rows = await dbQuery(
      `SELECT
         (SELECT COUNT(*) FROM stuck_sessions WHERE user_id = ?) AS sessions,
         (SELECT COUNT(*) FROM hypotheses h JOIN stuck_sessions s ON s.id = h.session_id WHERE s.user_id = ?) AS hypotheses,
         (SELECT COUNT(*) FROM experiments e JOIN stuck_sessions s ON s.id = e.session_id WHERE s.user_id = ?) AS experiments,
         (SELECT COUNT(*) FROM evidence_items WHERE user_id = ?) AS evidence`,
      [userId, userId, userId, userId]
    );
    return rows[0];
  },

  async deleteBusinessData(userId, q) {
    const sessionsOfUser = 'SELECT id FROM stuck_sessions WHERE user_id = ?';
    await q(`DELETE FROM reviews WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q('DELETE FROM evidence_items WHERE user_id = ?', [userId]);
    await q(
      `DELETE FROM experiment_logs WHERE experiment_id IN
         (SELECT id FROM experiments WHERE session_id IN (${sessionsOfUser}))`,
      [userId]
    );
    await q(`DELETE FROM experiments WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q(`DELETE FROM hypotheses WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q('DELETE FROM stuck_sessions WHERE user_id = ?', [userId]);
  },

  async templateIdMap(q) {
    const rows = await q('SELECT id, template_key FROM experiment_templates');
    return new Map(rows.map((r) => [String(r.template_key), Number(r.id)]));
  },

  async insertSessions(userId, sessions, q) {
    const map = new Map();
    for (const s of sessions) {
      const a = s.answers || {};
      const result = await q(
        `INSERT INTO stuck_sessions
           (user_id, root_id, round_no, free_text, q1_hours, q2_progress, q2_detail,
            q3_method_switch, q4_no_external, q5_peer, rule_top, rule_second,
            rule_scores, engine_used, safety_flagged, status, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          userId,
          Math.min(3, Math.max(1, Number(s.round_no) || 1)),
          truncate(s.free_text, 1000),
          mapEnum(a.q1, 'q1'),
          mapEnum(a.q2, 'q2'),
          truncate(s.q2_detail ?? a.q2_detail, 300),
          mapEnum(a.q3, 'q3'),
          mapEnum(a.q4, 'q4'),
          mapQ5(a.q5),
          truncate(s.rule_top, 20),
          truncate(s.rule_second, 20),
          jsonOr(s.rule_scores, {}),
          mapEngine(s.engine),
          mapStatus(s.status),
          toDatetime(s.created_at),
        ]
      );
      map.set(asId(s.id), Number(result.insertId));
    }
    // root_id 自引用：所有会话都落库后再回填（MySQL 触发器不能改同表字段）
    for (const s of sessions) {
      const self = map.get(asId(s.id));
      const root = s.root_id ? map.get(asId(s.root_id)) : null;
      if (self && root) await q('UPDATE stuck_sessions SET root_id = ? WHERE id = ?', [root, self]);
    }
    return map;
  },

  async insertHypotheses(sessions, sessionMap, q) {
    let n = 0;
    for (const s of sessions) {
      const sessionId = sessionMap.get(asId(s.id));
      if (!sessionId) continue;
      const list = Array.isArray(s.hypotheses) ? s.hypotheses.slice(0, 3) : [];
      for (const [i, h] of list.entries()) {
        await q(
          `INSERT INTO hypotheses
             (session_id, type_code, rank_no, confidence, reasoning, evidence_quote, evidence_from, user_disagreed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            truncate(h.type, 20) || 'A_METHOD',
            i + 1, // UNIQUE(session_id, rank_no)，用序号而非客户端 rank 保证不冲突
            mapConfidence(h.confidence),
            truncate(h.reasoning, 60),
            truncate(h.evidence_quote, 500),
            truncate(h.evidence_from, 40) || '你写的原话',
            h.disagreed ? 1 : 0,
          ]
        );
        n++;
      }
    }
    return n;
  },

  async insertExperiments(experiments, sessionMap, templateMap, q) {
    const map = new Map();
    for (const e of experiments) {
      const sessionId = sessionMap.get(asId(e.session_id));
      if (!sessionId) continue;
      const result = await q(
        `INSERT INTO experiments
           (session_id, hypothesis_id, template_id, type_code, title, actions_json,
            observation, duration_days, started_at, ended_at, outcome)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          templateMap.get(String(e.template_key)) || null,
          truncate(e.type, 20),
          truncate(e.title, 200) || '分辨实验',
          jsonOr(e.actions, []),
          truncate(e.observation, 300) || '观察做完之后发生了什么',
          Math.min(30, Math.max(1, Number(e.duration_days) || 7)),
          e.started_at ? toDatetime(e.started_at) : null,
          e.ended_at ? toDatetime(e.ended_at) : null,
          mapOutcome(e.outcome),
        ]
      );
      map.set(asId(e.id), Number(result.insertId));
    }
    return map;
  },

  async insertLogs(logs, experimentMap, q) {
    let n = 0;
    for (const l of logs) {
      const experimentId = experimentMap.get(asId(l.experiment_id));
      if (!experimentId) continue;
      await q(
        `INSERT INTO experiment_logs
           (experiment_id, day_no, slot, did_it, note, energy, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           slot = VALUES(slot), did_it = VALUES(did_it), note = VALUES(note), energy = VALUES(energy)`,
        [
          experimentId,
          Math.min(7, Math.max(1, Number(l.day_no) || 1)),
          Math.min(4, Math.max(1, Number(l.slot) || 1)),
          l.did_it ? 1 : 0,
          truncate(l.note, 500),
          Math.min(2, Math.max(-2, Number(l.energy) || 0)),
          toDatetime(l.created_at),
        ]
      );
      n++;
    }
    return n;
  },

  async insertEvidence(userId, evidence, sessionMap, experimentMap, q) {
    const map = new Map();
    for (const ev of evidence) {
      const sourceExpId = experimentMap.get(asId(ev.source_exp_id));
      if (!sourceExpId) continue; // 服务层已保证不会走到这里
      const rejected = Boolean(ev.user_rejected);
      const result = await q(
        `INSERT INTO evidence_items
           (user_id, session_id, evidence_type, content, source_exp_id, source_log_id,
            user_rejected, rejected_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          userId,
          sessionMap.get(asId(ev.session_id)) || null,
          mapEvidenceType(ev.type),
          truncate(ev.content, 300),
          sourceExpId,
          rejected ? 1 : 0,
          rejected ? toDatetime(ev.rejected_at || ev.created_at) : null,
          toDatetime(ev.created_at),
        ]
      );
      map.set(asId(ev.id), Number(result.insertId));
    }
    return map;
  },

  async insertReviews(sessions, sessionMap, experimentMap, evidenceMap, q) {
    let n = 0;
    for (const s of sessions) {
      const sessionId = sessionMap.get(asId(s.id));
      if (!sessionId) continue;
      for (const r of (Array.isArray(s.reviews) ? s.reviews : [])) {
        await q(
          `INSERT INTO reviews
             (session_id, experiment_id, outcome, converge_to, basis, evidence_id, next_action, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            experimentMap.get(asId(r.experiment_id)) || null,
            mapOutcome(r.outcome) || 'inconclusive',
            truncate(r.converge_to, 20),
            truncate(r.basis, 1000),
            evidenceMap.get(asId(r.evidence_id)) || null,
            mapNextAction(r.next_action),
            toDatetime(r.created_at),
          ]
        );
        n++;
      }
    }
    return n;
  },

  async upsertSnapshot(userId, snapshotJson, revision, clientSentAt, q) {
    await q(
      `INSERT INTO sync_snapshots (user_id, snapshot, revision, client_sent_at, synced_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         snapshot = VALUES(snapshot), revision = VALUES(revision),
         client_sent_at = VALUES(client_sent_at), synced_at = NOW()`,
      [userId, snapshotJson, revision, clientSentAt]
    );
  },

  async deleteSnapshot(userId, q) {
    await q('DELETE FROM sync_snapshots WHERE user_id = ?', [userId]);
  },
};

// ==================== 分区：业务逻辑层（原 features/sync/sync.service.js） ====================
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

// ==================== 分区：路由层（原 features/sync/sync.routes.js） ====================
const router = Router();

const pushSchema = z.object({
  snapshot: z.any(),
  baseRevision: z.number().int().min(0).optional().default(0),
  clientSentAt: z.string().max(40).optional(),
});

// 云同步全部接口都需要登录：默认离线状态下一字节都不上传
router.use('/api/v1/sync', requireAuth);

/** 同步状态：供前端判断是否开启过同步、当前云端版本 */
router.get('/api/v1/sync/state', asyncHandler(async (req, res) => {
  return ok(res, await syncService.state(req.user.id));
}));

/** 拉取云端快照（原样还原，字段零丢失） */
router.get('/api/v1/sync/pull', asyncHandler(async (req, res) => {
  return ok(res, await syncService.pull(req.user.id));
}));

/** 上传本机快照：服务端复算危机拦截与证据红线，事务内幂等落库 */
router.post('/api/v1/sync/push', validateBody(pushSchema), asyncHandler(async (req, res) => {
  const result = await syncService.push(req.user.id, req.body);
  return ok(res, result);
}));

/** 关闭云同步：只删云端副本，本机 localStorage 不动 */
router.delete('/api/v1/sync', asyncHandler(async (req, res) => {
  return ok(res, await syncService.clear(req.user.id));
}));

export default router;
