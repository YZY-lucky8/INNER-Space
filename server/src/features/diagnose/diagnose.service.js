import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { ServiceUnavailableError } from '../../shared/errors.js';
import { assertSafe, AI_FORBIDDEN } from '../../shared/safety.js';

/**
 * LLM 代理：密钥只在服务端，前端永不接触。
 * 原文只用于这一次推理，不落库、不进日志；未配置 LLM 时明确返回 AI_DISABLED，
 * 由前端已有的三级静默降级接管，服务端绝不伪造诊断结果。
 */
const TYPE_CODES = ['A_METHOD', 'B_SKILL', 'C_MEANING', 'D_CONTEXT', 'E_DIRECTION'];
const TEMPLATE_KEYS = ['A1', 'B1', 'C1', 'D1', 'E1']; // 与 database/schema.sql 静态模板一致

export function aiUnavailable(reason) {
  return new ServiceUnavailableError('AI 精修暂不可用，已自动使用规则引擎结果', {
    code: reason,
    fallback: 'rule',
  });
}

export function parseJsonLoose(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const startObj = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const start = startArr >= 0 && (startObj < 0 || startArr < startObj) ? startArr : startObj;
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export async function callLLM(messages, maxTokens = 1600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);
  try {
    const url = `${env.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`llm_http_${resp.status}`);
      err.status = resp.status;
      err.body = (await resp.text().catch(() => '')).slice(0, 500);
      throw err;
    }
    const data = await resp.json();
    const msg = data?.choices?.[0]?.message || {};
    return msg.content || msg.reasoning_content || '';
  } finally {
    clearTimeout(timer);
  }
}

/** 服务端先做一遍 AI 输出硬校验，前端 validateAISchema 会再做一遍（双保险） */
function validateDiagnosis(raw, input) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.hypotheses)) return null;
  const hs = raw.hypotheses;
  if (hs.length < 2 || hs.length > 3) return null;
  const candidates = (input.candidates || [input.rule_top, input.rule_second])
    .filter((c) => TYPE_CODES.includes(c));
  const freeText = String(input.free_text || '');
  const clean = [];

  for (const h of hs) {
    if (!TYPE_CODES.includes(h.type) || !candidates.includes(h.type)) return null;
    if (!['low', 'medium', 'high'].includes(h.confidence)) return null;
    const quote = String(h.evidence_quote || '');
    if (!quote || freeText.indexOf(quote) < 0) return null; // 逐字引用，禁止编造
    let reasoning = String(h.reasoning || '').slice(0, 60);
    if (AI_FORBIDDEN.test(reasoning)) return null;         // 不打分、不诊断贴标签
    clean.push({
      type: h.type,
      rank: clean.length + 1,
      confidence: h.confidence,
      reasoning,
      evidence_quote: quote,
      evidence_from: '你写的原话',
      disagreed: false,
    });
  }
  const key = TEMPLATE_KEYS.includes(raw.experiment_key) ? raw.experiment_key : `${clean[0].type[0]}1`;
  return {
    hypotheses: clean,
    uncertainty: String(raw.uncertainty || '现在还分不出是哪一种，实验会帮你看清。').slice(0, 60),
    why_guess: String(raw.why_guess || '').slice(0, 90),
    experiment_key: key,
    engine: 'ai',
  };
}

export const diagnoseService = {
  /** 对应前端 AI_ENDPOINT = '/api/v1/diagnose' 的 DiagnosisOutput 契约 */
  async diagnose(input) {
    assertSafe(input.free_text, 'diagnose');
    if (!env.llmEnabled) throw aiUnavailable('AI_DISABLED');

    const system = [
      '你在帮一个在校学生把「我卡住了」整理成可以验证的假设。',
      '规则：只基于用户原话与五道行为题，不臆测、不评价、不打分、不贴人格标签、不做心理或医学判断。',
      '只输出一个 JSON 对象，不要解释、不要代码块标记。格式为：',
      '{"hypotheses":[{"type":"候选类型码","confidence":"low|medium|high","evidence_quote":"用户原文里的逐字片段","reasoning":"60字内，说明为什么这么猜"}],',
      '"uncertainty":"60字内的不确定部分","why_guess":"90字内","experiment_key":"A1|B1|C1|D1|E1"}',
      'hypotheses 必须 2–3 条，type 只能从给定候选集里选，evidence_quote 必须是原话里逐字出现的连续片段。',
      '禁止出现百分比、分数、「分以上」、诊断、治疗、量表等词。',
    ].join('');
    const user = [
      `候选类型（只能从中选）：${(input.candidates || []).join(', ')}`,
      `规则引擎首猜：${input.rule_top}；次猜：${input.rule_second}`,
      `用户原话：${input.free_text}`,
      `五道行为题回答：${JSON.stringify(input.answers || {})}`,
    ].join('\n');

    let lastReason = 'schema_fail';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const content = await callLLM([
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]);
        const parsed = parseJsonLoose(content);
        const valid = validateDiagnosis(parsed, input);
        if (valid) {
          logger.info('diagnose.ai_succeeded', { attempt, hypothesisCount: valid.hypotheses.length });
          return valid;
        }
        lastReason = 'schema_fail';
      } catch (err) {
        lastReason = err?.name === 'AbortError' ? 'timeout' : 'upstream_error';
        logger.warn('diagnose.llm_call_failed', { attempt, reason: lastReason, status: err?.status || null });
      }
    }
    throw aiUnavailable(`AI_DEGRADED:${lastReason}`);
  },

  /** 替代前端 XHR 直连第三方：生成 3 条更贴合当下的实验做法 */
  async generateActions(payload) {
    assertSafe(payload.free_text, 'actions');
    if (!env.llmEnabled) throw aiUnavailable('AI_DISABLED');

    const system = [
      '你在帮一个在校学生把「卡住的一件事」变成这一周能直接做的动作。',
      '规则：只给做法，不做任何判断、评价、打分或贴标签；不使用任何心理或医学类词汇，改用日常说法；',
      '不追问，不寒暄；每条做法以动词开头，必须包含时间、次数或交付物等可核对信息；',
      '只输出一个 JSON 数组，不要输出解释、不要加代码块标记。',
      '数组固定 3 个元素，每个元素形如 {"t":"12字内的做法名","d":"40字内的具体做法","why":"24字内，说明为什么贴合这个人当下的处境"}。',
    ].join('');
    const user = [
      `TA 自己写的卡点（原话）：${payload.free_text}`,
      `补充说明：${payload.q2_detail || ''}`,
      `五道行为题回答：${JSON.stringify(payload.answers || {})}`,
      `初步归纳的方向（仅作背景，不要写进建议里）：${payload.type_code || ''}`,
      `当前模板这一周的安排，供参考、可以整体替换：${(payload.actions || []).join('；')}`,
      `这个实验想看清的是：${payload.observation || ''}`,
    ].join('\n');

    // 思考型模型可能先耗尽预算，遇到 max_tokens 报错时降档重试一次（与前端原逻辑一致）
    for (const budget of [8000, 1500]) {
      try {
        const content = await callLLM([{ role: 'system', content: system }, { role: 'user', content: user }], budget);
        const parsed = parseJsonLoose(content);
        if (!Array.isArray(parsed)) continue;
        const items = parsed.slice(0, 3).map((it) => ({
          t: String(it?.t || '').slice(0, 12),
          d: String(it?.d || '').slice(0, 40),
          why: String(it?.why || '').slice(0, 24),
        })).filter((it) => it.t && it.d);
        /* 输出硬校验：模型不得打分 / 贴诊断标签，命中整批作废再降档重试 */
        if (items.some((it) => AI_FORBIDDEN.test(`${it.t}${it.d}${it.why}`))) {
          logger.warn('diagnose.actions_forbidden_wording', { budget });
          continue;
        }
        if (items.length) {
          logger.info('diagnose.actions_succeeded', { count: items.length, budget });
          return { items };
        }
      } catch (err) {
        logger.warn('diagnose.actions_call_failed', { budget, status: err?.status || null });
        if (!(err?.status === 400 && budget > 1500)) break;
      }
    }
    throw aiUnavailable('AI_DEGRADED:actions');
  },
};
