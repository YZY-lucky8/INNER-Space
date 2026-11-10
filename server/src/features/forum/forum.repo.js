import { query } from '../../infra/db.js';

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
