/**
 * core.js —— 由 logger.js + errors.js + safety.js + http.js + env.js + db.js + request-context.js + error-handler.js + validate.js + authenticate.js 合并而成。
 * 文件内按原分层顺序分区，各分区仍保持原 routes/service/repo 职责边界。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { ZodError, z } from 'zod';

// ==================== 分区：日志（原 shared/logger.js） ====================
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

// ==================== 分区：错误类型（原 shared/errors.js） ====================
/**
 * 类型化错误体系。
 * 客户端永远只看到 { ok:false, error:{ code, message, details? } }，
 * 堆栈与内部信息只进服务端日志。
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', expose = true, details, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.details = details;
    this.operational = true;
  }

  toJSON() {
    const body = { code: this.code, message: this.expose ? this.message : '服务暂时不可用，请稍后再试' };
    if (this.expose && this.details) body.details = this.details;
    return body;
  }
}

export class BadRequestError extends AppError {
  constructor(message = '请求参数不合法', details) {
    super(message, { status: 400, code: 'BAD_REQUEST', details });
  }
}

export class ValidationError extends AppError {
  constructor(message = '提交的内容不符合要求', details) {
    super(message, { status: 422, code: 'VALIDATION_FAILED', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '登录状态已失效，请重新登录') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '没有权限执行这个操作') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = '没有找到这条记录') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = '云端数据与本机不一致', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = '操作太频繁，请稍后再试') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = '服务暂时不可用', details) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', details });
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(cause) {
    super('数据库尚未就绪，请先启动 MySQL 并执行 npm run db:init', {
      status: 503,
      code: 'DB_UNAVAILABLE',
      expose: true,
      cause,
    });
  }
}

/** 危机信号命中：不落原文、不写库，统一返回 422 + 转介资源 */
export class SafetyBlockedError extends AppError {
  constructor(channel) {
    super('这段内容先不发布。如果你现在很难受，建议直接联系下面这些渠道。', {
      status: 422,
      code: 'SAFETY_BLOCKED',
      details: {
        channel,
        resources: ['全国心理援助热线 12356', '北京心理危机研究与干预中心 010-82951332', '学校心理健康教育中心'],
      },
    });
  }
}

// ==================== 分区：安全护栏（原 shared/safety.js） ====================
/**
 * 危机信号双通道检测 —— 前端 detectCrisis() 的服务端等价实现。
 * 合规校验必须在服务端复算：前端校验只是体验，绕过前端不能写库。
 * 宁可误报：命中即中止，不落原文。
 */
export const CRISIS_WORDS = [
  '自杀', '轻生', '不想活', '活着没意义', '想死', '结束生命', '了结自己',
  '自残', '割腕', '跳楼', '吞药', '安眠药', '活不下去', '一了百了',
  '死了算了', '消失掉算了', '不想存在',
];
const NEG_WORDS = ['绝望', '撑不住', '崩溃', '没意义', '很痛苦', '熬不下去', '窒息', '麻木', '什么都做不好'];
const EXTREME_WORDS = ['永远', '再也', '彻底', '永远都不会好', '所有人', '没有人会', '完全没有'];
const FUNCTION_HIT = ['长期失眠', '每天失眠', '睡不着', '吃不下', '起不来床', '课都上不了', '不想出门', '把自己关起来', '无法上课'];

const hasAny = (text, words) => words.some((w) => text.includes(w));

export function detectCrisis(text) {
  const t = String(text || '');
  if (!t.trim()) return { hit: false };
  for (const word of CRISIS_WORDS) {
    if (t.includes(word)) return { hit: true, channel: 'keyword', word };
  }
  const neg = hasAny(t, NEG_WORDS);
  const ext = hasAny(t, EXTREME_WORDS);
  const fn = hasAny(t, FUNCTION_HIT);
  if (neg && ext) return { hit: true, channel: 'rule', word: '持续负面 + 绝对化表达' };
  if (neg && fn) return { hit: true, channel: 'rule', word: '持续负面 + 功能受损' };
  if (fn && ext) return { hit: true, channel: 'rule', word: '功能受损 + 绝对化表达' };
  return { hit: false };
}

/** 命中即抛错；用于所有写库入口 */
export function assertSafe(text, scope = 'content') {
  const c = detectCrisis(text);
  if (c.hit) {
    // 只记录通道与范围，绝不记录原文
    throw new SafetyBlockedError(c.channel);
  }
  return c;
}

/** AI 输出禁用项：不打分、不贴诊断标签 */
export const AI_FORBIDDEN = /\d+(\.\d+)?\s*%|\d+\s*分|分以上|评分|焦虑|抑郁|量表|筛查|诊断报告/;

// ==================== 分区：HTTP 响应（原 shared/http.js） ====================
/**
 * 统一响应结构与异步控制器包装。
 * 成功：{ ok:true, data, requestId }
 * 失败：{ ok:false, error:{code,message,details?}, requestId }
 */
export function ok(res, data = null, status = 200) {
  return res.status(status).json({ ok: true, data, requestId: res.locals.requestId || '-' });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFoundHandler(req, res) {
  return res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: '没有这个接口' },
    requestId: res.locals.requestId || '-',
  });
}

// ==================== 分区：环境配置（原 config/env.js） ====================
/**
 * 所有配置只从这里读取，启动时一次性校验并快速失败。
 * 服务层 / 仓储层不得直接读 process.env。
 */

const boolFromString = z
  .enum(['', '0', '1', 'true', 'false'])
  .default('')
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  CORS_ORIGINS: z.string().default('http://localhost:8765'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('innerspace'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),

  JWT_ACCESS_SECRET: z.string().default('CHANGE_ME'),
  JWT_REFRESH_SECRET: z.string().default('CHANGE_ME'),
  JWT_ACCESS_TTL: z.coerce.number().int().min(60).max(3600).default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().min(3600).max(2592000).default(604800),

  OTP_TTL: z.coerce.number().int().min(60).max(900).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SMTP_URL: z.string().default(''),
  // RBAC：逗号分隔的管理员邮箱，其余账号一律 user
  ADMIN_EMAILS: z.string().default(''),

  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
});

// 布尔型开关单独解析，避免与 zod object 的默认值互相干扰
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`环境变量校验失败，服务拒绝启动：\n${issues}`);
}

const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';
const warnings = [];

// 占位密钥：开发期给临时随机值并告警；生产期直接拒绝启动。
function resolveSecret(value, label) {
  if (!value || value === 'CHANGE_ME') {
    if (isProd) {
      throw new Error(`环境变量校验失败：生产环境必须为 ${label} 设置长随机密钥`);
    }
    warnings.push(`${label} 使用进程内临时密钥（仅 development，重启后令牌失效）`);
    return randomBytes(32).toString('hex');
  }
  if (isProd && value.length < 32) {
    throw new Error(`环境变量校验失败：生产环境 ${label} 长度至少 32 字符`);
  }
  return value;
}

const JWT_ACCESS_SECRET = resolveSecret(raw.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
const JWT_REFRESH_SECRET = resolveSecret(raw.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');

if (isProd && raw.CORS_ORIGINS.includes('*')) {
  throw new Error('环境变量校验失败：生产环境 CORS_ORIGINS 禁止通配符');
}
if (isProd && !raw.SMTP_URL) {
  warnings.push('生产环境未配置 SMTP_URL，OTP 登录接口将返回 503（不会伪造发送成功）');
}

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const adminEmails = raw.ADMIN_EMAILS.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const env = Object.freeze({
  ...raw,
  isProd,
  isDev: raw.NODE_ENV === 'development',
  corsOrigins,
  adminEmails,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  llmEnabled: Boolean(raw.LLM_BASE_URL && raw.LLM_API_KEY && raw.LLM_MODEL),
  otpDeliverable: Boolean(raw.SMTP_URL) || !isProd,
  warnings,
});

export { boolFromString };

// ==================== 分区：数据库连接池（原 infra/db.js） ====================
/**
 * MySQL 连接池。所有 SQL 只出现在仓储层，服务层不拼 SQL。
 * 数据库不可用时统一抛 DB_UNAVAILABLE，绝不用内存假数据冒充成功。
 */
const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_POOL_SIZE,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  multipleStatements: false,
  enableKeepAlive: true,
});

function normalizeDbError(err) {
  if (err?.operational) return err;
  // 连接类错误：明确告诉调用方"数据库没就绪"，不伪装成业务结果
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err?.code)) {
    return new DatabaseUnavailableError(err);
  }
  if (err?.code === 'ER_DUP_ENTRY') return new ConflictError('这条记录已经存在，请刷新后再试');
  if (err?.code === 'ER_NO_REFERENCED_ROW_2') return new ConflictError('引用的记录不存在');
  return err;
}

export async function query(sql, params = []) {
  const started = Date.now();
  try {
    const [rows] = await pool.execute(sql, params);
    logger.debug('db.query', { sql: sql.replace(/\s+/g, ' ').slice(0, 160), rows: Array.isArray(rows) ? rows.length : 1, ms: Date.now() - started });
    return rows;
  } catch (err) {
    logger.error('db.query_failed', { code: err?.code, message: err?.message, ms: Date.now() - started });
    throw normalizeDbError(err);
  }
}

/** 多步写入一律走事务；回调内使用同一 connection */
export async function transaction(fn) {
  const conn = await pool.getConnection().catch((err) => {
    logger.error('db.connection_failed', { code: err?.code, message: err?.message });
    throw normalizeDbError(err);
  });
  try {
    await conn.beginTransaction();
    // 传给仓储层的是一个可直接调用的函数 q(sql, params)，保持与普通 query 一致的心智模型
    const q = async (sql, params = []) => {
      const [rows] = await conn.execute(sql, params);
      return rows;
    };
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('db.transaction_rolled_back', { code: err?.code, message: err?.message });
    throw normalizeDbError(err);
  } finally {
    conn.release();
  }
}

export async function ping() {
  const rows = await query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}

export async function closePool() {
  await pool.end();
  logger.info('db.pool_closed');
}

// ==================== 分区：中间件-请求上下文（原 middleware/request-context.js） ====================
/** 请求 ID 贯穿日志与响应；结构化记录每个请求，不记录请求体 */
export function requestContext(req, res, next) {
  const requestId = req.get('x-request-id') || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const started = Date.now();

  res.on('finish', () => {
    logger.info('http.request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });

  logger.runWith({ requestId }, () => next());
}

// ==================== 分区：中间件-错误处理（原 middleware/error-handler.js） ====================
/** 全局错误处理：客户端只看到规范化结构，绝不返回堆栈或内部细节 */
export function errorHandler(err, _req, res, _next) {
  let error = err;

  if (err instanceof ZodError) {
    error = new ValidationError('提交的内容不符合要求', {
      fields: err.issues.map((i) => ({ field: i.path.join('.'), rule: i.code })),
    });
  } else if (!(err instanceof AppError)) {
    logger.error('unhandled_error', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
    });
    error = new AppError('服务内部错误', { status: 500, code: 'INTERNAL_ERROR', expose: false });
  } else if (err.status >= 500) {
    logger.error('app_error', { code: err.code, message: err.message });
  }

  return res.status(error.status).json({
    ok: false,
    error: error.toJSON(),
    requestId: res.locals.requestId || '-',
  });
}

// ==================== 分区：中间件-参数校验（原 middleware/validate.js） ====================
/**
 * 所有输入在边界处校验，绝不信任客户端数据。
 * 失败时只回传字段路径，不回传字段值（避免原文出现在日志/响应中）。
 */
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        rule: i.code,
      }));
      return next(new ValidationError('提交的内容不符合要求', { fields }));
    }
    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) return next(new ValidationError('地址参数不合法'));
    req.params = result.data;
    return next();
  };
}

// ==================== 分区：中间件-鉴权（原 middleware/authenticate.js） ====================
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
