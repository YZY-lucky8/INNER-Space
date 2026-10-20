-- ============================================================
-- INNERSCAPE · 真我 — 存储过程
-- 数据库: MySQL 8.x  |  字符集: utf8mb4
-- ============================================================

-- ------------------------------------------------------------
-- 存储过程 1: 执行每日诊断
-- ------------------------------------------------------------
-- 【功能说明】
--   基于用户近30天的打卡和签到数据，自动生成一次诊断记录，
--   量化分析用户的心智状态趋势。
--
-- 【参数说明】
--   user_id (INT) — 诊断对象的编号，取值范围 1~N
--
-- 【执行逻辑】
--   Step 1: SELECT COUNT(*) INTO check_in_count FROM mood_checkins WHERE user_id = @user_id AND sign_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
--          统计该用户近30天的心境签到次数。
--
--   Step 2: SELECT AVG(valence), AVG(arousal) INTO avg_valence, avg_arousal FROM mood_checkins WHERE user_id = @user_id AND sign_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
--          计算该用户近30天效价（情绪正负）和唤醒度（情绪强度）的均值。
--
--   Step 3: INSERT INTO diagnoses (user_id, diagnosis_type, result_data)
--           VALUES (@user_id, '每日诊断', JSON_OBJECT('签到天数', check_in_count, '平均效价', avg_valence, '平均唤醒度', avg_arousal));
--          将统计结果写入 diagnoses 表，诊断类型为"每日诊断"，
--          结果数据以 JSON 格式存储。
--
-- 【应用场景】
--   后端定时任务（如每天凌晨 0:00）自动调用此过程，
--   对用户最近30天的打卡和签到行为做一次量化评估。
--   诊断结果可在诊断记录中查看，用于用户心智状态趋势分析。
--
-- 【调用示例】
--   CALL 执行每日诊断(1);
-- ------------------------------------------------------------

DELIMITER 

CREATE PROCEDURE 执行每日诊断 (IN user_id INT)
BEGIN
  DECLARE check_in_count INT;
  DECLARE avg_valence DECIMAL(10,2);
  DECLARE avg_arousal DECIMAL(10,2);
  SELECT COUNT(*) INTO check_in_count FROM mood_checkins WHERE user_id = user_id AND sign_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
  SELECT AVG(valence), AVG(arousal) INTO avg_valence, avg_arousal FROM mood_checkins WHERE user_id = user_id AND sign_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
  INSERT INTO diagnoses (user_id, diagnosis_type, result_data) VALUES (user_id, '每日诊断', JSON_OBJECT('签到天数', check_in_count, '平均效价', avg_valence, '平均唤醒度', avg_arousal));
END

-- ------------------------------------------------------------
-- 存储过程 2: 测评记录归档
-- ------------------------------------------------------------
-- 【功能说明】
--   当用户完成一次测评时，调用此过程将测评结果写入"成长档案中心"视图，
--   实时更新用户档案统计数据（测评次数、心境签到次数、打卡天数、时间胶囊数、已获证书数）。
--
-- 【参数说明】
--   assessment_id (INT) — 测评记录编号，取值范围 1~N
--
-- 【执行逻辑】
--   Step 1: SELECT u.id, 1, 0, 0, 0, 0 FROM assessments a JOIN users u ON a.user_id = u.id WHERE a.id = assessment_id;
--          从 assessments 表定位测评记录，关联用户表获取用户编号。
--          测评次数 +1（第二个参数为 1），心境签到次数、打卡天数、时间胶囊数、已获证书数均为 0。
--
--   Step 2: INSERT INTO 成长档案中心 (用户, 测评次数, 心境签到次数, 打卡天数, 时间胶囊数, 已获证书数)
--           SELECT ...;
--          将上述结果写入"成长档案中心"视图（实际写入底层表聚合），
--          更新该用户的档案统计。
--
-- 【应用场景】
--   用户完成一次测评（快速档或完整档）后立即调用，
--   实时更新成长档案中心的统计数据。
--   与视图配合使用，保证用户档案始终反映最新测评结果。
--
-- 【调用示例】
--   CALL 测评记录归档(15);
-- ------------------------------------------------------------

CREATE PROCEDURE 测评记录归档 (IN assessment_id INT)
BEGIN
  INSERT INTO 成长档案中心 (用户, 测评次数, 心境签到次数, 打卡天数, 时间胶囊数, 已获证书数)
  SELECT u.id, 1, 0, 0, 0, 0 FROM assessments a JOIN users u ON a.user_id = u.id WHERE a.id = assessment_id;
END

-- ------------------------------------------------------------
-- 存储过程 3: 发放证书
-- ------------------------------------------------------------
-- 【功能说明】
--   向指定用户发放指定证书，自动去重（同一用户同一证书只发放一次）。
--   用于实现"用户达成条件 → 系统自动解锁证书"的游戏化激励机制。
--
-- 【参数说明】
--   user_id (INT) — 发放对象的用户编号
--   cert_id  (INT) — 要发放的证书编号
--
-- 【执行逻辑】
--   Step 1: IF NOT EXISTS (SELECT 1 FROM user_certificates WHERE user_id = user_id AND cert_id = cert_id) THEN
--          检查 user_certificates 表中是否已存在该用户和证书的关联记录。
--
--   Step 2: INSERT INTO user_certificates (user_id, cert_id) VALUES (user_id, cert_id);
--          若不存在关联记录，则插入一条，建立用户与证书的关联。
--
--   Step 3: END IF;
--          若已存在关联记录，跳过不操作（去重保护）。
--
-- 【应用场景】
--   当用户达成某个条件（如完成特定测评、连续打卡一定天数、通过诊断等）后，
--   系统自动触发此存储过程发放对应证书。
--   结合 user_certificates 中间表，证书发放记录可查询、可追溯。
--
-- 【调用示例】
--   CALL 发放证书(1, 3);
-- ------------------------------------------------------------

CREATE PROCEDURE 发放证书 (IN user_id INT, IN cert_id INT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_certificates WHERE user_id = user_id AND cert_id = cert_id) THEN
    INSERT INTO user_certificates (user_id, cert_id) VALUES (user_id, cert_id);
  END IF;
END

DELIMITER ;