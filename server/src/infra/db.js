import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { DatabaseUnavailableError, ConflictError } from '../shared/errors.js';

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
