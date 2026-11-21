/**
 * human3.js —— 由 human3.rules.js + human3.prompt.js + human3.repo.js + human3.service.js + human3.routes.js 合并而成。
 * 文件内按原分层顺序分区，各分区仍保持原 routes/service/repo 职责边界。
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AI_FORBIDDEN, assertSafe, asyncHandler, query as dbQuery, env, logger, ok, requireAuth, validateBody } from '../core.js';
import { aiUnavailable, callLLM, parseJsonLoose } from './diagnose.js';
import { jsonOr, toDatetime, truncate } from './mappers.js';

// ==================== 分区：规则与常量（原 features/human3/human3.rules.js） ====================
/**
 * Human 3.0 领域规则 —— 纯函数、零 IO、零 LLM。
 *
 * 安全红线：本项目 README §15 声明「不做心理评估、不打分、不贴标签」，
 * 且 safety.js 的 AI_FORBIDDEN 禁止模型输出评分/量表/诊断类内容。
 * 因此 12 格读数、瓶颈、阻塞链、阶段、参考画像、最小有效剂量
 * 全部由这里的确定性函数推导；LLM 只被允许改写「做法」的措辞。
 *
 * 前端 src/human3.js 是同一套逻辑的 ES5 等价实现（单文件页面不引打包器）。
 * 两边任何改动都要同步，并用 server/tests/human3.test.mjs 守住。
 */

export const QUADRANTS = ['mind', 'body', 'spirit', 'vocation'];
export const TRAITS = ['knowledge', 'experience', 'skill'];
export const QUADRANT_LABEL = { mind: '心智', body: '身体', spirit: '精神', vocation: '使命' };
export const TRAIT_LABEL = { knowledge: '知识', experience: '经验', skill: '技能' };
export const PHASE_LABEL = { 1: '不和谐', 2: '不确定', 3: '发现' };

/** 阻塞链：src 低会拖住 target */
export const BLOCKS = { body: 'spirit', mind: 'vocation', spirit: 'mind', vocation: 'body' };
/** 解锁链：src 高可以给 target 借力 */
export const UNLOCKS = [
  ['body', 'spirit'], ['body', 'mind'], ['mind', 'vocation'],
  ['mind', 'spirit'], ['vocation', 'body'], ['spirit', 'mind'],
];
export const BLOCK_TEXT = {
  body_spirit: '没力气的时候，很多「不想联系谁」其实只是累了',
  mind_vocation: '看不清机会在哪，往往不是机会不存在',
  spirit_mind: '没人给反馈，一个人很容易停止修正自己的想法',
  vocation_body: '时间和钱都被占满时，照顾身体最先被挤掉',
};
export const UNLOCK_TEXT = {
  body_spirit: '先把力气补回来，深一点的连接才有力气维系',
  body_mind: '睡够了、动一动，脑子会明显清爽',
  mind_vocation: '想清楚了，才看得见哪条路是自己的',
  mind_spirit: '先能觉察自己，才谈得上真正的亲密',
  vocation_body: '手头宽裕一点，才有余力照顾身体',
  spirit_mind: '有人接着，才敢质疑自己一直相信的东西',
};

/** 最小有效剂量：4 象限 × 3 阶段；动词开头 + 时间/次数/交付物，24h 内能做第一步 */
export const DOSE = {
  mind: [
    ['把这一块最说不清的一句话写下来，圈出哪部分是听说的', 15],
    ['每天挑一个自己做过的决定，写一句当时凭什么', 15],
    ['把这一块管用的做法讲给一位同学听，记下他问的问题', 20],
  ],
  body: [
    ['晚饭后走 15 分钟，回来记一句身体什么感觉', 15],
    ['连续 3 天固定同一个入睡时间，早上记一次起床状态', 20],
    ['把现在管用的作息写成 3 行，一周后照着核对一次', 15],
  ],
  spirit: [
    ['这一周约一位同学吃一次饭，只聊近况不聊任务', 30],
    ['每周给一位久没联系的人发一句具体的话，共 2 次', 15],
    ['把一次聊得舒服的对话记下来，写清当时你做了什么', 20],
  ],
  vocation: [
    ['找一件这周做完的小事，写清交付给谁、有没有用', 20],
    ['每周试一种不同的做法，记下哪一种少返工，共 2 次', 30],
    ['把手上在做的整理成一页，标出哪一步最常被卡住', 30],
  ],
};
export const SUPPORT = {
  mind: '每天睡前用 3 行写下今天想明白的一件事',
  body: '晚饭后走 15 分钟，给思路留点空隙',
  spirit: '每周约一位同学一起做一次，有人同行更容易连起来',
  vocation: '把这周做成的一件小事写下来，看看它通向哪里',
};
export const CAVEAT = '这是你自己标的坐标，不是结论，随时可以改。';

const isCell = (v) => v === 1 || v === 2 || v === 3;

/** 象限读数：缺格不猜测、不补零，返回 null。只用于排序与图形长度，不向用户显示数字 */
export function readGrid(grid) {
  const out = {};
  for (const q of QUADRANTS) {
    const cells = TRAITS.map((t) => grid?.[q]?.[t]).filter(isCell);
    out[q] = cells.length === 3 ? (cells[0] + cells[1] + cells[2]) / 3 : null;
  }
  return out;
}

/** 最低象限；并列时按 body > mind > spirit > vocation 的固定优先级（先解决最基础的条件） */
export function bottleneck(grid) {
  const r = readGrid(grid);
  const order = ['body', 'mind', 'spirit', 'vocation'];
  let best = null;
  for (const q of order) {
    if (r[q] === null) continue;
    if (best === null || r[q] < r[best] - 1e-9) best = q;
  }
  return best;
}

/** 病根象限（差值至少 0.34 = 一格），以及可借力的支撑象限 */
export function blockedBy(grid, target) {
  const r = readGrid(grid);
  if (!target || r[target] === null) return { blockedBy: null, supportFrom: null, chainText: '' };
  let blocked = null;
  for (const src of Object.keys(BLOCKS)) {
    if (BLOCKS[src] === target && r[src] !== null && r[src] < r[target] - 0.34) { blocked = src; break; }
  }
  let support = null;
  for (const [src, dst] of UNLOCKS) {
    if (dst !== target || r[src] === null) continue;
    if (!support || r[src] > r[support]) support = src;
  }
  const chainText = blocked
    ? (BLOCK_TEXT[`${blocked}_${target}`] || '')
    : (support ? (UNLOCK_TEXT[`${support}_${target}`] || '') : '');
  return { blockedBy: blocked, supportFrom: support, chainText };
}

/** 三道行为题取众数；平票取较低阶段，宁可判早，不判早熟（防假性好转） */
export function inferPhase(answers) {
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const v = answers?.[i];
    if (isCell(v)) c[v - 1]++;
  }
  let best = 1;
  for (let i = 1; i < 3; i++) if (c[i] > c[best - 1]) best = i + 1;
  return best;
}

/** 偏科提示：只给一句描述 + 一个追问，不给改进评分 */
export function traitBalance(grid, q) {
  const g = grid?.[q] || {};
  const { knowledge: k, experience: e, skill: s } = g;
  if (!(isCell(k) && isCell(e) && isCell(s))) return null;
  if (k >= e + 1 && k >= s + 1) return { text: '知道得不少，但还没怎么用过', ask: '带我走一遍你每天怎么用它的？' };
  if (e >= k + 1 && e >= s + 1) return { text: '做过不少，但说不清什么时候有效', ask: '哪一次做成了？当时和别的时候有什么不同？' };
  if (s >= k + 1) return { text: '做得顺，但说不清背后的道理', ask: '换个场景，你会怎么改？' };
  return null;
}

/** 参考画像：确定性查表，同一输入恒定输出，措辞不是结论 */
export function archetype(grid) {
  const r = readGrid(grid);
  const arr = QUADRANTS.filter((q) => r[q] !== null).map((q) => ({ q, v: r[q] }));
  if (arr.length < 4) return { key: '', label: '还没标完', caveat: CAVEAT };
  arr.sort((a, b) => a.v - b.v || QUADRANTS.indexOf(a.q) - QUADRANTS.indexOf(b.q));
  const key = `${arr[0].q}_${arr[3].q}`;
  const TABLE = {
    mind_body: '先把日子过稳，再谈想明白', body_mind: '身子先动起来，思路跟着松',
    mind_spirit: '想得清楚，也在学着靠近人', spirit_mind: '有人同行，才敢多想一步',
    mind_vocation: '从想清楚到做出来', vocation_mind: '在做事里把问题想透',
    body_spirit: '力气回来了，连接才有余地', spirit_body: '被人接住，才顾得上自己',
    body_vocation: '把作息稳住，手上的事才推得动', vocation_body: '事情在推进，身体别掉队',
    spirit_vocation: '从关系里长出去向', vocation_spirit: '做事的路上重新学会相处',
  };
  return { key, label: TABLE[key] || '四块都在慢慢长', caveat: CAVEAT };
}

export function makeDose({ bottleneck: b = 'body', phases = {}, support_from: sup = null, start_at = Date.now() } = {}) {
  const target = DOSE[b] ? b : 'body';
  const ph = [1, 2, 3].includes(phases?.[target]) ? phases[target] : 1;
  const [action, minutes] = DOSE[target][ph - 1];
  const supportFrom = (sup && QUADRANTS.includes(sup) && sup !== target)
    ? sup
    : QUADRANTS.find((q) => q !== target);
  return {
    action,
    minutes,
    support_from: supportFrom,
    support: SUPPORT[supportFrom],
    start_at,
    check_at: start_at + 7 * 86400000,
    review_at: start_at + 90 * 86400000,
    experiment_id: null,
  };
}

export function filled(grid) {
  let n = 0;
  for (const q of QUADRANTS) for (const t of TRAITS) if (isCell(grid?.[q]?.[t])) n++;
  return n;
}

/**
 * 收集 human3 里所有自由文本，交给服务端危机复算。
 * 新增字段最容易开绕过口，因此这里递归收集 notes，而不是逐个列字段名。
 */
export function collectHuman3Texts(snap) {
  const texts = [];
  const list = Array.isArray(snap?.human3?.assessments) ? snap.human3.assessments : [];
  const walk = (v, depth = 0) => {
    if (v == null || depth > 5) return;
    if (typeof v === 'string') { texts.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    walk(a.notes);
    if (a.dose) { texts.push(a.dose.action, a.dose.support); }
    if (a.archetype_label) texts.push(a.archetype_label);
  }
  return texts;
}

/** 快照写入前的结构校验；返回问题描述数组，由调用方抛类型化错误 */
export function validateHuman3Snapshot(snap) {
  const h = snap?.human3;
  if (!h || typeof h !== 'object') return [];
  const problems = [];
  const list = Array.isArray(h.assessments) ? h.assessments : [];
  if (list.length > 12) problems.push('四象限坐标最多保留 12 份');
  const expIds = new Set((snap.experiments || []).map((e) => String(e?.id)));
  for (const a of list) {
    if (!a || typeof a !== 'object') { problems.push('坐标记录格式不对'); continue; }
    for (const q of QUADRANTS) {
      for (const t of TRAITS) {
        const v = a.grid?.[q]?.[t];
        if (!(isCell(v) || v === null || v === undefined)) {
          problems.push(`${q}.${t} 只能是 1 / 2 / 3 或空`);
        }
      }
    }
    const eid = a.dose?.experiment_id;
    if (eid != null && eid !== '' && !expIds.has(String(eid))) {
      problems.push('最小有效剂量引用的实验不存在');
    }
  }
  return problems;
}

// ==================== 分区：提示词构建（原 features/human3/human3.prompt.js） ====================
/**
 * Human 3.0 服务端提示词模板 —— 只有模板，不含密钥、不含用户输入原文。
 *
 * 边界：LLM 只看到「用户原话 + 一句已经由确定性规则定好的象限/阶段标签」，
 * 绝不把 12 格读数、levels、参考画像 key 交给模型解读，否则等于绕过
 * §3 红线做测评。输出沿用 generateActions 的 {t,d,why} 三段式。
 */

export const human3SystemPrompt = [
  '你在帮一个在校学生把「这一周打算做的一件小事」写得更贴合他自己说的处境。',
  '规则：只给做法，不判断、不评价、不打分、不贴标签，不做任何心理或医学类判断；',
  '不使用百分比、分数、等级、量表、筛查、诊断等词；',
  '不追问、不寒暄；每条以动词开头，必须含时间、次数或交付物，24 小时内能做完第一步；',
  '只输出一个 JSON 数组，不要解释、不要代码块标记；',
  '固定 3 个元素：{"t":"12字内的做法名","d":"40字内的具体做法","why":"24字内，说明为什么贴合这个人当下的处境"}。',
].join('');

export function buildHuman3UserPrompt(payload) {
  const q = QUADRANT_LABEL[payload.bottleneck] || '这一块';
  const ph = PHASE_LABEL[payload.phase] || '不和谐';
  return [
    `TA 自己写的现状（原话）：${String(payload.free_text || '').slice(0, 480)}`,
    `最费劲的那一块：${q}`,
    `当前阶段：${ph}`,
    `规则引擎给的最小动作：${String(payload.dose || '').slice(0, 120)}`,
    `从另一块借来的支撑动作：${String(payload.support || '').slice(0, 120)}`,
    `现有这一周的安排，供参考、可以整体替换：${(payload.actions || []).join('；').slice(0, 600)}`,
  ].join('\n');
}

/** 前端与服务端共用的禁用词表；UI 文案也要避开 */
export const HUMAN3_UI_BAN = [
  '评分', '分数', '得分', '等级', '量表', '筛查', '诊断', '治疗',
  '焦虑', '抑郁', '健康度', '你是 X 型人',
];

// ==================== 分区：数据访问层（原 features/human3/human3.repo.js） ====================
/**
 * 匿名分布统计的数据访问。只写 SQL。
 * 表 human3_assessments 由 002_human3 迁移创建，只存结构化坐标，
 * 前端 notes / 卡点原文一律不进这张表。
 */
export const human3Repo = {
  /** 同一评估 id 重复提交幂等覆盖；一个用户可以有多份历史坐标 */
  async upsert(userId, a) {
    return dbQuery(
      `INSERT INTO human3_assessments
         (id, user_id, schema_ver, grid, phases, bottleneck, blocked_by,
          archetype_key, status, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         grid = VALUES(grid),
         phases = VALUES(phases),
         bottleneck = VALUES(bottleneck),
         blocked_by = VALUES(blocked_by),
         archetype_key = VALUES(archetype_key),
         status = VALUES(status),
         updated_at = VALUES(updated_at)`,
      [
        truncate(a.id, 64),
        userId,
        jsonOr(a.grid, {}),
        jsonOr(a.phases, {}),
        a.bottleneck || null,
        a.blocked_by || null,
        a.archetype_key ? truncate(a.archetype_key, 32) : null,
        a.status || 'report',
        toDatetime(a.created_at || Date.now()),
        toDatetime(Date.now()),
      ]
    );
  },

  /** 每人只取最新一份坐标参与聚合，避免多份历史把分布拉偏 */
  async distribution() {
    const byQuadrant = await dbQuery(
      `SELECT a.bottleneck AS bottleneck, COUNT(*) AS n
         FROM human3_assessments a
        WHERE a.bottleneck IS NOT NULL
          AND a.updated_at = (
            SELECT MAX(b.updated_at) FROM human3_assessments b WHERE b.user_id = a.user_id
          )
        GROUP BY a.bottleneck`
    );
    const totalRows = await dbQuery('SELECT COUNT(DISTINCT user_id) AS n FROM human3_assessments');
    return { byQuadrant, total: Number(totalRows?.[0]?.n || 0) };
  },

  /** 关闭云同步时一并清掉该用户的匿名坐标（本机 localStorage 不受影响） */
  async deleteForUser(userId, q) {
    const run = q || dbQuery;
    return run('DELETE FROM human3_assessments WHERE user_id = ?', [userId]);
  },
};

// ==================== 分区：业务逻辑层（原 features/human3/human3.service.js） ====================
/** 少于这个人数不展示分布，避免小样本对上号 */
const MIN_SAMPLES = 5;

/**
 * Human 3.0 服务层：
 * 1) AI 精修复用 diagnose 的 callLLM / parseJsonLoose / 双预算重试，不另造一条密钥链路；
 * 2) 匿名分布只做聚合，不足 MIN_SAMPLES 直接返回 unavailable。
 * 所有评分 / 瓶颈 / 参考画像都不经过这里，见 human3.rules.js。
 */
export const human3Service = {
  async generateActions(payload) {
    assertSafe(payload.free_text, 'human3');
    if (!env.llmEnabled) throw aiUnavailable('AI_DISABLED');

    const messages = [
      { role: 'system', content: human3SystemPrompt },
      { role: 'user', content: buildHuman3UserPrompt(payload) },
    ];

    // 思考型模型可能先耗尽预算，遇到 max_tokens 报错时降档重试一次
    for (const budget of [8000, 1500]) {
      try {
        const content = await callLLM(messages, budget);
        const parsed = parseJsonLoose(content);
        if (!Array.isArray(parsed)) continue;
        const items = parsed.slice(0, 3).map((it) => ({
          t: String(it?.t || '').slice(0, 12),
          d: String(it?.d || '').slice(0, 40),
          why: String(it?.why || '').slice(0, 24),
        })).filter((it) => it.t && it.d);
        if (items.length !== 3) continue;
        // 输出硬校验：不打分、不贴诊断标签；命中整批作废
        if (items.some((it) => AI_FORBIDDEN.test(`${it.t}${it.d}${it.why}`))) {
          logger.warn('human3.actions_forbidden_wording', { budget });
          continue;
        }
        logger.info('human3.actions_succeeded', { budget });
        return { items };
      } catch (err) {
        logger.warn('human3.actions_call_failed', { budget, status: err?.status || null });
        if (!(err?.status === 400 && budget > 1500)) break;
      }
    }
    throw aiUnavailable('AI_DEGRADED:human3');
  },

  async submitAssessment(userId, assessment) {
    await human3Repo.upsert(userId, assessment);
    // 只记聚合所需的结构化信息，不打印任何自由文本
    logger.info('human3.assessment_saved', { userId, quadrant: assessment.bottleneck });
    return { saved: true };
  },

  async distribution() {
    const { byQuadrant, total } = await human3Repo.distribution();
    if (total < MIN_SAMPLES) {
      return {
        available: false,
        total,
        reason: '样本还太少，暂时不展示分布（避免对上号）',
        quadrants: {},
      };
    }
    const quadrants = {};
    for (const q of QUADRANTS) quadrants[q] = 0;
    for (const row of byQuadrant) {
      if (Object.prototype.hasOwnProperty.call(quadrants, row.bottleneck)) {
        quadrants[row.bottleneck] = Number(row.n);
      }
    }
    return { available: true, total, quadrants };
  },
};

// ==================== 分区：路由层（原 features/human3/human3.routes.js） ====================
const router = Router();

// 与 diagnose 同档严格限流：这是唯一会消耗服务端 LLM 密钥的新入口
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '生成太频繁，请稍后再试' } },
});

const quadrant = z.enum(['mind', 'body', 'spirit', 'vocation']);
const cell = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);
const traitShape = z.object({ knowledge: cell, experience: cell, skill: cell });

const actionsSchema = z.object({
  free_text: z.string().max(480).optional().default(''),
  bottleneck: quadrant,
  phase: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dose: z.string().max(120),
  support: z.string().max(120).optional().default(''),
  actions: z.array(z.string().max(200)).max(3).optional().default([]),
});

/** 匿名分布只收结构化坐标；任何自由文本字段都不在这个 schema 里 */
const assessmentSchema = z.object({
  id: z.string().min(1).max(64),
  grid: z.object({
    mind: traitShape, body: traitShape, spirit: traitShape, vocation: traitShape,
  }),
  phases: z.record(z.any()).optional().default({}),
  bottleneck: quadrant.nullable(),
  blocked_by: quadrant.nullable().optional().default(null),
  archetype_key: z.string().max(32).nullable().optional().default(null),
  status: z.enum(['draft', 'report', 'dosed', 'reviewing', 'archived']).optional().default('report'),
  created_at: z.any().optional(),
});

/** 无状态措辞精修；未配置 LLM 时 503 + AI_DISABLED，前端静默回落规则模板 */
router.post('/api/v1/human3/actions', limiter, validateBody(actionsSchema), asyncHandler(async (req, res) => {
  return ok(res, await human3Service.generateActions(req.body));
}));

/** 显式「加入匿名分布」才写入；不与同步快照共用写入路径 */
router.post('/api/v1/human3/assessments', requireAuth, validateBody(assessmentSchema), asyncHandler(async (req, res) => {
  return ok(res, await human3Service.submitAssessment(req.user.id, req.body));
}));

/** 公开聚合结果：不足 5 人返回 unavailable，不含任何个人标识或文字 */
router.get('/api/v1/human3/distribution', asyncHandler(async (_req, res) => {
  return ok(res, await human3Service.distribution());
}));

export default router;
