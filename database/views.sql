-- ============================================================
-- INNER-Space /「卡点」· 视图脚本（v1.0 / 2026-11-04）
-- 依赖：schema.sql（先执行建表）
-- 口径：逐个视图都对应产品里真实要展示的一屏，不做"为了有视图而有视图"
--
-- 旧版视图「成长档案中心」已废弃：
--   它统计的是 测评次数 / 打卡天数 / 时间胶囊数，
--   而这些表（assessments / daily_punch / time_capsules）在重构中已删除。
--   新的"档案"不再数次数，而是看证据条数与收敛情况。
--
-- 2026-11-14 追加 v_forum_thread（第 6 个视图）：经验分享列表屏。
--   只统计单帖内的回答数与「有用」数，不做全站热度或排行榜。
-- ============================================================

SET NAMES utf8mb4;

DROP VIEW IF EXISTS v_forum_thread;
DROP VIEW IF EXISTS v_evidence_archive;
DROP VIEW IF EXISTS v_session_overview;
DROP VIEW IF EXISTS v_experiment_progress;
DROP VIEW IF EXISTS v_diagnosis_quality;
DROP VIEW IF EXISTS v_direction_options;

-- ------------------------------------------------------------
-- 1. v_evidence_archive —— 「我的证据」屏（PRD §3.2⑥）
--    按 5 类分组的证据条，每条带日期 + 来源实验（可点回那次实验）
--    被否定（user_rejected=1）的证据保留在档案里但单独标记：
--    否定本身也是身份信号，不能删。
-- ------------------------------------------------------------
CREATE VIEW v_evidence_archive AS
SELECT
    e.user_id                       AS user_id,
    e.id                            AS evidence_id,
    e.evidence_type                 AS evidence_type,
    CASE e.evidence_type
        WHEN 'interest' THEN '兴趣证据'
        WHEN 'strength' THEN '优势证据'
        WHEN 'value'    THEN '价值观证据'
        WHEN 'energy'   THEN '能量证据'
        WHEN 'boundary' THEN '边界证据'
    END                             AS evidence_type_name,
    e.content                       AS content,
    DATE(e.created_at)              AS evidence_date,
    e.user_rejected                 AS user_rejected,
    e.rejected_at                   AS rejected_at,
    e.source_exp_id                 AS source_exp_id,
    exp.title                       AS source_exp_title,
    exp.type_code                   AS source_type_code,
    ss.id                           AS session_id,
    ss.round_no                     AS round_no,
    e.source_log_id                 AS source_log_id,
    log.day_no                      AS source_log_day
FROM evidence_items e
JOIN experiments   exp ON exp.id = e.source_exp_id
JOIN stuck_sessions ss ON ss.id = exp.session_id
LEFT JOIN experiment_logs log ON log.id = e.source_log_id
ORDER BY e.user_id, e.created_at DESC;

-- ------------------------------------------------------------
-- 2. v_session_overview —— 「卡点历史」屏（PRD §3.2⑥）
--    曾经卡过什么、当时判成什么、后来怎样了（轮次 / 实验 / 复盘）
-- ------------------------------------------------------------
CREATE VIEW v_session_overview AS
SELECT
    ss.id                                   AS session_id,
    ss.user_id                              AS user_id,
    COALESCE(ss.root_id, ss.id)             AS root_id,
    ss.round_no                             AS round_no,
    ss.status                               AS status,
    LEFT(ss.free_text, 60)                  AS free_text_short,
    ss.rule_top                             AS rule_top,
    ss.rule_second                          AS rule_second,
    ss.engine_used                          AS engine_used,
    ss.safety_flagged                       AS safety_flagged,
    ss.created_at                           AS created_at,
    (SELECT COUNT(*) FROM hypotheses h  WHERE h.session_id  = ss.id)                                  AS hypothesis_count,
    (SELECT COUNT(*) FROM hypotheses h  WHERE h.session_id  = ss.id AND h.user_disagreed = 1)          AS hypothesis_disagree_count,
    (SELECT COUNT(*) FROM experiments x  WHERE x.session_id = ss.id)                                   AS experiment_count,
    (SELECT MAX(x.outcome) FROM experiments x WHERE x.session_id = ss.id)                              AS latest_outcome,
    (SELECT r.converge_to FROM reviews r WHERE r.session_id = ss.id ORDER BY r.created_at DESC LIMIT 1) AS converge_to,
    (SELECT r.next_action FROM reviews r WHERE r.session_id = ss.id ORDER BY r.created_at DESC LIMIT 1) AS next_action
FROM stuck_sessions ss;

-- ------------------------------------------------------------
-- 3. v_experiment_progress —— 「实验跟踪」屏（PRD §3.2④）
--    每 2 天一次记录：看已记几档、最后记到第几天、还剩几天、最后能量
-- ------------------------------------------------------------
CREATE VIEW v_experiment_progress AS
SELECT
    exp.id                              AS experiment_id,
    exp.session_id                      AS session_id,
    exp.type_code                       AS type_code,
    exp.title                           AS title,
    exp.duration_days                   AS duration_days,
    exp.started_at                      AS started_at,
    exp.ended_at                        AS ended_at,
    exp.outcome                         AS outcome,
    COUNT(log.id)                       AS log_count,
    MAX(log.day_no)                     AS last_log_day,
    SUM(CASE WHEN log.did_it = 1 THEN 1 ELSE 0 END) AS did_count,
    SUM(CASE WHEN log.did_it = 0 THEN 1 ELSE 0 END) AS missed_count,
    ROUND(AVG(log.energy), 2)           AS avg_energy,
    SUBSTRING_INDEX(GROUP_CONCAT(log.energy ORDER BY log.created_at DESC SEPARATOR ','), ',', 1) AS latest_energy,
    MAX(log.created_at)                 AS last_log_at,
    GREATEST(exp.duration_days - DATEDIFF(CURDATE(), DATE(exp.started_at)), 0) AS days_left
FROM experiments exp
LEFT JOIN experiment_logs log ON log.experiment_id = exp.id
GROUP BY exp.id, exp.session_id, exp.type_code, exp.title, exp.duration_days,
         exp.started_at, exp.ended_at, exp.outcome;

-- ------------------------------------------------------------
-- 4. v_diagnosis_quality —— 内部监控（PRD §6.2 诊断准确度）
--    按瓶颈类型看：假设被否率（diagnosis 认可率）、实验启动率、收敛率
--    注意：这是给内部用的聚合视图，不对单个学生下钻（§7.2 合规约束）
-- ------------------------------------------------------------
CREATE VIEW v_diagnosis_quality AS
SELECT
    h.type_code                                                     AS type_code,
    COUNT(*)                                                        AS hypothesis_total,
    SUM(CASE WHEN h.user_disagreed = 1 THEN 1 ELSE 0 END)            AS disagreed_total,
    ROUND(SUM(CASE WHEN h.user_disagreed = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS disagree_rate,
    (SELECT COUNT(*) FROM experiments x WHERE x.type_code = h.type_code)             AS experiment_started,
    (SELECT COUNT(*) FROM reviews r WHERE r.converge_to = h.type_code)               AS converged_total,
    (SELECT COUNT(*) FROM reviews r WHERE r.converge_to = h.type_code AND r.outcome = 'confirmed') AS confirmed_total
FROM hypotheses h
GROUP BY h.type_code;

-- ------------------------------------------------------------
-- 5. v_direction_options —— 方向模块（PRD §3.2⑦，仅 E 方向可达）
--    专业 × 证书 / 考研方向 / 岗位，每条必须带"为什么现在做它"
--    注意：
--      · 视图不带用户维度（视图无法接收参数）。"已考过哪些证"的去重
--        由调用方查 user_certificates 后自行过滤，不要把 user_id 写死在视图里。
--      · 岗位分支必须经 major_certificates → position_certificates 两跳，
--        不能用 positions 与 majors 直接笛卡尔积（会产出全量组合噪声）。
-- ------------------------------------------------------------
CREATE VIEW v_direction_options AS
SELECT
    m.id                                AS major_id,
    m.key_code                          AS major_key,
    m.name                              AS major_name,
    'certificate'                       AS option_kind,
    c.id                                AS option_id,
    c.name                              AS option_name,
    COALESCE(mc.why_now, c.description) AS why_now,
    mc.priority                         AS priority
FROM majors m
JOIN major_certificates mc ON mc.major_id = m.id
JOIN certificates       c  ON c.id = mc.cert_id
UNION ALL
SELECT
    m.id, m.key_code, m.name,
    'postgrad', p.id, p.name,
    COALESCE(mp.why_now, p.description),
    mp.priority
FROM majors m
JOIN major_postgrads      mp ON mp.major_id = m.id
JOIN postgrad_directions  p  ON p.id = mp.postgrad_id
UNION ALL
SELECT DISTINCT
    m.id, m.key_code, m.name,
    'position', pos.id, pos.name,
    COALESCE(pos.why_now, '这个岗位需要你这条路线的证书，先用它验证一次'),
    COALESCE(pc.priority, 0)
FROM majors m
JOIN major_certificates      mc  ON mc.major_id = m.id
JOIN position_certificates   pc  ON pc.cert_id  = mc.cert_id
JOIN positions               pos ON pos.id      = pc.position_id
ORDER BY major_id, option_kind, priority DESC;

-- ------------------------------------------------------------
-- 6. v_forum_thread —— 「经验分享」列表屏（2026-11-14 新增）
--    一行一个困惑：作者按匿名规则脱敏、回答数、有用总数、是否已采纳。
--    不做全站排行；排序交给调用方按 created_at 决定。
-- ------------------------------------------------------------
CREATE VIEW v_forum_thread AS
SELECT
    p.id                            AS post_id,
    p.user_id                       AS author_id,
    CASE WHEN p.is_anonymous = 1
         THEN '一位同学（匿名）'
         ELSE COALESCE(p.author_name, '一位同学')
    END                             AS author_label,
    p.title                         AS title,
    p.content                       AS content,
    p.is_anonymous                  AS is_anonymous,
    p.source                        AS source,
    p.accepted_reply_id             AS accepted_reply_id,
    p.created_at                    AS created_at,
    (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id) AS reply_count,
    (SELECT COUNT(*)
       FROM forum_reply_votes v
       JOIN forum_replies r ON r.id = v.reply_id
      WHERE r.post_id = p.id)       AS helpful_count,
    CASE WHEN p.accepted_reply_id IS NULL THEN 0 ELSE 1 END AS has_accepted
FROM forum_posts p;

-- ------------------------------------------------------------
-- 视图与表的对应关系（自检用）
--   v_evidence_archive   ← evidence_items / experiments / stuck_sessions / experiment_logs
--   v_session_overview   ← stuck_sessions / hypotheses / experiments / reviews
--   v_experiment_progress← experiments / experiment_logs
--   v_diagnosis_quality  ← hypotheses / experiments / reviews
--   v_direction_options  ← majors / certificates / postgrad_directions / positions
--                          / major_certificates / major_postgrads / position_certificates
--                          （user_certificates 由调用方查，不并入视图）
--   v_forum_thread       ← forum_posts / forum_replies / forum_reply_votes
-- ------------------------------------------------------------
