-- ============================================================
-- init.sql —— INNERSCAPE 数据库初始化唯一入口。
-- 由 schema.sql + views.sql + procedures.sql + triggers.sql 合并而成，
-- 分区顺序即建库顺序：建表 → 视图 → 存储过程 → 触发器。
-- 建库/重建直接执行本文件即可；各分区的 DELIMITER 块均已成对闭合。
-- ============================================================


-- ==================== 分区：建表（原 schema.sql） ====================
-- ============================================================
-- INNER-Space /「卡点」· 数据库建表脚本（v1.0 / 2026-11-04）
-- 数据库: MySQL 8.x  |  字符集: utf8mb4  |  引擎: InnoDB
--
-- 重构口径（对照 PRD v1.0 §4.3）：
--   旧版 21 张表（人格测评 / 每日打卡 / 时间胶囊 / 香氛 等）
--   → 本次重写为 19 张表（2026-11-20 精简后），全部被代码真正使用：
--       复用 8 张  majors / certificates / postgrad_directions / positions
--                  major_certificates / major_postgrads / position_certificates
--                  user_certificates
--       新建 7 张  users / stuck_sessions / hypotheses
--                  experiments / experiment_logs / reviews / evidence_items
--       内容资产 1 张  experiment_templates（静态内容，不计入 §4.3 的 16 张）
--       论坛 3 张  forum_posts / forum_replies / forum_reply_votes
--   即：PRD §4.3 的 16 张业务表 + 3 张论坛表 = 19 张
--
-- 删除的表（与"要证据不要态度"原则冲突或从未使用）：
--   questions / assessments / assessment_answers  自评量表，与产品原则冲突
--   user_settings                                音乐/音量/自适应，与主旨无关
--   daily_punch                                  改语义为 experiment_logs
--   time_capsules / seeds / seed_sounds / fragrance_recipes
--   diagnoses / action_plans                     改名重构为 stuck_sessions / experiments
--
-- 建表顺序：静态生涯库 → 用户与画像 → 核心业务 → 证据资产 → 内容资产 → 中间表 → 论坛
--
-- 2026-11-14 追加：经验分享 / 论坛 3 张表
--   forum_posts / forum_replies / forum_reply_votes
--   本文件是课程设计口径的 MySQL DDL；线上实际运行的是应用云数据库的同名表
--   （PostgreSQL + RLS，公开读 / 仅本人可写删），字段语义一致但不共用实例。
--   2026-11-20 精简：删除 bottleneck_types / user_profiles / observers / mood_checkins
--   4 张零引用表（后端 SQL、视图、存储过程、触发器均未引用），当前共 19 张。
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 第一部分 · 复用表（生涯数据，仅供 E 方向瓶颈分支查询）
-- ------------------------------------------------------------

DROP TABLE IF EXISTS forum_reply_votes;
DROP TABLE IF EXISTS forum_replies;
DROP TABLE IF EXISTS forum_posts;
DROP TABLE IF EXISTS major_certificates;
DROP TABLE IF EXISTS major_postgrads;
DROP TABLE IF EXISTS position_certificates;
DROP TABLE IF EXISTS user_certificates;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS postgrad_directions;
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS majors;
DROP TABLE IF EXISTS evidence_items;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS experiment_logs;
DROP TABLE IF EXISTS experiments;
DROP TABLE IF EXISTS hypotheses;
DROP TABLE IF EXISTS stuck_sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS experiment_templates;

-- DROP 阶段结束后立即恢复外键校验：后面的 CREATE 按依赖顺序执行，
-- 保证每个 FOREIGN KEY 都在父表已存在时建立。
-- （修复 2026-11-15：原脚本全程 FOREIGN_KEY_CHECKS=0，导致 experiments.fk_ex_tpl
--   引用了当时尚未创建的 experiment_templates，该约束实际不可用。）
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 第零部分 · 内容资产（被 experiments 引用，必须先于核心业务建表）
-- ------------------------------------------------------------

CREATE TABLE experiment_templates (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '模板编号',
    type_code     VARCHAR(20) NOT NULL COMMENT '瓶颈类型编码：A_METHOD/B_SKILL/C_MEANING/D_CONTEXT/E_DIRECTION',
    template_key  VARCHAR(20) COMMENT '前端模板 key，如 A1 / B1',
    title         VARCHAR(200) NOT NULL COMMENT '实验标题',
    actions_json  JSON NOT NULL COMMENT '3 条动作',
    observation   VARCHAR(300) NOT NULL COMMENT '观察点',
    duration_days TINYINT DEFAULT 7 COMMENT '周期，默认 7 天',
    branching     JSON COMMENT '分支判定：{"better":"A_METHOD","same":"B_SKILL"}',
    evidence_hint VARCHAR(20) COMMENT '本实验通常产出哪类证据',
    active        TINYINT(1) DEFAULT 1 COMMENT '是否启用',
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实验模板库（内容资产，目标 100+ 条）';

-- ------------------------------------------------------------
-- 第一部分 · 复用表（生涯数据，仅供 E 方向瓶颈分支查询）
-- ------------------------------------------------------------

CREATE TABLE majors (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '专业编号',
    name        VARCHAR(100) NOT NULL COMMENT '专业名称（与前端 MAJORS 的 key 对齐）',
    key_code    VARCHAR(40)  UNIQUE COMMENT '前端使用的 key，如 cs / fin / law',
    description VARCHAR(500) COMMENT '专业描述',
    tips        VARCHAR(1000) COMMENT '该专业的通用路径提示'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业库（复用，E 方向分支用）';

CREATE TABLE certificates (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '证书编号',
    name        VARCHAR(120) NOT NULL COMMENT '证书名称',
    issuer      VARCHAR(100) COMMENT '颁发机构',
    tag         VARCHAR(40) COMMENT '分类标签：通用技能 / 细分方向',
    description VARCHAR(500) COMMENT '证书描述',
    why_low     VARCHAR(500) COMMENT '大二适用理由（低年级）',
    why_high    VARCHAR(500) COMMENT '大三/大四适用理由',
    why_grad    VARCHAR(500) COMMENT '毕业/已就业适用理由'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='证书库（复用，E 方向分支用）';

CREATE TABLE postgrad_directions (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '考研方向编号',
    name        VARCHAR(120) NOT NULL COMMENT '考研方向名称',
    school_hint VARCHAR(200) COMMENT '院校/专业课参考',
    description VARCHAR(500) COMMENT '方向描述'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考研方向库（复用，E 方向分支用）';

CREATE TABLE positions (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '岗位编号',
    name        VARCHAR(120) NOT NULL COMMENT '岗位名称',
    description VARCHAR(500) COMMENT '岗位描述',
    why_now     VARCHAR(500) COMMENT '为什么现在做它（每条输出必须带，PRD §3.2⑦）'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位库（复用，E 方向分支用）';

-- ------------------------------------------------------------
-- 第二部分 · 用户与画像（新建）
-- ------------------------------------------------------------

CREATE TABLE users (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户编号',
    email         VARCHAR(120) UNIQUE COMMENT '邮箱免密登录，不存密码 = 不承担密码泄露责任',
    nickname      VARCHAR(50) COMMENT '昵称',
    graduated     TINYINT(1) DEFAULT 0 COMMENT '是否已走完毕业流程',
    graduate_summary TEXT COMMENT '毕业总结：这段时间你发现了什么',
    graduated_at  DATETIME COMMENT '毕业时间',
    consent_at    DATETIME COMMENT '告知同意时间（首次使用必须留痕）',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    last_seen_at  DATETIME COMMENT '最近活跃',
    status        ENUM('active','graduated','deleted') DEFAULT 'active' COMMENT '状态'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户（不采集姓名/学号/手机号）';

-- ------------------------------------------------------------
-- 第三部分 · 核心业务（新建）
-- ------------------------------------------------------------

CREATE TABLE stuck_sessions (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '卡点会话编号',
    user_id           INT NOT NULL COMMENT '用户ID',
    root_id           BIGINT COMMENT '首轮会话ID，用于把多轮实验串成一个卡点',
    round_no          TINYINT DEFAULT 1 COMMENT '第几轮（最多 3 轮）',
    free_text         TEXT NOT NULL COMMENT '用户自由描述（屏1）',
    q1_hours          ENUM('0-3','4-10','11-20','20+') COMMENT 'Q1 每周投入时长 → 区分 A',
    q2_progress       ENUM('yes','no','unclear') COMMENT 'Q2 是否有别人看得见的变化 → 核心判据',
    q2_detail         VARCHAR(300) COMMENT 'Q2 选"有"时的一句具体描述',
    q3_method_switch  ENUM('none','once','multiple') COMMENT 'Q3 是否换过做法 → 区分 A/B',
    q4_no_external    ENUM('yes','no','unclear') COMMENT 'Q4 无外部回报还做吗 → 区分 C/E',
    q5_peer           ENUM('yes','reachable','unreachable','none') COMMENT 'Q5 身边是否有够得着的同类 → 区分 D',
    rule_top          VARCHAR(20) COMMENT '规则引擎首猜（A_METHOD/B_SKILL/C_MEANING/D_CONTEXT/E_DIRECTION）',
    rule_second       VARCHAR(20) COMMENT '规则引擎次猜',
    rule_scores       JSON COMMENT '五类权重快照，便于复盘诊断质量',
    engine_used       ENUM('rule','ai','hybrid') DEFAULT 'rule' COMMENT '实际使用的引擎（降级率监控）',
    safety_flagged    TINYINT(1) DEFAULT 0 COMMENT '是否命中危机信号（命中即不落原文）',
    status            ENUM('open','converged','abandoned','referred') DEFAULT 'open' COMMENT '状态',
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_ss_user_created (user_id, created_at),
    INDEX idx_ss_root (root_id),
    CONSTRAINT fk_ss_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='一次卡点咨询（核心对象）';

CREATE TABLE hypotheses (
    id             INT AUTO_INCREMENT PRIMARY KEY COMMENT '假设编号',
    session_id     BIGINT NOT NULL COMMENT '所属卡点',
    type_code      VARCHAR(20) NOT NULL COMMENT 'A_METHOD/B_SKILL/C_MEANING/D_CONTEXT/E_DIRECTION',
    rank_no        TINYINT NOT NULL COMMENT '排序 1-3',
    confidence     ENUM('low','medium','high') NOT NULL COMMENT '置信度：只用低/中/高，不用百分比',
    reasoning      TEXT COMMENT '为什么这么猜（≤60 字）',
    evidence_quote VARCHAR(500) COMMENT '逐字引用用户原话（必须是 free_text 子串）',
    evidence_from  VARCHAR(40) DEFAULT '你写的原话' COMMENT '引用来源标注',
    user_disagreed TINYINT(1) DEFAULT 0 COMMENT '「这不像我」反馈（本身是重要信号）',
    disagreed_at   DATETIME COMMENT '否定时间',
    CONSTRAINT fk_hy_session FOREIGN KEY (session_id) REFERENCES stuck_sessions(id) ON DELETE CASCADE,
    CONSTRAINT uk_hy_rank UNIQUE (session_id, rank_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='诊断假设（最多 3 条/会话）';

CREATE TABLE experiments (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '实验编号',
    session_id    BIGINT NOT NULL COMMENT '所属卡点',
    hypothesis_id INT COMMENT '主要针对的假设',
    template_id   INT COMMENT '指向 experiment_templates',
    type_code     VARCHAR(20) COMMENT '实验对应的瓶颈类型',
    title         VARCHAR(200) NOT NULL COMMENT '实验标题',
    actions_json  JSON NOT NULL COMMENT '3 条动作',
    observation   VARCHAR(300) NOT NULL COMMENT '观察点（做完看什么）',
    duration_days TINYINT DEFAULT 7 COMMENT '周期天数，默认 7',
    started_at    DATETIME COMMENT '开始时间',
    ended_at      DATETIME COMMENT '结束时间',
    outcome       ENUM('confirmed','refuted','inconclusive') DEFAULT NULL COMMENT '实验结果',
    CONSTRAINT fk_ex_session FOREIGN KEY (session_id)    REFERENCES stuck_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_ex_hyp     FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id)     ON DELETE SET NULL,
    CONSTRAINT fk_ex_tpl     FOREIGN KEY (template_id)   REFERENCES experiment_templates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分辨实验（产品的真正产品）';

CREATE TABLE experiment_logs (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '记录编号',
    experiment_id INT NOT NULL COMMENT '所属实验',
    day_no        TINYINT NOT NULL COMMENT '第几天（1-7）',
    slot          TINYINT COMMENT '第几档记录（1/2/3/4，对应每 2 天一次）',
    did_it        TINYINT(1) COMMENT '今天做了 / 没做',
    note          VARCHAR(500) COMMENT '一句话发生了什么',
    energy        TINYINT COMMENT '能量 -2 ~ +2（五类证据里唯一可量化采集的原始数据）',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    CONSTRAINT uk_log_exp_day UNIQUE (experiment_id, day_no),
    CONSTRAINT ck_log_energy CHECK (energy BETWEEN -2 AND 2),
    CONSTRAINT fk_log_exp FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实验记录（每 2 天一次，不是每日打卡）';

CREATE TABLE reviews (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '复盘编号',
    session_id    BIGINT NOT NULL COMMENT '所属卡点',
    experiment_id INT COMMENT '复盘针对的实验',
    outcome       ENUM('confirmed','refuted','inconclusive') NOT NULL COMMENT '实验结果',
    converge_to   VARCHAR(20) COMMENT '收敛到的瓶颈类型',
    basis         VARCHAR(1000) COMMENT '依据（来自哪次记录）',
    evidence_id   INT COMMENT '本次产出的一条身份证据（最多 1 条）',
    next_action   ENUM('continue','new_session','graduated','referred') COMMENT '下一步',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '复盘时间',
    CONSTRAINT fk_rv_session FOREIGN KEY (session_id)    REFERENCES stuck_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_rv_exp     FOREIGN KEY (experiment_id) REFERENCES experiments(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='复盘（最多产出 1 条证据）';

-- ------------------------------------------------------------
-- 第四部分 · 核心资产：身份证据 + 情绪基线
-- ------------------------------------------------------------

CREATE TABLE evidence_items (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '证据编号',
    user_id       INT NOT NULL COMMENT '用户ID',
    session_id    BIGINT COMMENT '来源卡点',
    evidence_type ENUM('interest','strength','value','energy','boundary') NOT NULL COMMENT '兴趣/优势/价值观/能量/边界',
    content       VARCHAR(300) NOT NULL COMMENT '一句话证据',
    source_exp_id INT NOT NULL COMMENT '必须可追溯到具体实验（强约束，不允许悬空证据）',
    source_log_id BIGINT COMMENT '可进一步追溯到某条记录',
    user_rejected TINYINT(1) DEFAULT 0 COMMENT '「这不像我」否定标记（否定本身也是身份信号）',
    rejected_at   DATETIME COMMENT '否定时间',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
    INDEX idx_ev_user_type (user_id, evidence_type),
    CONSTRAINT fk_ev_user FOREIGN KEY (user_id)       REFERENCES users(id)        ON DELETE CASCADE,
    CONSTRAINT fk_ev_exp  FOREIGN KEY (source_exp_id) REFERENCES experiments(id)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='身份证据（产品核心资产，不可悬空）';

-- ------------------------------------------------------------
-- 第五部分 · 内容资产静态数据
--   experiment_templates 的 CREATE 已前移到「第零部分」：
--   开启外键校验后 experiments.fk_ex_tpl 要求父表先存在。
--   这里及后面的 INSERT 只负责灌静态数据，表数量不变（仍 19 张）。
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 第六部分 · 中间表（E 方向分支的多对多映射）
-- ------------------------------------------------------------

CREATE TABLE major_certificates (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    major_id INT NOT NULL,
    cert_id  INT NOT NULL,
    priority TINYINT DEFAULT 0 COMMENT '推荐优先级，越大越靠前',
    why_now  VARCHAR(500) COMMENT '为什么现在做它',
    CONSTRAINT fk_mc_major FOREIGN KEY (major_id) REFERENCES majors(id)       ON DELETE CASCADE,
    CONSTRAINT fk_mc_cert  FOREIGN KEY (cert_id)  REFERENCES certificates(id) ON DELETE CASCADE,
    CONSTRAINT uk_mc_pair  UNIQUE (major_id, cert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业 × 证书（复用，加 priority / why_now）';

CREATE TABLE major_postgrads (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    major_id    INT NOT NULL,
    postgrad_id INT NOT NULL,
    priority    TINYINT DEFAULT 0,
    why_now     VARCHAR(500) COMMENT '为什么现在做它',
    CONSTRAINT fk_mp_major   FOREIGN KEY (major_id)    REFERENCES majors(id)               ON DELETE CASCADE,
    CONSTRAINT fk_mp_postgrad FOREIGN KEY (postgrad_id) REFERENCES postgrad_directions(id)  ON DELETE CASCADE,
    CONSTRAINT uk_mp_pair    UNIQUE (major_id, postgrad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业 × 考研方向（复用）';

CREATE TABLE position_certificates (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    position_id INT NOT NULL,
    cert_id     INT NOT NULL,
    priority    TINYINT DEFAULT 0,
    CONSTRAINT fk_pc_position FOREIGN KEY (position_id) REFERENCES positions(id)    ON DELETE CASCADE,
    CONSTRAINT fk_pc_cert     FOREIGN KEY (cert_id)     REFERENCES certificates(id) ON DELETE CASCADE,
    CONSTRAINT uk_pc_pair     UNIQUE (position_id, cert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位 × 证书（复用）';

CREATE TABLE user_certificates (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id  INT NOT NULL,
    cert_id  INT NOT NULL,
    got_at   DATE COMMENT '取得时间',
    CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id)        ON DELETE CASCADE,
    CONSTRAINT fk_uc_cert FOREIGN KEY (cert_id) REFERENCES certificates(id) ON DELETE CASCADE,
    CONSTRAINT uk_uc_pair UNIQUE (user_id, cert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户已取得的证书（复用，E 方向分支去重用）';

-- ------------------------------------------------------------
-- 静态数据 · 实验模板（M0 先做 5 个，每类 1 个）
-- ------------------------------------------------------------

INSERT INTO experiment_templates (type_code, template_key, title, actions_json, observation, duration_days, branching, evidence_hint) VALUES
('A_METHOD','A1','把同一件事，换一种完全不同的做法再做一次',
 JSON_ARRAY('挑出这周本来就要做的那件事，不要换任务','换掉其中一个关键做法：一直看视频学的，就合上书自己讲一遍','两种做法都做完之后，写下产出上的具体差异'),
 '新做法的产出，和旧做法比有没有明显不同',7,
 JSON_OBJECT('better','A_METHOD','same','B_SKILL'),'strength'),
('B_SKILL','B1','只练卡住的那一步，每天 20 分钟',
 JSON_ARRAY('把卡住的那一步单独写下来，只写一步','每天 20 分钟只练这一步，不学别的','第 7 天回看：这一步比第一天顺了多少'),
 '这一步本身的熟练度，而不是整件事的进度',7,
 JSON_OBJECT('better','B_SKILL','same','D_CONTEXT'),'strength'),
('C_MEANING','C1','停掉这件"应该做"的事 7 天',
 JSON_ARRAY('这 7 天不碰它，不补进度，也不找替代品','每天只记一句：今天有没有主动想起它','第 7 天看这 7 天你到底主动做了什么'),
 '这 7 天你会不会主动想碰它',7,
 JSON_OBJECT('better','C_MEANING','same','E_DIRECTION'),'interest'),
('D_CONTEXT','D1','找一个走得比你远的人，聊 30 分钟',
 JSON_ARRAY('找出 1 个在做同一件事、且比你走得远的人（学长/老师/社群）','准备 3 个具体问题：我现在卡在这一步，你当时怎么过的','聊完记下：哪些信息是你原来完全没有的'),
 '对方给你的信息是不是你原来没有的',7,
 JSON_OBJECT('better','D_CONTEXT','same','A_METHOD'),'value'),
('E_DIRECTION','E1','用 1 天，真实体验这个方向的日常',
 JSON_ARRAY('选 1 天，按这个方向的人真实的一天去过（跟一天班 / 做一套真题 / 接一个真实小任务）','不要只查资料，要真的动手做完一小段','晚上记一句：这一天结束时，你的能量是升还是降'),
 '体验完之后你的能量是升还是降',7,
 JSON_OBJECT('better','E_DIRECTION','same','A_METHOD'),'energy');

-- ------------------------------------------------------------
-- 第七部分 · 经验分享 / 论坛（2026-11-14 新增）
--   设计红线：只把「主动发出来的内容」放这里。
--   卡点描述、实验日志、身份证据仍留用户本机，不入库、不上传。
--   不设全站排行榜；「有用」只是单条回答下的反馈计数。
-- ------------------------------------------------------------

CREATE TABLE forum_posts (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '帖子编号',
    user_id           INT NOT NULL COMMENT '发帖人（云端账号映射到 users.id）',
    author_name       VARCHAR(50) COMMENT '发帖时的显示名快照；匿名发布时为 NULL',
    title             VARCHAR(120) NOT NULL COMMENT '一句话标题',
    content           TEXT NOT NULL COMMENT '困惑正文',
    is_anonymous      TINYINT(1) DEFAULT 0 COMMENT '是否匿名发布',
    source            ENUM('forum','intake') DEFAULT 'forum' COMMENT '论坛直接发 / 从卡点描述带入',
    accepted_reply_id BIGINT COMMENT '楼主标记为「最有帮助」的回答',
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
    CONSTRAINT fk_fp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_fp_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经验分享 · 困惑帖子（公开读、仅本人可写删）';

CREATE TABLE forum_replies (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '回答编号',
    post_id       BIGINT NOT NULL COMMENT '所属帖子；删帖时级联删除',
    user_id       INT NOT NULL COMMENT '回答人',
    author_name   VARCHAR(50) COMMENT '显示名快照；匿名回答时为 NULL',
    content       TEXT NOT NULL COMMENT '回答正文（只讲经历，不做诊断或治疗建议）',
    is_anonymous  TINYINT(1) DEFAULT 0 COMMENT '是否匿名回答',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
    CONSTRAINT fk_fr_post FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_fr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_fr_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经验分享 · 回答';

CREATE TABLE forum_reply_votes (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '反馈编号',
    reply_id    BIGINT NOT NULL COMMENT '被标记的回答',
    user_id     INT NOT NULL COMMENT '标记人',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '标记时间',
    UNIQUE KEY uk_vote_once (reply_id, user_id) COMMENT '同一人对同一回答只能点一次「有用」',
    CONSTRAINT fk_fv_reply FOREIGN KEY (reply_id) REFERENCES forum_replies(id) ON DELETE CASCADE,
    CONSTRAINT fk_fv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经验分享 · 「有用」反馈（单帖内计数，不做全站排名）';

-- 采纳标记必须指向本帖下的回答；删回答时置空，不留下悬空引用
ALTER TABLE forum_posts
    ADD CONSTRAINT fk_fp_accepted FOREIGN KEY (accepted_reply_id)
    REFERENCES forum_replies(id) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;

-- 表数量核对：19 张 = 复用 8 + 新建 7 + 内容资产 1 + 论坛 3
--
-- 【复用 8 张】来自旧版，字段按新语义做过调整
--   majors / certificates / postgrad_directions / positions           ← E 方向模块的数据源
--   major_certificates / major_postgrads / position_certificates      ← 三张中间表
--   user_certificates                                                 ← E 方向：已考证书
--
-- 【新建 7 张】重构后新增的业务表
--   users                                                             ← 用户域
--   stuck_sessions                                                    ← 卡点（原 diagnoses 改名重构）
--   hypotheses / experiments / experiment_logs / reviews              ← 诊断→实验→复盘闭环
--   evidence_items                                                    ← 身份证据（产品核心资产）
--
-- 【内容资产 1 张】静态内容，不在 PRD §4.3 的 16 张业务表计数内
--   experiment_templates（实验模板库；type_code 取值域在字段注释中声明，不再建外键父表）
--
-- 【论坛 3 张】经验分享（2026-11-14 新增，见第七部分）
--   forum_posts / forum_replies / forum_reply_votes
--   → 线上运行的是应用云数据库的同名表（PostgreSQL + RLS）；本文件只作课程设计口径
--
-- 【已删除 8 张】
--   questions / assessments / assessment_answers  自评量表
--   user_settings（音乐/音量/自适应）
--   daily_punch                                   → 改为 experiment_logs
--   time_capsules / seeds / seed_sounds / fragrance_recipes
--
-- 配套脚本：views.sql（6 视图，含 v_forum_thread）→ procedures.sql（8 过程）→ triggers.sql（7 触发器）


-- ==================== 分区：视图（原 views.sql） ====================
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


-- ==================== 分区：存储过程（原 procedures.sql） ====================
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


-- ==================== 分区：触发器（原 triggers.sql） ====================
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
