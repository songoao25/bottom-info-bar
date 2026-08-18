# QA 验收报告：信息概览页面（v1.2.0）

> 验收人：独立 QA（职责分离，非开发）
> 日期：2026-08-18（首次验收）→ 2026-08-18（缺陷修复回归确认）
> 范围：FR-1 ~ FR-6 逐条对照 `docs/PRD.md` 验收 + 全量测试 + 新增独立单测
> 产物：`tests/test-info-overview.js`（75 断言，已注册进 `tests/run-all.mjs`）

## 一、验收结果表

| 需求 | 结果 | 说明 |
|---|---|---|
| FR-1 双入口 | ✅ | `settings.section` 与 `conversation.view` 各注册一处，id=`info-overview`、label=`信息概览`、order=30，均渲染同一组件 `InfoOverviewPage`；两处注册各自 try/catch 隔离；disposers 统一纳入 `ctx.effect` 清理（client-bundle.js L136-155）。回归：3 处 slots.register（2 页面入口 + 1 dock），互不影响 |
| FR-2 花费总览卡 | ✅ | 4 张卡（今日/本月/近30天/累计）数据字段正确，来自 `getUsageSummary` 的 todaySpend/monthSpend/last30dSpend/totalSpend；host 返回 `currency: activeCurrency()`；币种符号取自 currency。金额格式口径已拍板为「千分位 + 2 位小数 + ＜0.01 兜底」并与 PRD 一致（D-1 关闭，见缺陷清单） |
| FR-3 使用记录明细 | ✅ | host `getUsageRecords`：ts 倒序（与写入顺序无关）、默认 limit=20、上限 100、offset 越界/负数/非数字安全；每条 11 字段完整，费用复用 `costOf`（与信息栏同算法），未知模型 cost=null 显示「—」，逐条带各自币种；client 默认 20 条 + 「加载更多」追加、无更多隐藏、空列表「暂无使用记录」 |
| FR-4 模型用量统计 | ✅ | 按 model+provider 聚合 count/tokens/cost 正确；按 cost 降序、未知模型排最后且 costShare=null、占比和=1、空记录容错；client 占比条 width=costShare*100%。模型行费用已按各自币种符号显示（D-3 符号部分已修复）；host totalCost 跨币种混加保留为已知限制（UI 不渲染该字段，见缺陷清单） |
| FR-5 花费趋势 | ✅ | 7/30 天切换按钮存在，切换后重拉 `getSpendTrend({days})`（loadCore 依赖 trendDays）；柱高按 spend/maxSpend 归一化；每柱 title + aria-label 齐备 |
| FR-6 数据一致性 | ✅ | 页面数据全部走 `/_dsh/dsh-bottom-info-bar/` RPC（组件内零直接 fetch、零 slot props 依赖）；新 RPC（getUsageRecords/getModelStats/getUsageSummary/getSpendTrend）均不在 MUTATING 名单（只读）；host 无新增写盘。明细 RPC 失败恢复缺陷已修复（D-2，见缺陷清单） |

## 二、测试结果

新增独立单测 `tests/test-info-overview.js`：
- **host 纯函数提取验证**（从 host.js 提取真实源码函数 + 桩闭包 eval）：getUsageRecords 倒序/分页边界（offset 越界/负数/非数字、limit 上限/负数/默认、>20 默认取 20、>100 截断 100）、字段完整性、未知模型 cost=null、费用与 costOf 一致、币种逐条正确；getModelStats 聚合/降序/未知模型排最后/占比和=1/空记录容错；getUsageSummary 含 currency。
- **client 静态断言**：InfoOverviewPage 存在、双入口注册（settings.section + conversation.view + id + label）、组件不读 slot props、30s 轮询仅刷 core 不刷 records、4 张卡、空态/加载更多/limit=20、7/30 按钮、柱 title+aria-label、数据仅走 rpc。
- **回归锁定断言**（缺陷修复防回归）：D-2 onRetry 存在/重试按钮绑定 onRetry/onRetry 同时重拉 core 与 records/loadRecords 失败进 fatal；D-3 模型行按 `symbolFor(m.currency)` 各自币种符号。
- 结果：**75 PASS / 0 FAIL**。

全量测试（`node tests/run-all.mjs`，已含新用例，位于 test-dual-mode 之后）：

```
build OK → lib/
PASS  smoke-static-host                （全部 PASS）
PASS  test-static-client               （17 PASS / 0 FAIL）
PASS  test-display-name                （21 PASS / 0 FAIL）
PASS  test-density-toggle              （22 PASS / 0 FAIL）
PASS  test-spend-accounting            （11 PASS / 0 FAIL）
PASS  test-dual-mode                   （108 PASS / 0 FAIL）
PASS  test-info-overview（新增）        （75 PASS / 0 FAIL）
PASS  check-host                       （14 个 RPC handler 完整，含 getUsageRecords/getModelStats）
全量测试全部通过
```

## 三、缺陷清单（含回归状态）

### D-1（低）~~花费总览卡金额 2 位小数，与 PRD「3 位小数」不符~~ → **已拍板关闭**
- **回归确认**：PM 拍板口径为「币种符号 + 千分位 + 2 位小数 + ＜0.01 兜底」，PRD.md L32 已改为该口径，与实现 `fmtMoney`（千分位 + 2 位小数 + ＜0.01 兜底）一致。**关闭。**
- **新发现（低，文档残留）**：PRD.md L33 仍残留旧验收文字「无数据时显示 ¥0.000（不显示空白或错误）」，与 L32「无数据时显示 ¥0.00」自相矛盾——建议主 Agent 清理 L33（改 ¥0.00 或删除），非功能问题，不阻塞。

### D-2（中）~~明细 RPC 首次失败后页面永久「加载中…」~~ → **已修复，回归通过**
- **修复内容**：client-bundle.js ① `loadRecords` catch 增加 `setLoading(false)+setFatal`（L698-701）；② 新增 `onRetry()`（L722-727）：`setLoading(true); setFatal(null); loadCore(); loadRecords(0);` 同时重拉 core 与 records；③ 重试按钮绑定 `onClick: onRetry`（L732）。
- **回归验证**：恢复路径完整——records 首次失败 → 错误页 + 重试 → onRetry 同时重拉 4 个 RPC；records 再次失败仍回到错误页（可反复重试），不再出现 records=null 卡「加载中…」的死态。已追加 4 条静态断言锁定（onRetry 存在/按钮绑定/双重拉/catch 进 fatal），全部 PASS。**关闭。**

### D-3（低）~~模型统计跨币种时 totalCost 混加、模型行符号忽略各自币种~~ → **部分修复，符号已关闭；totalCost 混加降级为已知限制**
- **修复内容**：client-bundle.js L771 模型行费用改为 `(symbolFor(m.currency) || sym) + fmtMoney(m.cost)`——按各模型自身币种显示符号（USD 模型显示 $），已追加静态断言锁定，PASS。**符号部分关闭。**
- **保留的已知限制（低）**：host `getModelStats` 聚合 `totalCost += c` 仍无币种过滤（host.js L1087），跨币种并存时 totalCost 为 CNY+USD 数值混加；但页面 UI 不渲染 totalCost 字段（模型行只显示各行 cost 与占比），用户不可见；且纯 DeepSeek（CNY）单币种场景无任何影响。建议记入 backlog，后续可改为按活动币种过滤聚合。

## 四、结论（回归后）

**达到可交付状态**：FR-1 ~ FR-6 全部 ✅。全量测试（8 项，含新增 75 断言）全绿；缺陷 D-1 已拍板（PRD 口径统一）、D-2 已修复并回归通过、D-3 符号部分已修复（totalCost 混加降级为 UI 不可见的已知限制）。

**遗留（不阻塞，建议顺手处理）**：
1. **PRD.md L33 文档残留**（低）：仍写「无数据时显示 ¥0.000」，与 L32「¥0.00」矛盾，建议主 Agent 清理为 ¥0.00 或删除该行。
2. **D-3 totalCost 跨币种混加**（低，已知限制）：host `getModelStats` 聚合未按活动币种过滤，UI 不渲染该字段、用户不可见；建议记入 backlog。

未做 git commit（由主 Agent 统一提交）。
