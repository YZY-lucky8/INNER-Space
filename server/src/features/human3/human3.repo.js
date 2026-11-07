import { query as dbQuery } from '../../infra/db.js';
import { jsonOr, toDatetime, truncate } from '../sync/mappers.js';

/**
 * 匿名分布统计的数据访问。只写 SQL。
 * 表 human3_assessments 由 002_human3 迁移创建，只存结构化坐标，
 * 前端 notes / 卡点原文一律不进这张表。
 */
export const human3Repo = {
  /** 同一评估 id 重复提交幂等覆盖；一个用户可以有多份历史坐标 */
  async upsert(userId, a) {
    return dbQuery(
      `INSERT INTO human3_assessments
         (id, user_id, schema_ver, grid, phases, bottleneck, blocked_by,
          archetype_key, status, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         grid = VALUES(grid),
         phases = VALUES(phases),
         bottleneck = VALUES(bottleneck),
         blocked_by = VALUES(blocked_by),
         archetype_key = VALUES(archetype_key),
         status = VALUES(status),
         updated_at = VALUES(updated_at)`,
      [
        truncate(a.id, 64),
        userId,
        jsonOr(a.grid, {}),
        jsonOr(a.phases, {}),
        a.bottleneck || null,
        a.blocked_by || null,
        a.archetype_key ? truncate(a.archetype_key, 32) : null,
        a.status || 'report',
        toDatetime(a.created_at || Date.now()),
        toDatetime(Date.now()),
      ]
    );
  },

  /** 每人只取最新一份坐标参与聚合，避免多份历史把分布拉偏 */
  async distribution() {
    const byQuadrant = await dbQuery(
      `SELECT a.bottleneck AS bottleneck, COUNT(*) AS n
         FROM human3_assessments a
        WHERE a.bottleneck IS NOT NULL
          AND a.updated_at = (
            SELECT MAX(b.updated_at) FROM human3_assessments b WHERE b.user_id = a.user_id
          )
        GROUP BY a.bottleneck`
    );
    const totalRows = await dbQuery('SELECT COUNT(DISTINCT user_id) AS n FROM human3_assessments');
    return { byQuadrant, total: Number(totalRows?.[0]?.n || 0) };
  },

  /** 关闭云同步时一并清掉该用户的匿名坐标（本机 localStorage 不受影响） */
  async deleteForUser(userId, q) {
    const run = q || dbQuery;
    return run('DELETE FROM human3_assessments WHERE user_id = ?', [userId]);
  },
};
