-- 001_offline_sync 回滚：按依赖顺序删除，仅删本次新增的 3 张表。
-- 注意：执行后会清除所有云端同步快照与登录会话，需二次确认。
DROP TABLE IF EXISTS sync_snapshots;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS otp_codes;
