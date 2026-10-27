-- 002_human3 回滚：只删本迁移新建的统计表；快照里的 DB.human3 不动。
DROP TABLE IF EXISTS human3_assessments;
