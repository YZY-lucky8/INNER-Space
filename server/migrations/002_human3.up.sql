-- ============================================================
-- 002_human3 · 四象限匿名分布统计表（2026-11-15）
-- ------------------------------------------------------------
-- 与 001 的快照同步（方案 A）并存：快照仍完整保存 DB.human3，
-- 本表只存**结构化坐标**，供「同龄人象限分布」聚合，不含任何自由文本。
-- 写入路径唯一：用户显式点「加入匿名分布」（POST /api/v1/human3/assessments），
-- 默认离线 / 只开启云同步但没有点加入，都不会有这里的记录。
-- 约束名全库唯一（001 曾因 fk_ss_user 重名踩坑），这里用 fk_h3_assess_user_v2。
-- ============================================================

CREATE TABLE IF NOT EXISTS human3_assessments (
    id            VARCHAR(64)  PRIMARY KEY COMMENT '前端评估 id，幂等 upsert',
    user_id       INT          NOT NULL,
    schema_ver    TINYINT UNSIGNED NOT NULL DEFAULT 1,
    grid          JSON         NOT NULL COMMENT '4 象限 × 3 Traits，值域 1|2|3|null',
    phases        JSON         NOT NULL COMMENT '四象限阶段，值域 1|2|3',
    bottleneck    ENUM('mind','body','spirit','vocation') NULL COMMENT '最费劲的那一块',
    blocked_by    ENUM('mind','body','spirit','vocation') NULL COMMENT '阻塞链来源',
    archetype_key VARCHAR(32)  NULL COMMENT '确定性查表的参考画像 key，不是人格标签',
    status        ENUM('draft','report','dosed','reviewing','archived') NOT NULL DEFAULT 'report',
    created_at    DATETIME     NOT NULL,
    updated_at    DATETIME     NOT NULL,
    INDEX idx_h3_user_updated (user_id, updated_at),
    INDEX idx_h3_bottleneck (bottleneck),
    CONSTRAINT fk_h3_assess_user_v2 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Human 3.0 匿名结构化坐标（仅显式加入统计的用户有记录，无自由文本）';
