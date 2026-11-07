/**
 * Human 3.0 服务端提示词模板 —— 只有模板，不含密钥、不含用户输入原文。
 *
 * 边界：LLM 只看到「用户原话 + 一句已经由确定性规则定好的象限/阶段标签」，
 * 绝不把 12 格读数、levels、参考画像 key 交给模型解读，否则等于绕过
 * §3 红线做测评。输出沿用 generateActions 的 {t,d,why} 三段式。
 */
import { QUADRANT_LABEL, PHASE_LABEL } from './human3.rules.js';

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
