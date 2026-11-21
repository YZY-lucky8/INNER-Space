---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 3936f21f25e6ba96070df29586ae9321_0a2308f7e4fe11f18e5a525400de85a5
    ReservedCode1: JJSZe0Y9IJbbDjHBJm+0db1Ouyf9UF4kdIAvRqj1VZzPGsVYOi3oAs4R0je/Gs7+JgMaC64T/Xi9RiKbukbjN9iVnEUnzZUh9a6N3M5zUQCOoZmhhd6HQGUjCf/OAsGv8zc6DEVq1VxvGTtSkWGu7TJmyfcX3m1Wd4eeV/SJtObsISouZKfMoempXPI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 3936f21f25e6ba96070df29586ae9321_0a2308f7e4fe11f18e5a525400de85a5
    ReservedCode2: JJSZe0Y9IJbbDjHBJm+0db1Ouyf9UF4kdIAvRqj1VZzPGsVYOi3oAs4R0je/Gs7+JgMaC64T/Xi9RiKbukbjN9iVnEUnzZUh9a6N3M5zUQCOoZmhhd6HQGUjCf/OAsGv8zc6DEVq1VxvGTtSkWGu7TJmyfcX3m1Wd4eeV/SJtObsISouZKfMoempXPI=
---



# INNERSCAPE · 卡点

> 一个帮 18–22 岁在校大学生**走出瓶颈**的行为证据闭环工具：不告诉你"你是什么人"，给你一个 7 天能做完的小实验，让你自己试出来卡在哪。
> 数据库系统课程大作业 · PRD v1.0 · 当前版本 2026-11-04

---

## 1. 产品定位

本项目经历了一次方向修正：**从"测评工具"改为"行为证据闭环工具"**。

| | 旧版（v1.0-persona-model） | 当前版本 |
|---|---|---|
| 用户拿到什么 | 一个标签（H1/H2/H3）+ 小数点分数 | 一个瓶颈类型 + 一条关于自己的**行为证据** |
| 用户做什么 | 答题、看结果 | 做实验、记录、复盘 |
| 产品的价值 | 提供确定感（看完就走） | 缩短试错周期（数周陪伴） |
| 成功指标 | 测评完成数 | **毕业率**（走完一轮并说"有进展"） |

核心判断：**身份是通过行动被发现的，不是通过思考被定义的。** 标签给了确定性，然后关闭观察——这正是我们要避免的。

**不做什么（写死，防止范围蔓延）**

- ❌ 不做心理测评、不出人格标签、不打分、不做日活/打卡/签到/排行榜/AI 陪聊
- ❌ 不做诊断、不做治疗、不做心理健康评估
- ✅ 主线只做一件事：把"我卡住了"变成"我知道卡在哪，下一步做什么"
- ✅ 外围的「经验分享」是同行交流区（v1.2 新增，见 §12）：登录后分享困惑、他人回答。只做经历交流与单帖内的「有用 / 最有帮助」，**不做全站热度榜、关注、私信、AI 陪聊，也不允许诊断式建议**；它不参与六步闭环的任何判定，别人的回答也不会自动变成你的证据。

---

## 2. 六步闭环流程

```
① 落地页   「卡住的时候，先别急着努力」→ 唯一 CTA「我卡住了 →」
     ↓
② 卡点录入 屏1：自由描述（20–1000 字，字数不足只提示、不阻止提交）
   屏2：Q1–Q5 五道**行为题**（投入时长 / 有无可见变化 / 换过做法吗 / 无外部回报还做吗 / 身边有无够得着的同类）
     ↓
③ 诊断结果 2–3 个假设（类型名 + 置信度低/中/高 + 逐字引用原文的证据）+「为什么这么猜」+「不确定的部分」
   + 1 张分辨实验卡 + 免责声明；每张假设卡都有「这不像我」按钮
     ↓
④ 实验跟踪 7 天周期，**每 2 天**记录一次（做了/没做 + 一句话 + 能量 −2~+2），第 3/6 天站内提醒
     ↓
⑤ 复盘     结果（确认/推翻/不明确）+ 依据 + **最多 1 条**身份证据（标注 5 类之一）+ 下一步两选项
     ↓
⑥ 我的证据 按兴趣/优势/价值观/能量/边界 5 类分组，每条带日期与来源实验，「我觉得可以了」进入毕业总结
```

**外围两个页面**

- **方向模块**：仅当收敛到 E 方向瓶颈才可达（`direction_unlocked`），入口提示「这不是答案，是给你下一次实验用的选项」，每条带"为什么现在做它"与"回去做一个实验验证它"。
- **危机拦截**：关键词 + 规则双通道，命中即全屏中止流程，展示学校心理健康教育中心与热线 12356 / 010-82951332（宁可误报）。

**两条铁律**

1. **一次复盘最多产出 1 条证据**，且证据必须能追溯到某次实验的具体记录；**没有实验记录就不允许产出证据**（否则产品就退化成包装精美的巴纳姆效应）。
2. **3 轮实验仍不收敛 → 停止自动化流程**，给出口语化建议与具体求助渠道（辅导员 / 学长 / 学校心理健康教育中心）。

---

## 3. 五类卡点（A / B / C / D / E）

**卡点的可操作定义**：投入继续增加，回报不再增加。

| 类型 | 用户典型说法 | 判据（看行为，不看自评） | 处方方向 | 分辨实验 |
|---|---|---|---|---|
| **A 方法** | "我很努力但没进展" | 投入 ≥11h/周、连续 4 周无可见变化、**没换过做法** | 换策略 / 找高手校准 | 同一件事换一种完全不同的做法，比较产出差异 |
| **B 技能** | "我知道该做什么，但做不到" | 换过做法仍卡、**能指出具体卡在哪一步** | 刻意练习最小子技能 | 每天 20 分钟只练那一步 |
| **C 动机** | "不知道为什么要做" | 有能力但不启动、准备动作多、高频"应该/必须" | 重接目标与价值 | 停掉这件事 7 天，看你是否主动想它 |
| **D 环境** | "我周围没人这样" | 方法与技能都没问题，卡在没人/没资源/规则不允许 | 换场 / 找同类 / 改规则 | 找 1 个比你走得远的人聊 30 分钟 |
| **E 方向** | "我是不是选错了" | 能做好但不想做、目标是从别人那继承的 | 重新选择 → **此时才接入生涯模块** | 用 1 天真实体验这个方向的日常 |

> **生涯规划（专业 / 证书 / 考研 / 岗位）是 E 类瓶颈的下游工具，不是主产品。** 旧版把它当作主功能前置询问——这正是旧版转化率低的根因。

---

## 4. 诊断机制：规则引擎前置，AI 只调权重

```
Step 1  规则引擎预分类（确定性、无 AI）
        五条判定表 → 首猜 + 次猜 + 权重
Step 2  AI 精修（自由文本 → 修正权重 → 输出 2–3 个假设与逐字证据引用）
Step 3  规则兜底校验（schema / 安全标记 / 与 Step 1 是否严重矛盾）
```

**为什么规则在前**：AI 诊断最大问题是不可复现、会编理由。先用规则框住候选范围，AI 只能在范围内调权重，诊断结果才可复现、可测试、可解释——并且规则结果本身就是可用的降级方案。

**AI 输出的六条硬校验**（`validateAISchema`，任一失败即降级）

| 校验 | 失败处理 |
|---|---|
| 假设数量 2–3 | 截断 / 降级 |
| 假设必须落在规则候选集内 | 降级到规则结果 |
| `evidence_quote` 必须**逐字**出现在用户原文中 | 重试 1 次，再失败降级 |
| `reasoning` ≤60 字 | 截断 |
| 不得出现百分比、分数 | 重试 / 降级 |
| `experiment_key` 必须存在于模板库 | 用该类型默认模板 |

**三级静默降级**：AI 正常 → 规则结果（用户无感）→ 只展示五问让用户自选（数据异常兜底）。降级对用户永远静默。

---

## 5. 数据模型口径（16 表 → 实落 19 表）

设计口径来自 PRD §4.3：旧版 21 张表 → **16 张（8 张复用 + 8 张新建）**。

`database/schema.sql` 当前实建 **19 张**（PRD 16 张 + v1.2 论坛 3 张）。2026-11-20 精简时删掉了 4 张后端从不读写的表，表数量据此回到 PRD 口径，字段与业务语义未改。

| 精简对象 | 原设计意图 | 处理方式 |
|---|---|---|
| `bottleneck_types`（内容资产） | PRD §2.4 的 20 类卡点 × 5 变体模板 | 后端零读写，前端一直用内联常量；表与种子 INSERT 一并删除 |
| `observers`（观察者反馈） | PRD §4.1 ER 图的"他人反馈"来源 | 该功能未进本期闭环，后端零引用，删除 |
| `mood_checkins`（情绪基线） | PRD §4.3 归入复用 | 情绪记录走 localStorage 的 `DB.mood`，不入库，删除 |
| `user_profiles`（画像快照） | 缓存 `users` 的派生字段 | 可由 `users` + `human3_assessments` 实时推导，删除 |

`experiment_templates` 虽同属内容资产，但 `experiments.template_id` 有真实外键依赖，保留。

**当前 19 张表构成**

| 分组 | 表 |
|---|---|
| 生涯复用（4） | `majors`、`certificates`、`postgrad_directions`、`positions` |
| 生涯映射（3） | `major_certificates`、`major_postgrads`、`position_certificates` |
| 用户域复用（1） | `user_certificates` |
| 核心业务（5） | `users`、`stuck_sessions`、`hypotheses`、`experiments`、`experiment_logs` |
| 复盘与资产（2） | `reviews`、`evidence_items` |
| 内容资产（1） | `experiment_templates` |
| 经验分享（3，v1.2 新增） | `forum_posts`、`forum_replies`、`forum_reply_votes` |

生涯域这 8 张（4 + 3 + 1）只被 `init.sql` 视图分区的 6 个视图引用、后端代码不直接读写，按课程设计口径**保留未删**。

> v1.2 起 `database/init.sql` 的建表分区实落 **19 张表**（2026-11-20 精简后）。论坛 3 张只存用户**主动发出来**的内容；卡点描述、实验日志、身份证据仍只留用户本机，不入库、不上传。线上论坛实际跑的是应用云数据库的同名表（PostgreSQL + RLS），本目录的 MySQL 脚本是课程设计口径，两者字段语义一致但不共用实例（详见 §12）。

**已废弃的旧表**：`questions` / `assessments` / `assessment_answers`（自评量表）、`user_settings`、`time_capsules` / `seeds` / `seed_sounds` / `fragrance_recipes`；`daily_punch` 改语义为 `experiment_logs`，`diagnoses` / `action_plans` 重构为 `stuck_sessions` / `experiments`。

---

## 6. 目录结构

```
INNERSPACE/
├── src/
│   ├── index.html          单文件前端入口；主流程零依赖，论坛走官方 CDN SDK
│   ├── app.js              前端唯一脚本入口，六个分区依次为：
│   │                        云服务公开配置 → API 客户端与「云同步」面板 →
│   │                        WebGL 银河粒子 → 水面折射涟漪 → 星夜氛围 → Human3 四象限坐标
│   ├── visual.css          v6 设计层：星夜疗愈 + 高透玻璃（须在内联样式之后引入）
│   └── assets/
│       ├── background/bg.jpg   用户提供的树冠仰拍主背景（已去除水印）
│       └── …              旧轮播照片与蝴蝶素材
├── server/                 全栈后端（Node 22 + Express + MySQL 8）
│   ├── src/core.js         配置与启动校验 / 类型化错误 / 结构化日志 / 危机词库 /
│   │                       统一响应 / 请求 ID / JWT 认证 / zod 校验 / 全局错误处理 /
│   │                       MySQL 连接池与事务（原 config+shared+middleware+infra 合并）
│   ├── src/features/       auth · sync · diagnose · forum · health · human3 各一个文件 + mappers.js
│   ├── migrations/         可回滚迁移（含 down.sql）
│   ├── scripts/            init-db / migrate / check-syntax / smoke
│   ├── tests/              单元测试（node:test）
│   ├── .env.example        占位配置，真实 .env 不入库
│   └── package.json
├── database/               MySQL 8 脚本（课程设计口径，现被后端真实读写）
│   └── init.sql            建库唯一入口，按「建表 → 视图 → 存储过程 → 触发器」分区：
│                           19 张表（含论坛 3 张）· 6 视图（含 v_forum_thread）·
│                           8 存储过程 · 7 触发器（承担证据不可悬空、能量越界等业务红线）
├── docs/                   v1.0 设计稿（docx），**保留不动**
├── REFACTOR.md             重构说明（变更总览 / 自检结果 / 回退方式）
├── .gitignore
└── README.md
```

---

## 6.1 文件合并说明（2026-11-20）

为降低文件数量与维护成本，在**不改动任何业务逻辑**的前提下做了三处合并，代码行数净变化仅来自分区注释：

| 合并前 | 合并后 | 说明 |
|---|---|---|
| `src/api.js`、`particles.js`、`water.js`、`ambient.js`、`human3.js`、`cloud.config.js`（6 个） | `src/app.js`（1 个） | 六个文件原本各自是独立 IIFE、只通过 `window` 上的约定名通信，拼接不产生变量冲突；分区顺序与原 `index.html` 的加载顺序一致 |
| `server/src/` 下 config / shared / middleware / infra 共 10 个文件 | `src/core.js`（1 个） | 统一为基础层：配置、日志、错误类、危机词库、统一响应、认证、校验、连接池 |
| `server/src/features/<模块>/` 下 routes / service / repo / rules 共 19 个文件 | `features/<模块>.js`（6 个）+ `features/mappers.js` | 每个功能收敛为单文件，`routes → service → repo → rules` 仍按段内注释分节 |
| `database/schema.sql`、`views.sql`、`procedures.sql`、`triggers.sql`（4 个） | `database/init.sql`（1 个） | 按「建表 → 视图 → 存储过程 → 触发器」分区，`DELIMITER` 块均成对闭合，单文件即可建库 |

**验收**：`npm test` 27/27 通过；`node --check` 全部 JS 通过；`init.sql` 解析出 19 表 / 6 视图 / 8 过程 / 7 触发器，与合并前完全一致。

> 说明：下文 v6 / v7 / v8 / v1.4 等**变更历史记录**中出现的 `api.js`、`water.js`、`particles.js`、`ambient.js`、`cloud.config.js`、`schema.sql` 等分文件名，均为合并前的历史形态，记录保留当时原貌以便追溯；阅读当前代码请以本表为准。

---

## 7. 本地运行

**方式 A · 本机打开主流程（无需任何环境）**

直接双击 `src/index.html`，或在浏览器地址栏打开 `file:///E:/MYproject/INNERSPACE/src/index.html`。
六步闭环、登录门禁、纯色小蝴蝶与情绪轮播、人生坐标四象限图全部可用，**主流程不发任何网络请求**（论坛 SDK 会尝试联网，失败则自动降级为「需要在线访问」提示）；卡点描述、实验记录、身份证据存在浏览器 `localStorage`（键 `kadian_db_v1`），刷新不丢。带 `?demo=1` 可显示「载入演示数据」入口。
此方式下论坛会明确显示「需要在线访问」——它不会用本地假数据冒充同步，个人记录也一个字节都不会上传。

**方式 B · 在线访问论坛（跨设备多人）**

打开项目发布的在线地址（应用「卡点」，见 §12）。论坛需要在线地址：云端账号服务按来源域名做精确校验，`file://` 和 localhost 都连不上。浏览帖子不需要登录；**发帖、回答、标记「有用」需要邮箱验证码登录一次**，换设备用同一个邮箱即可找回身份。

**方式 C · 全栈模式（推荐，真正连数据库）**

```bash
cd server
npm install
cp .env.example .env          # Windows: copy .env.example .env
npm run db:init               # 建库 + 导入 init.sql + 执行迁移
npm start                     # http://localhost:8787/
```

后端同时静态托管 `src/`，打开 `http://localhost:8787/` 即可同源使用，无需跨域。
右下角「云同步」按钮默认显示「未开启」——**不登录、不点同步，个人数据一个字节都不会上传**。
`npm test` 跑单元测试，`npm run smoke` 跑 34 项启动冒烟（需先启动服务与数据库）。

**数据库（课程验收 / 全栈模式共用）**

1. 安装 MySQL 8.0，创建数据库：

```sql
CREATE DATABASE innerspace DEFAULT CHARACTER SET utf8mb4;
```

2. 导入建库脚本（表、视图、存储过程、触发器已按依赖顺序合并在同一个文件里）：

```bash
mysql -u root -p innerspace < database/init.sql
```

3. 前端与数据库的对应关系见 `REFACTOR.md` §3.3；全栈模式下 `server/src/features/sync` 负责 localStorage 快照 ↔ 19 张表的映射，AI 端点已改为服务端代理 `/api/v1/diagnose`（见 §14）。

---

## 8. 两代模型差异（论文 / 答辩可直接引用）

旧版完整保留在 git 标签 **`v1.0-persona-model`**，可用 `git checkout v1.0-persona-model` 回退比对。

| 维度 | v1.0-persona-model（旧） | 当前版本（v1.1 卡点） |
|---|---|---|
| 理论模型 | Human 3.0 成长模型四维（心智/身体/精神/职业）分阶 | 瓶颈突破：五类卡点（A 方法 / B 技能 / C 动机 / D 环境 / E 方向） |
| 输入 | 24 题**自评量表**（"我认为我……"） | 1 段自由描述 + 5 道**行为题**（"过去 4 周实际发生了什么"） |
| 输出 | H1/H2/H3 阶位标签 + 小数点分数 + 雷达图 | 2–3 个**假设**（低/中/高置信度）+ 逐字证据引用 + 1 个分辨实验 |
| 诊断方式 | AI 生成 900–1400 字长文建议 | **规则引擎前置**（五条判定表）→ AI 只在候选集内调权重 → 规则兜底校验 |
| 用户下一步 | 30 天行动清单（不可证伪） | 7 天**分辨实验**（可证伪，能区分假设） |
| 沉淀资产 | 历史记录（存档性质） | **身份证据档案**（5 类，必须绑定实验记录，可被用户否定） |
| 导航结构 | 7 视图侧栏编号阶梯 | 3 页线性主循环（录入 → 诊断 → 实验）+ 外围页 |
| 交互节奏 | 每日打卡、连续签到 | 每 2 天记一次，第 3/6 天提醒，超 4 天只提醒一次然后安静 |
| 降级设计 | `localAdvice` 本地文案兜底 | 三级静默降级（AI → 规则 → 五问自选），AI 挂了用户无感 |
| 合规处理 | 无 | 危机信号双通道拦截 + 转介资源 + 禁用词清单 + 不存原文 |
| 成功指标 | 测评完成数、日活 | **毕业率**（走完一轮且自评有进展）、假设命中率、实验完成率 |
| 技术债 | 存储过程参数同名、触发器占位、DELIMITER 不完整、251KB base64 背景图 | 四个 SQL 脚本全量重写（20 表 / 5 视图 / 8 过程 / 7 触发器），背景图改为 CSS 渐变 |

**一句话总结两代差别**：旧版卖"了解自我"（结果不可验证），新版卖"走出瓶颈"（过程可验证）——**"了解自我"必须作为过程发生，不能作为结果承诺。**

> `docs/` 下的 `INNERSCAPE_大作业_20261013.docx`、`INNERSCAPE_数据库设计_20261013.docx`、`INNERSCAPE_系统设计报告20261020V001.docx` 均为 **v1.0 阶段的设计与交付稿**，与旧版口径一致，**本次重构未改动**，作为历史留档与两代对比材料保留。

---

## 9. 技术栈

| 层次 | 选型 |
| --- | --- |
| 前端 | HTML5 + CSS3 + 原生 JavaScript（单文件 IIFE，无框架、无构建） |
| 视觉 | v3 现代落地页语言：中性近黑底 + 克制的薄荷点缀、极细网格与柔光、渐变大标题、卡片顶部 hairline 高光、eyebrow / 双 CTA / 一体式指标条 / 四步说明模块 |
| 首页情绪轮播 | 复用三张实景图（竹林 / 河流 / 茶园）做「闷 / 绕 / 松」三屏，色彩分级 + 情绪文案 + 行动入口；自动播放、左右按钮、指示点、缩略卡、滑动与键盘切换，悬停暂停 |
| 蝴蝶 | 单只内联 SVG，28–30px 纯色小蝶：四片纯白翅面、无渐变 / 无翅脉 / 无斑点，身体与触角明显缩小；v7 移除贴身光晕，只留 `1.4px` 极细冷白边；不引图片 |
| 蝴蝶姿态 | 弹簧阻尼跟随、指针静止后绕飞盘旋、无指针时复合曲线巡游；`rotateY/rotateX` 3D 翻飞侧倾 + `translateZ` 景深近大远小；canvas 蝶身局部坐标的离散闪粉（暖金 / 冷青亮点 + 十字星芒，见 §14.4）；`prefers-reduced-motion` 静态降级 |
| 粒子互动（主站） | canvas 深空粒子 120–205 颗：光标拨开、按住拖动涡旋、点击涟漪、双击爆发、双指缩放；连线近邻早退 |
| 论坛排版 | 小红书式三列图文瀑布流（实景封面 + 情绪标签 + 错落高度 + 头像署名 + 心形有用数）、搜索与频道 tab、悬浮发布按钮；笔记式详情页与评论卡片、sticky 回答栏、双击回答点「有用」 |
| 数据（个人，本机） | 浏览器 localStorage：卡点描述、实验记录、身份证据，**不上传** |
| 数据（论坛，线上） | 应用云数据库 PostgreSQL + RLS：公开读、仅本人可写删；官方 CDN SDK |
| 论坛账号（线上） | 云端邮箱验证码登录（无密码），会话由 SDK 维护 |
| 数据（课程设计 / 本机实例） | MySQL 8.0（19 表 / 6 视图 / 8 过程 / 7 触发器），由 `npm run db:init` 导入本机实例 |
| 后端 | Node.js 22 + Express 4，按功能分三层 `routes → services → repositories`，零构建 |
| 配置 / 日志 / 错误 | `.env` 集中校验与快速失败；结构化 JSON 日志贯穿请求 ID；类型化错误 + 全局处理器 |
| 数据访问 | mysql2 连接池、事务化多步写入、迁移可回滚；同步为事务内全量重建（幂等） |
| 接口 | REST，统一 `{ok, data, error}`；zod 边界校验；CORS 显式来源；helmet 安全头；限流 |
| 认证 | 邮箱验证码 OTP + JWT access（15 分钟，只存内存）+ 服务端 refresh（httpOnly cookie，可撤销）+ RBAC |
| 前端 API 客户端 | `src/app.js` 的 API 分区：401 自动刷新一次、4xx 不重试、5xx 最多 3 次、断网离线提示、错误映射可读文案 |
| AI | 服务端持有 LLM Key（`/api/v1/diagnose`、`/api/v1/diagnose/actions`）；未配置即 `AI_DISABLED`，前端静默降级到规则引擎 |
| 云同步 | 离线优先：localStorage 仍是主存储，显式登录并点「同步」才上传；事务内幂等，revision 冲突检测 |
| 版本控制 | Git + GitHub（旧版快照：`v1.0-persona-model`） |

---

## 10. 提交规范

本项目采用 Conventional Commits 前缀：

| 前缀 | 用途 |
| --- | --- |
| `feat` | 新增功能 |
| `fix` | 修复缺陷 |
| `docs` | 文档变更 |
| `chore` | 构建、配置、初始化等杂项 |
| `refactor` | 重构（不改变行为） |
| `style` | 格式调整 |

示例：`refactor: 以「卡点」六步闭环重写单文件 demo`

## 11. 分支约定

- `main`：主分支，保持可交付状态
- 功能开发使用 `feature/<模块名>` 分支，合并前需通过自测
- 标签 `v1.0-persona-model`：旧版人格测评模型的完整快照，**只读不回滚**

---

## 12. 经验分享 · 在线论坛（v1.2 / 2026-11-14）

**它是什么**：顶部导航「经验分享」进入。登录后可以把自己的困惑发成帖子，其他人用自己真实经历回答；楼主可标记一条「最有帮助」，任何人可对回答点「有用」（同一人只能点一次），作者可删除自己的帖子 / 回答（删帖级联删回答）。发帖与回答都可选匿名；卡点录入页、诊断页可一键把描述带入发帖表单，发布前可随意删改。

**两套数据，边界写死**

| 内容 | 存在哪 | 谁能看 | 说明 |
|---|---|---|---|
| 卡点描述 / 实验日志 / 身份证据 | 浏览器 localStorage | 只有这台设备 | **永不上传**，不因登录论坛而改变 |
| 帖子 / 回答 / 有用反馈 | 应用云数据库 | 所有访问者可读 | 只有主动发布的内容才公开；写删由 RLS 限制为本人 |
| 论坛显示名 / 实验备忘 | 浏览器 localStorage | 只有这台设备 | 显示名只用于署名；论坛回答可「存到我的实验备忘」，仅本机可见 |

**两套数据库，别混**：线上跑的是应用云数据库（PostgreSQL，`forum_posts` / `forum_replies` / `forum_votes` + RLS）；`database/` 下的 MySQL 脚本是课程设计交付物（19 表 / 6 视图），字段语义一致但实例不共用。论坛不读写 `stuck_sessions` / `experiments` / `evidence_items`。

**账号**：本机账号（或访客）用来打开私人空间；论坛另用云端邮箱验证码登录（不设密码），两者互不干扰。云端未登录时仍可浏览帖子，但不能写。

**合规红线（沿用全站铁律）**

- 发帖与回答同样跑 `detectCrisis()` 双通道拦截，命中即中止发布、展示危机转介页（12356 / 010-82951332），草稿不保存；
- 论坛固定展示免责声明：经历分享 ≠ 心理诊断 / 治疗建议 / 能力评价；
- 不做全站排行榜、关注、私信、AI 陪聊；「有用」只是单条回答下的计数；
- 「一键发帖」不会自动上传卡点原文，只是把文字带入可编辑表单，由用户自己按下发布。

**运行前提**：论坛必须经由应用发布的在线 HTTPS 地址访问，云端按来源域名精确校验，`file://` / localhost 无法完成身份验证。本地打开时论坛明确提示，不会静默降级成假数据。`src/app.js` 的云配置分区 只含公开配置（endpoint / publishableKey），不含任何长期密钥。

**v1.4 排版（2026-11-15）**：列表改为三列图文瀑布流（窄屏两列），封面复用 `assets/background` 三张实景图并按情绪做色彩分级，情绪标签由帖子内容派生（迷茫 / 拖延 / 在意 / 疲惫 / 闷 / 绕 / 松）；卡片高度按序号错落，附头像署名、心形有用数与回答数。顶部增搜索框（只显隐卡片、不重渲染、不丢光标）、推荐 / 最多回答 / 已有答案 / 我的 四个频道与悬浮发布按钮；详情页改笔记式沉浸排版与评论卡片、底部 sticky 回答栏；双击回答会真实点一次「有用」并飘心。**以上全是表现层改动**：`f:` 动作分发、云端读写、危机拦截与 RLS 策略未变，也没有新增数据库字段。

---

## 13. 全栈后端（v2.0 / 2026-11-15）

**一句话**：给原有单文件前端加了一层真实后端与数据库连接，不改产品红线，也不重写 5623 行 UI。

### 13.1 本次代码审核发现并修复的问题

| 级别 | 问题 | 处理 |
|---|---|---|
| P0 | 项目实际没有后端，建好的表从未被程序读写 | 新建 `server/`，`npm run db:init` 真正导入并读写 |
| P0 | 前端 XHR 把 API Key 以 `Authorization: Bearer` 直发第三方，密钥存 localStorage | 移除浏览器密钥入口（`aiCfgSet` 停用、`aiModalOpen` 改为状态提示），改走服务端 LLM 代理；`ai.local.js` 不再被引用 |
| P1 | 危机拦截 / 字数校验只在客户端，绕过前端即可写库 | `server/src/shared/safety.js` 是 `detectCrisis()` 的服务端等价实现，所有写库入口独立复算 |
| P1 | `schema.sql` 全程 `FOREIGN_KEY_CHECKS=0`，`experiments.fk_ex_tpl` 引用了后面才建的表 | 内容资产两张表前移到「第零部分」，DROP 后立即恢复外键校验；已实测该约束真实生效 |
| P1 | 迁移外键名 `fk_ss_user` 与 `stuck_sessions` 冲突（MySQL 约束名全库唯一） | 改名 `fk_sync_snap_user` |
| P2 | 前端无模块 / 无测试 / 无构建 | 新增 `api.js` 适配层、27 个单测、34 项冒烟；UI 主体保持不动 |

### 13.2 架构决策

按功能组织 + 三层（控制器解析请求 → 服务层业务规则 → 仓储层 SQL）；REST + 统一 `{ok,data,error}`；类型化错误 + 全局中间件；结构化 JSON 日志带请求 ID 且脱敏原文/密钥；配置全走 `.env` 并启动校验；所有输入 zod 边界校验；实时能力不需要（每 2 天记一次，轮询足够）；多步写入事务化、后台无长任务。

### 13.3 端点清单

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/health` `/ready` | 无 | 存活 / 就绪（后者真查库） |
| GET | `/api/v1/config` | 无 | 前端公开配置，不含密钥 |
| POST | `/api/v1/auth/otp/request` `/otp/verify` | 无 | 邮箱验证码登录；verify 返回 access token + httpOnly refresh cookie |
| POST | `/api/v1/auth/refresh` `/logout` | cookie | 令牌轮换 / 撤销 |
| GET | `/api/v1/auth/me` | JWT | 当前账号 |
| GET | `/api/v1/sync/state` `/pull` | JWT | 云端版本与快照 |
| POST | `/api/v1/sync/push` | JWT | 事务内幂等落库；服务端复算危机拦截与「证据必须来自实验记录」 |
| DELETE | `/api/v1/sync` | JWT | 只删云端副本，本机数据不动 |
| POST | `/api/v1/diagnose` `/diagnose/actions` | 无（限流） | 服务端持 Key 的 LLM 代理；未配置返回 `AI_DISABLED` |
| GET | `/api/v1/forum/posts` `/posts/:id` | 无 | 公开读 |
| POST | `/api/v1/forum/posts` `/posts/:id/replies` `/replies/:id/votes` | JWT | 服务端危机 + 字数校验；「有用」幂等 |
| DELETE | `/api/v1/forum/posts/:id` | JWT | 仅本人或管理员 |

### 13.4 数据边界（与 §12 一致，未放宽）

localStorage 仍是主存储。`src/app.js` 的 API 分区只在 `http(s)` 下探测一次**公开配置**，`file://` 下一个请求都不发；只有用户显式登录并点击「把本机数据同步到云端」，卡点描述 / 实验记录 / 身份证据才会上传。access token 只存内存，refresh 只进 httpOnly cookie，浏览器永不接触任何 API Key。论坛线上仍可走云 SDK（PostgreSQL + RLS），本机这套 MySQL 实现提供相同语义的 API，两者实例不共用。

### 13.5 验证结果

`npm test` 27/27 通过；`npm run db:init` 成功导入 19 表 / 6 视图 / 8 过程 / 7 触发器 + 4 张服务端表；`npm run smoke` **34/34 通过**（含 OTP→JWT→push→pull→冲突检测→危机拦截→证据红线→Human 3.0 匿名坐标与 notes 复算→论坛写入→清理的完整链路）。`node scripts/check-syntax.mjs` 38 个文件全过。

### 13.6 启动命令与遗留事项

```bash
cd server
npm install
copy .env.example .env        # 改成自己的 DB_PASSWORD / JWT 密钥
npm run db:init
npm start                     # http://localhost:8787/
npm test && npm run smoke     # 另开一个终端跑冒烟
```

- **MySQL 服务需自行启动**：本机原实例因数据目录权限受限无法在此环境拉起，验证时用的是隔离临时实例（`%TEMP%\innerspace-mysql-test`）。要切回原实例，先 `mysqladmin -u root -h 127.0.0.1 shutdown`，再启动系统 MySQL 服务并确认 3306 空闲。
- **OTP 邮件投递未接实盘 SMTP**：`development` 下验证码写结构化日志并在响应返回 `devCode`（明确标注 dev 通道，不冒充已发邮件）；`production` 未配 `SMTP_URL` 时接口返回 503 明确报错。接邮件服务是实现 `authService.requestOtp` 投递分支即可。
- **CSP 暂时关闭**：前端是单文件内联脚本，无法用 nonce；helmet 其余安全头照常启用。前端模块化后应重新开启 `contentSecurityPolicy`。
- **LLM 未配置**：`server/.env` 里 `LLM_*` 留空，AI 精修自动降级到规则引擎（用户无感）。填入 OpenAI 兼容的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 即自动启用。

---

## 14. 前端视觉与粒子动效（v7.0 / 2026-11-15）

### 14.1 设计定调：树冠天井 · 星夜水镜

**受众与目的**：给 18–22 岁在校生的私人内省工具一个温柔、可呼吸的视觉空间。
**方向**：只取一个极端 —— **星夜疗愈（Organic / natural × 夜空氛围）**，柔和曲线、玻璃质感、慢速呼吸动效。
**参考**：课程作业 `E:\大三上\webclass\class1` 的配方 —— 固定照片背景 + 深绿渐变遮罩 + `rgba(255,255,255,.09)` 毛玻璃卡片 + 白色发丝描边 + hover 上浮 + 光扫过。
**记忆点**：用户提供的**树冠仰拍照片**做「水面」，点击时照片被涟漪真实折射扭曲；斜贯全屏的银河带与流星叠在其上。

| 维度 | 决策 |
|---|---|
| 展示字 | 中文宋体栈（Songti SC / STSong / 思源宋体 / SimSun）；柔软引言用楷体栈（Kaiti SC / STKaiti）；**弃用 Inter / system-ui** |
| 正文 | 苹方 / 微软雅黑黑体栈，行高 1.74，字距 .02em |
| 编号与标签 | IBM Plex Mono 等宽体，`tabular-nums` |
| 配色 | 深墨绿夜空 `#061410` 60% / 苔绿玻璃 `#0e231b` 30% / **薄荷 `#5fdcab`** 10%；暖金只给徽章与流星，柔粉只给点赞心 |
| 主背景 | `src/assets/background/bg.jpg`（绿叶仰拍，已裁掉「AI 生成」水印）固定 `cover` / `center 42%`；`filter: saturate(.84) brightness(.74)` + 深绿渐变遮罩保证正文对比度 |
| 部分高透玻璃 | 信息型卡片（`.card.soft / .flat / .note / .hypo / .ev-item`、`.how-item`、`.forum-bound`、`.reply-dock`）用 `rgba(255,255,255,.045)` + `blur(22px) saturate(168%)` + `1px` 白描边 + inset 顶部高光 + 11s 光带扫过，hover 上浮 −6px；**操作型**（`.card.accent` / 主按钮）保持较实，形成虚实层次 |
| 动效 | 一次编排入场（错峰 80ms）+ 银河 16s 呼吸 / 品牌点脉冲 / 按钮流光 / 数字轻浮 / 罗盘缓转 / 贴纸摇曳；`prefers-reduced-motion` 全量降级 |

字体全部使用本地系统栈，**不引入任何外部字体请求**，`file://` 下视觉与离线承诺均不受影响。

### 14.2 点击水波：照片折射，不是光圈

`src/water.js`（新增，原生 WebGL1 / 零依赖）是本次最核心的改造。**只画同心亮环无论多亮都读成光圈**，所以改为模拟水面受扰动后的光学反应：

- **折射是决定性质感**：canvas 插进 `#photo-bg` 内、`.photo-veil` 之前；纹理就绪后该层加上 `.water-live`（关掉 CSS 背景图与 Ken Burns），**这一层就是照片本身**。着色器用 `coverUV()` 复现 `center 42%/cover`，按波面斜率产生的径向 `refr` 做 RGB 分通道 UV 位移采样（系数 0.0135），树叶与蓝天会被真实推挤拉伸；无波处 `duv=0`，与静态照片逐像素一致。
- **v7 雨滴尺度 + 连点累积**：第一下只有一枚小涟漪 —— 终末半径 `52px`、寿命 `1.05s`、波包宽 `10px`、短波长细密 3–4 圈，像雨滴落进水面。波前用阻尼式 `vmax*(1-exp(-age*3.6))` 先快后慢，比线性扩散更像真水波。连点会累积 `charge`（每滴 +0.22，约 5 次到顶），后续每一滴的半径 / 波宽 / 寿命按该滴自身的 `scale` 递增到 `352px` / `2.6s`；停手 2.4s 自动回落到第一滴。`uScale[6]` 逐波传入，旧波不会被后来点击突然撑大。
- **波列模型**：快波前 + 慢跟随波包，角度谐波轻微扰动波前避免完美圆，竖向压扁 1.22 做椭圆透视，指数阻尼 + 落点暗核/亮环。波峰天光、波谷阴影、镜面高光与极淡青紫色散只作克制叠加，避免变成过曝电环。圆心处 `dv→0` 会让 `normalize` 乱跳，用 `smoothstep(1,7+16*sc,d)` 淡掉，消除星形采样伪影。
- **包围盒剔除**：`if(length(dv) > f1 + 3.2*w1 + 4.0) continue;` —— 雨滴只覆盖落点周围几十像素，其余片元不进重计算；连点 6 波并存时软件渲染也不会被全屏 `exp/sin` 拖垮。
- **联动**：`src/ambient.js` 移除全部 DOM 光圈，点击 / 键盘 Enter·Space 只派发 `INNERSCAPE_WATER.ripple(x,y)`，再读 `status.scale` 把幅度 `0.55 + scale*1.65` 传给 `INNERSCAPE_PARTICLES.ripple(x,y,amp)` —— 第一滴只轻推一下星点，连点后才跟着铺开，不会出现「小涟漪 + 大光圈」的割裂。
- **降级三级**：纹理加载失败（`file://` 跨域）→ 透明叠加的明暗波列，CSS 照片照常；WebGL 不可用 → canvas 2D 多层明暗椭圆波带（同步支持雨滴 / 累积缩放）；两者都不行 → 静默失败。无活跃波时完全停帧，`preserveDrawingBuffer` 保留静态照片；DPR ≤ 1.25、最多 6 波并存、页面隐藏暂停、reduce-motion 不产波。

### 14.3 星空银河、流星与治愈系动画

- `src/particles.js`：原生 WebGL 银河引擎，主形态是**倾斜扁平盘 + 三条旋臂 + 亮核**（17% 粒子聚到银心），另三形态为旋涡 / 星潮 / 双环；加色混合双层辉光、深度雾、冷白星点 + 薄荷主色 + 少量暖金。四形态作为静态 attribute 一次上传、GPU 内插值。
- `src/ambient.js`：canvas 2D 氛围层挂在 `body`，不受登录态影响。171 颗静态星野、27 只漂浮萤火、26 粒下落光尘，随机 2.8–6.8 秒斜向划过的流星（渐变拖尾 + 头部辉光，22% 概率成流星雨）。CSS 另有 −19° 呼吸银河带、SVG 颗粒与罗盘缓转。

### 14.4 蝴蝶鳞粉：颗颗分明的闪粉，不是光团

演进：折线丝带像蚯蚓 → v5 世界坐标粒子飞走后留在原地、与蝶脱节 → v6 改用**蝶身局部坐标**解决脱节，但两侧的径向柔光 + 56px 光晕把蝶与粉糊成一个白色光团。v7 保留局部坐标的贴身约束，**彻底重写质感**：

- **删光团**：移除 canvas 的贴身柔光与蝶后光斑、`#bf-glow` 直接 `display:none`、`#bf` 的发光雾收成 `1.4px` 极细冷白边、opacity 提到 `.94`，蝶身轮廓清晰可辨
- **独立绘制**：`globalCompositeOperation` 从 `lighter` 改回 `source-over`。加色混合会让几颗星芒重叠处饱和成一片白雾（等于又变回光团），独立绘制下每颗粉边界清楚、颗颗可数
- **颗粒设计**：每颗 = 锐利亮点 + 纯白内核，26% 带十字星芒、22% 带 2–4px 极细短拖尾；`62%` 暖金 `255,203,128` 与冷白星野拉开色差；高频轻闪让粉在动态上比慢闪的背景星点更抓眼
- **不脱节也不断线**：粒子仍存蝶身局部偏移，每帧按当前蝶位 + 朝向变换；阻尼 + 短寿命 + 横向抖动自然拖出 20–34px 粉带，越界就加速谢幕（不设硬夹紧环，避免老粒子堆成一圈），既不是蚯蚓也不是光团
- `REDUCED` 下蝴蝶静态定位、无尾迹

浏览器实测：尾迹 canvas 非空像素 460 个、`maxAlpha 252`、高亮核像素占比 25.9%，4 倍放大特写里是贴着蝶翼的一簇独立暖金/冷青亮点与星芒，无白色雾团、无长线。

### 14.5 经验分享：小红书 × 抖音排版

- **头部**：渐变裁切大标题 + 旋转 ✦ + 贴纸式「一起慢慢来」+「你不是一个人卡在这里」渐变大字横幅；**断网时同样保留**整套头部，离线提示改成带呼吸光环与标签的渐变卡
- **列表**：话题胶囊无缝跑马灯、脉冲数据条、三列瀑布流；卡片含渐变贴纸 / TOP 角标 / 心情胶囊 / Ken Burns 封面 / 渐变热度条 / 错峰入场 / 心形跳动 / 数字滚动
- **详情与评论**：渐顶条、话题标签、头像光环、accepted 渐变高亮、双击飘心
- **可读性兜底**：玻璃近乎无色，照片亮处会吃掉 12px 细字，因此 `.forum-bound / .card.soft.forum-auth / .forum-hero-band / .forum-empty` 额外压一层 `rgba(4,20,14,.46)` 深底，模糊与光扫保留
- 所有 `data-act` / `data-id` / `data-search` 与云端读写、危机拦截链路**完全未改动**

### 14.6 人生坐标四象限图（纯 SVG）

坐标图由 `src/human3.js` 的 `quadrantHtml()` 直接拼字符串生成 **纯 SVG**：无 canvas、无第三方库、无独立页面，`file://` 双击即可打开。

- **坐标系**：`viewBox="0 0 420 320"`，横轴个人 ↔ 集体、纵轴外在 ↔ 内在，四象限各一块底色；14 条网格线（含 0.5 档细线）、2 条带箭头的轴 `path`、17 条刻度 / 轴标题文字，原点 O 居中
- **数据表达**：每象限一条 `polyline`（知识 / 经验 / 技能三点连折线）+ 3 个 `circle` 数据点，合计 4 条折线 12 个点；未标格画成 `empty` 半透明点，不假装有值
- **可读性**：每个数据点带 `<title>`，悬停显示「象限 · 维度 · 档位文字」，**不显示数字、不显示分数、不评定等级**
- **瓶颈提示**：最费劲的象限加 `hot` 描边，只作视觉提示，判断逻辑全在纯函数 `bottleneck()` 里
- **刷新方式**：`refresh()` 重写 `#h3-quad-host` 的 `innerHTML`，切页不重建容器、不留事件监听

### 14.7 验证结果（v7 最终）

| 关卡 | 结果 |
|---|---|
| 语法 | `check-syntax.mjs` **38/38**；`index.html` 内联脚本单独 `node --check` 通过 |
| 真实渲染 | 无头 Chrome 实测 1440 / 768 / 375 三档 + 论坛页，`WebGL available:true`、`water.textured:true` |
| 水波折射 | 静态帧 vs 产波帧抽样对比 `meanDelta 79–126`，水波层原始裁剪截图显示树叶/蓝天被推挤成细密明暗波带；`mode:webgl` / `textured:true` |
| v7 雨滴尺度 | 单滴 `scale:0`、影响半径 **38–60px**（抽样差异像素 761–1023）；连点 6 次 `scale` 逐滴 `0→0.21→0.40→0.58→0.75→0.91`、影响半径 **283–313px**，6 波叠加；停手 3.2s 后自动回落到单滴 |
| 蝶粉质感 | 尾迹 canvas 460 个非空像素、`maxAlpha 252`、高亮核占比 25.9%；4 倍放大特写为独立暖金/冷青亮点 + 十字星芒，无白色雾团、无长线 |
| v7 性能 | 包围盒剔除后 6 波并存软件渲染不再阻塞主线程（CDP 无超时），JS 运行时异常 **0** |
| 动效降级 | `prefers-reduced-motion` 下 `running:false` / `waves:0` / 不生成流星；纹理模式下 canvas 仍作为背景照片保留 |
| 玻璃与对比度 | 信息卡 `blur(22px) saturate(1.68)` + 白描边，操作卡保持较实；论坛细字信息条加深底 |
| 后端回归 | 单测 **27/27**、冒烟 **34/34**、语法 **38/38**、JS 运行时异常 **0** |

### 14.8 新增与修改文件

- 新增 `src/water.js`（WebGL 照片折射涟漪）、`src/ambient.js`（点击派发 / 流星 / 星野 / 萤火光尘）、`src/assets/background/bg.jpg`（用户提供主背景，已去水印）
- 重写 `src/visual.css`（v6 设计令牌 + 部分高透玻璃 + 水面层 + 论坛可读性兜底，**必须在内联 `<style>` 之后引入**）
- 修改 `src/index.html`：引入 `water.js`、新增 `#photo-bg` 固定照片层、**蝶身局部坐标**鳞粉尾迹、删除折线丝带与 `hist[]`/`TH[]`、论坛装饰与离线页
- 修改 `src/particles.js`：银河形态 / 薄荷配色 / `ripple(x,y,amp)` 联动；`src/api.js`：色板统一回薄荷绿
- **v7 微调**：`src/water.js` 雨滴尺度 + `uScale[6]` 连点累积 + 包围盒剔除；`src/ambient.js` 按 scale 联动星点；`src/particles.js` `ripple` 接受幅度；`src/index.html` / `src/visual.css` 蝶粉改为独立绘制的离散闪粉并关闭 `#bf-glow`

**回退**：删掉 `index.html` 里的 `water.js` 引入与 `#photo-bg` 节点即可回到 CSS 照片背景；`visual.css` 的 `<link>` 移除可回到内联旧样式（色值已做源码替换，需一并回滚）。

---

## 15. 免责与边界

本产品定位为**学业与职业困惑的结构化梳理（发展辅导）**，不是心理咨询、不是心理诊断、不是治疗，也不做任何心理健康评估。
Human 3.0 四象限坐标是**用户自评的定位工具**，同样不构成心理、医学或人格评估：不显示分数、等级、百分比或诊断结论，全部读数只换算成图形的长度与体量。
一旦识别到自伤 / 轻生相关表达，流程立即中止并给出求助资源——**这件事不该由产品来处理**。

---

## 16. Human 3.0 四象限坐标模型（v8.0 / 2026-11-15）

把 Dan Koe《HUMAN 3.0》的四象限（心智 / 身体 / 精神 / 使命）× 三层 × 三阶段，落成一条**可离线、可复查、可实体化**的闭环。设计依据见 `docs/HUMAN3_DESIGN.md`。

### 16.1 本轮拍板的四项

| 未决项 | 结论 |
|---|---|
| 12 格口径 | **4 象限 × 3 Traits**（知识 / 经验 / 技能），每格自评 1 / 2 / 3 |
| 入口强度 | **首屏明显入口**：主 CTA 右侧「人生坐标 · 坐标图 ↗」+ hero 下方坐标缩略图预览卡 + 导航「人生坐标」；v10 起收敛为唯一一张坐标门卡（见 §17.2） |
| 实施范围 | **P0–P3 一次做完**（前端 / 服务端 / 坐标图可视化 / 独立表与统计） |
| 复查周期 | 两级：7 天小复查 + 90 天大复查（日期在 `dose.check_at` / `dose.review_at`，到点用 `DB.remind` 一次性标记） |

### 16.2 领域层：确定性纯函数，零 LLM

`src/human3.js`（前端 ES5）与 `server/src/features/human3/human3.rules.js`（ESM）是同一套逻辑的两份实现：

- `readGrid` 缺格返回 `null`，不补零不猜测；`bottleneck` 并列按 `body > mind > spirit > vocation`
- `blockedBy` 差值 ≥ 0.34 才判阻塞，命中时返回固定中文常量文案（不现编）；另给可借力的 `supportFrom`
- `inferPhase` 三道行为题取众数，**平票取较低阶段**（防「假性好转」）
- `traitBalance` 只给一句偏科描述 + 一个追问；`archetype` 确定性查表生成「参考画像」，用户可改
- `makeDose` 按 `象限 × 阶段` 查 12 条模板，动词开头、含时间 / 次数 / 交付物、24h 内能做第一步，并附一个来自其它象限的支撑动作

数据落在 `DB.human3`（`localStorage` 已有存储键的附加顶层字段，旧库零迁移）；12 份上限、草稿实时落盘、任意状态可退出。一键「放进这周的小实验」会创建**合法 session + experiment**，因此云同步不会被孤立记录清理或证据红线拦下。

### 16.3 坐标图可视化：把 12 格画在标准笛卡尔四象限里

坐标图整条链路收在 **`src/human3.js` 内部生成 SVG 字符串**，随 `refresh()` 写进 `#h3-quad-host`：不加载任何三方资源、不开独立页面，刷新只替换 `innerHTML`。

- **象限映射**：`mind → II`、`body → III`、`spirit → I`、`vocation → IV`；横轴个人 ↔ 集体、纵轴外在 ↔ 内在，与领域层的 `QSUB` 文案逐字对应
- **图纸构成**：4 块象限底色 + 14 条网格线（含 0.5 档细线）+ 2 条带箭头主轴 + 1/2/3 刻度 + 象限编号 I–IV + 轴标题，原点 O 在正中
- **数据层**：每象限一条 `polyline` 串起知识 / 经验 / 技能三档，12 个 `circle` 数据点各带 `<title>` 文案；未标格用 `empty` 类画半透明点，读数缺口就是缺口
- **瓶颈与阻塞**：`bottleneck()` 命中的象限加 `hot` 描边；`blockedBy()` 的阻塞关系仍只在文字卡里给出，不画跨象限连线
- **尺寸与降级**：`viewBox="0 0 420 320"` 配 `preserveAspectRatio`，宽度交给 CSS，窄屏自动缩小；本图无动画，`prefers-reduced-motion` 天然满足
- **复用**：首屏与导航门卡的缩略图 `quad-mini` 复用同一份 SVG（缩到小尺寸只看方块与折线），保证门卡预览与详情页是同一套刻度语言

### 16.4 服务端、安全与匿名分布（P1 / P3）

| 层 | 内容 |
|---|---|
| 可选 AI | `POST /api/v1/human3/actions` 复用 `diagnose.service.js` 导出的 `callLLM` / `parseJsonLoose` / `aiUnavailable` 与双预算重试，只把「做法」写得更贴合用户原话；输出固定 3 条 `{t,d,why}`，逐条过 `AI_FORBIDDEN`；未配置 LLM → 503 `AI_DISABLED`，前端静默用规则模板 |
| 同步安全 | `snapshotSchema` 显式声明 `human3` + `.passthrough()`（pull 字段零丢失）；`assertSnapshotSafe()` 递归收集 `notes.*` / `dose.action` / `dose.support` 做危机复算；`assertHuman3Rules()` 校验值域、12 份上限、`dose.experiment_id` 必须指向真实实验 |
| 独立表 | `002_human3.up.sql` 建 `human3_assessments`，**只存结构化坐标，不存任何自由文本**；仅在用户显式点「加入匿名分布」时写入 |
| 统计 | `GET /api/v1/human3/distribution` 每人只取最新一份，样本 < 5 直接返回 `available:false`（防重识别）；关闭云同步时一并清掉该用户记录 |
| 隐私 | 默认零上传；`LLM_*` 为空时全流程纯本地；原文与四象限 `notes` 只在 `localStorage`，仅显式 push 才进快照 |

`mappers.js` 新增 `quadrant` / `h3Status` / `h3Phase` 白名单，`health.js` 暴露 `features.human3`，`src/app.js` 的 API 分区封装三个新方法并沿用 401 刷新 / 5xx 重试 / 离线提示。

### 16.5 验证结果（v8 最终）

| 关卡 | 结果 |
|---|---|
| 后端 | 语法 **38/38**、单测 **27/27**、冒烟 **34/34**（含 human3 写入、notes 危机复算、快照零丢失、小样本不暴露） |
| 数据库 | `db:migrate up` 执行 001 + 002；`human3_assessments` 12 列、外键 `fk_h3_assess_user_v2` 生效 |
| 前端实测 | 无头 Chrome（v8 时）：首屏入口可见、`#/map` 4 卡 36 格、标满 12 格 → 瓶颈 `vocation` + 最小剂量生成、窄屏卡片自适应、JS 运行时异常 **0** |
| 坐标图 | Node 桩环境加载 `src/human3.js` 直接调用 `quadrantHtml()`，三种输入（12 格填满 / 12 格全未标 / 空 `grid`）均输出 `rect` 4、`line` 14、`path` 2、`text` 17、`polyline` 4、`circle` 12、`<title>` 12、`viewBox="0 0 420 320"`；填满时 `hot` 1 / `empty` 0，全未标时 `empty` 12；`NaN`、`undefined`、第三方嵌入标签命中 **0**，判定 PASS（脚本 `temp/verify_human3.js`） |
| 降级 | 全新浏览器无评估数据时 12 点全部画成 `empty` 半透明点并给出「去标 →」；`file://` 不发任何请求 |

### 16.6 新增与修改文件

**新增**：`src/human3.js`、`server/src/features/human3/{human3.rules,human3.prompt,human3.service,human3.repo,human3.routes}.js`、`server/migrations/002_human3.{up,down}.sql`、`server/tests/human3.test.mjs`、`docs/HUMAN3_DESIGN.md`

**修改**：`src/index.html`（引入 / `blankDB` / `loadDB` / `VIEWS` / `ROUTES` / `viewTitle` / `onClick` 的 `h3:` 分发 / 首屏入口与复查提醒 / 导航 / `__INNERSPACE_BRIDGE`）、`src/visual.css`（§19）、`src/api.js`、`server/src/app.js`、`server/src/features/health/health.routes.js`、`server/src/features/sync/{sync.service,mappers}.js`、`server/src/features/diagnose/diagnose.service.js`（导出复用链路 + 输出硬校验）、`server/scripts/{init-db,smoke}.mjs`、`README.md`

**回退**：删 `index.html` 的 `human3.js` 引入与三处路由登记即回到 v7；`DB.human3` 是附加字段，删除后 `loadDB()` 兼容分支不报错。回滚数据库用 `npm run db:migrate -- down --confirm`（会一并删 001 的三张表，慎用）。

---

## 17. v15 编辑式档案重排版与四项纠偏（2026-11-16）

> 本节只记本次增量。§1–§16 是各版本时点快照。本轮**未改数据库脚本、云端表、RLS 与危机拦截**，也**未调用在线发布**。

按 `@skill:"前端设计"` 的方法论（`references/zh-CN.md`）定方向为「编辑式暗夜档案」：深墨绿 60% / 苔绿玻璃 30% / 薄荷 10%，宋体展示字 + 等宽编号 + 黑体正文，只留一种强调色；用发丝线、竖向规则线、错峰入场替代堆叠卡片与通用渐变；`prefers-reduced-motion` 与 `:focus-visible` 一律给降级 / 焦点态。落地为 `src/visual.css` §20「v10 重排版」**追加覆盖层**，不改任何既有功能选择器。

### 17.1 蝴蝶尾迹：单条白色柔光光束

`src/index.html` 的 `drawTrail()` 重写。v8 那套双翼 V 形航迹、涡旋扰动、柔雾团、离散闪粉、涟漪全部撤掉——它们读起来就是「两条痕迹 + 一团水波」。

- 历史点 `CONTRAIL` 只存世界坐标轨迹，`TRAIL_LIFE = 1.55s` / `TRAIL_MAX = 110`，相邻点位移 < 2.2px 不入队；活头永远锚在当前蝶位，尾部按时间消散，不会越拖越长。
- **同一条路径**叠三遍描边：`WIDTH = [11.0, 4.2, 1.25]` / `GROW = [6.0, 2.2, 0.8]` / `ALPHA = [.055, .14, .55]`，分别是外晕 / 中层 / 细亮芯，是这一束光的截面，不是三条线；三次坐标完全相同、颜色全部纯白。按 14 个年龄桶批量 `stroke()`，低配机也不掉帧。
- `globalCompositeOperation = 'source-over'`，避免加色叠加把光束糊成白雾；头部只留一颗 1.4px 白点。`#bf-glow` 关闭，蝶身保持清晰轮廓，发光只交给这一条光束。

### 17.2 人生坐标独立成导航，门卡收敛为坐标入口

v10 把人生坐标从「藏在实验室里」提为一等入口：导航项 `data-navx="map"` 回到主站顶栏，首屏只保留**唯一**一张 `.coord-gate` 坐标门卡（非对称玻璃门卡 + 破格 `COORD` 描边字），三件事写在一处：标准四象限坐标图 / 12 格自评 / 复查提醒。右侧缩略图由 `quadrantHtml()` 派生的小尺寸 SVG 生成（`.quad-mini`），与详情页共用同一套刻度语言：方格、十字轴、1/2/3 刻度、象限编号 I–IV、四条折线。`viewTitle()` 的 `map` 为「12 格自评」，`human3Reminder()` 文案统一为「坐标图」。原独立实验页面与配套启动脚本已整体移出代码库，`#/map` 现在是主站内的自评视图，不再跳转外部页面。

### 17.3 标准笛卡尔四象限统计图（替换 12 轴蛛网）

本轮把这块可视化整体收敛为主线内联 SVG：改为 `src/human3.js` 的 `quadrantHtml()` 直接拼字符串（详见 §14.6），原独立实验页目录连同 639 行场景脚本一并移除，仓库内不再保留相关资源：

| 项 | 实现 |
|---|---|
| 象限映射 | `mind → II`（左上）、`body → III`（左下）、`spirit → I`（右上）、`vocation → IV`（右下）；横轴 `个人 ↔ 集体`，纵轴 `外在 ↔ 内在` |
| 图纸构成 | 4 块 `<rect>` 象限底色 + 14 条 `<line>`（含 0.5 档细线）+ 2 条带箭头 `<path>` 主轴 + 17 条 `<text>`（1/2/3 刻度、轴标题、象限编号 I–IV、图注），`O` 原点居中，根部 `role="img"` |
| 数据拼接 | 4 条 `<polyline>`（知识 / 经验 / 技能三档连线）+ 12 个 `<circle>` 数据点；未标格落 `empty` 半透明虚位，不补零、不假装有值 |
| 读数映射 | 每格 `1/2/3` 沿象限内方向线定位，离原点越远档位越高；`bottleneck()` 命中的象限加 `hot` 描边 |
| 可访问性 | 每个数据点带 `<title>`，悬停显示「象限 · 维度 · 档位文字」；不显示数字、不显示分数、不给结论 |
| 契约 | `window.HUMAN3.quadrantHtml()` 为纯函数（输入 `{grid, bottleneck}` → 返回字符串）；`refresh()` 只重写 `#h3-quad-host` 的 `innerHTML`，不重建容器、不留监听 |

### 17.4 流星统一朝向

`src/ambient.js` 删掉 `fromLeft = Math.random() < 0.32` 的随机反向分支：所有流星固定 `dx = -cos(ang) < 0`、`dy = sin(ang) > 0`，即**右上 → 左下**。角度只在 `0.38–0.53 rad` 窄区间抖动，让同向的几条保持自然差别又不散成两个方向；流星雨里延后出发的几条沿用同一朝向，只是错峰起跑。

### 17.5 视觉编排与响应式修正

`src/visual.css` §20 追加：`--measure` / `--hair` / `--tracking-display` / `--dur-scene` / `--shadow-hair` 令牌；Hero 竖向规则线 + 渐变标题（`@supports` 内启用）+ eyebrow 规则线 + 指标条发丝线；`.coord-gate` 非对称门卡与描边巨型 `COORD` 破格编号；6 组 60ms 错峰入场；论坛瀑布流间距 / 阴影微调；`:focus-visible`、900px / 520px 响应式、`prefers-reduced-motion` 降级。

用 CDP 设备模拟做了 11 档真实视口扫描，修掉两处真实溢出：

| 视口 | 问题 | 修正 |
|---|---|---|
| ≤440px | `11.5vw` 标题把第二行「先别急着努力。」的句号顶出右边缘 | 新增 `@media (max-width:440px){.hero-copy h1{font-size:clamp(29px,9.2vw,40px)}}` |
| 768–1099px | 装饰罗盘 `right:-8%` 溢出视口 19px，产生横向滚动条 | 新增 `@media (min-width:768px) and (max-width:1099px){.hero-visual{right:0}}`；≥1100px 因 `#stage` 居中留白足够，仍保留破格出血 |

> 注：无头 Chrome 157 会把 CSS 视口钳到 ≥500px，`--window-size=375` 截出的 375px 图只是 500px 布局的裁切，**不能**用来判断窄屏；本次窄屏结论全部来自 CDP `Emulation.setDeviceMetricsOverride`。

### 17.6 验证结果（v15 最终）

| 关卡 | 结果 |
|---|---|
| 语法 | 7 个外部 JS 与 `index.html` 内联脚本 `node --check` 全部通过（`index.html` 5798 行 / `visual.css` 1407 行；独立实验页目录已移除） |
| 尾迹 | 隔离探针截图：一只 30px 纯白小蝶 + **一条**白色柔光光束，无双线、无水波环 |
| 统计图 | 离线桩验证 `quadrantHtml()`：均方格、十字箭头、1/2/3 刻度、I/II/III/IV、四组折线与 12 个数据点齐全；`NaN` / `undefined` / 第三方嵌入标签命中 **0**；首屏门卡缩略图与详情页同源同刻度 |
| 论坛 | 1440px 截图确认 3 列瀑布流、8 张卡片；DOM 诊断 `COLS=3 / N=8 / LEFT=209,548,887` |
| 响应式 | CDP 扫描 320 / 375 / 420 / 520 / 600 / 700 / 768 / 900 / 1024 / 1100 / 1440 全部 `scrollWidth == innerWidth`，无横向溢出 |
| 降级 | `--force-prefers-reduced-motion=reduce` 实测 `REDUCED=true`、`anim-ok` 未添加 |
| 密钥 | `src/` 全文扫描无 `sk-` 明文 |
| 临时产物 | `_p_*.html` 预览副本全部删除，`src/` 只保留正式文件 |

### 17.7 新增与修改文件

**修改**：`src/index.html`（`drawTrail()` / `.coord-gate` / `quadrantHtml()` 接入口 / 导航 `data-navx="map"` / `viewTitle()` / `human3Reminder()`）、`src/visual.css`（§20 v10 重排版 + 两处响应式修正 + `svg.h3q` / `.quad-mini`）、`src/ambient.js`（`spawnMeteor()`）、`src/human3.js`（`#/map` 改为主站内自评视图 + `quadrantHtml()` 出图）、`database/schema.sql`（23 → 19 张表）、`README.md`、`REFACTOR.md`、`docs/HUMAN3_DESIGN.md`

**未动**：`server/*`、云端 PostgreSQL 表与 RLS、`src/particles.js`、`src/water.js`、`src/cloud.config.js`、`database/views.sql`（生涯域 8 张专业表与 6 个视图按课程设计口径保留）

**回退**：删 `visual.css` §20 即回到 v1.4 视觉层；`human3.js` 用 Git 上一版 `pushFrame` 实现并恢复上一版实验页目录，可回到嵌入式出图（该目录与启动脚本已移入回收站，可还原）；`schema.sql` 用 Git 上一版可恢复被精简的 4 张表。论坛逻辑与数据边界不受影响。
*（内容由AI生成，仅供参考）*
