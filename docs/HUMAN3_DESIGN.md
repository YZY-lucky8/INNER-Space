# INNERSPACE × Human 3.0 融合详细设计

| 项 | 值 |
|---|---|
| 版本 | v1.0（**已按 P0–P3 实施**，2026-11-15） |
| 日期 | 2026-11-15 |
| 项目 | `E:\MYproject\INNERSPACE` |
| 框架 | Dan Koe《HUMAN 3.0》个人发展框架（四象限 × 三层 × 三阶段） |
| 交付范围 | 设计推演 + 前端 / 服务端 / 3D 实体化 / 迁移与统计的完整实现 |
| 实施说明 | 实现清单与验证数据见 `README.md` §16；本文保留约束核对与规则定义，作为实现依据 |
| 前置阅读 | `README.md` §14–§16、`REFACTOR.md` §3、`server/migrations/001_offline_sync.up.sql` |

---

## 0. 文档目标与不做的事

把 Human 3.0 从「一张人生检查单」变成 INNERSPACE 里一条**可落地、可复查、可离线运行**的闭环：定位卡在哪个象限 → 判断是否被别的象限拖住 → 生成最小有效剂量 → 落进已有的 7 天小实验 → 用身份证据回看 → 90 天复查。

> **实施状态（v1.0）**：用户拍板「首屏给明显入口 / 4 象限 × 3 Traits / P0–P3 一次做完」，并追加要求「根据个人数据做一个立体可视化、结合 3D 交互实验室把人生模型实体化」。P0–P3 已全部落地，3D 实体化见**附录 C**。下面「不做」的边界在实现中全部守住。

**本设计明确不做**：

- 不改动 `database/schema.sql` 的 23 张课程设计表、6 视图、8 过程、7 触发器。
- 不改变现有六步闭环（`landing → intake → diagnosis → experiment → review → evidence`）。新视图是**可选旁路**，不是必经关卡。
- 不破坏「离线优先」数据边界：`localStorage` 仍是主存储，云同步仍需用户显式开启。
- 不引入任何新的外部 CDN / 字体 / 模型请求；`file://` 双击打开仍可完整使用。

---

## 1. 框架摘要与工程化裁剪

### 1.1 原始概念

| 概念 | 内容 |
|---|---|
| 四象限 | 心智 Mind（个人·内在）/ 身体 Body（个人·外在）/ 精神 Spirit（集体·内在）/ 使命 Vocation（集体·外在） |
| 三层水平 | 1.0 从众者 / 2.0 个体者 / 3.0 整合者；「超越并包含」，不是道德高低 |
| 三阶段 | x.1 不和谐 Dissonance / x.2 不确定 Uncertainty / x.3 发现 Discovery |
| Traits | 知识 Knowledge / 经验 Experience / 技能 Skill；偏科即「胖教练」「体检报告收藏家」 |
| 核心动作 | 找瓶颈，不平均用力；症状 ≠ 病根；最小有效剂量 + 定期复查 |
| 元类型 Metatype | 四象限读数合成的参考画像；原著把它交给 AI 自适应访谈生成 |
| 假性好转 | 只有词汇升级、没有支撑能力；用「带我走一遍你每天怎么用它」类追问拆穿 |

### 1.2 工程化裁剪（**已拍板：方案 A**）

原著是散文式框架，没有可执行的评分口径。本设计采用**方案 A**：

- **12 格 = 4 象限 × 3 Traits**，每格由用户自评 `1 / 2 / 3`（1 = 几乎没动过，2 = 做过但没稳，3 = 做起来不费力）。
- 每个象限另记 `level`（1/2/3）与 `phase`（1/2/3，对应 x.1/x.2/x.3），由 3 道行为题推断，**不靠用户给自己贴层级标签**。
- 元类型由**确定性查表**生成，措辞为「参考画像」，用户可随时改，不是结论。
- 方案 B（贴近原著）：12 格 = 4 象限 × 3 层原型契合度，总分除以 12 得元类型。切换成本仅 `human3.rules.js` 的常量表与问卷文案，数据结构不变。

### 1.3 阻塞链 / 解锁链（写死为常量表，不交给 LLM）

| 类型 | 链路 | 含义 |
|---|---|---|
| 阻塞 | body → spirit | 没精力维系关系；以为自己社恐，其实只是累 |
| 阻塞 | mind → vocation | 看不出机会在哪，机会不是不存在 |
| 阻塞 | spirit → mind | 孤立让人停止成长，没人给反馈和碰撞 |
| 阻塞 | vocation → body | 付不起养生的钱 / 时间 |
| 解锁 | body → spirit | 有精力，才谈得上深层连接 |
| 解锁 | body → mind | 运动和营养直接作用于认知 |
| 解锁 | mind → vocation | 思路清晰了，才看得见适合的路 |
| 解锁 | mind → spirit | 先有自我觉察，才有真正的亲密 |
| 解锁 | vocation → body | 财务稳定，才有余力投入健康 |
| 解锁 | spirit → mind | 社群的安全感，是敢质疑信念的前提 |

---

## 2. 现状与接入约束（逐条核对过源码）

| # | 真实约束 | 出处 | 对设计的影响 |
|---|---|---|---|
| 1 | `AI_FORBIDDEN = /\d+%\|\d+分\|分以上\|评分\|焦虑\|抑郁\|量表\|筛查\|诊断报告/` | `server/src/shared/safety.js:45` | **LLM 输出不能出现评分 / 量表 / 分数**。所有读数计算必须在确定性领域层完成，不经过 LLM |
| 2 | 前端 `AI_BAN = ['焦虑','抑郁','量表','筛查','诊断','治疗']` | `src/index.html:3386` | UI 文案同样要避开这些词；改用「坐标 / 读数 / 哪一格最费劲 / 参考画像」 |
| 3 | `diagnose.service.js` 的 system 提示词已写死「不打分、不贴人格标签、不做心理或医学判断」 | `server/src/features/diagnose/diagnose.service.js:107-115` | 元类型**不能**由 LLM 生成，只能本地查表；LLM 只做「把做法写得更贴合原话」 |
| 4 | `README.md` §15 已声明「不是心理咨询 / 不做心理健康评估」 | `README.md:479-483` | 12 格读数只能呈现为**自评坐标**，禁止写成等级、诊断、健康度、百分比 |
| 5 | `assertSafe()` 在服务端复算危机信号，命中即中止且不落原文 | `server/src/shared/safety.js:35`，`sync.service.js:87-99` | 新增的自由文本字段必须补进 `assertSnapshotSafe()` 的文本收集列表，否则出现绕过口 |
| 6 | `snapshotSchema` 是 `.passthrough()` | `server/src/features/sync/sync.service.js:75-85` | 新增 `DB.human3` 顶层字段能随快照上传，无需改 schema；但仍需补 §2.5 的安全复算 |
| 7 | `sync_snapshots` 是「整包 JSON + revision」，`push` 时 `baseRevision` 冲突检测 | `001_offline_sync.up.sql:33-41`、`sync.service.js:165-205` | 评估数据天然随快照同步，**不强制**为它单独建表（见 §5.2 方案对比） |
| 8 | `DB.remind` 是 `{key: 已触发时间戳}` 的一次性提醒**标记**字典 | `src/index.html:1949-1958, 3699-3700` | **纠正前期口头方案**：90 天复查日期不能塞进 `remind`，要放 `human3.review_at`；到点弹提醒时才写 `remind` 标记防重复 |
| 9 | `assertEvidenceRules()`：证据必须绑定实验、必须来自有记录的实验、一次复盘最多 1 条 | `server/src/features/sync/sync.service.js:101+` | Human 3.0 生成的证据必须挂到真实 `experiment_id`，不能凭空造证据 |
| 10 | 路由是 `VIEWS` 映射 + `ROUTES` 白名单 + `render()` 全量重绘 | `src/index.html:1427-1440, 2398-2408` | 新视图需同时登记 4 处：`VIEWS` / `ROUTES` / `viewTitle()` / `ensureView()` |
| 11 | 视图状态存 `sessionStorage`(`kadian_state_v1`)，只持久化 `PERSIST_KEYS` 列出的键 | `src/index.html:1441-1446` | 评估草稿要落 `localStorage` 的 `DB`，**不要**放 `state`（刷新会丢） |
| 12 | 全局限流 400/15min；`/api/v1/diagnose` 单独 20/15min | `server/src/app.js:47-58`、`diagnose.routes.js:12-18` | 新接口复用同等级限流，不额外放宽 |
| 13 | `mappers.js` 对所有枚举做白名单收敛 | `server/src/features/sync/mappers.js:3-15` | 新枚举（`quadrant` 等）必须加白名单，不能把客户端值直接写进 ENUM 列 |
| 14 | 前端 `aiDiagnose()` 三级静默降级：后端不可用 → 规则引擎 | `src/index.html:1712-1713, 1766` | Human 3.0 的 AI 精修必须沿用同一降级链，不能出现硬失败弹窗 |

---

## 3. 产品定位与安全红线

**一句话**：Human 3.0 在这里是「帮用户把『我过得不好』拆成一张可以逐项处理的单子」的**定位工具**，不是测评产品。

四条红线：

1. **不做诊断**。不出现「你是 2.0」「你的心智得分 1.7」「健康度 62%」这类表述。读数只画成四象限坐标，配一句「这是你自己标的，随时可以改」。
2. **危机优先**。`assertSafe()` 必须覆盖所有新增自由文本；命中即按现有 `crisis` 视图中止，Human 3.0 的任何流程不得覆盖或延后它。
3. **AI 不打分**。评分、瓶颈、元类型全部是确定性纯函数；LLM 只被允许做「把用户原话整理成更贴合的动作」，输出沿用 `generateActions()` 的 `{t,d,why}` 三段式，并复用 `AI_FORBIDDEN` 硬校验。
4. **原文不出本机**。`free_text` / 现状描述默认只在 `localStorage`；仅当用户显式开启云同步并 push 时才进 `sync_snapshots`，与现有承诺一致。

---

## 4. 概念映射表

| Human 3.0 | INNERSPACE 现有件 | 新增件 |
|---|---|---|
| 四象限定位 | 首屏「我卡住了」、卡点描述 `sessions.free_text` | `#/map` 视图 + `DB.human3.grid` |
| 不和谐 / 不确定 / 发现 | 六步闭环的 intake → diagnosis → experiment | `phase` 推断，映射到现有阶段文案 |
| Traits 知识/经验/技能 | 五类瓶颈 `A_METHOD/B_SKILL/C_MEANING/D_CONTEXT/E_DIRECTION` | 12 格读数 + 偏科提示（只做关联建议，**不改写诊断结果**） |
| 瓶颈优先 | 规则引擎 `src/ai.local.js` 首猜 / 次猜 | `bottleneck()` 纯函数 |
| 解锁链 / 阻塞链 | 无 | `CHAINS` 常量表 |
| 最小有效剂量 | `experiments.actions`、`logs` | `makeDose()` + 一键建实验 |
| 身份证据 | `evidence`（5 类） | 复查时引导写 1 条 `energy` / `boundary` 证据 |
| 90 天复查 | `DB.remind`（一次性标记）、`logs.day_no` | `human3.review_at` + 到点写 remind 标记 |
| 元类型 | 无 | 确定性查表生成的「参考画像」，可编辑 |
| 四象限可视化 | 罗盘 CSS、`particles.js` 四形态、`hand3d.html` 手势 | P2 阶段接入，非必需 |

### 4.1 与五类瓶颈的建议关联（只读提示，不参与判定）

| 象限 | 常见关联瓶颈 | 提示文案方向 |
|---|---|---|
| mind | `C_MEANING` / `E_DIRECTION` | 「先看看是不是还没想清楚它和你有什么关系」 |
| body | `B_SKILL` / `C_MEANING` | 「连续睡不够时，很多『不想做』其实是没力气」 |
| spirit | `C_MEANING` / `D_CONTEXT` | 「没人给反馈时，一个人很容易把方向问题误读成能力问题」 |
| vocation | `A_METHOD` / `B_SKILL` / `E_DIRECTION` | 「投入在增加、回报没增加，可能只是做法没换过」 |

---

## 5. 数据模型

### 5.1 前端 `DB.human3`（`localStorage: kadian_db_v1`）

新增一个顶层字段，`loadDB()` 的兼容分支补 `d.human3 = d.human3 || defaultHuman3()`。**不新增存储键**。

```js
{
  schema: 1,                       // 数据结构版本，便于日后迁移
  current: null,                   // 当前评估 id；null = 还没做过
  assessments: [                   // 历史评估，最多保留 12 份
    {
      id: 'h3_...',                // 沿用 uid() 生成
      created_at: 1731660000000,   // 沿用 now()
      updated_at: 1731660000000,
      grid: {                      // 12 格自评，1|2|3，null = 未填
        mind:     { knowledge:2, experience:1, skill:2 },
        body:     { knowledge:3, experience:1, skill:1 },
        spirit:   { knowledge:2, experience:2, skill:1 },
        vocation: { knowledge:1, experience:1, skill:1 }
      },
      levels:  { mind:2, body:1, spirit:2, vocation:2 },   // 1|2|3，由行为题推断
      phases:  { mind:1, body:1, spirit:3, vocation:2 },   // 1|2|3 → x.1/x.2/x.3
      notes:   { mind:'', body:'', spirit:'', vocation:'' },// 每象限 3 句：现状/卡点/想要的样子
      bottleneck: 'vocation',      // 确定性推导结果，可缓存
      blocked_by: 'mind',          // 阻塞链推导；null = 无
      archetype: '...',            // 参考画像 key，确定性查表，用户可改
      dose: {                      // 最小有效剂量
        action: '晚饭后走 30 分钟',
        support_from: 'spirit',
        support: '每周约一位同学一起走一次',
        minutes: 30,
        start_at: 1731660000000,
        review_at: 1739436000000,  // +90 天
        experiment_id: 'e_...'     // 一键建实验后回填，未建则 null
      },
      status: 'draft'              // draft | report | dosed | reviewing | archived
    }
  ]
}
```

**字段约束**：
- `grid` 每格只允许 `1|2|3|null`，用 `z.union([z.literal(1),z.literal(2),z.literal(3),z.null()])` 级等价校验（前端手写校验函数，不引入新依赖）。
- `notes` 每象限 ≤ 120 字，合计 ≤ 480 字；**属于自由文本，必须纳入危机复算**（§2.5）。
- `assessments` 上限 12，超出淘汰最旧且 `status !== 'dosed'` 的草稿。
- `dose.experiment_id` 必须指向真实存在的 `DB.experiments[].id`（对应 `assertEvidenceRules` 第 1 条）。

### 5.2 服务端存储：两个方案

| | 方案 A（**推荐**）：随快照同步 | 方案 B：独立业务表 |
|---|---|---|
| 改动 | `sync.service.js` 补文本复算 + `mappers.js` 补枚举白名单 | 新增 `002_human3.up/down.sql`、`human3.repo/service/routes`、mappers 映射 |
| 表 | 复用 `sync_snapshots.snapshot` LONGTEXT | 新表 `human3_assessments` |
| 查询/统计 | 只能整包取，服务端无法按象限聚合 | 可 SQL 聚合、可做跨用户统计 |
| 冲突 | 复用现有 `revision`，天然一致 | 需自己处理 `baseRevision` 与双写一致性 |
| 隐私 | 与现有「显式开启才上传」完全一致 | 多一条写入路径，边界更复杂 |
| 适用 | 当前阶段（单机、课程设计、无统计需求） | 将来要做「同龄人象限分布」才需要 |

**实施结论（v1.0）：A 与 B 并存**。用户拍板「要服务端统计」，因此快照同步（A）继续整包保存 `DB.human3`，独立表（B）只接收显式「加入匿名分布」的结构化坐标、不做双写一致性耦合。实际 DDL 已落地为 `server/migrations/002_human3.up.sql`（约束名 `fk_h3_assess_user_v2`），下列草案供对照：

```sql
-- 002_human3.up.sql（草案，约束名须全库唯一，参考 fk_sync_snap_user 的踩坑）
CREATE TABLE IF NOT EXISTS human3_assessments (
    id            VARCHAR(64)  PRIMARY KEY COMMENT '前端 uid，幂等 upsert',
    user_id       INT          NOT NULL,
    schema_ver    TINYINT UNSIGNED NOT NULL DEFAULT 1,
    grid          JSON         NOT NULL,
    levels        JSON         NOT NULL,
    phases        JSON         NOT NULL,
    bottleneck    ENUM('mind','body','spirit','vocation') NULL,
    blocked_by    ENUM('mind','body','spirit','vocation') NULL,
    archetype_key VARCHAR(32)  NULL,
    dose          JSON         NULL,
    status        ENUM('draft','report','dosed','reviewing','archived') NOT NULL DEFAULT 'draft',
    review_at     DATETIME     NULL,
    created_at    DATETIME     NOT NULL,
    updated_at    DATETIME     NOT NULL,
    INDEX idx_h3_user_review (user_id, review_at),
    CONSTRAINT fk_h3_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Human 3.0 自评坐标（仅显式开启同步的用户有记录）';
```

> 自由文本 `notes` 依 §3 红线**不上服务端表**；方案 B 下也只存 `localStorage`，避免扩大敏感面。

### 5.3 同步映射与安全补丁（方案 A 必做）

`snapshotSchema` 已 `.passthrough()`，`DB.human3` 会随快照原样上传/还原，字段零丢失。但必须补三处：

1. `sync.service.js → assertSnapshotSafe()`：把 `snap.human3.assessments[].notes.*` 与 `dose.action` / `dose.support` 追加进 `texts[]`，逐条 `assertSafe(t, 'human3')`。
2. `mappers.js → ENUMS`：新增 `quadrant: ['mind','body','spirit','vocation']`、`phase: ['1','2','3']`、`h3Status: [...]`，所有值走 `enumOrNull()`。
3. `sync.service.js` 加 `assertHuman3Rules()`：校验 `grid` 值域、`dose.experiment_id` 必须存在于 `snap.experiments`、`assessments.length <= 12`；失败抛类型化错误，不落库。

---

## 6. 领域规则（确定性纯函数，零 LLM）

新文件 `server/src/features/human3/human3.rules.js`（**纯函数、无 IO、可单测**），前端 `src/human3.js` 复用同一份逻辑的 ES5 等价实现（项目前端是单文件 ES5 风格，不引入打包器）。

### 6.1 常量

```js
export const QUADRANTS = ['mind','body','spirit','vocation'];
export const TRAITS    = ['knowledge','experience','skill'];
export const LEVELS    = { 1:'从众', 2:'个体', 3:'整合' };   // 仅用于内部推导，不直接展示给用户
export const PHASES    = { 1:'不和谐', 2:'不确定', 3:'发现' };
export const BLOCKS = { body:'spirit', mind:'vocation', spirit:'mind', vocation:'body' };
export const UNLOCKS = [
  ['body','spirit'], ['body','mind'], ['mind','vocation'],
  ['mind','spirit'], ['vocation','body'], ['spirit','mind']
];
```

### 6.2 `readGrid(grid)` → 象限读数

```js
function readGrid(grid) {
  const out = {};
  for (const q of QUADRANTS) {
    const cells = TRAITS.map(t => grid?.[q]?.[t]).filter(v => v === 1 || v === 2 || v === 3);
    out[q] = cells.length === 3 ? (cells[0] + cells[1] + cells[2]) / 3 : null;
  }
  return out;                 // 缺失格子不猜测、不补零
}
```
只用于排序与图形长度，**不向用户显示数字**（§3 红线）。

### 6.3 `bottleneck(grid)` → 最低象限

取 `readGrid()` 中最小值；并列时按 `['body','mind','spirit','vocation']` 的固定优先级（先解决最基础的身体条件，与框架「身体低堵精神」一致）。全空返回 `null`，UI 走「还没标完」空态。

### 6.4 `blockedBy(grid, target)` → 病根象限

1. 查 `BLOCKS` 反查：若存在 `src` 使 `BLOCKS[src] === target` 且 `readGrid()[src] < readGrid()[target] - 0.34`（至少差一格），返回 `src`。
2. 若无，查 `UNLOCKS` 中指向 `target` 的链路，取读数最高者作为「可借力的象限」，只用于生成支撑动作，不覆盖 `blockedBy`。
3. 两者都返回 `{ blockedBy, supportFrom, chainText }`，`chainText` 用 §1.3 的中文常量表，不现编。

### 6.5 `inferPhase(answers)` → x.1 / x.2 / x.3

三道行为题（问事实不问态度）：

| 题 | 1 → x.1 | 2 → x.2 | 3 → x.3 |
|---|---|---|---|
| 最近三个月，这一项你实际做过什么 | 想改但没动 | 试过一两次，没连起来 | 有在持续做，且知道什么管用 |
| 遇到卡住时你通常 | 反复想 / 反复搜 | 换过做法，还在试 | 有一套自己的处理顺序 |
| 这一项现在最像哪种状态 | 说不清哪里不对，就是烦 | 方向有了，方法还没稳 | 基本顺了，在带别人 / 往外扩 |

取三题众数；平票取较低阶段（宁可判早，不判早熟），对应框架对「假性好转」的警惕。

### 6.6 `traitBalance(grid, q)` → 偏科提示

`knowledge` 高而 `experience/skill` 低 → 「知道很多但没怎么用过」；`experience` 高而 `knowledge` 低 → 「做过不少，但说不清什么时候有效」。只给一句描述 + 一个追问（「带我走一遍你每天怎么用它」），**不给改进评分**。

### 6.7 `makeDose({grid, phases, notes})` → 最小有效剂量

确定性模板 + 用户输入拼装，输出须满足：

- 动词开头，含时间 / 次数 / 交付物之一；
- 每天 15–60 分钟，24 小时内能完成第一步；
- 可连续做 90 天（「晚饭后走 30 分钟」✅，「我决定开始健身」❌）；
- 附带一个来自 `supportFrom` 象限的支撑动作；
- `review_at = start_at + 90 * 86400000`。

模板按 `bottleneck × phase` 查表（4 × 3 = 12 条中文短句），`notes` 里的用户原话只做填空，不做语义生成。

### 6.8 `archetype(grid, levels)` → 参考画像

`levels` 四元组查 81 格以内的常量表，返回 `{ key, label, caveat }`；`caveat` 固定为「这是你自己标的坐标，不是结论，随时可以改」。**禁止**由 LLM 生成或输出人格标签。

---

## 7. 接口设计

### 7.1 默认路径：纯本地，零网络

`src/human3.js` 直接读写 `DB.human3`，调用 §6 的规则函数，渲染 `#/map`。**不发任何请求**，与 `file://` 离线承诺一致。

### 7.2 可选：`POST /api/v1/human3/actions`（复用现有 AI 代理）

只做一件事：把 `dose.action` 按用户原话改写得更贴合，输出格式与 `/api/v1/diagnose/actions` 完全一致。

```js
// zod（沿用 diagnose.routes.js 风格）
const human3ActionsSchema = z.object({
  free_text:   z.string().max(1000).optional().default(''),   // notes 拼接，≤480 字
  bottleneck:  z.enum(['mind','body','spirit','vocation']),
  phase:       z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dose:        z.string().max(120),
  support:     z.string().max(120).optional().default(''),
  actions:     z.array(z.string().max(200)).max(3).optional().default([]),
});
```

- 路由：`rateLimit` 20/15min（与 diagnose 同档）→ `validateBody` → `assertSafe(free_text, 'human3')` → `diagnoseService.generateActions()` 的同一套 `callLLM` / `parseJsonLoose` / 双预算重试。
- **不新增 LLM 提示词里的打分层**：system 模板沿用「只给做法，不判断、不评价、不打分、不贴标签」。
- 输出硬校验：固定 3 条 `{t,d,why}`，逐条过 `AI_FORBIDDEN`，`t≤12` / `d≤40` / `why≤24` 字。
- 失败一律 `ServiceUnavailableError('AI_DISABLED'|'AI_DEGRADED:*')`，前端静默回落到 `makeDose()` 的原始模板，不弹错。

### 7.3 统一契约

沿用现有 `{ ok:true, data }` / `{ ok:false, error:{code,message,details} }` 与 `requestId`。错误码：

| code | 触发 | 前端行为 |
|---|---|---|
| `AI_DISABLED` | 未配置 `LLM_*` | 静默用规则模板 |
| `AI_DEGRADED:*` | 超时 / schema 失败 / 上游错 | 静默用规则模板 |
| `SAFETY_BLOCKED` | 危机信号命中 | 中止，转 `crisis` 视图（与现有一致） |
| `VALIDATION_FAILED` | grid 值域 / 数量越界 | 提示「这一格还没标完」 |
| `H3_CONFLICT` | 仅方案 B：revision 落后 | 提示重新拉取，不覆盖 |

---

## 8. 交互与状态机

### 8.1 接入清单（4 处必改 + 2 处可选）

| 位置 | 改动 |
|---|---|
| `VIEWS` (`index.html:1427`) | 加 `map: renderHuman3Map` |
| `ROUTES` (`index.html:1440`) | 加 `map:1` |
| `viewTitle()` (`index.html:2409`) | 加 `map:'四象限坐标'` |
| `ensureView()` (`index.html:1465`) | **不做数据守卫**：允许空态直接进入（现有约定） |
| 导航 `navPaint()` | 可选：加「人生坐标」入口，放在「经验分享」旁 |
| 首屏 `renderLanding()` | 可选：在「我卡住了 →」下方加一条次要入口「先看看卡在哪一块」 |

### 8.2 状态机

```
        ┌───────────────── 重新标一次 ─────────────────┐
        ▼                                              │
   [idle] ──开始──▶ [assessing] ──12格标完──▶ [report] │
                         │                        │    │
                         │ 中断刷新               │ 确认
                         ▼                        ▼    │
                    (草稿落 DB)              [dosed] ──┘
                                               │ 一键建实验
                                               ▼
                                    现有 experiment / review
                                               │ 90 天后
                                               ▼
                                        [reviewing] ── 归档 ─▶ [archived]
```

- `assessing` 每格变化即 `saveDB()`（沿用现有 150ms 节流思路，避免每帧写盘）。
- 任何状态都允许「退出」，草稿不丢。
- `dosed` 时 `dose.experiment_id` 必须回填真实实验 id；用户取消建实验则该字段保持 `null`，不伪造证据。
- 复查到点：读 `human3.review_at`，若 `now() >= review_at` 且 `!DB.remind['h3_' + id + '_r90']`，弹一次提示并写标记（**这才是 `remind` 的正确用法**）。

### 8.3 UI 结构（沿用 v7 深绿玻璃设计语言）

1. **罗盘区**：四象限圆形坐标，长度映射 `readGrid()`（不显示数字），复用 `.compass` 与 `particles.js` 的四形态配色。
2. **12 格自评**：每象限一张玻璃卡，3 个 Trait 各 3 档选择；卡内 3 行短文本（现状 / 卡点 / 想要的样子）。
3. **坐标报告**：一句话瓶颈 + 一句阻塞链 + 一句偏科追问 + 参考画像（带可改按钮）。**无总分、无百分比、无等级条**。
4. **最小有效剂量**：动作 + 支撑动作 + 复查日期 + 「放进这周的小实验」按钮。
5. **空态 / 降级**：未标完显示「还差 N 格」；`prefers-reduced-motion` 下罗盘静态。

### 8.4 文案禁用词表（前端 + 服务端共用）

`评分 / 分数 / 得分 / 等级 / 量表 / 筛查 / 诊断 / 治疗 / 焦虑 / 抑郁 / 健康度 / % / 你是 X 型人`

替换词：`坐标 / 读数 / 这一格 / 更费劲 / 参考画像 / 你自己标的`。

---

## 9. 提示词模板设计（服务端，Key 不进浏览器）

**位置**：`server/src/features/human3/human3.prompt.js`，只导出模板字符串，不含密钥、不含用户输入。

```
[system]
你在帮一个在校学生把「这一周打算做的一件小事」写得更贴合他自己说的处境。
规则：
- 只给做法，不判断、不评价、不打分、不贴标签，不做任何心理或医学类判断；
- 不使用百分比、分数、等级、量表、筛查、诊断等词；
- 每条以动词开头，必须含时间、次数或交付物，24 小时内能做完第一步；
- 只输出一个 JSON 数组，不要解释、不要代码块标记；
- 固定 3 个元素：{"t":"12字内的做法名","d":"40字内的具体做法","why":"24字内，说明为什么贴合这个人当下的处境"}。

[user]
TA 自己写的现状（原话）：{{free_text}}
最费劲的那一块：{{bottleneck_label}}
当前阶段：{{phase_label}}
规则引擎给的最小动作：{{dose}}
从另一块借来的支撑动作：{{support}}
现有这一周的安排，供参考、可以整体替换：{{actions}}
```

**硬校验链**（复用 `diagnose.service.js` 现有实现，不另造）：

1. `parseJsonLoose()` → 数组且长度 3；
2. 每项字段截断到 `t≤12 / d≤40 / why≤24`；
3. 每项 `AI_FORBIDDEN.test()` 命中即整批作废；
4. `assertSafe()` 已在入口对用户文本做过；**输出不再回读用户自由文本**；
5. 两次重试 + `[8000, 1500]` 双预算（思考型模型可能先耗尽预算）；
6. 任何失败 → `aiUnavailable('AI_DEGRADED:human3')` → 前端静默回落规则模板。

**禁止**：把 12 格读数、`levels`、元类型 key 拼进 user 消息让 LLM「解读」——那等于绕过 §3 红线做测评。LLM 只看到用户原话与一句已经确定好的象限/阶段标签。

---

## 10. 安全、隐私与合规清单

- [ ] `assertSnapshotSafe()` 覆盖 `notes.*` / `dose.action` / `dose.support`。
- [ ] 所有新增写库入口先 `assertSafe()`；命中不落原文、不进日志，只记 channel + scope。
- [ ] `logger` 沿用现有脱敏；新字段不打印 `free_text` / `notes`。
- [ ] 默认零上传；云同步面板文案同步说明「四象限坐标会随快照一起上传」。
- [ ] `README.md` §15 免责声明追加一句：「Human 3.0 坐标是自评工具，不构成心理或医学评估」。
- [ ] `file://` 下不调用任何后端接口，`human3` 全流程仍可用。
- [ ] CSP 维持现状关闭（`app.js:29-34` 已注明单文件内联脚本限制），不因此新增外链。

---

## 11. 性能与降级

| 场景 | 行为 |
|---|---|
| 无后端 / 未配置 LLM | 纯本地规则引擎，全流程可用，无弹窗 |
| LLM 超时 / 输出不合规 | 静默回落 `makeDose()` 模板 |
| `prefers-reduced-motion` | 罗盘静态、无入场动画，功能不变 |
| `file://` 打开 | 不发请求、不加载新资源 |
| 页面隐藏 | 不新增常驻 rAF；罗盘只在数据变化时重绘 |
| 数据增长 | `assessments` 硬上限 12，快照体积增量 < 8 KB |

---

## 12. 测试计划

**新增单测** `server/tests/human3.test.mjs`（沿用 `node:test`，不引新依赖）：

| 用例 | 断言 |
|---|---|
| `readGrid` 缺格 | 返回 `null`，不补零、不猜测 |
| `bottleneck` 并列 | 固定优先级 `body > mind > spirit > vocation` |
| `blockedBy` 阈值 | 差值 < 0.34 不判阻塞；命中时返回正确常量文案 |
| `inferPhase` 平票 | 取较低阶段（防假性好转） |
| `makeDose` | 24h 内可完成、`review_at = start + 90d`、支撑象限 ≠ 瓶颈象限 |
| `archetype` | 同一输入恒定输出；不含禁用词 |
| AI 输出校验 | 含「评分」「量表」「%」的候选整批作废 |
| 危机复算 | `notes` 里出现危机词时 `assertSafe` 抛 `SafetyBlockedError` 且不落原文 |
| 快照兼容 | `snapshotSchema` 接受带 `human3` 的快照并原样保留（passthrough） |

**回归命令**（v8 实施后基线：语法 38/38、单测 27/27、冒烟 34/34）：

```bash
node server/scripts/check-syntax.mjs
npm --prefix server test
npm --prefix server run smoke
```

**浏览器验收**：1440 / 768 / 375 三档；`file://` 与 `http://localhost:8787` 各跑一遍；登录态与非登录态；`prefers-reduced-motion`；开启云同步后 push → pull 字段零丢失；危机词输入必转 `crisis` 视图。

---

## 13. 分期实施

| 期 | 内容 | 改动文件 | 是否动数据库 |
|---|---|---|---|
| **P0 最小切片**（推荐先做） | `src/human3.js` 规则函数 + `#/map` 视图 + `DB.human3`；不建表、不加接口 | `src/index.html`（VIEWS/ROUTES/viewTitle/loadDB/renderLanding）、新增 `src/human3.js`、`src/visual.css` 追加样式 | 否 |
| **P1 服务端** | `features/human3/` 规则模块与提示词、`POST /api/v1/human3/actions`、`assertSnapshotSafe` 补丁、`mappers.js` 白名单、单测 | 新增 4 个 server 文件 + 改 `app.js` / `sync.service.js` / `mappers.js` | 否（走方案 A） |
| **P2 可视化** | 四象限罗盘接 `particles.js` 四形态；`hand3d.html` 用手势切换象限 | `src/particles.js`、`src/lab/hand3d.html` | 否 |
| **P3（按需）** | 独立表 `002_human3` + 跨用户象限分布统计 | `server/migrations/002_*`、`human3.repo/service/routes` | 是 |

**实施状态**：P0 / P1 / P2 / P3 **全部完成**，且 P2 从原计划的「罗盘接粒子形态」升级为完整的 3D 实体化场景（附录 C）。另补了三处设计稿未细化的工程处理：① `diagnose.service.js` 导出 `callLLM` / `parseJsonLoose` / `aiUnavailable` 供 human3 复用，避免第二条密钥链路；② `sync.service.js` 的 `clear()` 在关闭同步时一并清掉匿名统计记录（**不在** `deleteBusinessData` 里删，否则每次 push 都会把统计抹掉）；③ `human3d.html` 在后台标签页停帧时改尺寸会强制补渲染一帧。

**回退**：P0 只需删 `#/map` 的 3 处登记与 `src/human3.js` 引入；P1 删路由挂载即可。`DB.human3` 是附加字段，删除后 `loadDB()` 兼容分支不报错，旧数据不受影响。

---

## 14. 拍板结论（v1.0）

| # | 结论 | 实现落点 |
|---|---|---|
| 1 | **方案 A：4 象限 × 3 Traits** | `src/human3.js` / `human3.rules.js` 的 `readGrid()`；12 格问卷文案见附录 A |
| 2 | **首屏给明显入口** | 主 CTA 右侧「人生坐标 · 3D 模型 ↗」+ hero 下方立体柱预览卡 + 导航「人生坐标」；六步闭环仍是主路径，`#/map` 是可选旁路 |
| 3 | **两级复查** | `dose.check_at = start + 7d`、`dose.review_at = start + 90d`；到点在首屏弹一次提醒，用 `DB.remind['h3_<id>_d7' / '_r90']` 防重复 |
| 4 | **要服务端统计** | 方案 A（快照同步）与方案 B（独立表）**并存**：快照仍整包保存 `DB.human3`，独立表 `human3_assessments` 只收结构化坐标、仅在显式「加入匿名分布」时写入，样本 < 5 不展示 |

**追加需求**（原设计未覆盖）：把个人数据做成**立体可视化**，结合 3D 交互实验室「将人生模型实体化」→ 见附录 C。

---

## 附录 A · 12 格问卷题干（P0 文案草案）

每个象限一张卡，三个 Trait 各问一句（1 / 2 / 3 三档，档位描述见 §1.2）：

| Trait | 问题 | 档 1 | 档 2 | 档 3 |
|---|---|---|---|---|
| 知识 | 这一块「是怎么回事」，你说得清吗 | 基本说不清 | 能说个大概 | 能讲给别人听 |
| 经验 | 最近三个月真的动手做过吗 | 没怎么动过 | 试过一两次 | 一直在做 |
| 技能 | 做起来费不费劲 | 每次都要重新想 | 顺的时候还行 | 基本不费力 |

卡下三行短输入：`现在是什么样` / `最不满意什么` / `变好了会怎样`（各 ≤ 40 字，合计 ≤ 120 字）。

## 附录 B · 文件改动清单（P0 + P1）

**新增**
```
docs/HUMAN3_DESIGN.md              （本文档）
src/human3.js                      前端规则 + 视图渲染（ES5，无依赖）
server/src/features/human3/human3.rules.js     纯函数规则
server/src/features/human3/human3.prompt.js    提示词模板
server/src/features/human3/human3.routes.js    可选 actions 接口
server/src/features/human3/human3.service.js   复用 diagnoseService 的 LLM 链路
server/tests/human3.test.mjs       单测
```

**修改**
```
src/index.html      VIEWS / ROUTES / viewTitle / loadDB / renderLanding / ensureView（可选）
src/visual.css      §17 之前追加四象限罗盘与玻璃卡样式（实际落在 §19）
src/api.js          human3.actions() 封装（复用 request / 401 refresh / 离线提示）
server/src/app.js   use(human3Routes)
server/src/features/sync/sync.service.js   assertSnapshotSafe + assertHuman3Rules
server/src/features/sync/mappers.js        ENUMS 白名单
README.md           §15 补免责；新增 §16 完整实现与验证
```

P2 的 3D 实体化与 P3 的迁移 / 统计文件清单见 `README.md` §16.6。

---

---

## 附录 C · 3D 实体化人生模型（v1.0 追加实现）

用户追加要求：「通过个人数据，针对四个象限设计一个立体可视化图像，结合 3D 交互实验室，将用户的人生模型实体化」。原 §4 里「四象限可视化」只列为 P2 可选接粒子形态，这里升级为独立场景。

**文件**：`src/lab/human3d.html`（普通 script + 本地 `vendor/three.min.js`，`file://` 可用）；`src/lab/hand3d.html` 顶栏加互链；`src/index.html` 的 `#/map` 用 iframe 嵌入 `?embed=1`。

**数据 → 几何的映射**（全部只画体量，不显示数字）：

| 数据 | 立体表现 |
|---|---|
| 每格 1 / 2 / 3 | 该段六棱柱的高度 `0.24 + v*0.31`、透明度、自发光强度 |
| 未标的格 | 高度 0.12、透明度 0.10 的「虚位」线框段 |
| 四象限 | 十字方位的四座塔，各有稳定色（薄荷 / 青 / 冷蓝 / 暖金） |
| `bottleneck` | 基座下沉、扩散一圈暗红水波环、基座环亮度降低 |
| `blocked_by` / `support_from` | 红 / 暖金贝塞尔弧线 + 沿弧线跑动的光点 |
| 三格合计 | 中心到该塔「光桥」的亮度 |
| 数据变化 | 逐帧 lerp 到新高度，不重建几何体、不重载 iframe |

**交互**：拖拽旋转、滚轮缩放、射线拾取聚焦（HUD 显示该象限三格档位文字）、键盘 1–4 / 0 / 空格 / R、自动缓慢旋转；`http://` 下复用 `vendor/vision_bundle.mjs` + `hand_landmarker.task` 的同一套手势（掌心转视角、开合缩放），`file://` 自动跳过。

**数据通道**：iframe 发 `h3:request-data` → 主站 `src/human3.js` 回推 `h3:data`（`model()` 只含 12 格 / 阶段 / 瓶颈 / 支撑，不含 `notes` 自由文本）；iframe **不回写**主站。独立打开时读 `localStorage` 的 `DB.human3`，都没有则显示「示例坐标」并给出「去标 →」。

**降级**：WebGL 不可用 → 页面内 CSS 平面柱状视图；`prefers-reduced-motion` 静止；后台标签页 `visibilitychange` 停帧时，`onResize` 会强制补渲染一帧避免空缓冲；窄屏相机距离随 iframe 宽度自适应（`<420px` 拉远到 9.8，保证四座塔都进画面）。

**验证**：无头 Chrome 实测 `THREE=object` / `webgl2:true` / 四塔出图 / 聚焦「使命」/ 1440 与 390 两档 / iframe canvas 从 `940×430` 自适应到 `318×330` / JS 运行时异常 0。

---

*v1.0：设计稿已全部落地（P0–P3 + 附录 C）。实现清单、验证数据与回退步骤见 `README.md` §16。*
