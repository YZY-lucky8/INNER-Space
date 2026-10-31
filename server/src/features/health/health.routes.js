import { Router } from 'express';
import { env } from '../../config/env.js';
import { ping } from '../../infra/db.js';
import { ok, asyncHandler } from '../../shared/http.js';
import { ServiceUnavailableError } from '../../shared/errors.js';

const router = Router();

/** 存活探针：不查库，进程活着就返回 ok */
router.get('/health', (_req, res) => {
  ok(res, { status: 'ok', uptimeSec: Math.floor(process.uptime()), version: '1.0.0' });
});

/** 就绪探针：数据库真正可用才返回 ok */
router.get('/ready', asyncHandler(async (_req, res) => {
  try {
    const ready = await ping();
    if (!ready) throw new Error('ping returned false');
    ok(res, { status: 'ready', database: 'up' });
  } catch (err) {
    throw new ServiceUnavailableError('数据库尚未就绪，请先启动 MySQL 并执行 npm run db:init', {
      code: 'DB_UNAVAILABLE',
      hint: err?.code || null,
    });
  }
}));

/** 前端启动配置：只暴露公开信息，不含任何密钥 */
router.get('/api/v1/config', (_req, res) => {
  ok(res, {
    apiBase: `/api/v1`,
    authMode: 'otp',
    features: {
      sync: true,
      ai: env.llmEnabled,
      forum: true,
      human3: true,
      otpDeliverable: env.otpDeliverable,
    },
    limits: { postTitle: 120, postContent: 1500, replyContent: 1200, freeText: 1000 },
  });
});

export default router;
