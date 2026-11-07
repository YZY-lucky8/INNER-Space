import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';

import { ok, asyncHandler } from '../../shared/http.js';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { human3Service } from './human3.service.js';

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
