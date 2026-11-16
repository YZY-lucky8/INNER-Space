---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 3936f21f25e6ba96070df29586ae9321_07482f5ed80611f18947525400de85a5
    ReservedCode1: uXwb8Zt49U+7JlSGLP6xcNG2HdQxm8xlIjirYeW76PO/tMyAcCaTE4OLs0a+hdfSxvxltTbu43mLhnPQE855dKb96+7qOdarON0Nk/OrokO6m8pKazndr7iMszqQpnWoV5k6S7k6+JypmFff6rcmPLm7zb4KHF58oKSBmDs0WHM7ibyQxJ0DlTic7n4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 3936f21f25e6ba96070df29586ae9321_07482f5ed80611f18947525400de85a5
    ReservedCode2: uXwb8Zt49U+7JlSGLP6xcNG2HdQxm8xlIjirYeW76PO/tMyAcCaTE4OLs0a+hdfSxvxltTbu43mLhnPQE855dKb96+7qOdarON0Nk/OrokO6m8pKazndr7iMszqQpnWoV5k6S7k6+JypmFff6rcmPLm7zb4KHF58oKSBmDs0WHM7ibyQxJ0DlTic7n4=
---

# INNER-Space →「卡点」重构说明

> 版本：v1.1 / 2026-11-04
> 基线：旧版（人格模型测评 demo）已由 git tag **`v1.0-persona-model`** 完整快照，随时可 `git checkout v1.0-persona-model` 回退。
> 依据文档：`INNER-Space-PRD-v1.0.md`、`INNER-Space-产品重构-瓶颈突破.md`
> 未改动（v1.1 当时）：`docs/` 下三份 docx、`README.md`、`.gitignore`
>
> **后续版本：v1.2 / 2026-11-14** —— 白色发光蝴蝶重绘 + 在线「经验分享」论坛，见本文 §7。
> **后续版本：v1.3 / 2026-11-14** —— 蝴蝶改为半透明薄翼 SVG 并重写飞行动力学；前端升级为 v3 现代落地页视觉，见本文 §8。
> 本文 §1–§6 是 v1.1 时点的重构快照，其中行数、表数、视图数、自检数字均为**当时值**；§7 记录 v1.2 时点值；当前口径一律以 `README.md` 为准。

---

## 0. 一句话

旧版卖的是「测出你是什么人」，新版卖的是「**给你一个 7 天能做完的实验，让你自己试出卡在哪**」。
重构范围：`src/index.html` 全量重写（2594 行单文件）、`database/` 四个 SQL 脚本全量重写、新增本文档。

---

## 1. 变更总览

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/index.html` | **全量重写** | 2594 行 / 145.7 KB，单文件零依赖，六步闭环 demo |
| `database/schema.sql` | **全量重写** | 20 张表（9 复用 + 9 新建 + 2 内容资产），PRD §4.2 DDL 口径 |
| `database/views.sql` | **全量重写** | 5 个视图，对应 PRD 里真实存在的五个页面 |
| `database/procedures.sql` | **全量重写** | 8 个存储过程，对应前端 8 个真实动作 |
| `database/triggers.sql` | **全量重写** | 7 个触发器，承担「证据不可悬空」「能量越界」等业务红线 |
| `REFACTOR.md` | 新增 | 本文件 |

### 被删掉的东西（旧版人格测评资产）

`H1/H2/H3 阶位判定`、`24 题自评量表`、`小数点分数`、`AI 生成 900–1400 字长文`、`7 视图侧栏导航`、`251KB base64 背景图`、`time_capsules / seeds / seed_sounds / fragrance_recipes`、`user_settings`、`daily_punch`（改为 `experiment_logs`）。

---

## 2. 单文件 demo（`src/index.html`）

### 2.1 技术约束达成情况

| 约束 | 实现 |
|---|---|
| 单文件、零外部依赖 | 无 CDN、无外链字体/图片；全文唯一 `http://` 出现在 CSS 内联 `data:image/svg+xml` 的 `xmlns` 声明中，不产生任何网络请求 |
| 双击可运行 | 纯 `file://` 打开即可，无构建、无服务端 |
| 移动优先 | `#stage` 容器 `max-width:480px`，桌面居中；`@media (max-width:400px)` 有二次收窄 |
| 原生 HTML+CSS+JS | 单 `<script>` IIFE，无框架、无编译 |
| 玻璃拟态 + 深色森林绿 | CSS 径向/线性渐变多层叠加 + `rgba` 半透明面板 + `backdrop-filter`，背景图大小 0.23%（约 330 字节 SVG 噪点纹理） |
| 数据持久化 | `localStorage` 键 `kadian_db_v1`（业务）+ `kadian_events_v1`（埋点，上限 300 条） |

### 2.2 流程实现（六步闭环 + 两个外围页）

| 视图 | 渲染函数（行号） | 关键实现 |
|---|---|---|
| 落地页 | `renderLanding()` 1464 | 主标题、副标题、唯一 CTA「我卡住了 →」、真实用户原话社会证明 |
| 卡点录入 屏1 | `renderIntake()` 1502 | 自由文本 min 20 / max 1000，字数不足只提示「再多说一点，我需要知道你具体在做什么」，**不阻止提交** |
| 卡点录入 屏2 | 同上 | Q1–Q5 行为单选，选项严格按 PRD §3.2② 表（Q5 三档：能问到 / 问不到 / 没有） |
| 诊断页 | `renderDiagnosis()` 1556 | 2–3 张假设卡（类型名 + 置信度 低/中/高 + 可展开逐字引用证据）、「为什么这么猜」、「不确定的部分」、1 张分辨实验卡、免责声明、「这不像我」按钮 |
| 实验跟踪 | `renderExperiment()` 1637 | 实验卡钉顶 + 剩余天数；每 2 天记录一次（做了/没做 + 一句话 + 能量 −2~+2）；第 3、6 天站内提醒；超 4 天仅一次轻提醒；第 7 天自动进复盘 |
| 复盘 | `renderReview()` 1777 / `renderReviewResult()` 1826 | 结果（确认/推翻/不明确）+ 依据 + 最多 1 条身份证据（标注 5 类）+ 下一步两选项；3 轮不收敛给退出建议与具体渠道 |
| 我的证据 | `renderEvidence()` 1875 | 按 5 类分组、每条带日期与来源实验可点回、空态「还没有证据。第一条证据来自你的第一次实验。」、单条「这不像我」否定记录、「我觉得可以了」毕业 |
| 毕业总结 | `renderGraduate()` 1946 | 证据条数、分类分布、最近证据、明确「你不需要它了」 |
| 方向模块 | `renderDirection()` 1983 | **仅 E 类可达**（`DB.flags.direction_unlocked`），进入提示「这不是答案，是给你下一次实验用的选项」，每条带「为什么现在做它」与「回去做一个实验验证它」 |
| 危机拦截 | `renderCrisis()` 2041 | 全屏中止，展示学校心理健康教育中心 + 12356 + 010-82951332 |

### 2.3 诊断逻辑（PRD §2.3 三步）

- **Step 1 规则引擎**：`ruleEngine()` 完整实现判定表五条主规则（A/B/C/D/E 各一条），每条命中给首猜 +4 / 次猜 +1，另有 7 条弱信号加权（`h11`、`h3`、`noChange`、`prepActs`、`extQ4`、`extTarget`、`noPeer`、`vague`）负责在同分时区分次序。输出 `{top, second, scores, hits}`。
- **Step 2 AI 精修**：`async aiDiagnose()`。当前 `AI_ENDPOINT = null`，即 demo 默认只走规则结果（PRD M0 口径）；配置端点后自动接管。`validateAISchema()` 强制六条红线：

| 校验项 | 失败 reason |
|---|---|
| 假设数组长度 2–3 | `hypothesis_count` |
| 假设必须落在规则候选集内 | `out_of_candidates` |
| `evidence_quote` 必须逐字出现在用户原文中 | `quote_not_substring` → **重试 1 次，再失败降级** |
| `reasoning` ≤60 字 | 超长截断 |
| 不出现百分比 / 分数 / 「分以上」 | `forbidden_number` |
| `experiment_key` 必须在模板库中 | 回退到该类型默认模板 |

- **Step 3 三级静默降级**：level 1 AI 正常 → level 2 规则引擎结果（用户无感，加载文案「正在整理你的描述…」）→ level 3 只展示五问自选（数据异常兜底）。

### 2.4 合规与禁用项自检

- v1.1 时全局无「分数 / 百分比 / 雷达图 / 等级 / 人格标签 / 每日打卡 / 签到 / 排行 / 社区 / AI 陪聊」。**v1.2 起「社区」按严格边界重新开放**：只有「经验分享」一处（见 `README.md` §12 与本文 §7），排行 / 打卡 / 关注 / 私信 / AI 陪聊仍然没有，且不参与六步闭环判定。
- 全文 `禁用词` 扫描（焦虑/抑郁/量表/筛查/诊断报告/评分）**仅命中 1 处**：`validateAISchema()` 内的正则 `/\d+(\.\d+)?\s*%|\d+\s*分|分以上|评分/`——这是**拦截** AI 输出分数的守卫代码，属预期命中。
- 危机拦截双通道：关键词命中（自伤/轻生类表达）+ 规则命中（持续负面 + 绝对化 / 持续负面 + 功能受损），任一命中即中止，**宁可误报**。`detectCrisis()` 返回 `{hit, by, reason}`。

### 2.5 交互与埋点

- 键盘：`←/→` 切换选项、`Enter` 提交、`Esc` 返回。
- 埋点 `track(evt, params)` 覆盖 PRD §6.3 十四个事件：`landing_view`、`intake_started`、`intake_q_answered`、`intake_submitted`、`diagnosis_shown`、`hypothesis_expanded`、`disagree_clicked`、`experiment_started`、`log_submitted`、`review_shown`、`evidence_shown`、`evidence_rejected`、`graduated`、`safety_triggered`。
- 「载入演示数据」入口：注入 4 条示例会话（A/B/E/C 四类、含已复盘 / 进行中 / 未复盘三种状态、带证据溯源），用于演示与走查。

### 2.6 方向模块数据迁移

旧版 `CAREER_DB` 与 `MAJORS` 原样迁入（13 大类 45 子专业、98 条证书/考研/岗位数据），位置在 `/* ==== 生涯数据（迁自 v1.0-persona-model，仅 E 类方向模块使用） ==== */` 之后。旧版硬编码结构未拆散，方便后续 M2 一次性搬进数据库。

---

## 3. 数据模型（`database/`）

### 3.1 20 张表构成

| 分组 | 表 | 来源 |
|---|---|---|
| 生涯复用（4） | `majors`、`certificates`、`postgrad_directions`、`positions` | ✅ 原样复用，仅 E 类分支查询 |
| 生涯映射（3） | `major_certificates`、`major_postgrads`、`position_certificates` | ✅ 复用 |
| 用户域复用（2） | `user_certificates`、`mood_checkins` | ✅ 复用（`mood_checkins` 升级为情绪基线） |
| 核心业务（6） | `users`、`user_profiles`、`stuck_sessions`、`hypotheses`、`experiments`、`experiment_logs` | 🆕 新建（`experiment_logs` 承接旧 `daily_punch` 语义） |
| 复盘与资产（3） | `reviews`、`evidence_items`、`observers` | 🆕 新建 |
| 内容资产（2） | `bottleneck_types`、`experiment_templates` | 🆕 新建（护城河，目标 100+ 模板） |

**与 PRD §4.3「21 → 16」的差异说明**：PRD 的 16 = 8 复用 + 8 新建，未计入 ① 两张内容资产表（`bottleneck_types` / `experiment_templates`，§2.4 明确要求）与 ② `observers`（§4.1 ER 图含），故实际落库 20 张，口径非收缩性偏差。

### 3.2 四个脚本的对象清单

| 脚本 | 对象 | 职责 |
|---|---|---|
| `schema.sql` | 20 × `CREATE TABLE` | 建表 + 索引 + 外键 + 字段注释；头部注释记录 8 张废弃表 |
| `views.sql` | 5 × `CREATE VIEW` | `v_evidence_archive`（证据档案）、`v_session_overview`（卡点概览）、`v_experiment_progress`（实验进度与提醒判定）、`v_diagnosis_quality`（假设命中率/否定率）、`v_direction_options`（E 类方向清单，三分支 JOIN + DISTINCT） |
| `procedures.sql` | 8 × `CREATE PROCEDURE` | `sp_create_stuck_session`、`sp_replace_hypotheses`、`sp_start_experiment`、`sp_log_experiment`、`sp_add_evidence`、`sp_converge_session`、`sp_reject_evidence`、`sp_graduate_user` |
| `triggers.sql` | 7 × `CREATE TRIGGER` | `trg_hyp_quote_guard`（引用非空）、`trg_hyp_disagree_stamp`（「不像我」落时间）、`trg_log_energy_guard`（能量钳制 −2~+2）、`trg_evidence_guard`（**证据必须绑定实验**）、`trg_evidence_reject_stamp`、`trg_review_after_insert`（复盘自动回写收敛状态）、`trg_user_graduate_stamp`（毕业时间戳） |

> 说明：原设计的 `trg_ss_root_default`（`stuck_sessions.root_id` 自指默认值）因 MySQL 不允许触发器修改同表字段而移除，`root_id` 改由 `sp_create_stuck_session` 写入，触发器由 8 个调整为 7 个。

### 3.3 前后端字段对应（抽样）

| 前端（localStorage 对象） | 数据库 |
|---|---|
| `DB.sessions[]` = `{id, free_text, answers{q1..q5}, q2_detail, rule_top, rule_second, rule_scores, round_no, status, experiment_id, reviews[]}` | `stuck_sessions` + `hypotheses` + `reviews` |
| `DB.sessions[].hypotheses[]` = `{type, confidence, reasoning, evidence_quote, user_disagreed}` | `hypotheses` |
| `DB.experiments[]` + `DB.logs[]` = `{day_no, slot, did_it, note, energy}` | `experiments` + `experiment_logs`（`slot` 对应 `uk_exp_day`，实现「每 2 天一次」的幂等） |
| `DB.evidence[]` = `{type, content, source_exp_id, user_rejected}` | `evidence_items`（`source_exp_id NOT NULL` 强约束） |

---

## 4. 自检结果

| 检查 | 方法 | 结果 |
|---|---|---|
| JS 语法 | `node --check`（提取 script 体） | 通过 |
| 零外部请求 | 全文 `https?://` 正则 | 仅 1 处 `svg xmlns`，无网络请求 |
| 无禁用项 | 禁用词扫描 | 仅命中守卫正则 1 处（预期） |
| 规则引擎判定表 | 无头运行五行输入 + 空输入兜底 | 6/6 通过（A→B、B→A、C、D、E 首猜全对） |
| 危机拦截 | 关键词 / 绝对化 / 功能受损 / 正常文本 / 空串 | 5/5 通过（正常文本与空串不误报） |
| AI 降级 | 无端点调用 `aiDiagnose()` | 返回 `{ok:false, level:2}`，静默走规则 |
| AI schema 红线 | 逐字引用 / 编造引用 / 越界类型 / 含百分比 / 假设不足 | 5/5 通过 |
| 实验记录节奏 | 同档重复提交 | 第 2 次被拒并提示下次记录时间；能量越界被钳制 |
| 复盘证据约束 | 无记录出证据 / 二次证据 / 无证据复盘 | 3/3 通过（前两者被拒，第三者放行） |
| 毕业与埋点 | `graduateNow()` + 事件回读 | 总结生成、`graduated` 事件写入 |
| SQL 一致性 | 解析 schema 字段，校验 views/procedures/triggers 的别名与 INSERT 列 | 无缺失字段、无缺列；`v_direction_options` 的笛卡尔积问题已修复 |
| 行数/体积 | — | `src/index.html`：**2594 行 / 145,679 字节** |

> 说明：测试脚本放在会话中间产物目录（`temp/test_demo.js`），未写入仓库，避免污染项目结构。

---

## 5. 如何运行与后续接入

**运行**：双击 `src/index.html`（Chrome / Edge 均可），或 `start src/index.html`。

**接服务端 AI（M1）**：~~改 `src/index.html` 中一处常量即可~~ —— 这是 v1.1 时点的做法，**已过时**。
2026-11-15 起密钥只在 `server/.env`，前端 `src/api.js` 自动探测 `/api/v1/diagnose`，
在 `server/.env` 填 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 即启用；详见 `README.md` §13。

接口契约按 PRD §5.2 `DiagnosisOutput`；前端已内置 schema 校验、子串校验、15s 超时与三级降级，**即使后端返回脏数据也不会污染页面**。

**M2 迁数据**：把 `src/index.html` 里 `MAJORS` / `CAREER_DB` 迁入 `majors` / `certificates` / `postgrad_directions` / `positions` 及三张中间表，方向模块改为读 `v_direction_options`，实现「改一条证书不用发版」。

---

## 6. 回退方式

```bash
git checkout v1.0-persona-model -- src/index.html database/
# 或整体回到旧版
git checkout v1.0-persona-model
```

旧版全部内容（含 21 表 DDL 与 7 视图首页）都在 `v1.0-persona-model` 标签内，本次重构未删除任何历史提交。

---

## 7. v1.2 追加：白色发光蝴蝶 + 在线经验分享（2026-11-14）

> 本次是**点状追加**，没有重写六步闭环的任何业务逻辑。改动集中在 `src/index.html` 的 CSS 层、独立的论坛模块，以及 `database/` 与文档。

### 7.1 变更清单

| 文件 | 变更 |
|---|---|
| `src/index.html` | 白色蝴蝶 CSS 重绘；论坛 CSS；导航「经验分享」入口；`VIEWS.forum` / `ROUTES.forum`；`f:` 动作分发；论坛模块（约 400 行）；危机页返回来源判断；卡点录入 / 诊断 / 实验页的三处联动入口 |
| `src/cloud.config.js` | 新增。云服务公开配置（endpoint / oauthRelayBaseUrl / publishableKey），不含长期密钥 |
| `database/schema.sql` | 追加论坛 3 张表 + 采纳外键；DROP 列表同步；20 → 23 张 |
| `database/views.sql` | 追加 `v_forum_thread`；5 → 6 视图 |
| `README.md` / `REFACTOR.md` | 修正「不做社区」「零网络请求」「2594 行」等过期口径 |

### 7.2 蝴蝶（v1.2：纯 CSS，不引图片）

> **v1.3 已整体替换本节实现**：翅面改为内联 SVG 半透明薄膜，飞行姿态改为弹簧跟随 + 3D 侧倾，详见 §8。以下保留作为 v1.2 变更记录。

沿用 v1.1 的 DOM 结构与 `bfStart()` 动画循环，只替换样式：珍珠白翅面 + 冷灰蓝边缘、白色放射翅脉、鳞粉微点、翅尖高光、多层冷白 `drop-shadow`；新增 `#bf::before` 呼吸光环与 `#bf::after` 核心亮斑；光晕放大到 170px；拖尾 6 颗光点改为白色星尘并带外发光。扇翅 / 滑翔 / 跟随鼠标 / 无鼠标自动巡游 / `prefers-reduced-motion` 降级全部保留，动画关键帧名不变，因此 JS 一行未动。`assets/butterfly/` 里的白色三视图素材保留未用。

### 7.3 论坛架构与数据边界

| | 位置 | 说明 |
|---|---|---|
| 个人数据 | `localStorage`（`kadian_db_v1`） | 卡点描述、实验日志、身份证据，**永不上传** |
| 论坛数据 | 应用云数据库 PostgreSQL | `forum_posts` / `forum_replies` / `forum_votes`，公开读；写删由 RLS 限制为本人（`owner_id TEXT DEFAULT auth.uid()`） |
| 论坛账号 | 云端邮箱验证码（Email OTP，无密码） | 与本机账号门禁互不干扰；浏览帖子不需要登录 |
| 本机小数据 | `localStorage` | 论坛显示名、从回答「存到我的实验备忘」的建议，仅本机可见 |

前端用单文件 HTML 适用的 **CDN `<script>` 形式**引入官方 SDK，全局 `WorkBuddyCloud.createWorkBuddyCloud()` 只初始化一次，参数全部取自 `publicConfig`。未登录 / RLS 拒绝 / 网络失败都有明确文案；云端不可用（`file://` 打开或 SDK 未加载）时论坛显示「需要在线访问」，**不落本地假数据、不假装同步成功**。

### 7.4 功能与合规

- 发帖（标题 + 正文）、帖子列表、详情、回答、「有用」（唯一约束 `UNIQUE(reply_id, owner_id)`，可取消）、楼主采纳（写 `forum_posts.accepted_reply_id`）、作者删除自己的帖子 / 回答（删帖级联删回答）。
- 发帖 / 回答均可匿名：匿名时 `owner_name` 直接写 `NULL`，服务端也不存显示名。
- 与主流程联动：卡点录入页与诊断页一键把描述**带入可编辑表单**（不自动发布）；回答可「存到我的实验备忘」，在实验页顶部展示。这些备忘不是证据，不进 `evidence_items`。
- `detectCrisis()` 双通道拦截延伸到发帖与回答，命中即中止发布、跳转危机转介页，`crisisExit` 按 `state.crisis.from === 'forum'` 回论坛并保留草稿；主流程原有清空逻辑不变。
- 论坛固定展示免责声明（经历分享 ≠ 心理诊断 / 治疗建议 / 能力评价）与热线；不做全站排行榜、关注、私信、AI 陪聊。
- 论坛页不读写 `DB.sessions` / `DB.experiments` / `DB.evidence`。

### 7.5 两套数据库的口径差异

`database/` 的 MySQL 脚本是**课程设计交付物**（23 表 / 6 视图），线上论坛跑的是应用云数据库的 PostgreSQL 同名表 + RLS。两者字段语义一致（帖子 / 回答 / 有用 / 匿名 / 采纳 / 级联删除），但**不共用实例、不互相导入**。README §12 与 §5 已写明，避免答辩时被问混。

### 7.6 自检

| 检查 | 结果 |
|---|---|
| 内联 JS `node --check` | 通过（v1.2 当时 `src/index.html` 为 4945 行 / 264 KB；v1.3 后见 §8.5） |
| 云端建表 | `forum_posts` / `forum_replies` / `forum_votes` 三表存在，RLS 均为开启 |
| RLS 策略 | 10 条：三表 public read / insert own / delete own，帖子额外 update own（采纳标记） |
| 关键动作 | 所有 `f:` 动作走独立分发，未污染六步闭环的 `onClick` switch |
| 配置来源 | `createWorkBuddyCloud` 的 endpoint / publishableKey / oauthRelayBaseUrl 全部来自 `publicConfig` |
| 运行前提 | 论坛必须经在线 HTTPS 地址访问；`file://` / localhost 无法完成云端身份验证 |

---

## 8. v1.3 追加：半透明薄翼蝴蝶 + v3 前端视觉（2026-11-14）

### 8.1 变更范围

| 文件 | 改动 |
|---|---|
| `src/index.html` | 蝴蝶 CSS / DOM / `bfStart()` 三处全量替换；追加 v3 视觉层 CSS；`renderLanding()` 增加 eyebrow、双 CTA、一体式指标条与「它怎么工作」四步模块 |
| `README.md` / `REFACTOR.md` | 同步行数、技术栈与蝴蝶口径 |
| `database/` | **未改动**：本轮纯前端视觉，不涉及表结构 |

### 8.2 蝴蝶：从「实心白蝶」到「半透明薄翼」

v1.2 是 CSS 圆角矩形渐变拼出的实心白翅 + 三层强 `drop-shadow` + 呼吸光环 + 170px 光晕，观感偏实、偏亮。v1.3 改为：

- **形态**：单只内联 `<svg viewBox="0 0 120 120">`，`defs` 里定义左半边前翅（长尖）与后翅（圆润带尾突），右半边由 `<use transform="translate(120,0) scale(-1,1)">` 镜像，保证严格对称；附放射翅脉、亚缘斑点、翅尖珠光、触角与分节腹部。
- **半透明 + 微光**：翅膜用 `linearGradient` 的 `stop-opacity`（0.72 → 0.10），叠在深色背景上呈薄膜质感；只保留一层 `drop-shadow(0 0 3px rgba(255,255,255,.34))` 与极淡冷白外晕，光晕缩到 120px、透明度随速度在 0.24–0.48 之间。**不再有呼吸光环 / 核心亮斑 / 星尘堆光**。
- **不引图片**：`assets/butterfly/` 素材仍未使用；本体 88px，比 v1.2 略大以便看清薄翼细节。

### 8.3 飞行动力学（`bfStart()` 重写）

| 姿态 | 实现 |
|---|---|
| 跟随 | 弹簧阻尼（速度 + 加速度 + 0.84 阻尼）替代线性 `lerp`，接近目标自然减速、快速移动略有滞后拖曳 |
| 悬停 | 指针静止 0.7s 后逐渐进入绕飞盘旋（Lissajous 小圈，幅度 14→48px），不再「钉」在光标上 |
| 巡游 | 无指针时走复合正弦轨迹，路径不重复 |
| 朝向 / 翻飞 | 沿速度方向平滑转 `rotateZ`；转向角速度换算成 `rotateY` 侧倾（±24°）与 `rotateX` 俯仰，配合容器 `perspective:720px` 产生 3D 翻飞透视 |
| 扇翅 | 每帧直接写 `<g>` 的 SVG `transform`（`translate(60,55) scale(s,1) rotate(a) translate(-60,-55)`），不依赖 CSS 关键帧；频率随速度变化、与升沉同相，左右翅在侧倾时略有开合差 |
| 可辨识度 | 最小展翅度锁在 0.38，任何相位都能看出是一只蝶，不会收成两条线 |
| 鳞粉 | 6 颗 → 4 颗，尺寸 4px，带横向飘散与周期消散 |
| 降级 | `prefers-reduced-motion` 下静态放置在右上角、翅膀半展 |

### 8.4 v3 前端视觉

以**追加覆盖**方式加一层 CSS，不改任何既有选择器对应的功能与六屏差异化版式：

配色由高饱和森林绿改为中性近黑底 + 单一克制薄荷点缀；背景叠加极细 68px 网格（径向遮罩渐隐）与更柔的多层光晕，噪点降到 0.26；统一字体栈、标题字距 / 字重、卡片 20px 圆角与顶部 hairline 高光、按钮实体渐变与内高光、导航毛玻璃与底部渐隐亮线、focus-visible / selection / 滚动条。

落地页补上主流高赞站常见结构：`eyebrow` 标签、渐变超大标题（`@supports` 内启用，不支持时回落纯色）、主 CTA + 次 CTA 双按钮、一体式三格指标条、「它怎么工作」四步说明模块。次 CTA 直达论坛（`data-act="nav" data-to="forum"`），不改变原有 `case 'nav'` 逻辑。

### 8.5 自检

| 检查 | 结果 |
|---|---|
| 内联 JS `node --check` | 通过（`src/index.html` 现为 5170 行 / 约 270 KB） |
| 旧蝴蝶残留 | `bf-wing` / `bfFlap` / `--flapDur` / `bf-glide` 全部 0 处 |
| 无头 Chrome 渲染 | 全展形态、两个飞行相位、3D 侧倾三组截图均正常：四翅对称、半透明薄膜可辨、透视生效 |
| 登录门禁 | 免登录会话注入后落地页、导航、四步模块、实验室入口、页脚均正常，无遮挡与溢出 |
| 临时产物 | 预览页与截图探针文件已全部删除，`src/` 只保留正式文件 |

---

## 9. v1.4 追加：纯色小蝶 / 情绪轮播 / 瀑布流论坛 / 手势粒子（2026-11-15）

> 本节只记本次增量。§1–§8 是各版本时点快照，行数、表数、视图数以 `README.md` 为准。
> 本轮**未改数据库脚本**，也未触碰云端读写与危机拦截逻辑。

### 9.1 蝴蝶：从「半透明薄翼」到「纯色小蝶」

- 88px → **30px**（约光标大小）；`defs` 删掉全部渐变、翅脉、亚缘斑与翅尖高光，只剩纯白翅面，后翅用一层略淡纯色区分层次；身体长度 36→21、宽度 5.6→2.6，触角缩短，去掉复眼与腹部分节线。
- 发光从两层 `drop-shadow` + 呼吸光环收敛为单层 2.5px 微光，光晕 120→56px。
- 新增 `#bf-trail` canvas：每帧把位置压入 44 点历史，按速度取 18–38 段绘制双层渐隐丝带（外层柔光 + 内芯），旧点叠加正弦扰动模拟气流飘散；尾迹宽度随景深缩放。
- 空间感：`translateZ` 在 `perspective:460px` 下产生真实近大远小，Z 目标由巡游 / 盘旋曲线驱动，蝶体 scale、光晕大小与透明度同步随深度变化。
- 保留弹簧阻尼跟随、静止后绕飞盘旋、3D 侧倾与 `prefers-reduced-motion` 静态降级；旧 `bf-mem` / `bf-vein` / `bf-shine` / `bfFlap` / `--flapDur` 残留 0 处。

### 9.2 首页情绪轮播

复用 `assets/background` 三张实景图（竹林 / 河流 / 茶园）做「闷 / 绕 / 松」三屏，`filter` 色彩分级拉开情绪差；每屏配情绪文案与行动入口（开始录入 / 经验分享 / 3D 实验室）。支持 5.6s 自动播放、上一张下一张、指示点、缩略卡、左右滑动、键盘方向键、悬停暂停；`MOOD.idx` 保存在内存，切屏回来不跳帧；`reduced-motion` 下不自动播放。

### 9.3 论坛排版：小红书式瀑布流

- 列表：三列 CSS `columns` 瀑布流（≤1080px 两列），卡片 `break-inside:avoid`；封面复用三张实景图，用「列表位置 + 组号」打散避免同排撞图，三档高度错落；情绪标签由标题与正文关键词派生；头像、有用数（该帖所有回答的「有用」之和）、回答数、已解决标记。
- 工具区：搜索框只显隐卡片（`forumFilterCards`，不重渲染、不丢光标）、推荐 / 最多回答 / 已有答案 / 我的 四个频道、悬浮发布 FAB。
- 详情：笔记式主卡（作者行 → 大标题 → 正文 → 标签）＋评论式回答卡片＋ sticky 回答栏；双击回答会真实触发该条 `[data-act="f:vote"]` 并飘一颗心，不是假交互。
- 边界说明收进可折叠 `details`，内容一字未删；所有 `f:` 动作、RLS 与 `detectCrisis()` 拦截保持不变。

### 9.4 粒子互动与手势

| 位置 | 改动 |
|---|---|
| 主站深空粒子 | 46–96 → **120–205 颗**；新增光标斥力、按住拖动涡旋、点击 / 双击涟漪爆发、双指缩放、近邻粒子高亮；连线用近邻早退控制 O(n²) 成本 |
| 3D 实验室 | 主粒子 9000 → **18000**（移动端 12000），星空 2600→4600、尘埃 900→2000；大火星比例与点尺寸上限下调，密集但不糊 |
| 手势识别 | `numHands: 2`；新增 `classifyGesture()`（捏合 / 张开 / 握拳 / 只伸食指 / 比 V）＋横挥速度检测＋双手距离控制开合 |
| 形态 | 云团 / 光束 / 双核 / 凝聚四态，`shapeMix` 平滑混合目标位置，shader 加 `uTint` 随形态染色；挥手 / 双击触发 `pulse` 爆发 |
| 兜底 | 鼠标拖动旋转、右键 / Shift 拖动平移、双击炸开、双指捏合、滚轮、数字键 1–4 切形态、B 爆发；HUD 显示当前手势与粒子数 |

### 9.5 自检

| 检查 | 结果 |
|---|---|
| 内联 JS `node --check`（index / lab module） | 均通过（index 5624 行 / 约 293 KB，lab 1045 行） |
| 无头 Chrome 截图 | 首页（轮播 + 小蝶 + 尾迹）、论坛列表（三列瀑布流）、论坛详情（笔记 + 评论 + sticky 输入）、3D 实验室（24k 粒子 + 形态按钮 + HUD）四组全部渲染正常，无错位、无图片加载失败 |
| 明文密钥 | `src/` 扫描无 `sk-` 明文 |
| 临时产物 | `_p_*.html` 预览副本全部删除，`src/` 只保留 5 个正式条目 |
| 在线发布 | 本轮用户只要求本地改版，**未调用发布**；线上链接仍是上一轮状态 |

---

## 10. v1.5 追加：编辑式档案重排版 + 四项纠偏（2026-11-16）

> 本节只记本次增量。§1–§9 是各版本时点快照，行数 / 表数以 `README.md` §17 为准。
> 本轮**未改数据库脚本、云端表、RLS、危机拦截**，未动 `particles.js` / `water.js`，**未调用发布**。

### 10.1 设计方法

按 `@skill:"前端设计"`（`references/zh-CN.md`）的「先想清楚再写」协议，定方向为**编辑式暗夜档案**：深墨绿 60% / 苔绿玻璃 30% / 薄荷 10%，宋体展示字 + 等宽编号 + 黑体正文，单一强调色；用发丝线、竖向规则线、非对称破格、错峰入场替代堆叠卡片与通用 AI 渐变；强对比与 `:focus-visible`、`prefers-reduced-motion` 降级一次做齐。落地方式是 `src/visual.css` **追加 §20 覆盖层**，既有功能选择器一律不改，方便整段回退。

### 10.2 四项纠偏的实现要点

| 用户反馈 | 实现 |
|---|---|
| 「单条白色柔光光束，不要两条痕迹，也不要水波」 | `drawTrail()` 撤掉 v8 双翼 V 形航迹 / 涡旋 / 柔雾团 / 闪粉 / 涟漪；`CONTRAIL` 只存一条世界坐标轨迹，`1.55s` 时间消散；同一路径叠 3 遍描边（`11/4.2/1.25px`，纯白）是光束截面而非三条线；`source-over` 不加色叠加；头部 1.4px 白点；`#bf-glow` 关闭 |
| 「人生坐标不用单独列出来，和 3D 实验室合并」 | 删主站 `data-navx="map"` 导航、Hero 次 CTA `h3:navmap`、首屏 `.h3-entry`；只留唯一 `.lab-gate` 门卡，三个能力写在一处；`human3ChartMini()` 替换 `human3MiniWeb()`；`viewTitle()` 的 `map` → 「12 格自评」；`#/map` 降级为实验室内的自评页 |
| 「按标准数学统计图描绘和粒子拼接，精致一点」 | `web3d.js` 整文件重写：四象限映射到标准笛卡尔 I/II/III/IV，`CanvasTexture` 1600² 画方格 / 十字箭头 / 1·2·3 刻度 / `O` 原点 / 轴名 / 象限编号；8 类 `THREE.Points` 拼图纸；`computeVerts()` 把 12 格读数映射为 `DX`/`DY`；billboard 每帧 `group.quaternion.copy(camera.quaternion)`，宿主删除 `group.rotation.y`；API 契约零变更 |
| 「流星应该是一个朝向的」 | `ambient.js` 删 `fromLeft = Math.random() < 0.32` 反向分支；`dx=-cos(ang)<0` / `dy=sin(ang)>0` 恒定右上 → 左下，`ang ∈ [0.38,0.53]` 只做小幅抖动；流星雨延后出发沿用同向 |

配套的 UI 口径同步：`hand3d.html` 顶栏「人生坐标 · 统计图」+「标 12 格」，`human3d.html` 标题 / brand / `#info` / `#hint` 全部改成标准统计图说法；`body.webmode #notice` 把 `file://` 摄像头提示收成右下角小卡，不再压住图纸中心。

### 10.3 反 AI 味自检

| 检查项 | 结果 |
|---|---|
| 单一强调色 | 只留薄荷绿；罗盘 / 光晕 / 光子都降为同一色相的透明度变化 |
| 字体层级 | 展示字（宋体）/ 编号（等宽）/ 正文（黑体）三层，不混第四种 |
| 空间构成 | Hero 左侧竖向规则线、非对称 `.lab-gate` 门卡、描边巨型 `LAB` 破格编号；不是三张等宽卡片 |
| 动效编排 | 6 组 60ms 错峰入场，而非全页一起淡入；`prefers-reduced-motion` 下全部 `opacity:1 / transform:none` |
| 交互态 | `.lab-gate a:focus-visible` / `.btn:focus-visible` / `:focus-within` 给 2px 薄荷描边 |
| 可访问性 | 渐变标题在 `@supports` 外回落纯色；缩略统计图带 `role="img"` 与中文 `aria-label` |

### 10.4 验证中发现并修复的两处真实问题

用 CDP `Emulation.setDeviceMetricsOverride` 扫了 11 档真实视口；无头 Chrome 157 会把 CSS 视口钳到 ≥500px，所以 375px 的 `--screenshot` 只是 500px 布局的裁切，不能当作窄屏证据。

| 视口 | 现象 | 修正 |
|---|---|---|
| ≤440px | `11.5vw` 标题把「先别急着努力。」的句号顶出右边缘 | `@media (max-width:440px){.hero-copy h1{font-size:clamp(29px,9.2vw,40px)}}` |
| 768–1099px | `.hero-visual{right:-8%}` 溢出 19px，`scrollWidth 787 > 768` | `@media (min-width:768px) and (max-width:1099px){.hero-visual{right:0}}`；≥1100px 保留破格出血 |

修完 320 / 375 / 420 / 520 / 600 / 700 / 768 / 900 / 1024 / 1100 / 1440 全部 `scrollWidth == innerWidth`。另修一处截图时序误会：论坛「只显示一列」与实验室「提示居中」都是旧截图（12:52）早于代码修正（12:55）造成的，重新截图后三列瀑布流与右下角提示均正常。

### 10.5 自检

| 检查 | 结果 |
|---|---|
| `node --check` | 8 个外部 JS + `index.html` 内联脚本全部通过 |
| 无头 Chrome 截图 | 首页（1440 / 768 / 375）、论坛（3 列 8 卡）、独立统计图、实验室 `?mode=web`、蝴蝶尾迹隔离探针，全部无黑屏 / 空白 / 遮挡 |
| 尾迹形态 | 隔离探针：一只纯白小蝶 + **一条**白色柔光光束，无双线、无水波环 |
| 论坛 DOM | `COLS=3 DISPLAY=block WIDTH=1000 N=8 LEFT=209,209,209,548,548,548,887,887` |
| 降级 | `--force-prefers-reduced-motion=reduce` → `REDUCED=true`、`anim-ok` 未添加 |
| 明文密钥 | `src/` 扫描无 `sk-` 明文 |
| 临时产物 | `_p_*.html` 预览副本、`_cdp_check.mjs`、缩放探针全部删除 |
| 在线发布 | 本轮用户只要求本地改版，**未调用发布**；前两次 `SITES_UPLOAD_FAILED` 后需用户本轮明确授权才会覆盖线上链接 |

### 10.6 回退

删 `visual.css` §20 即回到 v1.4 视觉层与窄屏行为；`web3d.js` 换回上一版 12 轴蛛网实现、并在两个宿主恢复 `group.rotation.y` 即回到雷达图；`index.html` 的 `drawTrail()` / `.lab-gate` / `human3ChartMini()` 与 `ambient.js` 的 `spawnMeteor()` 都是独立函数，可逐项回退，论坛逻辑与数据边界不受影响。

*（内容由AI生成，仅供参考）*
