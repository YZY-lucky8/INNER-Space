-- ============================================================
-- INNER-Space /「卡点」· 数据库建表脚本（v1.0 / 2026-11-04）
-- 数据库: MySQL 8.x  |  字符集: utf8mb4  |  引擎: InnoDB
--
-- 重构口径（对照 PRD v1.0 §4.3）：
--   旧版 21 张表（人格测评 / 每日打卡 / 时间胶囊 / 香氛 等）
--   → 本次重写为 20 张表，全部被代码真正使用：
--       复用 9 张  majors / certificates / postgrad_directions / positions
--                  major_certificates / major_postgrads / position_certificates
--                  mood_checkins / user_certificates
--       新建 9 张  users / user_profiles / observers / stuck_sessions / hypotheses
--                  experiments / experiment_logs / reviews / evidence_items
--       内容资产 2 张  bottleneck_types / experiment_templates（静态内容，不计入 §4.3 的 16 张）
--   即：PRD §4.3 的 16 张业务表 + observers + 2 张内容资产 = 20 张
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
--   当前共 23 张 = 原 20 张 + 论坛 3 张。
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
DROP TABLE IF EXISTS mood_checkins;
DROP TABLE IF EXISTS evidence_items;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS experiment_logs;
DROP TABLE IF EXISTS experiments;
DROP TABLE IF EXISTS hypotheses;
DROP TABLE IF EXISTS stuck_sessions;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS observers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS experiment_templates;
DROP TABLE IF EXISTS bottleneck_types;

-- DROP 阶段结束后立即恢复外键校验：后面的 CREATE 按依赖顺序执行，
-- 保证每个 FOREIGN KEY 都在父表已存在时建立。
-- （修复 2026-11-15：原脚本全程 FOREIGN_KEY_CHECKS=0，导致 experiments.fk_ex_tpl
--   引用了当时尚未创建的 experiment_templates，该约束实际不可用。）
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 第零部分 · 内容资产（被 experiments 引用，必须先于核心业务建表）
-- ------------------------------------------------------------

CREATE TABLE bottleneck_types (
    code         VARCHAR(20) PRIMARY KEY COMMENT 'A_METHOD/B_SKILL/C_MEANING/D_CONTEXT/E_DIRECTION',
    name         VARCHAR(50) NOT NULL COMMENT '类型名：方法/技能/动机/环境/方向',
    definition   VARCHAR(500) COMMENT '可操作定义',
    signals      JSON COMMENT '可观测信号清单（靠行为证据，不靠自评）',
    prescription VARCHAR(1000) COMMENT '处方方向',
    sort_no      TINYINT DEFAULT 0 COMMENT '展示顺序'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='五类瓶颈（静态 5 条）';

CREATE TABLE experiment_templates (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '模板编号',
    type_code     VARCHAR(20) NOT NULL COMMENT '对应瓶颈类型',
    template_key  VARCHAR(20) COMMENT '前端模板 key，如 A1 / B1',
    title         VARCHAR(200) NOT NULL COMMENT '实验标题',
    actions_json  JSON NOT NULL COMMENT '3 条动作',
    observation   VARCHAR(300) NOT NULL COMMENT '观察点',
    duration_days TINYINT DEFAULT 7 COMMENT '周期，默认 7 天',
    branching     JSON COMMENT '分支判定：{"better":"A_METHOD","same":"B_SKILL"}',
    evidence_hint VARCHAR(20) COMMENT '本实验通常产出哪类证据',
    active        TINYINT(1) DEFAULT 1 COMMENT '是否启用',
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tpl_type FOREIGN KEY (type_code) REFERENCES bottleneck_types(code)
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

CREATE TABLE user_profiles (
    user_id     INT PRIMARY KEY COMMENT '用户ID，1:1',
    major_id    INT COMMENT '专业ID，仅在 E 方向瓶颈时才采集',
    grade       TINYINT UNSIGNED COMMENT '2=大二 3=大三 4=大四',
    CONSTRAINT fk_up_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_up_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户画像（极简，不采集身份敏感信息）';

CREATE TABLE observers (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '观察者编号',
    user_id     INT NOT NULL COMMENT '被观察的用户ID',
    session_id  BIGINT COMMENT '关联的卡点（可空，代表全局观察者）',
    nickname    VARCHAR(50) COMMENT '观察者昵称（用户自己填，不采集联系方式）',
    feedback    VARCHAR(1000) COMMENT '观察者给出的一句反馈',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    CONSTRAINT fk_obs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='观察者反馈（补"他人反馈"这一自我认知来源；M2 上线）';

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

CREATE TABLE mood_checkins (
    id        INT AUTO_INCREMENT PRIMARY KEY COMMENT '记录编号',
    user_id   INT NOT NULL COMMENT '用户ID',
    valence   TINYINT NOT NULL COMMENT '效价 1-9（只用于个人趋势对比，不做任何评分）',
    arousal   TINYINT NOT NULL COMMENT '唤醒度 1-9',
    sign_date DATE NOT NULL COMMENT '日期',
    CONSTRAINT fk_mood_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT uk_mood_user_date UNIQUE (user_id, sign_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='情绪基线（复用，仅用于判断"走出去了没有"）';

-- ------------------------------------------------------------
-- 第五部分 · 内容资产静态数据
--   bottleneck_types / experiment_templates 的 CREATE 已前移到「第零部分」：
--   开启外键校验后 experiments.fk_ex_tpl 要求父表先存在。
--   这里及后面的 INSERT 只负责灌静态数据，表数量不变（仍 23 张）。
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
-- 静态数据 · 五类瓶颈
-- ------------------------------------------------------------

INSERT INTO bottleneck_types (code, name, definition, signals, prescription, sort_no) VALUES
('A_METHOD','方法','投入继续增加，回报不再增加，且做法一次没换过。',
 JSON_ARRAY('每周投入 ≥11 小时','连续 4 周没有别人看得见的变化','没换过做法','说不出做得好的人哪里不一样'),
 '换策略 / 找高手校准：把同一件事换一种完全不同的做法再做一次，比较产出。',1),
('B_SKILL','技能','方向对、方法也换了，但卡在某一个具体子能力上。',
 JSON_ARRAY('换过做法仍卡','能指出具体卡在哪一步','与做得好的差距是某一个子能力','知道该做什么但做不到'),
 '刻意练习最小子技能：只挑卡住的那一步，每天 20 分钟只练它。',2),
('C_MEANING','动机','有能力、有方法，但不启动。',
 JSON_ARRAY('他人认可你的能力，但你不启动','大量准备行为（买课/列计划）没有执行','高频出现"应该/必须"','无外部回报时不会做'),
 '重接目标与价值：停掉这件"应该做"的事 7 天，观察你会不会主动想它。',3),
('D_CONTEXT','环境','方法与技能都没问题，卡在没有人、没有资源、规则不允许。',
 JSON_ARRAY('方法技能都正常','卡点是缺人/缺资源/规则不允许','身边没有同类参照','信息拿不到'),
 '换场 / 找同类 / 改规则：找 1 个走得比你远的人聊 30 分钟。',4),
('E_DIRECTION','方向','目标与你的真实处境或价值观不匹配。',
 JSON_ARRAY('能做好但不想做','目标是从别人那里继承的','描述里"我"缺位','无外部回报时说不清'),
 '重新选择：做一次最小代价试错，用 1 天真实体验这个方向的日常。',5);

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

-- 表数量核对：23 张 = 复用 9 + 新建 9 + 内容资产 2 + 论坛 3
--
-- 【复用 9 张】来自旧版，字段按新语义做过调整
--   majors / certificates / postgrad_directions / positions           ← E 方向模块的数据源
--   major_certificates / major_postgrads / position_certificates      ← 三张中间表
--   mood_checkins                                                     ← 升级为情绪基线
--   user_certificates                                                 ← E 方向：已考证书
--
-- 【新建 9 张】重构后新增的业务表
--   users / user_profiles / observers                                 ← 用户域
--   stuck_sessions                                                    ← 卡点（原 diagnoses 改名重构）
--   hypotheses / experiments / experiment_logs / reviews              ← 诊断→实验→复盘闭环
--   evidence_items                                                    ← 身份证据（产品核心资产）
--
-- 【内容资产 2 张】静态内容，不在 PRD §4.3 的 16 张业务表计数内
--   bottleneck_types / experiment_templates
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
