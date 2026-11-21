/**
 * auth.js —— 由 auth.repo.js + auth.service.js + auth.routes.js 合并而成。
 * 文件内按原分层顺序分区，各分区仍保持原 routes/service/repo 职责边界。
 */
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { BadRequestError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError, asyncHandler, env, logger, ok, query, requireAuth, signAccessToken, signRefreshToken, validateBody, verifyRefreshToken } from '../core.js';

// ==================== 分区：数据访问层（原 features/auth/auth.repo.js） ====================
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

// ==================== 分区：业务逻辑层（原 features/auth/auth.service.js） ====================
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const otpHash = (email, code) => sha256(`${email}:${code}:${env.JWT_ACCESS_SECRET}`);
const roleFor = (email) => (env.adminEmails.includes(String(email).toLowerCase()) ? 'admin' : 'user');

/** 生成一组令牌并只把 refresh 的哈希存库；明文 refresh 只通过 httpOnly cookie 返回 */
async function issueTokenPair(user) {
  const tokenId = randomUUID();
  const accessToken = signAccessToken({ ...user, role: roleFor(user.email) });
  const refreshToken = signRefreshToken(user, tokenId);
  await authRepo.insertRefreshToken(user.id, sha256(refreshToken), env.JWT_REFRESH_TTL);
  return {
    user: { id: user.id, email: user.email, nickname: user.nickname, role: roleFor(user.email) },
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL,
  };
}

export const authService = {
  /**
   * 发送验证码。开发期把码写入结构化日志并在响应里返回 devCode（明确标注 dev 通道）；
   * 生产未接 SMTP 时返回 503，绝不伪造"已发送"。
   */
  async requestOtp(email) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await authRepo.issueOtp(email, otpHash(email, code), env.OTP_TTL);

    if (env.SMTP_URL) {
      // 邮件投递适配器留待接入实盘 SMTP；此处不假装发送成功。
      logger.warn('otp.delivery_not_implemented', { emailDomain: email.split('@')[1] || '-' });
      throw new ServiceUnavailableError('邮件投递服务尚未接入，请联系管理员配置 SMTP 适配器', { code: 'SMTP_NOT_IMPLEMENTED' });
    }
    if (!env.isDev) {
      throw new ServiceUnavailableError('邮件服务未配置，验证码登录暂不可用', { code: 'SMTP_NOT_CONFIGURED' });
    }

    logger.info('otp.issued_dev_channel', { emailDomain: email.split('@')[1] || '-', ttl: env.OTP_TTL });
    return { channel: 'dev', expiresIn: env.OTP_TTL, devCode: code };
  },

  async verifyOtp(email, code) {
    const row = await authRepo.findActiveOtp(email);
    if (!row) throw new BadRequestError('验证码已过期，请重新获取');
    if (Number(row.attempts) >= env.OTP_MAX_ATTEMPTS) {
      await authRepo.consumeOtp(row.id);
      throw new TooManyRequestsError('尝试次数太多，请重新获取验证码');
    }

    const expected = Buffer.from(row.code_hash, 'hex');
    const actual = Buffer.from(otpHash(email, code), 'hex');
    const matched = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matched) {
      await authRepo.bumpOtpAttempts(row.id);
      throw new BadRequestError('验证码不对，再检查一下');
    }

    await authRepo.consumeOtp(row.id);
    const user = await authRepo.findOrCreateUser(email);
    if (!user) throw new ServiceUnavailableError('账号创建失败，请稍后再试');
    const pair = await issueTokenPair(user);
    logger.info('auth.login_succeeded', { userId: user.id });
    return pair;
  },

  /** 刷新令牌轮换：旧令牌立即撤销，防止重放 */
  async refresh(refreshToken) {
    if (!refreshToken) throw new UnauthorizedError('登录已过期，请重新登录');
    const payload = verifyRefreshToken(refreshToken);
    if (payload.typ !== 'refresh') throw new UnauthorizedError();

    const hash = sha256(refreshToken);
    const stored = await authRepo.findRefreshToken(hash);
    if (!stored || stored.revoked_at || new Date(stored.expires_at) <= new Date()) {
      throw new UnauthorizedError('登录已过期，请重新登录');
    }
    const user = await authRepo.findUserById(payload.sub);
    if (!user) throw new UnauthorizedError();
    if (user.status === 'deleted') throw new UnauthorizedError('这个账号已停用');

    await authRepo.revokeRefreshToken(hash);
    return issueTokenPair(user);
  },

  async logout(refreshToken) {
    if (refreshToken) await authRepo.revokeRefreshToken(sha256(refreshToken));
    return { loggedOut: true };
  },

  async getMe(userId) {
    const user = await authRepo.findUserById(userId);
    if (!user) throw new UnauthorizedError();
    return { ...user, role: roleFor(user.email) };
  },
};

// ==================== 分区：路由层（原 features/auth/auth.routes.js） ====================
const router = Router();
const REFRESH_COOKIE = 'is_refresh';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,       // 生产必须 HTTPS
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_TTL * 1000,
  });
}
function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/api/v1/auth' });
}
function readRefreshCookie(req) {
  return req.cookies?.[REFRESH_COOKIE] || null;
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });
const otpSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/, '验证码是 6 位数字') });

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '验证码获取太频繁，请稍后再试' } },
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '尝试太频繁，请稍后再试' } },
});

/** 请求邮箱验证码 */
router.post('/api/v1/auth/otp/request', otpRequestLimiter, validateBody(emailSchema), asyncHandler(async (req, res) => {
  const result = await authService.requestOtp(req.body.email);
  return ok(res, result);
}));

/** 校验验证码并登录：access token 只在响应体（由前端存内存），refresh 只进 httpOnly cookie */
router.post('/api/v1/auth/otp/verify', otpVerifyLimiter, validateBody(otpSchema), asyncHandler(async (req, res) => {
  const pair = await authService.verifyOtp(req.body.email, req.body.code);
  setRefreshCookie(res, pair.refreshToken);
  return ok(res, {
    user: pair.user,
    accessToken: pair.accessToken,
    expiresIn: pair.expiresIn,
  });
}));

/** 401 自动刷新入口：前端 app.js 的 API 分区在收到 401 时调用一次 */
router.post('/api/v1/auth/refresh', asyncHandler(async (req, res) => {
  const cookie = readRefreshCookie(req);
  if (!cookie) throw new UnauthorizedError('登录已过期，请重新登录');
  const pair = await authService.refresh(cookie);
  setRefreshCookie(res, pair.refreshToken);
  return ok(res, { accessToken: pair.accessToken, expiresIn: pair.expiresIn, user: pair.user });
}));

router.post('/api/v1/auth/logout', asyncHandler(async (req, res) => {
  await authService.logout(readRefreshCookie(req));
  clearRefreshCookie(res);
  return ok(res, { loggedOut: true });
}));

router.get('/api/v1/auth/me', requireAuth, asyncHandler(async (req, res) => {
  return ok(res, await authService.getMe(req.user.id));
}));

export default router;
