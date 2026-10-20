CREATE VIEW 成长档案中心 AS
SELECT 
  u.id AS 用户,
  u.username AS 登录名,
  u.nickname AS 昵称,
  m.name AS 专业,
  u.grade AS 年级,
  u.created_at AS 注册时间,
  COUNT(DISTINCT a.id) AS 测评次数,
  COUNT(DISTINCT mc.id) AS 心境签到次数,
  COUNT(DISTINCT dp.id) AS 打卡天数,
  COUNT(DISTINCT tc.id) AS 时间胶囊数,
  COUNT(DISTINCT uc.cert_id) AS 已获证书数
FROM users u
LEFT JOIN majors m ON u.major_id = m.id
LEFT JOIN assessments a ON u.id = a.user_id
LEFT JOIN mood_checkins mc ON u.id = mc.user_id
LEFT JOIN daily_punch dp ON u.id = dp.user_id
LEFT JOIN time_capsules tc ON u.id = tc.user_id
LEFT JOIN user_certificates uc ON u.id = uc.user_id
GROUP BY u.id, u.username, u.nickname, m.name, u.grade, u.created_at;
