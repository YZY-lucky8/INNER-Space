import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

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
