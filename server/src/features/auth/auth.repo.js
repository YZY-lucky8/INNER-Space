import { query } from '../../infra/db.js';

/** 认证数据访问：只写 SQL，不含业务规则 */
export const authRepo = {
  async findOrCreateUser(email) {
    await query(
      `INSERT INTO users (email, nickname, consent_at, last_seen_at)
       VALUES (?, '同学', NOW(), NOW())
       ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
      [email]
    );
    const rows = await query('SELECT id, email, nickname, status, graduated FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0];
  },

  async findUserById(id) {
    const rows = await query('SELECT id, email, nickname, status, graduated FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async issueOtp(email, codeHash, ttlSeconds) {
    await query('UPDATE otp_codes SET consumed_at = NOW() WHERE email = ? AND consumed_at IS NULL', [email]);
    const result = await query(
      'INSERT INTO otp_codes (email, code_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
      [email, codeHash, ttlSeconds]
    );
    return Number(result.insertId);
  },

  async findActiveOtp(email) {
    const rows = await query(
      `SELECT id, code_hash, expires_at, attempts
         FROM otp_codes
        WHERE email = ? AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  async bumpOtpAttempts(id) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [id]);
  },

  async consumeOtp(id) {
    await query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?', [id]);
  },

  async insertRefreshToken(userId, tokenHash, ttlSeconds) {
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
      [userId, tokenHash, ttlSeconds]
    );
  },

  async findRefreshToken(tokenHash) {
    const rows = await query(
      `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  },

  async revokeRefreshToken(tokenHash) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
  },

  async revokeAllForUser(userId) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
  },
};
