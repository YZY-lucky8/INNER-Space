import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import { connect } from './db-connect.mjs';
import { splitStatements } from './sql-splitter.mjs';
import { runMigrations } from './migrate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(here, '../../database');

const BASE_SCRIPTS = ['schema.sql', 'views.sql', 'procedures.sql', 'triggers.sql'];

async function main() {
  const conn = await connect({ withDatabase: false });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME.replace(/`/g, '')}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[init] 数据库 ${env.DB_NAME} 已就绪`);
    await conn.query(`USE \`${env.DB_NAME.replace(/`/g, '')}\``);

    // 后端自建的 3 张表不在课程脚本的 DROP 列表里；重建前先清掉，
    // 避免 users 被 DROP 后留下指向已删表的悬空外键。
    // 注意：这会清除登录会话与云端同步快照，仅在主动执行 db:init 时发生。
    console.log('[init] 注意：重建会清除登录会话与云端同步快照');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DROP TABLE IF EXISTS sync_snapshots, refresh_tokens, otp_codes, human3_assessments');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    for (const file of BASE_SCRIPTS) {
      const sql = await fs.readFile(path.join(databaseDir, file), 'utf8');
      const statements = splitStatements(sql);
      for (const stmt of statements) await conn.query(stmt);
      console.log(`[init] ${file} · ${statements.length} 条语句执行完成`);
    }

    await runMigrations('up', conn);
    console.log('[init] 完成：23 张业务表 + 6 视图 + 8 过程 + 7 触发器 + 4 张服务端表');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[init] 失败：${err?.code || ''} ${err?.message}`);
  if (['ECONNREFUSED', 'ETIMEDOUT'].includes(err?.code)) {
    console.error('MySQL 服务未启动。Windows 上请执行：net start MySQL80（或以管理员运行 mysqld --console）');
  }
  if (err?.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('数据库账号或密码不对，请检查 server/.env 的 DB_USER / DB_PASSWORD');
  }
  process.exit(1);
});
