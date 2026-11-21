/**
 * forum.js —— 由 forum.repo.js + forum.service.js + forum.routes.js 合并而成。
 * 文件内按原分层顺序分区，各分区仍保持原 routes/service/repo 职责边界。
 */
import { Router } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, assertSafe, asyncHandler, logger, ok, query, requireAuth, validateBody, validateParams } from '../core.js';

// ==================== 分区：数据访问层（原 features/forum/forum.repo.js） ====================
/** 论坛数据访问：只写 SQL。写删权限在服务层按 owner 判定，DB 侧另有 RLS（线上实例）。 */
export const forumRepo = {
  async listPosts(limit = 100) {
    return query(
      `SELECT p.id, p.title, p.content, p.author_name, p.is_anonymous, p.source,
              p.accepted_reply_id, p.created_at,
              (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id) AS reply_count,
              (SELECT COUNT(*) FROM forum_reply_votes v
                 JOIN forum_replies r2 ON r2.id = v.reply_id
                WHERE r2.post_id = p.id) AS useful_count
         FROM forum_posts p
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?`,
      [limit]
    );
  },

  async getPost(id) {
    const rows = await query(
      `SELECT id, user_id, title, content, author_name, is_anonymous, source,
              accepted_reply_id, created_at
         FROM forum_posts WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async listReplies(postId) {
    return query(
      `SELECT r.id, r.post_id, r.author_name, r.is_anonymous, r.content, r.created_at,
              (SELECT COUNT(*) FROM forum_reply_votes v WHERE v.reply_id = r.id) AS useful_count
         FROM forum_replies r
        WHERE r.post_id = ?
        ORDER BY r.created_at ASC, r.id ASC`,
      [postId]
    );
  },

  async getReply(id) {
    const rows = await query('SELECT id, post_id, user_id FROM forum_replies WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async createPost(userId, { title, content, authorName, isAnonymous, source }) {
    const result = await query(
      `INSERT INTO forum_posts (user_id, author_name, title, content, is_anonymous, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, authorName, title, content, isAnonymous ? 1 : 0, source]
    );
    return Number(result.insertId);
  },

  async createReply(userId, postId, { content, authorName, isAnonymous }) {
    const result = await query(
      `INSERT INTO forum_replies (post_id, user_id, author_name, content, is_anonymous)
       VALUES (?, ?, ?, ?, ?)`,
      [postId, userId, authorName, content, isAnonymous ? 1 : 0]
    );
    return Number(result.insertId);
  },

  /** 同一人对同一回答只能点一次；重复点击幂等返回 false */
  async addVote(userId, replyId) {
    const result = await query(
      'INSERT IGNORE INTO forum_reply_votes (reply_id, user_id) VALUES (?, ?)',
      [replyId, userId]
    );
    return Number(result.affectedRows) > 0;
  },

  async deletePostOwned(id, userId) {
    const result = await query('DELETE FROM forum_posts WHERE id = ? AND user_id = ?', [id, userId]);
    return Number(result.affectedRows) > 0;
  },

  async deletePostAsAdmin(id) {
    const result = await query('DELETE FROM forum_posts WHERE id = ?', [id]);
    return Number(result.affectedRows) > 0;
  },
};

// ==================== 分区：业务逻辑层（原 features/forum/forum.service.js） ====================
const cleanName = (v) => {
  const s = String(v || '').trim().slice(0, 50);
  return s || null;
};

/**
 * 论坛业务规则：字数与危机信号在服务端独立复算。
 * 线上云端的 RLS 只保证「谁能写」，这里保证「写了什么」——绕过前端也写不进违规内容。
 * 不做全站排行榜：useful_count 只是单条回答下的计数。
 */
export const forumService = {
  async listPosts() {
    return forumRepo.listPosts(100);
  },

  async getThread(postId) {
    const post = await forumRepo.getPost(postId);
    if (!post) throw new NotFoundError('这个帖子已经不在了');
    const replies = await forumRepo.listReplies(postId);
    return { post, replies };
  },

  async createPost(userId, dto) {
    assertSafe(`${dto.title} ${dto.content}`, 'forum_post');
    const isAnonymous = Boolean(dto.is_anonymous);
    const id = await forumRepo.createPost(userId, {
      title: dto.title.trim(),
      content: dto.content.trim(),
      authorName: isAnonymous ? null : cleanName(dto.author_name),
      isAnonymous,
      source: dto.source === 'intake' ? 'intake' : 'forum',
    });
    logger.info('forum.post_created', { userId, postId: id });
    return { id };
  },

  async createReply(userId, postId, dto) {
    assertSafe(dto.content, 'forum_reply');
    const post = await forumRepo.getPost(postId);
    if (!post) throw new NotFoundError('这个帖子已经不在了');
    const isAnonymous = Boolean(dto.is_anonymous);
    const id = await forumRepo.createReply(userId, postId, {
      content: dto.content.trim(),
      authorName: isAnonymous ? null : cleanName(dto.author_name),
      isAnonymous,
    });
    logger.info('forum.reply_created', { userId, postId, replyId: id });
    return { id };
  },

  async vote(userId, replyId) {
    const reply = await forumRepo.getReply(replyId);
    if (!reply) throw new NotFoundError('这条回答已经不在了');
    const added = await forumRepo.addVote(userId, replyId);
    return { added, alreadyVoted: !added };
  },

  /** 作者本人或管理员可删；删帖级联删回答，采纳标记置空 */
  async deletePost(userId, role, postId) {
    const post = await forumRepo.getPost(postId);
    if (!post) throw new NotFoundError('这个帖子已经不在了');
    if (role === 'admin') {
      await forumRepo.deletePostAsAdmin(postId);
    } else {
      const removed = await forumRepo.deletePostOwned(postId, userId);
      if (!removed) throw new ForbiddenError('只能删除自己发的帖子');
    }
    logger.info('forum.post_deleted', { userId, postId });
    return { deleted: true };
  },
};

// ==================== 分区：路由层（原 features/forum/forum.routes.js） ====================
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
