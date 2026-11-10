import { Router } from 'express';
import { z } from 'zod';

import { ok, asyncHandler } from '../../shared/http.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { forumService } from './forum.service.js';

const router = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const postSchema = z.object({
  title: z.string().trim().min(1, '给这个困惑起个标题').max(120),
  content: z.string().trim().min(1, '正文还没写').max(1500),
  is_anonymous: z.boolean().optional().default(false),
  author_name: z.string().max(50).optional().default(''),
  source: z.enum(['forum', 'intake']).optional().default('forum'),
});
const replySchema = z.object({
  content: z.string().trim().min(1, '先写一句你当时是怎么过的').max(1200),
  is_anonymous: z.boolean().optional().default(false),
  author_name: z.string().max(50).optional().default(''),
});

// 浏览不需要登录；写、点有用、删除都需要登录
router.get('/api/v1/forum/posts', asyncHandler(async (_req, res) => {
  return ok(res, { posts: await forumService.listPosts() });
}));

router.get('/api/v1/forum/posts/:id', validateParams(idParam), asyncHandler(async (req, res) => {
  return ok(res, await forumService.getThread(req.params.id));
}));

router.post('/api/v1/forum/posts', requireAuth, validateBody(postSchema), asyncHandler(async (req, res) => {
  return ok(res, await forumService.createPost(req.user.id, req.body), 201);
}));

router.post('/api/v1/forum/posts/:id/replies', requireAuth, validateParams(idParam), validateBody(replySchema), asyncHandler(async (req, res) => {
  return ok(res, await forumService.createReply(req.user.id, req.params.id, req.body), 201);
}));

router.post('/api/v1/forum/replies/:id/votes', requireAuth, validateParams(idParam), asyncHandler(async (req, res) => {
  return ok(res, await forumService.vote(req.user.id, req.params.id));
}));

router.delete('/api/v1/forum/posts/:id', requireAuth, validateParams(idParam), asyncHandler(async (req, res) => {
  return ok(res, await forumService.deletePost(req.user.id, req.user.role, req.params.id));
}));

export default router;
