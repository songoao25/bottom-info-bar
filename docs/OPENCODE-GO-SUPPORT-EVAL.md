# OpenCode Go 订阅套餐显示支持评估

日期：2026-08-17
评估人：主 Agent（产品/技术负责人）
状态：待用户决策（是否开发）

## 结论

**当前版本（v1.0.0）不支持显示 OpenCode Go 订阅额度。**
改造复杂度：**中等偏低** —— 数据获取简单（官方有现成查询接口），主要成本在显示语义设计与前置条件配置。

## 事实核查

### 1. OpenCode Go 是什么
- OpenCode（`opencode.ai`）推出的订阅制编程套餐（约 $10–12/月起，分档 $12/$30/$60）。
- 订阅内含 DeepSeek / MiMo 等模型额度，在 opencode CLI 内消耗。
- 额度机制为**三个时间窗口**：5 小时滚动窗口 / 每周 / 每月，每个窗口有百分比（0–100）与重置时间。

### 2. 官方查询接口（关键利好）
```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <API_KEY>
```
响应（来源：xiaoqi20/dsh-opencode-go-usage README、cc-switch issue #6433）：
```json
{ "usage": {
    "rolling":  { "status": "ok", "percent": 9,  "resetsAt": "..." },
    "weekly":   { "status": "ok", "percent": 12, "resetsAt": "..." },
    "monthly":  { "status": "ok", "percent": 6,  "resetsAt": "..." } } }
```
- 接口**未写入公开文档**，可能变化 → 需防御性解析（dsh-bottom-info-bar 现有"失败保留旧快照"模式天然适配）。
- API Key：Anthropic 兼容格式 `sk-opencode-…`；来源 = DSH credentials（`OPENCODE_GO_API_KEY`）或 `~/.local/share/opencode/auth.json` 的 `opencode-go` 条目。

### 3. 现成参考实现
- `xiaoqi20/dsh-opencode-go-usage`（GitHub，MIT）：DSH 插件，官方 API 版，功能=显示 OpenCode Go 三窗口额度（挂设置侧栏）。与本项目同生态，可直接参考代码。
- `slkiser/opencode-quota`（GitHub）：OpenCode 生态配额工具，OpenCode Go 走 dashboard 抓取（复杂路径，不建议优先采用）。

### 4. 本机现状（2026-08-17 实测）
- opencode CLI 1.17.8 已安装（/opt/homebrew/bin/opencode）。
- `~/.local/share/opencode/auth.json` 目前**仅有 deepseek 条目，无 opencode-go** → 用户尚未在 opencode 内配置 OpenCode Go 订阅 key。
- 结论：即使完成功能开发，也必须先由用户完成 OpenCode Go 订阅并配置 key，信息栏才会显示真实额度。

## 与本项目现有架构的匹配度

dsh-bottom-info-bar 现有架构（PROVIDERS 适配器 + balance 快照 60s 刷新 + 失败保留旧快照 + RPC 下发 + 记账落盘）与 OpenCode Go 接入点高度吻合：

| 现有机制 | OpenCode Go 接入 |
| --- | --- |
| `balanceAPI` fetch + Bearer + JSON parse | 直接复用模式（换 URL 与解析函数） |
| 60s 定时刷新 / 失败保留旧快照 | 直接复用 |
| RPC `/balance` 下发 | 扩展返回字段或新增 `/quota` 方法 |
| 显示组（服务商+模型 / 余额 / 时段 / 倒计时 / 花费） | 新增一组"OpenCode Go 额度" |

## 复杂度分解（非复杂点 vs 真实成本）

**不复杂的部分：**
- 取数：一个 GET + Bearer，与现有 DeepSeek 余额查询同构（约 40–60 行 host 代码）。
- 已有同生态现成实现可参考，踩坑成本低。

**真实成本（需要用户拍板的设计点）：**
1. **显示语义不同**：现有"余额=钱"是单一数值；订阅额度是**三个窗口的百分比**（5h/周/月），不是单一数字 → 显示需重新设计：
   - 方案 A：只显示"最紧张窗口"（如"月额度 62%"），其余进 hover 浮窗 —— 占用最省。
   - 方案 B：三窗口全显示（5h 62% · 周 55% · 月 40%）—— 占位大。
2. **布局预算紧张**：行可用宽约 684px（实测），原生 7 组全显约 710px 必换行，现已隐藏 2 个低优字段。新增额度组需继续取舍或并入 compact 密度。
3. **前置条件**：用户需先订阅 OpenCode Go 并配置 key（本机 auth.json 当前无该条目）。
4. **语义隔离提醒**：OpenCode Go 额度在 opencode CLI 中消耗，与 DSH 对话记账（信息栏现有"花费"）是两套独立数据；显示须分开，避免误解。

## 工作量估算（若做，作为 v1.1.0）

- host：新增 provider 适配器 + 额度快照刷新 + RPC 字段 ≈ 40–60 行
- client：新增显示组 + hover 明细 ≈ 30–50 行
- 测试：tests/run-all.mjs 增补 2–3 用例（mock 响应解析 / 快照失败回退）
- 文档：README 功能表 + 配置说明
- 合计：小型到中型改造，1 个开发子 Agent + 1 个 QA 子 Agent 可完成

## 风险

- 接口未公开，OpenCode 可能改接口或加鉴权 → 防御性解析 + 失败保留旧快照可兜底。
- OpenCode Go 订阅本身若未购买，功能显示"未配置"引导文案（参考 dsh-opencode-go-usage 的做法）。
