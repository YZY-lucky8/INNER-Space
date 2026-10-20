-- ============================================================
-- INNERSCAPE · 真我 — 数据库建表脚本（21 张表）
-- 数据库: MySQL 8.x  |  字符集: utf8mb4
-- 说明: 先建静态库(被引用表)，再建核心表，最后建中间表(依赖外键)
-- ============================================================

-- ------------------------------------------------------------
-- ① 静态数据表（无外键，先建）
-- ------------------------------------------------------------

CREATE TABLE majors (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '专业编号',
    name        VARCHAR(100) NOT NULL COMMENT '专业名称',
    description VARCHAR(500) COMMENT '专业描述'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业库';

CREATE TABLE certificates (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '证书编号',
    name        VARCHAR(100) NOT NULL COMMENT '证书名称',
    issuer      VARCHAR(100) COMMENT '颁发机构',
    description VARCHAR(500) COMMENT '证书描述'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='证书库';

CREATE TABLE postgrad_directions (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '考研方向编号',
    name        VARCHAR(100) NOT NULL COMMENT '考研方向名称',
    description VARCHAR(500) COMMENT '方向描述'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考研方向库';

CREATE TABLE positions (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '岗位编号',
    name        VARCHAR(100) NOT NULL COMMENT '岗位名称',
    description VARCHAR(500) COMMENT '岗位描述'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位库';

CREATE TABLE questions (
    id           INT AUTO_INCREMENT PRIMARY KEY COMMENT '题目编号',
    question_text VARCHAR(500) NOT NULL COMMENT '题目内容',
    dimension    VARCHAR(50) NOT NULL COMMENT '维度(心/身/灵/职业)',
    options      VARCHAR(1000) COMMENT '选项JSON',
    score_weight DECIMAL(5,2) DEFAULT 1.00 COMMENT '分值权重'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题目库';

-- ------------------------------------------------------------
-- ② 核心表（引用静态库）
-- ------------------------------------------------------------

CREATE TABLE users (
    id              INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户编号',
    username        VARCHAR(50) NOT NULL UNIQUE COMMENT '登录名，唯一',
    password        VARCHAR(255) NOT NULL COMMENT '密码(加密存储)',
    nickname        VARCHAR(50) COMMENT '昵称',
    major_id        INT COMMENT '专业ID',
    grade           VARCHAR(20) COMMENT '年级',
    inner_signature VARCHAR(500) COMMENT '内在签名',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_users_major FOREIGN KEY (major_id) REFERENCES majors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

CREATE TABLE user_settings (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户设置编号',
    user_id     INT NOT NULL UNIQUE COMMENT '用户ID，1:1唯一',
    music_on    TINYINT(1) DEFAULT 1 COMMENT '是否开启音乐',
    volume      TINYINT DEFAULT 80 COMMENT '音量0-100',
    adaptive_on TINYINT(1) DEFAULT 1 COMMENT '自适应模式',
    CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户设置表';

CREATE TABLE assessments (
    id              INT AUTO_INCREMENT PRIMARY KEY COMMENT '测评编号',
    user_id         INT NOT NULL COMMENT '用户ID',
    assessment_type VARCHAR(20) NOT NULL COMMENT '类型(快速档/完整档)',
    total_score     DECIMAL(8,2) COMMENT '总分',
    mind_score      DECIMAL(8,2) COMMENT '心维度分',
    body_score      DECIMAL(8,2) COMMENT '身维度分',
    spirit_score    DECIMAL(8,2) COMMENT '灵维度分',
    vocation_score  DECIMAL(8,2) COMMENT '职业维度分',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '测评时间',
    CONSTRAINT fk_assessments_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测评记录表';

CREATE TABLE assessment_answers (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键自增(一人多次测评同题会重复，必须自增)',
    assessment_id INT NOT NULL COMMENT '测评记录ID',
    question_id   INT NOT NULL COMMENT '题目ID',
    selected_option VARCHAR(500) COMMENT '所选选项',
    score         DECIMAL(5,2) COMMENT '本题得分',
    answered_at   DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '作答时间',
    CONSTRAINT fk_answers_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
    CONSTRAINT fk_answers_question   FOREIGN KEY (question_id)   REFERENCES questions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='答题明细表';

CREATE TABLE diagnoses (
    id             INT AUTO_INCREMENT PRIMARY KEY COMMENT '记录编号',
    user_id        INT NOT NULL COMMENT '用户ID',
    diagnosis_type VARCHAR(50) NOT NULL COMMENT '诊断类型(五层排查等)',
    result_data    JSON COMMENT '诊断结果数据',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '诊断时间',
    CONSTRAINT fk_diagnoses_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='诊断记录表';

CREATE TABLE action_plans (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '计划编号',
    diagnosis_id  INT NOT NULL COMMENT '诊断记录ID',
    plan_title    VARCHAR(100) COMMENT '计划标题',
    plan_content  TEXT COMMENT '计划内容',
    status        VARCHAR(20) DEFAULT 'pending' COMMENT '状态',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_plans_diagnosis FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='行动计划表';

CREATE TABLE mood_checkins (
    id        INT AUTO_INCREMENT PRIMARY KEY COMMENT '签到编号',
    user_id   INT NOT NULL COMMENT '用户ID',
    valence   TINYINT NOT NULL COMMENT '效价1-9',
    arousal   TINYINT NOT NULL COMMENT '唤醒度1-9',
    sign_date DATE NOT NULL COMMENT '签到日期',
    CONSTRAINT fk_mood_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uk_mood_user_date UNIQUE (user_id, sign_date) COMMENT '一天只能签到一次'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心境签到表';

CREATE TABLE daily_punch (
    id         INT AUTO_INCREMENT PRIMARY KEY COMMENT '打卡编号',
    user_id    INT NOT NULL COMMENT '用户ID',
    punch_date DATE NOT NULL COMMENT '打卡日期',
    content    VARCHAR(1000) COMMENT '打卡内容',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_punch_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日打卡表';

CREATE TABLE time_capsules (
    id         INT AUTO_INCREMENT PRIMARY KEY COMMENT '胶囊编号',
    user_id    INT NOT NULL COMMENT '用户ID',
    content    TEXT COMMENT '胶囊内容',
    open_date  DATE NOT NULL COMMENT '开启日期',
    is_opened  TINYINT(1) DEFAULT 0 COMMENT '是否已开启',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_capsules_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='时间胶囊表';

CREATE TABLE seeds (
    id         INT AUTO_INCREMENT PRIMARY KEY COMMENT '种子编号',
    user_id    INT NOT NULL COMMENT '用户ID',
    seed_data  JSON COMMENT '种子数据',
    version    VARCHAR(20) COMMENT '版本号',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_seeds_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='种子表';

CREATE TABLE seed_sounds (
    id         INT AUTO_INCREMENT PRIMARY KEY COMMENT '音符编号',
    seed_id    INT NOT NULL COMMENT '种子ID',
    sound_data VARCHAR(500) COMMENT '声音数据',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_sounds_seed FOREIGN KEY (seed_id) REFERENCES seeds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='真我之音表';

CREATE TABLE fragrance_recipes (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '配方编号',
    seed_id     INT NOT NULL COMMENT '种子ID',
    recipe_data JSON COMMENT '香氛配方数据',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT fk_fragrance_seed FOREIGN KEY (seed_id) REFERENCES seeds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='香氛配方表(方案A:种子更新后旧配方存档)';

-- ------------------------------------------------------------
-- ③ 中间表（多对多关系，最后建）
-- ------------------------------------------------------------

CREATE TABLE user_certificates (
    id      INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户证书编号',
    user_id INT NOT NULL COMMENT '用户ID',
    cert_id INT NOT NULL COMMENT '证书ID',
    CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_uc_cert FOREIGN KEY (cert_id) REFERENCES certificates(id),
    CONSTRAINT uk_uc_pair UNIQUE (user_id, cert_id) COMMENT '同一用户同一证书不重复'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户证书表(用户M:N证书)';

CREATE TABLE major_certificates (
    id       INT AUTO_INCREMENT PRIMARY KEY COMMENT '专业证书编号',
    major_id INT NOT NULL COMMENT '专业ID',
    cert_id  INT NOT NULL COMMENT '证书ID',
    CONSTRAINT fk_mc_major FOREIGN KEY (major_id) REFERENCES majors(id),
    CONSTRAINT fk_mc_cert  FOREIGN KEY (cert_id)  REFERENCES certificates(id),
    CONSTRAINT uk_mc_pair UNIQUE (major_id, cert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业证书表(专业M:N证书)';

CREATE TABLE major_postgrads (
    id            INT AUTO_INCREMENT PRIMARY KEY COMMENT '专业考研编号',
    major_id      INT NOT NULL COMMENT '专业ID',
    postgrad_id   INT NOT NULL COMMENT '考研方向ID',
    CONSTRAINT fk_mp_major   FOREIGN KEY (major_id)     REFERENCES majors(id),
    CONSTRAINT fk_mp_postgrad FOREIGN KEY (postgrad_id) REFERENCES postgrad_directions(id),
    CONSTRAINT uk_mp_pair UNIQUE (major_id, postgrad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专业考研表(专业M:N考研方向)';

CREATE TABLE position_certificates (
    id          INT AUTO_INCREMENT PRIMARY KEY COMMENT '岗位证书编号',
    position_id INT NOT NULL COMMENT '岗位ID',
    cert_id     INT NOT NULL COMMENT '证书ID',
    CONSTRAINT fk_pc_position FOREIGN KEY (position_id) REFERENCES positions(id),
    CONSTRAINT fk_pc_cert     FOREIGN KEY (cert_id)     REFERENCES certificates(id),
    CONSTRAINT uk_pc_pair UNIQUE (position_id, cert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位证书表(岗位M:N证书)';
