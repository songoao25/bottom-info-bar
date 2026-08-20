# 代码审计报告 — dsh-bottom-info-bar v1.3.0（深度审计）

- 审计日期：2026-08-20
- 审计对象：
  1. `plugin/src/host.js`（1251 行，核心）
  2. `plugin/src/client-bundle.js`（564 行）
  3. `plugin/scripts/build.mjs`（32 行）
  4. `tests/run-all.mjs` 及 `tests/` 全部 7 个测试文件
- 审计方式：只读精读 + grep 核实调用关系/常量使用；未修改任何代码，未提交 git。
- 基线：v1.3.0 已回归"原生简洁"（移除 v1.2.x 信息概览页），记账/余额/订阅/峰谷价保留。

---

## 摘要：总体健康度 = 良好（中上）

核心纯逻辑层（双模式解析、Codex/OpenCode Go 响应解析、峰谷判定、记账聚合、同源防护、原子落盘 tmp+rename）实现严谨、防御充分、注释多为"为什么"，且单测对纯函数的覆盖相当扎实（test-dual-mode / test-spend-accounting / test-display-name 用 extractFn 从正式源码提取函数验证，思路很好）。

主要风险集中在三处，均与 v1.3.0 回归/长期演进有关：

1. **客户端失败处理原子性不足**（任一 RPC 失败整栏空白 / 挂起即永久"加载中"）——高
2. **记账数值未清洗**（单条 NaN/Infinity usage 污染全部花费汇总，并落盘损坏记录）——高
3. **v1.3.0 移除概览页后遗留大量死 RPC / 死计算 / 死字段**（约 1/3 host 逻辑不再被客户端消费，且测试护栏锁死了清理）——中低

另有余额刷新 seq 竞态（1 处漏网）、3000 条截断静默失真、llm/stream 错误吞噬、跨服务商余额/花费错配等中等问题，详见缺陷清单。

---

## 一、缺陷清单

| 严重度 | 位置（文件:行号） | 问题 | 影响 | 建议修复 |
|---|---|---|---|---|
| 高 | client-bundle.js:22-39, 160-175, 491-492 | `load()` 用 `Promise.all` 聚合 5 个 RPC：任一失败则整次失败；`rpc()` 无 AbortSignal 超时/中止；失败后 `state.fatal` 分支只渲染"加载失败"，把 `setState` 里保留的旧数据（balance/pricing/usage）全部丢弃 | 任一端点瞬断（宿主重启、网络抖动）→ 整条信息栏变"加载失败"；端点挂起 → 永久"加载中…"（最长被 host 15s 超时兜底，宿主卡死则无限）；30s 主轮询与 2s 变更轮询并发时，旧响应可覆盖新响应 | ① `rpc()` 加 `AbortSignal.timeout(20000)` 与组件卸载时 abort；② 用 `Promise.allSettled` 逐端点容错，失败端点保留旧值并仅在对应区块打错误标记；③ `fatal` 分支改为"渲染旧数据 + 顶部/角落错误提示"，不要整栏降级 |
| 高 | host.js:713-717, 201-205, 750-761 | `recordUsage` 对 usage 数值零清洗：`uncachedInputTokens != null` 对 `NaN` 恒真（NaN/Infinity/负值/超大值直通）；`loadUsageRecords` 的 `typeof x === 'number'` 挡不住 NaN/Infinity；`costOf` 的 `c != null` 对 NaN 恒真 → NaN 逐层累加进全部汇总 | 上游一旦发出异常 usage 块：本对话显示 `¥NaN`、今天/近一月/全部显示 `—`，全部金额失真；NaN 记录经 `JSON.stringify` 落盘为 `null`，重启后被 loadUsageRecords 静默丢弃（内存态污染持续到重启） | `recordUsage` 对 input/cacheRead/cacheWrite/output 统一 `Number.isFinite(x) && x >= 0 ? x : 0` 清洗；`loadUsageRecords` 过滤加 `Number.isFinite` 与 `>=0` 校验；`costOf` 对结果做 isFinite 检查后再返回 |
| 中 | host.js:316-323 | 余额刷新 seq 防覆盖有 1 处漏网：credentials 异常（:317）与未配置 key（:321）两条路径**无 `balanceSeq[pid] === seq` guard**，且直接写 `data:null, fetchedAt:null` 清空快照；与 :331/:337/:342 的"失败保留旧快照"策略不一致 | 竞态窗口（60s interval + 启动刷新/RPC 触发并存）内，慢请求的凭据失败可覆盖新快照；无并发时，一次瞬断的凭据解析失败也会把好数据清空，违反注释声称的"失败保留上次快照" | 两条路径补 seq guard；失败统一走"保留旧 data/fetchedAt、仅换 error"（与订阅侧 `mergeSubscriptionResult` 一致）；若 no-key 意图是"显示未配置"引导，则至少补注释说明策略差异 |
| 中 | host.js:719 | 3000 条截断：`splice(0, length-3000)` 静默丢弃最旧记录，"全部花费"/"近一月"在超量后失真且无任何提示 | 高频使用（子代理工作流）1~2 周即可触顶，之后"全部花费"是"最近 3000 条的花费"，与文案承诺不符（静默数据丢失） | 提高上限并记录截断日志；或引入按月/按会话滚动汇总持久化（保留累计值）；至少 README 注明上限 |
| 中 | host.js:723-730 | `llm/stream` 中间件在 `await next()` 失败时 catch 后 `return`（吞掉异常），不 rethrow | 若 DSH 框架按 waterfall 语义组合，本中间件会把上游流创建失败"消化"成空流：对话表现为模型无响应/空输出而非错误提示，问题难排查 | 日志后 `throw err` 保持错误传播；仅跳过记账逻辑 |
| 中 | host.js:1094-1096, 651-677, 837-842（联动 client-bundle.js:392-394） | 余额与花费锚定 `config.activeProvider`（恒为 deepseek），而非活跃模型的 provider：活跃模型为 gpt-4o 时余额显示 DeepSeek ¥，今天/近一月/全部因币种过滤（CNY≠USD）显示 ¥0.000，本对话却显示 $——跨服务商显示错配 | OpenAI 用户看到"余额 ¥xxx + 花费 ¥0.000"的矛盾画面；openai 估算余额分支（PROVIDERS.openai）实际永不被展示 | 余额/花费币种锚定 `modelSelection().provider`；活跃 provider 无余额 API 时隐藏余额区块或明确显示"估算"；至少补注释说明当前设计意图 |
| 低 | host.js:1210 | `decodeURIComponent` 对畸形路径（如孤立 `%`）抛 URIError → 落入 500 | 非法请求返回 500（应 400），语义不准 | try/catch 包住，畸形 → 400 |
| 低 | client-bundle.js:186-197 | 2s `getBillingMode` 轮询与 30s 主轮询并发无请求序号，旧 load 的 `setState` 可能晚于新 load 到达并覆盖 | 切换模型后短暂显示旧数据（最长 30s，被下一轮刷新纠正）；概率低 | load 加单调请求序号，仅最新序号可写 state（host 已用同一模式，client 未用） |
| 低 | host.js:107 | Codex `reset_at` 硬编码按秒 `×1000`（OpenCode 侧 `normalizeResetAt` 已兼容秒/毫秒/ISO） | 若 wham 接口某天改毫秒单位，倒计时偏差 1000 倍 | 实测确认接口单位；或复用 `normalizeResetAt` |
| 低 | host.js:1216-1221 | 无 HTTP 方法白名单：任意方法（含 GET）都能执行任意 ROUTE；同源 GET 可触发 MUTATING 变更 | `<a>`/`<img>` 预取等浏览器行为可能触发同源变更（跨站已被 sameOrigin 挡住，风险有限） | MUTATING 路由限定 POST/PUT；其余方法返回 405 |
| 低 | host.js:1167-1185 | `readBody` 未监听 `'aborted'`，客户端中断时 Promise 可能悬置（handler 挂起） | 极端场景下请求处理不释放 | 监听 aborted/close 并 reject |
| 低 | host.js:360 | `accountId` 直接拼入请求头，若 auth.json 被篡改（含 CRLF）可注入额外头 | 本地可信文件、低危；header 注入理论上可伪造请求 | 过滤 `[\r\n]` |
| 低 | client-bundle.js:533-534, 242-250 | 投影字段缺失时 `formatDuration/formatTps` 输出 `'NaN'`；`fmtCountdown` 对 NaN 输出 `'NaN:NaN'` | 依赖 DSH 投影形状，当前 host 已防护，纯防御性 | 入口处 `Number.isFinite` 兜底 |
| 低 | host.js:837-842 | `activeCurrency` 在余额快照未就绪时回退 CNY，刷新完成前短暂币种错配 | 启动后首个 30s 内可能显示 ¥ 后变 $ | 无数据时不显示币种敏感项，或等待快照 |
| 低 | host.js:489 | `subscriptionRequested` 置 true 后永不重置：用户切回余额制 provider 后仍每 60s 刷新订阅接口 | 少量多余请求（已有失败退避兜底） | provider 切走时清除标记 |

---

## 二、优化清单

| 类别 | 位置 | 现状 | 建议 |
|---|---|---|---|
| 死代码清理（v1.3.0 回归遗留，影响最大） | host.js:1105-1126 | 客户端实际只调用 7 个 RPC（getBalanceSnapshot/getPricing/getUsageSummary/getBillingMode/getSubscriptionSnapshot/getConfig/setInfoDensity），以下全部为死 RPC：`getEstimate`/`getProviders`/`setActiveProvider`/`getSpendTrend`/`setDisplayMode`；连带死逻辑 `computeEstimate`、`spendTrend`、`providerList`、`SCENARIOS`、`CALIB_SESSIONS`、`conversion`、openai 估算余额分支 | 与概览页一并删除，或明确标注"保留给未来/备用接口"并加注释；同步更新 check-host.js:64 的 12-handler 名单（该护栏目前**锁死**了死 RPC 的清理） |
| 冗余计算/冗余输出 | host.js:1015-1028 | `getUsageSummary` 每 30s 被调一次，却计算并序列化客户端**从不使用**的 `spend`（spendSummary 每记录 2 次 costOf）、`calibration`、`sessions`、`last30dSpend`、`now` → 每次调用 6 遍全量扫描，绝大部分被丢弃 | 只返回 `currentSession`/`todaySpend`/`monthSpend`/`totalSpend`；smoke 测试中 `sessions` 断言同步调整 |
| 死字段 | host.js:712（purpose）、:536（nextIsPeak）、:277-282（displayMode/alertThreshold 配置） | `purpose` 写入从未读取；`nextIsPeak` 计算从未消费；`displayMode`/`alertThreshold` 客户端从不展示 | 删除或补注释说明保留意图 |
| 死常量/过时注释 | client-bundle.js:19-20 | `WINDOW_ALERT_PERCENT = 90` 定义后从未使用，注释还声称"与 host 常量保持一致"，而 host.js:23 已注明删除该常量 | 删除常量并修正注释（预警逻辑已在 host.js:22 注明由客户端 `LOW_QUOTA_PERCENT=20` 承担） |
| 测试可维护性 | test-spend-accounting.js:42-57, 161-171 | `beijingDayKey`/`currentPeriod`/`costOf`/`last30dSpend` 在测试中手工复刻（注释称"逐行一致"），与 test-dual-mode.js 的 `extractFn` 从源码提取方式不一致 | 统一为 extractFn 式提取，避免实现变更后测试静默漂移 |
| 魔法数字 | host.js:719 | 截断上限 `3000` 为裸字面量 | 提为命名常量并注释 |
| 命名 | host.js:1108 | ROUTES 的 `getUsageSummary` 与内部函数 `getUsageSummary` 同名（靠作用域区分，可读性差） | 内部函数改名（如 `computeUsageSummary`） |
| 注释质量 | 整体 | 大部分注释是优秀的"为什么"注释（如 host.js:494-496 退避解释、client 头部策略说明）；个别过时（见上） | 清理过时注释即可 |
| 安全加固（低优先） | host.js:1152-1165 | sameOrigin 逻辑正确且无 CORS 头（跨站不可读响应，好默认）；MUTATING 已防护 | 可补：MUTATING 限定 POST/PUT、readBody 监听 aborted、accountId 过滤 CRLF（见缺陷清单） |

---

## 三、测试覆盖缺口清单

现有覆盖（强项）：双模式检测、Codex/OpenCode Go 响应解析全边界、快照失败回退纯函数、显示名缓存回退链、记账会话聚合（CNY 单币种）、密度两态、RPC 路由/同源防护/持久化重载（smoke）。

以下核心逻辑**无测试覆盖**：

1. **余额刷新 seq 竞态与失败保留旧快照**——smoke 桩的 `credentials.resolve` 恒同步返回 undefined，从未触发并发刷新路径；host.js:317/321 两条无 guard 分支完全裸奔（与本次审计发现直接相关）。
2. **usage chunk 异常形态**——NaN/Infinity/负值/超大值/缺字段的记账与汇总（缺陷 #2 无回归测试）。
3. **3000 条截断 splice**——无测试验证截断后保留最新、丢最旧。
4. **loadUsageRecords 异常数据**——损坏 JSON / NaN / 负值 / 非法记录过滤。
5. **跨币种混合聚合**——test-spend-accounting 只用 CNY；USD+CNY 混合记录下的 todaySpend/monthSpend 币种过滤无测试。
6. **峰谷边界整点时刻**——现有测试只用非边界时刻；9:00/12:00/14:00/18:00 精确边界、nextSwitchAt 跨午夜（23:59 → 次日 9:00）无测试。
7. **client 运行时行为**——全部 client 测试均为静态字符串断言；`fatal` 渲染分支、rpc 失败/挂起、load 竞态、组件卸载清理均无运行时测试（受限于无 DOM 测试环境，可至少对 load/状态机抽纯函数测试）。
8. **sameOrigin 全矩阵**——smoke 只测了跨源 403 + 同源 200 两例；`sec-fetch-site: cross-site/none`、无头请求、host 缺失等未覆盖。
9. **HTTP 路由异常路径**——readBody 超限 413、非法 JSON 400、畸形 URL（decodeURIComponent）、404/405。
10. **订阅退避与并发去重**——`subscriptionLastFailAt` 退避期判定、`kickSubscriptionRefresh` in-flight 去重、`!snap.data` 时 await inflight 分支。
11. **resolveOpenCodeGoKey 回退链**——credentials → opencode → opencode-go auth.json 三级回退。
12. **落盘失败重试**——flushSave catch 分支（dirty 保留 + 卸载重试）。

---

## 四、结论

### 必须修复（严重度 ≥ 中，共 6 项）

| 优先级 | 项 | 一句话 |
|---|---|---|
| 1（高） | 客户端失败处理原子性 | load 任一 RPC 失败/挂起 → 整栏空白或永久加载中；加 rpc 超时 + 逐端点容错 + 失败保留旧数据渲染 |
| 2（高） | 记账数值清洗 | NaN/Infinity/负数 usage 直通 → 全部花费汇总失真并落盘坏记录；recordUsage/loadUsageRecords/costOf 三处补 isFinite 校验 |
| 3（中） | 余额 seq 竞态 | host.js:317/321 无 seq guard 且清空快照，与"失败保留旧快照"策略冲突 |
| 4（中） | 3000 条截断失真 | "全部花费"超量后静默不准；提高上限/滚动汇总/至少文档注明 |
| 5（中） | llm/stream 错误吞噬 | next() 失败被吞 → 上游错误被遮蔽；改 rethrow |
| 6（中） | 跨服务商错配 | 余额/花费锚定 deepseek，OpenAI 用户显示矛盾；锚定活跃模型 provider |

### 记录 backlog（低，共 10 项）

缺陷清单中 8~16 项（decodeURIComponent 400、轮询竞态序号、reset_at 单位实测、HTTP 方法白名单、readBody aborted、accountId 注入、client NaN 边角、activeCurrency 回退、subscriptionRequested 重置、多实例共享数据目录）；优化清单全部（重点是**死代码清理**——v1.3.0 移除概览页后遗留约 1/3 host 逻辑未被消费，且 check-host.js 护栏锁死了清理，建议随下个版本一起处理）。

### 建议补测（与必修复项配套）

缺陷 #2（异常 usage）、#3（seq 竞态）、#6（跨币种）建议各补一条回归测试；峰谷边界整点时刻补参数化用例；sameOrigin 补全矩阵。
