import { logger } from '../../shared/logger.js';
import { assertSafe } from '../../shared/safety.js';
import { NotFoundError, ForbiddenError } from '../../shared/errors.js';
import { forumRepo } from './forum.repo.js';

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
