# 审计报告：dsh-bottom-info-bar（v1.1.0 双模式信息栏 + v1.2.0 信息概览页增量审计）

日期：2026-08-17（v1.1.0 主报告）；2026-08-18（v1.2.0 增量审计，见第六节）
审计范围：commit ecffc92（双模式实现）+ 3fb677f（同源校验）+ v1.2.0 信息概览页（工作树未提交变更）
流程：开发（工程师子 Agent）→ QA（独立 QA 子 Agent）→ 安全审计（独立审计子 Agent）→ 修复 → QA 最终回归
状态：待 Gate 4 用户确认

## 一、功能验收（对照 docs/DUAL-MODE-DESIGN.md 第 7 节 + 用户 2026-08-17 拍板）

| # | 验收标准 | 结果 | 说明 |
|---|---|---|---|
| 1 | provider 检测 + 互斥替换无叠加 | ✅ | codex/chatgpt/opencode-go/opencode→订阅制；deepseek 等→余额制；billingMode auto/manual 覆盖；client if/else 严格互斥 |
| 2 | 订阅制只显示三类信息（模型名称/额度/重置时间） | ✅ | 订阅服务+模型（`Codex · GPT 5 Codex`）+ 三窗口（`5h 9% · 周 62% · 月 40%`）+ 距重置倒计时（`距重置 1d 21h`）；余额/时段/距高峰/本对话花费/本对话 token 用量均不渲染（防回归测试断言） |
| 3 | 窗口缺失（Codex 无 5h）跳过不报错 | ✅ | 真实响应实测（仅周窗口 43%）；parseCodexUsage 跳过未知/缺失窗口 |
| 4 | 任一窗口 ≥90% ⚠；全部 <90% 无 ⚠ | ✅ | WINDOW_ALERT_PERCENT=90 双端一致；title 点名告急窗口 |
| 5 | 失败保留旧快照 + 提示；无快照明确错误 | ✅ | mergeSubscriptionResult 单测（失败保留 data/fetchedAt 仅换 error）；client「⚠ 刷新失败，显示上次快照」/「未配置 OpenCode Go」引导 |
| 6 | 行宽 ≤684px 居中、单击切密度 | ✅ | 布局估算：修复后最坏 458px（Codex 真实形态 427px），余量 ≥226px；.bi-root 居中 + onClick 密度切换 |
| 7 | row1 原生统计行不变 | ✅ | 与 v1.0.0 逐字符相同（git 对比） |
| 8 | 未配置 OpenCode Go 引导不崩溃 | ✅ | no-key → 引导文案 |

## 二、测试结果

命令：`node tests/run-all.mjs`（7 文件全绿，EXIT=0）
- smoke-static-host（含订阅模式冒烟：codex/opencode-go no-key、同源/跨源校验）
- test-static-client 17 / test-display-name 22 / test-density-toggle 22 / test-spend-accounting 11
- **test-dual-mode 90 断言**（模式检测/窗口映射边界/Codex 解析含窗口缺失/OpenCode Go 解析/快照失败回退/订阅分支静态防回归）
- check-host（12 个 RPC handler 完整 + 关键函数齐备）

Codex 真实连通验证（2026-08-17，开发执行，token 不出本机）：chatgpt.com/backend-api/wham/usage → HTTP 200；真实响应顶层 rate_limit、plan_type=plus、仅 primary_window 604800s（周 43%）、5h 缺失 → 解析正确，正是设计预期的边界用例。

## 三、安全检查（独立审计子 Agent，审计者≠开发者）

- [x] 无硬编码密钥（工作树 + git 全历史 13 commit 扫描；sk- 仅 2 处文档格式说明）
- [x] 无个人路径（工作树与历史；文档用 ~/ 相对写法）
- [x] token 仅内存、Header 传输、不进日志/落盘/错误信息（实测 usage-records.json 无 token，权限 0600/0700）
- [x] 注入防护：白名单路由 + 64KB body 限制 + 参数白名单
- [x] 同源防护：MUTATING 含 setActiveProvider/setDisplayMode/setInfoDensity/getSubscriptionSnapshot（3fb677f 新增，防跨站触发订阅 API 查询）
- [x] XSS：全 React.createElement 默认转义，无 dangerouslySetInnerHTML
- [x] 依赖安全：零运行时依赖（仅 react peer），无 lockfile，攻击面≈0
- [x] 构建产物卫生：plugin/lib/ 与 .dsh-vision-toolkit/ 均在 .gitignore，git ls-files 确认产物未跟踪

## 四、遗留问题

| 问题 | 严重度 | 处理 |
|---|---|---|
| 历史早期 LICENSE/README 版权行含机器用户名（已由后续 commit 统一为 songoao25） | 低 | 不处理（改写历史风险高收益低，记录在案） |
| billingMode 手动覆盖暂无 UI/setRPC 入口（配置字段已支持） | 低 | 已知限制，下版迭代计划 |
| Codex refresh_token 续期分支未真实端到端触发（逻辑覆盖，access_token 本次有效） | 低 | 已知限制，遇 401 时自然验证 |
| wham/usage 为未公开接口可能变更/风控 | 低 | 失败保留旧快照 + 60s 重试兜底已实现 |

## 五、结论

**达到可发布状态。** 功能验收 8/8 通过，测试全绿（7 文件 90+ 断言），安全审计通过（高危 0 / 中危 0 / 低危均已处理或记录）。遗留项均不影响发布。发布前需用户确认 Gate 4，并重启 dsh web 生效（当前运行进程为旧版）。

---

## 六、v1.2.0 迭代审计（信息概览页面）

审计日期：2026-08-18
审计范围：info-overview 新功能——host 端 getUsageRecords/getModelStats RPC（host.js 1030-1114 行函数、1198-1205 行路由注册）、getUsageSummary 新增 currency 字段（1026 行）；client 端 InfoOverviewPage 组件 + installOverviewStyles + 双入口注册（settings.section + conversation.view）；tests/test-info-overview.js
审计者：独立安全审计子 Agent（职责分离：审计者≠开发者，只读审查，不修改代码）
方法：源码逐行审查 + 静态模式扫描（grep）+ git 全历史扫描 + 边界测试执行验证

### 6.1 功能验收（对照 PRD）

见独立 QA 报告 `docs/QA-REPORT-INFO-OVERVIEW.md`（75 断言全绿：倒序/分页边界/聚合/占比/双入口注册/30s 轮询范围/渲染要素）。审计侧独立复核：`node tests/test-info-overview.js` → **75 PASS / 0 FAIL（EXIT=0）**。

### 6.2 安全检查（本次迭代：信息概览页面）

**A. 硬编码密钥/敏感数据**
- [x] 无硬编码密钥。证据：`grep -nEi "sk-[A-Za-z0-9]|bearer|authorization|access_token|secret|password|api_key" plugin/src/host.js plugin/src/client-bundle.js tests/test-info-overview.js`——命中行 122-152/248/268/327/359/379-382/398-424 全部位于 host.js 1030 行之前，`git diff` 确认属 v1.1.0 存量订阅逻辑（变量引用 `cred.value/token/key` 与环境变量名 `DEEPSEEK_API_KEY` 等，**无真实密钥值**）；本次新增 diff 行（getUsageRecords/getModelStats/currency/路由注册）零命中
- [x] git 全历史无真实密钥值。证据：`git log -p --all | grep -E "sk-[A-Za-z0-9]{20,}|api_key[:=]['\"][A-Za-z0-9]{16,}|Bearer [A-Za-z0-9._-]{30,}"` → 零命中
- [x] 新增 RPC 不触碰凭据：getUsageRecords/getModelStats 只读 `usageRecords`（字段：ts/model/provider/input/cacheRead/cacheWrite/output/sessionId 等，无任何凭据字段），不读取/打印令牌

**B. 个人路径/环境泄露**
- [x] 无个人路径。证据：`grep -nE "/Users/|/home/|C:\\|songsong(?!ao25)|邮箱"` 三个文件 → 零命中；`songsong` 仅以仓库署名 `songoao25` 出现（作者署名，分发铁律允许）
- [x] 测试无真实数据：test-info-overview.js 用 `__dirname` 相对路径 + 桩数据（假 sessionId s1-s5、假模型名），不读真实 usage-records.json；host 端数据目录用 `homedir()` + `DSH_BOTTOM_INFO_BAR_DATA_DIR` 环境变量覆盖（存量，非个人路径硬编码）

**C. RPC 安全（webServer 路由）**
- [x] 新增 RPC 纯只读零副作用：getUsageRecords/getModelStats 函数体仅内存遍历（slice/sort/map/聚合），不写盘、不修改 config/balances、不发网络请求
- [x] 未入 MUTATING 名单且正确：host.js 1245 行 `MUTATING = { setActiveProvider, setDisplayMode, setInfoDensity, getSubscriptionSnapshot }`，新增 3 个只读 RPC 均不在名单——只读接口跨源调用无副作用、无凭据操作，无需同源拦截（测试 FR-6 静态断言覆盖）
- [x] 参数校验完备：offset/limit 经 `typeof number + isFinite` 校验 → `Math.floor` → 负数归零 → limit 上限 100 截断 → offset 越界 `Math.min` 落尾返回空数组，绝不越界/崩溃。证据：测试 6 组边界（负数 offset/负数 limit/非数字/offset 越界/limit 超 100/记录 >20 默认 20 条）全部 PASS
- [x] 响应最小化，sessionId 不对外暴露：getUsageRecords 响应字段仅 `ts/model/provider/modelDisplay/providerDisplay/input/cacheRead/cacheWrite/output/cost/currency`（逐字段核对 1049-1061 行）；getUsageSummary.currentSession 返回对象（815-833 行）也不含 sessionId——sessionId 仅作 host 内部聚合 key（sessionTotals），**零对外暴露**；purpose 字段同样不返回。风险等级：无
- [x] 无 XSS 注入面：`grep dangerouslySetInnerHTML|innerHTML|outerHTML|document.write|eval(|new Function|insertAdjacentHTML` client-bundle.js 全文件 → 零命中；渲染全部 `React.createElement` 默认转义；title/aria-label 拼接值（pt.label 为 host 生成的 'MM-DD' 日期、模型名/服务商名）经 React 属性自动转义；style height/width 为数值计算 + '%' 拼接，无注入面。路由层另有 ROUTES 白名单（未知 method 404）+ body 64KB 限制 + 响应 no-store（存量，复核确认）

**D. 依赖安全**
- [x] 零新增依赖：package.json 与 v1.1.0 一致（无 dependencies/devDependencies，仅 peerDependencies `react ^18.0.0`），本次迭代未改 package.json
- [x] 无 lockfile：plugin/ 下 package-lock.json / npm-shrinkwrap.json / yarn.lock / pnpm-lock.yaml 均不存在 → npm audit 无依赖树可扫；零运行时依赖攻击面≈0

**E. OWASP 适用项（针对本插件形态）**
- [x] 注入：无 SQL/命令注入面（数据仅来自本地 JSON 文件 + React 纯渲染，无 innerHTML/无字符串拼接进执行上下文）
- [x] 失效访问控制：新增 RPC 只读且无敏感操作；webServer 同源防护对 MUTATING 生效；只读接口跨源调用仅有本机统计数据的低价值响应且无副作用，评估无需额外防护
- [x] 敏感数据泄露：usage-records.json 权限复核（host.js 687 行 DATA_DIR 0o700、690 行文件 0o600，tmp 原子 rename）——存量达标；新 RPC 暴露面 = 用户在本机页面读取自己的花费统计，不新增任何敏感字段

### 6.3 风险与建议

| 风险 | 严重度 | 建议 |
|---|---|---|
| 未发现新增安全缺陷 | — | 无必须修复项 |
| 信息项：plugin/package.json version 仍为 1.1.0，v1.2.0 未 bump | 低（非安全） | 发布阶段（release-deploy）bump 至 1.2.0 |
| 信息项：usage-records.json 明文含 sessionId（存量字段，RPC 已不返回） | 低 | 保持现状；未来新增任何导出/分享功能时继续排除 sessionId 与凭据字段 |
| 信息项：只读 RPC 无同源拦截 | 低 | 无需处理（无副作用、无凭据操作、跨源无利用价值） |

### 6.4 结论（v1.2.0 增量）

**通过（达到可发布状态）。** 零硬编码密钥（含 git 全历史）、零个人路径、依赖零新增且无 lockfile（攻击面≈0）、新增 RPC 纯只读且参数防护完备、响应不暴露 sessionId/purpose、无 XSS 注入面。高危 0 / 中危 0 / 低危 0，无必须修复项。两项信息项（版本 bump、sessionId 存量说明）交由发布阶段处理。测试证据：test-info-overview.js 75 PASS / 0 FAIL。
