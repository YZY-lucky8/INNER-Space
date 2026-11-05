import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';

import { ok, asyncHandler } from '../../shared/http.js';
import { validateBody } from '../../middleware/validate.js';
import { diagnoseService } from './diagnose.service.js';

const router = Router();

// 无状态推理接口，离线用户也能用；原文不落库。用严格限流防止密钥代理被滥用。
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '生成太频繁，请稍后再试' } },
});

const diagnoseSchema = z.object({
  free_text: z.string().max(1000).optional().default(''),
  answers: z.record(z.any()).optional().default({}),
  rule_top: z.string().max(20).optional().default(''),
  rule_second: z.string().max(20).optional().default(''),
  candidates: z.array(z.string().max(20)).max(5).optional().default([]),
});

const actionsSchema = z.object({
  free_text: z.string().max(1000).optional().default(''),
  q2_detail: z.string().max(300).optional().default(''),
  answers: z.record(z.any()).optional().default({}),
  type_code: z.string().max(20).optional().default(''),
  actions: z.array(z.string().max(500)).max(10).optional().default([]),
  observation: z.string().max(300).optional().default(''),
});

/** Step 2 AI 精修；未配置 LLM 时返回 503 + AI_DISABLED，前端静默降级到规则引擎 */
router.post('/api/v1/diagnose', limiter, validateBody(diagnoseSchema), asyncHandler(async (req, res) => {
  return ok(res, await diagnoseService.diagnose(req.body));
}));

/** 替代前端 XHR 直连第三方：服务端持 Key 生成 3 条实验做法 */
router.post('/api/v1/diagnose/actions', limiter, validateBody(actionsSchema), asyncHandler(async (req, res) => {
  return ok(res, await diagnoseService.generateActions(req.body));
}));

export default router;
