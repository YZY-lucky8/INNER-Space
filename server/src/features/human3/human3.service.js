import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { assertSafe, AI_FORBIDDEN } from '../../shared/safety.js';
import { callLLM, parseJsonLoose, aiUnavailable } from '../diagnose/diagnose.service.js';
import { human3SystemPrompt, buildHuman3UserPrompt } from './human3.prompt.js';
import { QUADRANTS } from './human3.rules.js';
import { human3Repo } from './human3.repo.js';

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
