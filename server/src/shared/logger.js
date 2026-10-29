import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 结构化 JSON 日志 + 贯穿请求的 requestId。
 * 绝不记录密码、令牌、验证码、用户原文。
 */
const store = new AsyncLocalStorage();

const REDACT_KEYS = new Set([
  'password', 'token', 'accesstoken', 'refreshtoken', 'authorization',
  'cookie', 'otp', 'otpcode', 'verificationcode', 'devcode',
  'apikey', 'key', 'secret', 'free_text', 'content', 'note', 'email',
]);
// 注意：'code' 不脱敏 —— 它几乎总是错误码 / SQLSTATE，是排障必需信息；
// 真正的验证码字段用 otpCode / devCode 等精确名称脱敏。

function scrub(value, depth = 0) {
  if (depth > 3 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
  return value;
}

function emit(level, event, fields = {}) {
  const ctx = store.getStore() || {};
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: ctx.requestId || '-',
    userId: ctx.userId ?? null,
    ...scrub(fields),
  };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
  debug: (event, fields) => {
    if (process.env.NODE_ENV === 'development') emit('debug', event, fields);
  },
  runWith(context, fn) {
    return store.run(context, fn);
  },
  set(context) {
    const current = store.getStore() || {};
    store.enterWith({ ...current, ...context });
  },
};
