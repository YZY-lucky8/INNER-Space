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
