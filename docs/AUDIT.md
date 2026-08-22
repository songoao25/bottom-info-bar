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
| 4 | 任一窗口剩余 ≤20% 显示警示；全部剩余 >20% 无预警 | ✅ | 当前由客户端 `LOW_QUOTA_PERCENT=20` 判定；警示为红色百分比 + 无框 `低` 字，title 点名告急窗口 |
| 5 | 失败保留旧快照 + 提示；无快照明确错误 | ✅ | mergeSubscriptionResult 单测（失败保留 data/fetchedAt 仅换 error）；client 显示「刷新失败」/「未配置 OpenCode Go」引导 |
| 6 | 行宽 ≤684px 居中、单击切密度 | ✅ | 布局估算：修复后最坏 458px（Codex 真实形态 427px），余量 ≥226px；.bi-root 居中 + onClick 密度切换 |
| 7 | row1 核心统计信息保留 | ✅ | 保留轮次、步骤、LLM/工具耗时、缓存命中及输入/输出 token；为统一标签与数值间距，排版已调整，不再声称逐字符或像素不变 |
| 8 | 未配置 OpenCode Go 引导不崩溃 | ✅ | no-key → 引导文案 |

## 二、测试结果

命令：`node tests/run-all.mjs`（14 个测试项全绿，EXIT=0）
- smoke-static-host（含订阅模式冒烟：codex/opencode-go no-key、同源/跨源校验）
- client 静态、故障容错、会话模型同步、显示名、密度、花费、双模式、账本、更新与 host 回归测试
- **test-dual-mode 109 断言**（模式检测/窗口映射边界/Codex 解析含窗口缺失/OpenCode Go 解析/快照失败回退/订阅分支静态防回归）
- check-host（13 个 RPC handler 完整 + 关键函数齐备）

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

**达到可发布状态。** 功能验收 8/8 通过，测试全绿（14 个测试项，双模式 109 项断言），安全审计通过（高危 0 / 中危 0 / 低危均已处理或记录）。遗留项均不影响发布。发布前需用户确认 Gate 4，并重启 dsh web 生效（当前运行进程为旧版）。

---
