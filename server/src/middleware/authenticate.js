import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { UnauthorizedError, ForbiddenError } from '../shared/errors.js';

/**
 * 访问令牌只出现在 Authorization 头，短时效；
 * 刷新令牌走 httpOnly cookie，服务端存哈希。两者都不进 localStorage / URL。
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role || 'user', typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL, issuer: 'innerspace', audience: 'innerspace-web' }
  );
}

export function signRefreshToken(user, tokenId) {
  return jwt.sign(
    { sub: String(user.id), jti: tokenId, typ: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_TTL, issuer: 'innerspace', audience: 'innerspace-web' }
  );
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: 'innerspace', audience: 'innerspace-web' });
  } catch {
    throw new UnauthorizedError('登录已过期，请重新登录');
  }
}

export function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return next(new UnauthorizedError('请先登录'));
  try {
    const payload = jwt.verify(match[1], env.JWT_ACCESS_SECRET, {
      issuer: 'innerspace',
      audience: 'innerspace-web',
    });
    if (payload.typ !== 'access') return next(new UnauthorizedError());
    req.user = { id: Number(payload.sub), email: payload.email, role: payload.role || 'user' };
    logger.set({ userId: req.user.id });
    return next();
  } catch (err) {
    return next(new UnauthorizedError(err?.name === 'TokenExpiredError' ? '登录状态已过期，请刷新后重试' : '登录状态无效，请重新登录'));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) return next(new ForbiddenError('这个操作需要管理员权限'));
    return next();
  };
}
