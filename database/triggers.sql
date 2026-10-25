-- ============================================================
-- INNER-Space /「卡点」· 触发器脚本（v1.0 / 2026-11-04）
-- 依赖：schema.sql → views.sql → procedures.sql
--
-- 说明：旧版 triggers.sql 的 3 个触发器全是占位（BEGIN ... END 里没有语句）。
-- 本次重写后每个触发器都承担一条真实业务红线，任何一条被绕过，
-- 产品就会退化（变成"AI 夸人"或"标签化测评"）。
--
-- 五条红线：
--   ① 假设引用的原文必须是用户真的写过的（禁止 AI 编证据）
--   ② 置信度只能是低/中/高（禁止伪精确）
--   ③ 能量值只能 -2 ~ +2（唯一可量化的证据原始数据）
--   ④ 身份证据必须挂在一次有记录的真实实验上（禁止悬空证据）
--   ⑤ 复盘一旦产生结果，实验与会话状态必须同步（禁止"复盘了但还挂在进行中"）
-- ============================================================

SET NAMES utf8mb4;

-- 注：多轮卡点的 root_id 自指不放触发器 —— MySQL 禁止在触发器内 UPDATE 触发表本身
--     （错误 1442），该职责由 sp_create_stuck_session 在第 1 轮插入后回填。
DROP TRIGGER IF EXISTS trg_hyp_quote_guard;
DROP TRIGGER IF EXISTS trg_hyp_disagree_stamp;
DROP TRIGGER IF EXISTS trg_log_energy_guard;
DROP TRIGGER IF EXISTS trg_evidence_guard;
DROP TRIGGER IF EXISTS trg_evidence_reject_stamp;
DROP TRIGGER IF EXISTS trg_review_after_insert;
DROP TRIGGER IF EXISTS trg_user_graduate_stamp;

DELIMITER $$

-- ------------------------------------------------------------
-- ② 禁止 AI 编造证据：evidence_quote 必须是 free_text 的逐字子串
--    （PRD §5.2 第 3 条，这是这类产品最常见的质量问题）
--    同时禁止在 reasoning / quote 里出现百分比和"分数"表述
-- ------------------------------------------------------------
CREATE TRIGGER trg_hyp_quote_guard
BEFORE INSERT ON hypotheses
FOR EACH ROW
BEGIN
    DECLARE v_free TEXT;

    SELECT free_text INTO v_free FROM stuck_sessions WHERE id = NEW.session_id;

    IF v_free IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '假设必须挂在存在的卡点上';
    END IF;

    IF NEW.evidence_quote IS NOT NULL AND CHAR_LENGTH(TRIM(NEW.evidence_quote)) > 0 THEN
        IF LOCATE(NEW.evidence_quote, v_free) = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = '证据引用必须是用户原话的逐字子串（禁止编造，PRD §5.2）';
        END IF;
    END IF;

    IF NEW.reasoning IS NOT NULL AND NEW.reasoning REGEXP '[0-9]+(\\.[0-9]+)?%' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '假设理由里不允许出现百分比（禁止伪精确）';
    END IF;

    IF NEW.confidence NOT IN ('low','medium','high') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '置信度只能是 low/medium/high';
    END IF;
END$$

-- ------------------------------------------------------------
-- ③ 「这不像我」：否定动作本身要留时间戳
--    否定率是诊断准确度的反向指标（PRD §6.3 disagree_clicked）
-- ------------------------------------------------------------
CREATE TRIGGER trg_hyp_disagree_stamp
BEFORE UPDATE ON hypotheses
FOR EACH ROW
BEGIN
    IF NEW.user_disagreed = 1 AND (OLD.user_disagreed = 0 OR OLD.user_disagreed IS NULL) THEN
        SET NEW.disagreed_at = NOW();
    END IF;
END$$

-- ------------------------------------------------------------
-- ④ 实验记录：能量范围、天数范围、档位自动推算
--    slot = CEIL(day_no / 2) —— 对应"每 2 天记一次"的节奏
-- ------------------------------------------------------------
CREATE TRIGGER trg_log_energy_guard
BEFORE INSERT ON experiment_logs
FOR EACH ROW
BEGIN
    IF NEW.day_no < 1 OR NEW.day_no > 7 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '实验周期只有 7 天，day_no 必须在 1~7';
    END IF;

    IF NEW.energy IS NOT NULL AND (NEW.energy < -2 OR NEW.energy > 2) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '能量值必须在 -2 ~ +2（能量证据的原始刻度）';
    END IF;

    IF NEW.slot IS NULL THEN
        SET NEW.slot = CEIL(NEW.day_no / 2);
    END IF;
END$$

-- ------------------------------------------------------------
-- ⑤ 身份证据不能悬空：必须指向一次真实存在、且已有记录的实验
--    （PRD §2.5 道德底线：证据不是从行为来的，产品就退化成巴纳姆效应）
-- ------------------------------------------------------------
CREATE TRIGGER trg_evidence_guard
BEFORE INSERT ON evidence_items
FOR EACH ROW
BEGIN
    DECLARE v_logs INT DEFAULT 0;

    IF NEW.source_exp_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '身份证据必须绑定 source_exp_id';
    END IF;

    SELECT COUNT(*) INTO v_logs FROM experiment_logs WHERE experiment_id = NEW.source_exp_id;
    IF v_logs = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '该实验没有任何记录，不允许产出身份证据';
    END IF;
END$$

-- ------------------------------------------------------------
-- ⑥ 证据被否定时留痕（不删除，只标记）
-- ------------------------------------------------------------
CREATE TRIGGER trg_evidence_reject_stamp
BEFORE UPDATE ON evidence_items
FOR EACH ROW
BEGIN
    IF NEW.user_rejected = 1 AND (OLD.user_rejected = 0 OR OLD.user_rejected IS NULL) THEN
        SET NEW.rejected_at = NOW();
    END IF;
END$$

-- ------------------------------------------------------------
-- ⑦ 复盘后状态同步：实验挂结果、会话收敛或转介
--    另外守一条：同一会话不能出现两条"已确认收敛"的复盘
-- ------------------------------------------------------------
CREATE TRIGGER trg_review_after_insert
AFTER INSERT ON reviews
FOR EACH ROW
BEGIN
    DECLARE v_confirmed INT DEFAULT 0;

    IF NEW.experiment_id IS NOT NULL THEN
        UPDATE experiments
           SET outcome = NEW.outcome,
               ended_at = COALESCE(ended_at, NOW())
         WHERE id = NEW.experiment_id;
    END IF;

    IF NEW.next_action = 'referred' THEN
        UPDATE stuck_sessions SET status = 'referred' WHERE id = NEW.session_id;
    ELSEIF NEW.outcome IN ('confirmed','refuted') THEN
        UPDATE stuck_sessions SET status = 'converged' WHERE id = NEW.session_id;
    END IF;

    SELECT COUNT(*) INTO v_confirmed
      FROM reviews
     WHERE session_id = NEW.session_id AND outcome = 'confirmed' AND converge_to IS NOT NULL;

    IF v_confirmed > 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '同一卡点只允许一条已确认收敛的复盘';
    END IF;
END$$

-- ------------------------------------------------------------
-- ⑧ 毕业：状态字段自动对齐（让用户走，是产品的核心功能）
-- ------------------------------------------------------------
CREATE TRIGGER trg_user_graduate_stamp
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    IF NEW.graduated = 1 AND (OLD.graduated = 0 OR OLD.graduated IS NULL) THEN
        SET NEW.graduated_at = COALESCE(NEW.graduated_at, NOW());
        SET NEW.status = 'graduated';
    END IF;
END$$

DELIMITER ;

-- ------------------------------------------------------------
-- 触发器清单（7 个）
--   trg_hyp_quote_guard        证据引用必须是原文子串 + 禁百分比
--   trg_hyp_disagree_stamp     「这不像我」留痕
--   trg_log_energy_guard       能量 -2~+2、天数 1~7、档位推算
--   trg_evidence_guard         禁止悬空证据 / 无记录证据
--   trg_evidence_reject_stamp  证据否定留痕
--   trg_review_after_insert    复盘 → 实验与会话状态同步
--   trg_user_graduate_stamp    毕业状态对齐
-- ------------------------------------------------------------
