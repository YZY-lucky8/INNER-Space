import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';

import { env } from '../../config/env.js';
import { ok, asyncHandler } from '../../shared/http.js';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { authService } from './auth.service.js';

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

/** 401 自动刷新入口：前端 api.js 在收到 401 时调用一次 */
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
