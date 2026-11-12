import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db-connect.mjs';
import { splitStatements } from './sql-splitter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');

/** 数据库变更一律通过可回滚迁移；up 幂等，down 需显式指定 */
export async function runMigrations(direction = 'up', conn = null) {
  const own = !conn;
  const connection = conn || await connect();
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(`.${direction}.sql`))
    .sort();

  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const statements = splitStatements(sql);
      for (const stmt of statements) await connection.query(stmt);
      console.log(`[migrate:${direction}] ${file} · ${statements.length} 条语句`);
    }
    if (!files.length) console.log(`[migrate:${direction}] 没有待执行的迁移文件`);
  } finally {
    if (own) await connection.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  if (direction === 'down') {
    console.warn('[migrate] 回滚会删除同步快照、刷新令牌与验证码表，属于破坏性操作');
    if (process.argv[3] !== '--confirm') {
      console.error('[migrate] 已中止：确认请追加 --confirm');
      process.exit(1);
    }
  }
  runMigrations(direction)
    .then(() => { console.log(`[migrate] ${direction} 完成`); process.exit(0); })
    .catch((err) => {
      console.error(`[migrate] 失败：${err?.code || ''} ${err?.message}`);
      if (err?.code === 'ECONNREFUSED') console.error('请先启动 MySQL 8 服务（3306）');
      process.exit(1);
    });
}
