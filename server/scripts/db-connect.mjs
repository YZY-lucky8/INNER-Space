import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

/** 初始化脚本专用：连到服务器（可不指定 database），与运行时连接池分开 */
export async function connect({ withDatabase = true } = {}) {
  return mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: withDatabase ? env.DB_NAME : undefined,
    multipleStatements: false,
    charset: 'utf8mb4',
  });
}
