import { SafetyBlockedError } from './errors.js';

/**
 * 危机信号双通道检测 —— 前端 detectCrisis() 的服务端等价实现。
 * 合规校验必须在服务端复算：前端校验只是体验，绕过前端不能写库。
 * 宁可误报：命中即中止，不落原文。
 */
export const CRISIS_WORDS = [
  '自杀', '轻生', '不想活', '活着没意义', '想死', '结束生命', '了结自己',
  '自残', '割腕', '跳楼', '吞药', '安眠药', '活不下去', '一了百了',
  '死了算了', '消失掉算了', '不想存在',
];
const NEG_WORDS = ['绝望', '撑不住', '崩溃', '没意义', '很痛苦', '熬不下去', '窒息', '麻木', '什么都做不好'];
const EXTREME_WORDS = ['永远', '再也', '彻底', '永远都不会好', '所有人', '没有人会', '完全没有'];
const FUNCTION_HIT = ['长期失眠', '每天失眠', '睡不着', '吃不下', '起不来床', '课都上不了', '不想出门', '把自己关起来', '无法上课'];

const hasAny = (text, words) => words.some((w) => text.includes(w));

export function detectCrisis(text) {
  const t = String(text || '');
  if (!t.trim()) return { hit: false };
  for (const word of CRISIS_WORDS) {
    if (t.includes(word)) return { hit: true, channel: 'keyword', word };
  }
  const neg = hasAny(t, NEG_WORDS);
  const ext = hasAny(t, EXTREME_WORDS);
  const fn = hasAny(t, FUNCTION_HIT);
  if (neg && ext) return { hit: true, channel: 'rule', word: '持续负面 + 绝对化表达' };
  if (neg && fn) return { hit: true, channel: 'rule', word: '持续负面 + 功能受损' };
  if (fn && ext) return { hit: true, channel: 'rule', word: '功能受损 + 绝对化表达' };
  return { hit: false };
}

/** 命中即抛错；用于所有写库入口 */
export function assertSafe(text, scope = 'content') {
  const c = detectCrisis(text);
  if (c.hit) {
    // 只记录通道与范围，绝不记录原文
    throw new SafetyBlockedError(c.channel);
  }
  return c;
}

/** AI 输出禁用项：不打分、不贴诊断标签 */
export const AI_FORBIDDEN = /\d+(\.\d+)?\s*%|\d+\s*分|分以上|评分|焦虑|抑郁|量表|筛查|诊断报告/;
