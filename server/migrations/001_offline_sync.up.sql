-- ============================================================
-- 001_offline_sync · 离线优先全栈所需的服务端表（2026-11-15）
-- 不改动 database/schema.sql 的 23 张课程设计表结构，只新增 3 张服务端表。
-- 可回滚：配套 001_offline_sync.down.sql
--
-- 数据边界：sync_snapshots.snapshot 含卡点原文，只有用户显式「开启云同步」
-- 并调用 POST /api/v1/sync/push 时才会写入；默认离线状态下一字节都不上传。
-- ============================================================

CREATE TABLE IF NOT EXISTS otp_codes (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    email        VARCHAR(120) NOT NULL COMMENT '邮箱（只用于投递验证码，不采集姓名/学号）',
    code_hash    CHAR(64)     NOT NULL COMMENT 'SHA-256(code + server pepper)，绝不存明文',
    expires_at   DATETIME     NOT NULL,
    attempts     TINYINT UNSIGNED DEFAULT 0,
    consumed_at  DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otp_email_created (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱验证码（短时效、限次数、用完即弃）';

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    token_hash   CHAR(64) NOT NULL COMMENT 'SHA-256(refresh JWT)，服务端只存哈希',
    expires_at   DATETIME NOT NULL,
    revoked_at   DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_rt_hash (token_hash),
    INDEX idx_rt_user (user_id),
    CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='刷新令牌（服务端可撤销）';

CREATE TABLE IF NOT EXISTS sync_snapshots (
    user_id      INT PRIMARY KEY,
    snapshot     LONGTEXT NOT NULL COMMENT '前端 DB 全量快照 JSON，pull 时原样还原，字段零丢失',
    revision     INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '每次 push +1，用于检测多端冲突',
    client_sent_at DATETIME COMMENT '客户端声明的快照时间（仅作展示，不参与冲突判定）',
    synced_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- 约束名全库唯一，不能与 stuck_sessions.fk_ss_user 同名
    CONSTRAINT fk_sync_snap_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='离线优先同步快照（仅显式开启同步的用户有记录）';
