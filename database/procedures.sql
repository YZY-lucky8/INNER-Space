-- ============================================================
-- INNER-Space /「卡点」· 存储过程脚本（v1.0 / 2026-11-04）
-- 依赖：schema.sql → views.sql
-- 口径：
--   1) 每个过程对应前端 demo 里的一个真实动作，不写"演示用"的空过程
--   2) 关键业务约束落在库层（证据必须绑定实验、最多 1 条证据、3 轮不收敛转介）
--      —— 前端可以被绕过，库层不能
--   3) 过程内的 SIGNAL 都是业务错误，前端应静默降级而不是弹红字
-- ============================================================

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS sp_create_stuck_session;
DROP PROCEDURE IF EXISTS sp_replace_hypotheses;
DROP PROCEDURE IF EXISTS sp_start_experiment;
DROP PROCEDURE IF EXISTS sp_log_experiment;
DROP PROCEDURE IF EXISTS sp_add_evidence;
DROP PROCEDURE IF EXISTS sp_converge_session;
DROP PROCEDURE IF EXISTS sp_reject_evidence;
DROP PROCEDURE IF EXISTS sp_graduate_user;

DELIMITER $$

-- ------------------------------------------------------------
-- 1. sp_create_stuck_session
--    「卡点录入」两屏提交后调用（PRD §3.2②）
--    写入自由文本 + Q1~Q5 + 规则引擎首猜/次猜 + 权重快照 + 实际引擎
--    多轮：若传了 p_root_id，则 round_no = 父会话轮次 + 1
-- ------------------------------------------------------------
CREATE PROCEDURE sp_create_stuck_session(
    IN  p_user_id       INT,
    IN  p_free_text     TEXT,
    IN  p_q1_hours      VARCHAR(10),
    IN  p_q2_progress   VARCHAR(10),
    IN  p_q2_detail     VARCHAR(300),
    IN  p_q3_switch     VARCHAR(10),
    IN  p_q4_no_ext     VARCHAR(10),
    IN  p_q5_peer       VARCHAR(12),
    IN  p_rule_top      VARCHAR(20),
    IN  p_rule_second   VARCHAR(20),
    IN  p_rule_scores   JSON,
    IN  p_engine        VARCHAR(10),
    IN  p_safety        TINYINT,
    IN  p_root_id       BIGINT,
    OUT p_session_id    BIGINT
)
BEGIN
    DECLARE v_round   TINYINT DEFAULT 1;
    DECLARE v_root    BIGINT;
    DECLARE v_rounds  TINYINT DEFAULT 0;

    IF p_free_text IS NULL OR CHAR_LENGTH(TRIM(p_free_text)) < 20 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '卡点描述至少 20 字：太短无法定位（前端应放行但在库层留痕）';
    END IF;

    IF p_safety = 1 THEN
        -- 命中危机信号：只落标记，不落原文（PRD §8.2 / §5.4 日志要求）
        INSERT INTO stuck_sessions
            (user_id, root_id, round_no, free_text, q1_hours, q2_progress, q2_detail,
             q3_method_switch, q4_no_external, q5_peer, rule_top, rule_second,
             rule_scores, engine_used, safety_flagged, status)
        VALUES
            (p_user_id, p_root_id, 1, '[safety_flagged]', p_q1_hours, p_q2_progress, NULL,
             p_q3_switch, p_q4_no_ext, p_q5_peer, NULL, NULL,
             NULL, 'rule', 1, 'referred');
        SET p_session_id = LAST_INSERT_ID();
    ELSE
        IF p_root_id IS NOT NULL THEN
            SELECT COALESCE(MAX(round_no), 0) INTO v_rounds
              FROM stuck_sessions WHERE id = p_root_id OR root_id = p_root_id;
            SET v_round = LEAST(v_rounds + 1, 3);
            SET v_root  = p_root_id;
        ELSE
            SET v_root = NULL;
        END IF;

        INSERT INTO stuck_sessions
            (user_id, root_id, round_no, free_text, q1_hours, q2_progress, q2_detail,
             q3_method_switch, q4_no_external, q5_peer, rule_top, rule_second,
             rule_scores, engine_used, safety_flagged, status)
        VALUES
            (p_user_id, v_root, v_round, p_free_text, p_q1_hours, p_q2_progress, p_q2_detail,
             p_q3_switch, p_q4_no_ext, p_q5_peer, p_rule_top, p_rule_second,
             p_rule_scores, COALESCE(p_engine, 'rule'), 0, 'open');

        SET p_session_id = LAST_INSERT_ID();

        IF v_root IS NULL THEN
            UPDATE stuck_sessions SET root_id = p_session_id WHERE id = p_session_id;
        END IF;
    END IF;
END$$

-- ------------------------------------------------------------
-- 2. sp_replace_hypotheses
--    「诊断结果」屏的 2~3 张假设卡（PRD §3.2③ / §5.2）
--    入参是该会话的假设 JSON 数组：
--      [{"type":"A_METHOD","rank":1,"confidence":"high",
--        "reasoning":"...","quote":"..."}, ...]
--    硬约束由 trg_hyp_quote_guard 兜住：quote 必须是 free_text 的子串
-- ------------------------------------------------------------
CREATE PROCEDURE sp_replace_hypotheses(
    IN p_session_id BIGINT,
    IN p_json       JSON
)
BEGIN
    DECLARE v_len   INT DEFAULT 0;
    DECLARE v_i     INT DEFAULT 0;
    DECLARE v_type  VARCHAR(20);
    DECLARE v_rank  TINYINT;
    DECLARE v_conf  VARCHAR(10);
    DECLARE v_reason TEXT;
    DECLARE v_quote VARCHAR(500);

    IF p_json IS NULL OR JSON_TYPE(p_json) <> 'ARRAY' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '假设必须是 JSON 数组';
    END IF;

    SET v_len = JSON_LENGTH(p_json);
    IF v_len < 2 OR v_len > 3 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '假设数量必须为 2~3 条（不做单点断言）';
    END IF;

    DELETE FROM hypotheses WHERE session_id = p_session_id;

    WHILE v_i < v_len DO
        SET v_type   = JSON_UNQUOTE(JSON_EXTRACT(p_json, CONCAT('$[', v_i, '].type')));
        SET v_rank   = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_json, CONCAT('$[', v_i, '].rank'))) AS UNSIGNED);
        SET v_conf   = JSON_UNQUOTE(JSON_EXTRACT(p_json, CONCAT('$[', v_i, '].confidence')));
        SET v_reason = JSON_UNQUOTE(JSON_EXTRACT(p_json, CONCAT('$[', v_i, '].reasoning')));
        SET v_quote  = JSON_UNQUOTE(JSON_EXTRACT(p_json, CONCAT('$[', v_i, '].quote')));

        IF v_type NOT IN ('A_METHOD','B_SKILL','C_MEANING','D_CONTEXT','E_DIRECTION') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '假设类型不在五类瓶颈内';
        END IF;
        IF v_conf NOT IN ('low','medium','high') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '置信度只能是 low/medium/high（不允许百分比）';
        END IF;

        INSERT INTO hypotheses
            (session_id, type_code, rank_no, confidence, reasoning, evidence_quote)
        VALUES
            (p_session_id, v_type, v_rank, v_conf, LEFT(v_reason, 200), v_quote);

        SET v_i = v_i + 1;
    END WHILE;
END$$

-- ------------------------------------------------------------
-- 3. sp_start_experiment
--    「开始实验」按钮（PRD §3.2③ 分辨实验卡）
--    从 experiment_templates 取模板实例化；不传模板则取该类型第一条启用的模板
-- ------------------------------------------------------------
CREATE PROCEDURE sp_start_experiment(
    IN  p_session_id   BIGINT,
    IN  p_template_key VARCHAR(20),
    IN  p_type_code    VARCHAR(20),
    OUT p_exp_id       INT
)
BEGIN
    DECLARE v_tpl     INT;
    DECLARE v_title   VARCHAR(200);
    DECLARE v_actions JSON;
    DECLARE v_observe VARCHAR(300);
    DECLARE v_days    TINYINT;
    DECLARE v_type    VARCHAR(20);
    DECLARE v_hyp     INT;

    SELECT t.id, t.title, t.actions_json, t.observation, t.duration_days, t.type_code
      INTO v_tpl, v_title, v_actions, v_observe, v_days, v_type
      FROM experiment_templates t
     WHERE t.active = 1
       AND (p_template_key IS NULL OR t.template_key = p_template_key)
       AND (p_type_code    IS NULL OR t.type_code    = p_type_code)
     ORDER BY t.id LIMIT 1;

    IF v_tpl IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '没有可用的实验模板（对应 PRD §5.3 第三级降级）';
    END IF;

    SELECT h.id INTO v_hyp
      FROM hypotheses h
     WHERE h.session_id = p_session_id AND h.type_code = v_type
     ORDER BY h.rank_no LIMIT 1;

    INSERT INTO experiments
        (session_id, hypothesis_id, template_id, type_code, title,
         actions_json, observation, duration_days, started_at)
    VALUES
        (p_session_id, v_hyp, v_tpl, v_type, v_title,
         v_actions, v_observe, COALESCE(v_days, 7), NOW());

    SET p_exp_id = LAST_INSERT_ID();
END$$

-- ------------------------------------------------------------
-- 4. sp_log_experiment
--    「实验跟踪」每 2 天一次记录（PRD §3.2④）
--    同一实验同一天重复提交 → 覆盖（用户改口是常见行为，不该报错）
--    slot = CEIL(day_no / 2)：1→1, 3→2, 5→3, 7→4
-- ------------------------------------------------------------
CREATE PROCEDURE sp_log_experiment(
    IN p_exp_id  INT,
    IN p_day_no  TINYINT,
    IN p_did_it  TINYINT,
    IN p_note    VARCHAR(500),
    IN p_energy  TINYINT
)
BEGIN
    DECLARE v_started DATETIME;
    DECLARE v_outcome VARCHAR(20);

    SELECT started_at, outcome INTO v_started, v_outcome
      FROM experiments WHERE id = p_exp_id;

    IF v_started IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '实验不存在';
    END IF;
    IF v_outcome IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '该实验已复盘，不再接收记录';
    END IF;
    IF p_day_no < 1 OR p_day_no > 7 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'day_no 必须在 1~7 之间';
    END IF;
    IF p_energy IS NOT NULL AND (p_energy < -2 OR p_energy > 2) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '能量值必须在 -2 ~ +2 之间';
    END IF;

    INSERT INTO experiment_logs (experiment_id, day_no, slot, did_it, note, energy)
    VALUES (p_exp_id, p_day_no, CEIL(p_day_no / 2), p_did_it, LEFT(p_note, 500), p_energy)
    ON DUPLICATE KEY UPDATE
        slot       = VALUES(slot),
        did_it     = VALUES(did_it),
        note       = VALUES(note),
        energy     = VALUES(energy),
        created_at = NOW();

    -- 第 7 天有记录 → 实验自动结束，前端据此自动进复盘页
    IF p_day_no = 7 THEN
        UPDATE experiments SET ended_at = NOW() WHERE id = p_exp_id AND ended_at IS NULL;
    END IF;
END$$

-- ------------------------------------------------------------
-- 5. sp_add_evidence
--    「身份证据」入库（PRD §2.5 道德底线）
--    三条硬约束在这里守：
--      a) 必须有 source_exp_id，且该实验属于该用户
--      b) 该实验必须至少有一条记录（没记录不允许产出证据）
--      c) 一次复盘最多 1 条证据（由 sp_converge_session 控制调用次数）
-- ------------------------------------------------------------
CREATE PROCEDURE sp_add_evidence(
    IN  p_user_id    INT,
    IN  p_session_id BIGINT,
    IN  p_type       VARCHAR(20),
    IN  p_content    VARCHAR(300),
    IN  p_exp_id     INT,
    IN  p_log_id     BIGINT,
    OUT p_ev_id      INT
)
BEGIN
    DECLARE v_owner INT;
    DECLARE v_logs  INT;

    IF p_type NOT IN ('interest','strength','value','energy','boundary') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '证据类型必须是 5 类之一';
    END IF;
    IF p_content IS NULL OR CHAR_LENGTH(TRIM(p_content)) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '证据内容不能为空';
    END IF;

    SELECT ss.user_id INTO v_owner
      FROM experiments x JOIN stuck_sessions ss ON ss.id = x.session_id
     WHERE x.id = p_exp_id;

    IF v_owner IS NULL OR v_owner <> p_user_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '证据必须绑定到本人名下的实验（不允许悬空证据）';
    END IF;

    SELECT COUNT(*) INTO v_logs FROM experiment_logs WHERE experiment_id = p_exp_id;
    IF v_logs = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '该实验还没有任何记录，不能产出证据（防止 AI 夸人）';
    END IF;

    INSERT INTO evidence_items
        (user_id, session_id, evidence_type, content, source_exp_id, source_log_id)
    VALUES
        (p_user_id, p_session_id, p_type, LEFT(p_content, 300), p_exp_id, p_log_id);

    SET p_ev_id = LAST_INSERT_ID();
END$$

-- ------------------------------------------------------------
-- 6. sp_converge_session
--    「复盘」提交（PRD §3.2⑤ / §2.6）
--      · 写 review（结果 + 依据 + 收敛类型 + 下一步）
--      · 至多 1 条证据（p_evidence_content 非空才写）
--      · 3 轮仍不收敛 → status = 'referred'，并给出转介口径
-- ------------------------------------------------------------
CREATE PROCEDURE sp_converge_session(
    IN  p_session_id       BIGINT,
    IN  p_exp_id           INT,
    IN  p_outcome          VARCHAR(20),
    IN  p_converge_to      VARCHAR(20),
    IN  p_basis            VARCHAR(1000),
    IN  p_next_action      VARCHAR(20),
    IN  p_evidence_type    VARCHAR(20),
    IN  p_evidence_content VARCHAR(300),
    OUT p_review_id        INT,
    OUT p_ev_id            INT
)
BEGIN
    DECLARE v_user    INT;
    DECLARE v_round   TINYINT DEFAULT 1;
    DECLARE v_status  VARCHAR(20);
    DECLARE v_next    VARCHAR(20);
    DECLARE v_conv    INT DEFAULT 0;

    SELECT user_id, round_no, status INTO v_user, v_round, v_status
      FROM stuck_sessions WHERE id = p_session_id;

    IF v_user IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '卡点不存在';
    END IF;
    IF p_outcome NOT IN ('confirmed','refuted','inconclusive') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '复盘结果必须是 confirmed / refuted / inconclusive';
    END IF;

    SET p_ev_id = NULL;

    IF p_evidence_content IS NOT NULL AND CHAR_LENGTH(TRIM(p_evidence_content)) > 0 THEN
        CALL sp_add_evidence(v_user, p_session_id, p_evidence_type, p_evidence_content, p_exp_id, NULL, p_ev_id);
    END IF;

    -- 3 轮不收敛 → 停止自动化流程，转介（PRD §2.6）
    SET v_next = p_next_action;
    IF p_outcome = 'inconclusive' AND v_round >= 3 THEN
        SET v_next = 'referred';
    END IF;

    INSERT INTO reviews
        (session_id, experiment_id, outcome, converge_to, basis, evidence_id, next_action)
    VALUES
        (p_session_id, p_exp_id, p_outcome, p_converge_to, p_basis, p_ev_id, v_next);

    SET p_review_id = LAST_INSERT_ID();

    UPDATE experiments
       SET outcome = p_outcome, ended_at = COALESCE(ended_at, NOW())
     WHERE id = p_exp_id;

    UPDATE stuck_sessions
       SET status = CASE
                        WHEN v_next = 'referred'                  THEN 'referred'
                        WHEN p_outcome IN ('confirmed','refuted') THEN 'converged'
                        ELSE status
                    END
     WHERE id = p_session_id;

    -- 事实自检：本轮之后该卡点收敛了几次（用于内部质量看板）
    SELECT COUNT(*) INTO v_conv FROM reviews
     WHERE session_id = p_session_id AND converge_to IS NOT NULL AND outcome = 'confirmed';
    IF v_conv > 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '同一个卡点不应该产生多条已确认收敛的复盘';
    END IF;
END$$

-- ------------------------------------------------------------
-- 7. sp_reject_evidence
--    「这不像我」（PRD §2.5 / §3.2⑤）
--    不删除证据，只标记 —— 否定本身是身份信号，且下次诊断要参考
-- ------------------------------------------------------------
CREATE PROCEDURE sp_reject_evidence(
    IN p_ev_id  INT,
    IN p_reason VARCHAR(200)
)
BEGIN
    UPDATE evidence_items
       SET user_rejected = 1,
           rejected_at   = NOW()
     WHERE id = p_ev_id AND user_rejected = 0;

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '证据不存在或已被否定过';
    END IF;
END$$

-- ------------------------------------------------------------
-- 8. sp_graduate_user
--    「我觉得可以了」毕业流程（PRD §2.6 / §3.2⑥）
--    生成"这段时间你发现了什么"总结，并明确把用户请走
-- ------------------------------------------------------------
CREATE PROCEDURE sp_graduate_user(
    IN p_user_id INT
)
BEGIN
    DECLARE v_ev      INT DEFAULT 0;
    DECLARE v_sess    INT DEFAULT 0;
    DECLARE v_conv    INT DEFAULT 0;
    DECLARE v_summary TEXT;

    SELECT COUNT(*) INTO v_ev   FROM evidence_items WHERE user_id = p_user_id AND user_rejected = 0;
    SELECT COUNT(*) INTO v_sess FROM stuck_sessions  WHERE user_id = p_user_id;
    SELECT COUNT(*) INTO v_conv FROM reviews r
      JOIN stuck_sessions s ON s.id = r.session_id
     WHERE s.user_id = p_user_id AND r.outcome = 'confirmed';

    IF v_ev = 0 THEN
        SET v_summary = '这段时间你走完了 0 条证据。没有证据就谈不上"发现了什么"——这不是失败，是还没到时候，下次从一个小实验开始。';
    ELSE
        SET v_summary = CONCAT('这段时间你走完了 ', v_sess, ' 个卡点、', v_conv,
                               ' 次确认，攒下 ', v_ev, ' 条关于你自己的证据。',
                               '这些证据不是标签，是你在具体情境里真实做过的事。',
                               '你不需要它了 —— 下次卡住时，你已经有办法自己试一次。');
    END IF;

    UPDATE users
       SET graduated = 1,
           graduated_at = NOW(),
           graduate_summary = v_summary,
           status = 'graduated'
     WHERE id = p_user_id;
END$$

DELIMITER ;

-- ------------------------------------------------------------
-- 过程与前端动作的对应关系
--   卡点录入屏提交      → sp_create_stuck_session
--   诊断页渲染          → sp_replace_hypotheses（AI / 规则结果统一走这里）
--   点「开始」做实验    → sp_start_experiment
--   每 2 天一次记录     → sp_log_experiment
--   复盘提交            → sp_converge_session
--   证据「这不像我」    → sp_reject_evidence
--   「我觉得可以了」    → sp_graduate_user
--   单独补一条证据      → sp_add_evidence（正常主流程无需直调）
-- ------------------------------------------------------------
