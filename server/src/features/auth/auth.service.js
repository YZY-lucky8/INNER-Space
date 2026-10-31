import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import {
  BadRequestError, UnauthorizedError, ServiceUnavailableError, TooManyRequestsError,
} from '../../shared/errors.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../middleware/authenticate.js';
import { authRepo } from './auth.repo.js';

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
