import { Router } from 'express';
import { z } from 'zod';

import { ok, asyncHandler } from '../../shared/http.js';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { syncService } from './sync.service.js';

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
