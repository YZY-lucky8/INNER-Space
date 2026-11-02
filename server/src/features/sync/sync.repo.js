import { query as dbQuery } from '../../infra/db.js';
import {
  asId, truncate, toDatetime, jsonOr, mapEnum, mapQ5, mapConfidence, mapStatus,
  mapOutcome, mapNextAction, mapEvidenceType, mapEngine,
} from './mappers.js';

/**
 * 同步仓储：整个 push 在一个事务里完成「按依赖顺序清空该用户业务数据 → 全量重建」。
 * 这是离线优先快照同步最可靠的幂等策略，且不动课程设计 23 张表的结构。
 * 完整快照另存 sync_snapshots，pull 时原样还原，前端字段零丢失。
 */
export const syncRepo = {
  async getMeta(userId) {
    const rows = await dbQuery(
      'SELECT revision, synced_at, client_sent_at FROM sync_snapshots WHERE user_id = ? LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  },

  async getSnapshot(userId) {
    const rows = await dbQuery(
      'SELECT snapshot, revision, synced_at, client_sent_at FROM sync_snapshots WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) return null;
    let snapshot;
    try { snapshot = JSON.parse(rows[0].snapshot); } catch { snapshot = null; }
    return { snapshot, revision: Number(rows[0].revision), syncedAt: rows[0].synced_at, clientSentAt: rows[0].client_sent_at };
  },

  async counts(userId) {
    const rows = await dbQuery(
      `SELECT
         (SELECT COUNT(*) FROM stuck_sessions WHERE user_id = ?) AS sessions,
         (SELECT COUNT(*) FROM hypotheses h JOIN stuck_sessions s ON s.id = h.session_id WHERE s.user_id = ?) AS hypotheses,
         (SELECT COUNT(*) FROM experiments e JOIN stuck_sessions s ON s.id = e.session_id WHERE s.user_id = ?) AS experiments,
         (SELECT COUNT(*) FROM evidence_items WHERE user_id = ?) AS evidence`,
      [userId, userId, userId, userId]
    );
    return rows[0];
  },

  async deleteBusinessData(userId, q) {
    const sessionsOfUser = 'SELECT id FROM stuck_sessions WHERE user_id = ?';
    await q(`DELETE FROM reviews WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q('DELETE FROM evidence_items WHERE user_id = ?', [userId]);
    await q(
      `DELETE FROM experiment_logs WHERE experiment_id IN
         (SELECT id FROM experiments WHERE session_id IN (${sessionsOfUser}))`,
      [userId]
    );
    await q(`DELETE FROM experiments WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q(`DELETE FROM hypotheses WHERE session_id IN (${sessionsOfUser})`, [userId]);
    await q('DELETE FROM stuck_sessions WHERE user_id = ?', [userId]);
  },

  async templateIdMap(q) {
    const rows = await q('SELECT id, template_key FROM experiment_templates');
    return new Map(rows.map((r) => [String(r.template_key), Number(r.id)]));
  },

  async insertSessions(userId, sessions, q) {
    const map = new Map();
    for (const s of sessions) {
      const a = s.answers || {};
      const result = await q(
        `INSERT INTO stuck_sessions
           (user_id, root_id, round_no, free_text, q1_hours, q2_progress, q2_detail,
            q3_method_switch, q4_no_external, q5_peer, rule_top, rule_second,
            rule_scores, engine_used, safety_flagged, status, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          userId,
          Math.min(3, Math.max(1, Number(s.round_no) || 1)),
          truncate(s.free_text, 1000),
          mapEnum(a.q1, 'q1'),
          mapEnum(a.q2, 'q2'),
          truncate(s.q2_detail ?? a.q2_detail, 300),
          mapEnum(a.q3, 'q3'),
          mapEnum(a.q4, 'q4'),
          mapQ5(a.q5),
          truncate(s.rule_top, 20),
          truncate(s.rule_second, 20),
          jsonOr(s.rule_scores, {}),
          mapEngine(s.engine),
          mapStatus(s.status),
          toDatetime(s.created_at),
        ]
      );
      map.set(asId(s.id), Number(result.insertId));
    }
    // root_id 自引用：所有会话都落库后再回填（MySQL 触发器不能改同表字段）
    for (const s of sessions) {
      const self = map.get(asId(s.id));
      const root = s.root_id ? map.get(asId(s.root_id)) : null;
      if (self && root) await q('UPDATE stuck_sessions SET root_id = ? WHERE id = ?', [root, self]);
    }
    return map;
  },

  async insertHypotheses(sessions, sessionMap, q) {
    let n = 0;
    for (const s of sessions) {
      const sessionId = sessionMap.get(asId(s.id));
      if (!sessionId) continue;
      const list = Array.isArray(s.hypotheses) ? s.hypotheses.slice(0, 3) : [];
      for (const [i, h] of list.entries()) {
        await q(
          `INSERT INTO hypotheses
             (session_id, type_code, rank_no, confidence, reasoning, evidence_quote, evidence_from, user_disagreed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            truncate(h.type, 20) || 'A_METHOD',
            i + 1, // UNIQUE(session_id, rank_no)，用序号而非客户端 rank 保证不冲突
            mapConfidence(h.confidence),
            truncate(h.reasoning, 60),
            truncate(h.evidence_quote, 500),
            truncate(h.evidence_from, 40) || '你写的原话',
            h.disagreed ? 1 : 0,
          ]
        );
        n++;
      }
    }
    return n;
  },

  async insertExperiments(experiments, sessionMap, templateMap, q) {
    const map = new Map();
    for (const e of experiments) {
      const sessionId = sessionMap.get(asId(e.session_id));
      if (!sessionId) continue;
      const result = await q(
        `INSERT INTO experiments
           (session_id, hypothesis_id, template_id, type_code, title, actions_json,
            observation, duration_days, started_at, ended_at, outcome)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          templateMap.get(String(e.template_key)) || null,
          truncate(e.type, 20),
          truncate(e.title, 200) || '分辨实验',
          jsonOr(e.actions, []),
          truncate(e.observation, 300) || '观察做完之后发生了什么',
          Math.min(30, Math.max(1, Number(e.duration_days) || 7)),
          e.started_at ? toDatetime(e.started_at) : null,
          e.ended_at ? toDatetime(e.ended_at) : null,
          mapOutcome(e.outcome),
        ]
      );
      map.set(asId(e.id), Number(result.insertId));
    }
    return map;
  },

  async insertLogs(logs, experimentMap, q) {
    let n = 0;
    for (const l of logs) {
      const experimentId = experimentMap.get(asId(l.experiment_id));
      if (!experimentId) continue;
      await q(
        `INSERT INTO experiment_logs
           (experiment_id, day_no, slot, did_it, note, energy, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           slot = VALUES(slot), did_it = VALUES(did_it), note = VALUES(note), energy = VALUES(energy)`,
        [
          experimentId,
          Math.min(7, Math.max(1, Number(l.day_no) || 1)),
          Math.min(4, Math.max(1, Number(l.slot) || 1)),
          l.did_it ? 1 : 0,
          truncate(l.note, 500),
          Math.min(2, Math.max(-2, Number(l.energy) || 0)),
          toDatetime(l.created_at),
        ]
      );
      n++;
    }
    return n;
  },

  async insertEvidence(userId, evidence, sessionMap, experimentMap, q) {
    const map = new Map();
    for (const ev of evidence) {
      const sourceExpId = experimentMap.get(asId(ev.source_exp_id));
      if (!sourceExpId) continue; // 服务层已保证不会走到这里
      const rejected = Boolean(ev.user_rejected);
      const result = await q(
        `INSERT INTO evidence_items
           (user_id, session_id, evidence_type, content, source_exp_id, source_log_id,
            user_rejected, rejected_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          userId,
          sessionMap.get(asId(ev.session_id)) || null,
          mapEvidenceType(ev.type),
          truncate(ev.content, 300),
          sourceExpId,
          rejected ? 1 : 0,
          rejected ? toDatetime(ev.rejected_at || ev.created_at) : null,
          toDatetime(ev.created_at),
        ]
      );
      map.set(asId(ev.id), Number(result.insertId));
    }
    return map;
  },

  async insertReviews(sessions, sessionMap, experimentMap, evidenceMap, q) {
    let n = 0;
    for (const s of sessions) {
      const sessionId = sessionMap.get(asId(s.id));
      if (!sessionId) continue;
      for (const r of (Array.isArray(s.reviews) ? s.reviews : [])) {
        await q(
          `INSERT INTO reviews
             (session_id, experiment_id, outcome, converge_to, basis, evidence_id, next_action, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            experimentMap.get(asId(r.experiment_id)) || null,
            mapOutcome(r.outcome) || 'inconclusive',
            truncate(r.converge_to, 20),
            truncate(r.basis, 1000),
            evidenceMap.get(asId(r.evidence_id)) || null,
            mapNextAction(r.next_action),
            toDatetime(r.created_at),
          ]
        );
        n++;
      }
    }
    return n;
  },

  async upsertSnapshot(userId, snapshotJson, revision, clientSentAt, q) {
    await q(
      `INSERT INTO sync_snapshots (user_id, snapshot, revision, client_sent_at, synced_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         snapshot = VALUES(snapshot), revision = VALUES(revision),
         client_sent_at = VALUES(client_sent_at), synced_at = NOW()`,
      [userId, snapshotJson, revision, clientSentAt]
    );
  },

  async deleteSnapshot(userId, q) {
    await q('DELETE FROM sync_snapshots WHERE user_id = ?', [userId]);
  },
};
