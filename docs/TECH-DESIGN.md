# 技术设计：信息概览页面（v1.2.0）

> 版本：v1.2.0 迭代 · 关联：`docs/PRD.md`、`docs/product-definition.md`
> 架构决策记录：本设计经架构评审子 Agent 交叉审查（见 §6）

## 1. 方案概述（大白话）

我们要给插件加一个**「信息概览」页面**，用户从两个地方都能进：设置页的左侧导航、对话页顶部的标签栏。进的是同一个页面，看到同一份数据。

实现方式完全不引入新技术：
- **数据**：插件一直把每一笔 AI 调用的记录（用了哪个模型、多少 token）存在本地文件里。我们只需要在插件内部加几个"读取接口"，把数据整理好传给页面。
- **页面**：用插件现有的 React 技术写一个页面组件（花钱总览、记录列表、模型统计、趋势图），注册到 DSH 的两个插槽上（设置页 + 顶部标签栏）。
- **复用一切**：花费计算、模型显示名、服务商显示名、币种判断——全部复用信息栏已有的逻辑，保证页面数字和信息栏完全一致。

## 2. 技术选型

| 项 | 选择 | 为什么 |
|---|---|---|
| 页面框架 | React（现有 bundle 内） | 插件 client 已用 React，零新依赖 |
| 图表 | 纯 CSS 柱状图 | 不引图表库（echarts/chart.js 体积大、主题难统一）；7/30 天柱状图 CSS 足够 |
| 数据接口 | host 端新增 RPC（webServer HTTP） | 与现有 12 个 RPC 同一通道、同一防护，无需新机制 |
| 状态管理 | React useState + 30s 轮询 | 与信息栏节奏一致，简单可靠 |
| 持久化 | 复用现有 `usage-records.json` | 数据已落盘，页面只读不改写，零迁移 |

### 为什么不做
- **不引入图表库**：30 个柱子用 CSS flex 即可，引入 100KB+ 依赖不值。
- **不新建数据文件**：现有记录文件已有全部字段（时间/模型/服务商/input/cacheRead/cacheWrite/output），费用可实时计算，无需新存储。
- **不做后端服务**：这是本地插件，DSH 就是宿主，webServer 即后端。

## 3. 数据流与接口契约

### 3.1 现有可复用 RPC（页面直接调）
| RPC | 提供 | 用途 |
|---|---|---|
| `getUsageSummary({sessionId})` | 今日/本月/近30天/累计花费、会话数 | 花费总览卡 |
| `getSpendTrend({days: 7\|30})` | 每日花费点 + 按模型花费 | 趋势图 + 模型统计 |
| `getPricing()` | 当前模型/服务商显示名、定价模式 | 显示模型名 |

### 3.2 新增 RPC（host 端）
#### `getUsageRecords({ offset?, limit? })` — 使用记录明细
- 入参：`offset`（默认 0，从最新往前数）、`limit`（默认 20，上限 100）
- 返回：
```jsonc
{
  "total": 1234,            // 记录总数
  "offset": 0,
  "limit": 20,
  "records": [              // 最新在前
    {
      "ts": 1786898466150,  // 毫秒时间戳
      "model": "deepseek-v4-flash",
      "provider": "deepseek-official",
      "modelDisplay": "DeepSeek-V4-Flash",   // 目录名 → 回退原始 id
      "providerDisplay": "DeepSeek",
      "input": 45, "cacheRead": 82944, "cacheWrite": 0, "output": 1656,
      "cost": 0.0421,       // 该笔费用（按记录时刻峰谷价计算）
      "currency": "CNY"
    }
  ]
}
```
- 纯读操作，不入 MUTATING 名单（无需同源校验拦截，只读安全）。

#### `getModelStats()` — 各模型用量统计
- 返回：
```jsonc
{
  "models": [               // 按费用降序
    {
      "model": "deepseek-v4-flash",
      "provider": "deepseek-official",
      "modelDisplay": "DeepSeek-V4-Flash",
      "count": 812,           // 调用次数
      "input": 123456, "cacheRead": 891011, "cacheWrite": 0, "output": 654321,
      "cost": 12.34, "currency": "CNY",
      "costShare": 0.87       // 占总费用比例（0~1，用于条形占比）
    }
  ],
  "totalCost": 14.18, "totalCurrency": "CNY"
}
```
- 聚合逻辑：遍历 `usageRecords`，按 `model + provider` 分组求和；`costOf` 复用现有函数；币种用 `modelCurrency`。

#### `getUsageSummary` 扩展 `monthSpend`
- 现有 `getUsageSummary` 已含 `monthSpend`（自然月，北京时区）——**确认已有**，无需扩展。页面直接复用。

### 3.3 无新增写盘
页面所有操作只读。host 端不新增任何写文件逻辑。

## 4. 页面结构与双入口

### 4.1 页面组件 `InfoOverviewPage`（client）
```
信息概览（InfoOverviewPage）
├── ① 花费总览卡（今日 / 本月 / 近30天 / 累计）—— 4 张卡
├── ② 花费趋势（7天/30天 切换，CSS 柱状图）
├── ③ 各模型用量统计（按费用降序，占比条）
└── ④ 使用记录明细（倒序列表 + 「加载更多」每批 20 条）
```
- 数据加载：进入页面 `Promise.all` 并行拉取 4 个 RPC（summary / records / modelStats / trend），加载中显示骨架/加载中，失败显示错误 + 重试。
- 刷新：30s 轮询 summary / modelStats / trend（records 只在用户"加载更多"时拉，避免列表跳动）。
- 样式：复用 `installStyles` 机制，新增 `.bi-ov-*` 前缀的独立样式块，全部用主题 token（`--dsw-alias-*`）适配深/浅色。

### 4.2 双入口注册（client apply 内）
```js
// 入口 A：设置页左侧导航
slots.register(
  { name: 'settings.section', id: 'info-overview', order: 30, label: '信息概览' },
  (props) => React.createElement(InfoOverviewPage, props)
)
// 入口 B：对话页顶部标签栏
slots.register(
  { name: 'conversation.view', id: 'info-overview', order: 30, label: '信息概览' },
  (props) => React.createElement(InfoOverviewPage, props)
)
```
- 两个入口渲染**同一个组件** → 同一份数据、同一套样式。
- id 用 `info-overview`（自己命名空间，不冲突；`settings.section` 与 `conversation.view` 各自独立命名空间）。
- label 均为「信息概览」。
- order 30：设置页排在与数据相关的 models(10) 之后、插件(15) 附近；标签栏排在 chat(0)/trajectory(10) 之后。

### 4.3 注册时机与失败容忍
- 沿用现有 apply 模式：`slots` 服务轮询等待（最多 60×300ms），注册用 `ctx.effect` 包裹，插件卸载自动清理。
- 若某 slot 在当前 DSH 版本不存在（老版本），`slots.register` 静默失败或抛错被捕获——**不影响信息栏本体**（现有 `conversation.composer.dock` 注册逻辑不动）。
- 注册用 try/catch 隔离：一个入口失败不拖垮另一个。

## 5. 边界与失败场景

| 场景 | 行为 |
|---|---|
| 无任何记录（首次安装） | 总览卡显示 ¥0.000；明细显示「暂无使用记录」；模型统计空态；趋势图空柱 |
| `usage-records.json` 损坏/缺失 | 现有 `loadUsageRecords` 已容错返回 `[]`，页面自然显示空态 |
| 未知模型（PRICING 无此模型） | `costOf` 返回 null → 记录费用显示「—」；统计按可计费项聚合 |
| 跨币种记录（CNY + USD 混用） | 沿用信息栏口径：按 `modelCurrency` 判断币种，总览卡只聚合活动币种；明细逐条显示各自币种符号 |
| RPC 失败（host 未就绪） | 页面显示错误 + 重试按钮，30s 自动重试 |
| 标签栏无会话（hero 页） | `conversation.view` 为 session 级 slot，无会话时不渲染——天然安全 |
| 记录 >3000 条 | 现有上限 3000（splice 截断），页面分页最多读到 3000 条，满足「查看最近使用」需求 |

## 6. 调研与架构评审结论（子 Agent 交叉审查）

### 6.1 业界调研结论（产品调研工程师）
主流 AI 产品（OpenAI API / Anthropic Console / OpenRouter）的用量页采用统一四层骨架：
**① 顶部 KPI 卡（总花费/周期内）→ ② 按天趋势图 → ③ 按模型分解 → ④ 明细记录**。订阅制产品（ChatGPT/Claude/Cursor）普遍缺真实花费可见性——正是本插件差异化机会。

交互与视觉要点（已纳入本设计）：
- 明细列表用**「加载更多」而非分页**：浏览型时间序列表，用户不回看跳页；默认渲染最近 20 条 + 按钮加载更多。
- 费用显示：币种符号前缀（¥/$）、2 位小数 + 千分位（¥1,234.56）；小于 ¥0.01 显示「＜¥0.01」防误导；Token 千分位。
- 纯 CSS 柱状图：容器固定高度（120–160px）、`--h` 自定义属性 + `calc()` 归一化柱高、flex 横排、圆角柱顶、hover 微交互、`title` + `aria-label` 无障碍、CSS 变量适配深浅主题。
- 布局优先级：KPI 卡 → 趋势图 → 模型统计 → 明细列表。

### 6.2 架构评审结论（主 Agent 收口交叉审查）
**结论：方案有条件通过**（问题均低危、有对策，无需改架构）。

| # | 严重度 | 问题 | 对策 |
|---|---|---|---|
| R1 | 低 | `conversation.view`（session 级）与 `settings.section`（root 级）的 owner props 不同，若组件误读 slot props 会渲染错乱 | 组件**只依赖 rpc() 与自有样式**，不读任何 slot 注入 props；两种环境均只传 React 元素；T3 验收标准锁定该约束 |
| R2 | 低 | 明细单笔费用（按记录时刻峰谷价）与信息栏"本对话花费"（按会话聚合、也按记录时刻）算法一致，但**币种**可能混用（CNY/USD 记录并存） | 沿用现有口径：明细逐条带 `currency`，前端按各自币种显示符号；总览卡只聚合活动币种（复用 `activeCurrency`）——与信息栏行为一致，不引入新规则 |
| R3 | 低 | 30s 轮询 + 明细"加载更多"并发拉取可能轻微增加 host 计算（记录 ≤3000 条，聚合为 O(n) 内存遍历，纳秒~微秒级） | 可接受；records 不参与轮询，仅用户点击时拉取；必要时 host 端缓存 modelStats 结果（本期不做，YAGNI） |
| R4 | 低 | 页面在 `conversation.view` 内嵌于会话体，若内容超长可能撑破会话滚动容器 | 页面根容器用 `overflow-y: auto` + 合理最大高度；真机验证（T9）确认 |
| R5 | 低 | 新增 RPC 未入 MUTATING 名单（只读安全）；路由需注意 body 大小上限 64KB（offset/limit 极小，无风险） | 保持只读不入 MUTATING；沿用现有 `readBody` 上限 |
| R6 | 低 | 与信息栏 30s 轮询叠加请求量（页面打开时双倍 RPC） | 页面只在激活时渲染（标签未激活不挂载组件）；请求均为本地毫秒级，可接受 |

**简化建议（已采纳）**：
- 不做 CSV 导出、不做多币种并行、不做预算配置——保持纯展示。
- 模型统计复用现有 `getSpendTrend` 的 `byModel`？**不**：`byModel` 只覆盖近 7/30 天且无 token 聚合，页面需要"全部历史"的模型维度 → 新增 `getModelStats` 是必要的最小接口，不砍。
- `getUsageRecords` 不新增筛选参数（时间/模型筛选）——首版"加载更多"足够，筛选按 PRD 非目标延后（YAGNI）。

**通过条件**：R1–R6 全部有对策且无需架构改动 → 通过。开发按 tasks.md 执行，T3/T4 验收标准已包含上述约束。

## 7. 风险与对策
| 风险 | 概率 | 对策 |
|---|---|---|
| `conversation.view` 渲染环境与 composer dock 不同（props 差异） | 中 | 组件只用 rpc + 自有样式，不依赖 slot 注入 props；静态测试 + 真机验证 |
| 页面样式与 DSH 主题冲突 | 低 | 全部用主题 token + 独立 class 前缀 `.bi-ov-*` |
| 30s 轮询与信息栏轮询叠加请求量 | 低 | 页面只在激活时渲染（标签未激活不挂载）；record 列表不轮询 |
| 明细费用与信息栏口径不一致 | 低 | 两者都调 host 端同一 `costOf`，单测锁定 |
