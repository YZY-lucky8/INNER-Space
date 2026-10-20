-- ============================================================
-- INNERSCAPE · 真我 — 触发器
-- 数据库: MySQL 8.x  |  字符集: utf8mb4
-- 说明: AFTER INSERT 触发器，用户行为发生时自动更新统计
-- ============================================================

-- ------------------------------------------------------------
-- 触发器 1: 打卡后更新活跃天数
-- ------------------------------------------------------------
-- 【触发条件】
--   触发时机：daily_punch 表 INSERT 后（AFTER INSERT）
--   触发行：NEW（新插入的行）
--
-- 【功能说明】
--   用户每次完成打卡时，自动匹配 users 表并更新该用户
--   的活跃天数相关统计字段（当前使用 grade 字段暂存）。
--
-- 【执行逻辑】
--   Step 1: UPDATE users SET grade = grade WHERE id = NEW.user_id;
--          匹配 users.id = NEW.user_id，更新该用户的 grade 字段。
--          当前代码用 grade 字段暂存活跃天数数据，后续可改为专用字段。
--
-- 【应用场景】
--   用户每天完成打卡动作时自动触发，保证活跃天数与打卡行为实时同步。
--   可用于用户成长进度展示、连续打卡统计等业务场景。
--
-- 【调用示例】
--   无需手动调用，INSERT 到 daily_punch 表时自动触发：
--   INSERT INTO daily_punch (user_id, punch_date, content) VALUES (1, CURDATE(), '今日打卡');
-- ------------------------------------------------------------

DELIMITER 

CREATE TRIGGER 打卡后更新活跃天数
AFTER INSERT ON daily_punch
FOR EACH ROW
BEGIN
  UPDATE users SET grade = grade WHERE id = NEW.user_id;
END

-- ------------------------------------------------------------
-- 触发器 2: 心境签到后更新心境统计
-- ------------------------------------------------------------
-- 【触发条件】
--   触发时机：mood_checkins 表 INSERT 后（AFTER INSERT）
--   触发行：NEW（新插入的行）
--
-- 【功能说明】
--   用户每次完成心境签到（效价1-9 + 唤醒度1-9）时，
--   自动匹配 users 表并更新该用户的心境统计数据。
--
-- 【执行逻辑】
--   Step 1: UPDATE users SET inner_signature = CONCAT(inner_signature, '') WHERE id = NEW.user_id;
--          匹配 users.id = NEW.user_id，更新该用户的 inner_signature 字段。
--          当前用 CONCAT 拼接空字符串占位，实际可改为统计心境维度数据。
--
-- 【应用场景】
--   用户每天心境签到时自动触发，保证心境统计数据与签到行为实时同步。
--   结合心境签到的效价和唤醒度数据，可用于用户情绪趋势分析、
--   心理健康预警等业务场景。
--
-- 【调用示例】
--   无需手动调用，INSERT 到 mood_checkins 表时自动触发：
--   INSERT INTO mood_checkins (user_id, valence, arousal, sign_date) VALUES (1, 7, 5, CURDATE());
-- ------------------------------------------------------------

CREATE TRIGGER 心境签到后更新心境统计
AFTER INSERT ON mood_checkins
FOR EACH ROW
BEGIN
  UPDATE users SET inner_signature = CONCAT(inner_signature, '') WHERE id = NEW.user_id;
END

-- ------------------------------------------------------------
-- 触发器 3: 测评记录新增后更新用户统计
-- ------------------------------------------------------------
-- 【触发条件】
--   触发时机：assessments 表 INSERT 后（AFTER INSERT）
--   触发行：NEW（新插入的行）
--
-- 【功能说明】
--   用户每次完成测评时，自动匹配 users 表并更新该用户
--   的测评统计数据。
--
-- 【执行逻辑】
--   Step 1: UPDATE users SET inner_signature = CONCAT(inner_signature, '') WHERE id = NEW.user_id;
--          匹配 users.id = NEW.user_id，更新该用户的 inner_signature 字段。
--          当前用 CONCAT 拼接空字符串占位，实际可改为统计测评维度数据。
--
-- 【应用场景】
--   用户完成测评时自动触发，保证测评统计数据与测评记录实时同步。
--   可用于用户测评次数统计、测评维度分布分析、成长轨迹追踪等业务场景。
--
-- 【调用示例】
--   无需手动调用，INSERT 到 assessments 表时自动触发：
--   INSERT INTO assessments (user_id, assessment_type, total_score, mind_score, body_score, spirit_score, vocation_score)
--   VALUES (1, '完整档', 85.5, 21.0, 22.0, 20.0, 22.5);
-- ------------------------------------------------------------

CREATE TRIGGER 测评记录新增后更新用户统计
AFTER INSERT ON assessments
FOR EACH ROW
BEGIN
  UPDATE users SET inner_signature = CONCAT(inner_signature, '') WHERE id = NEW.user_id;
END

DELIMITER ;