# 双模式信息栏设计方案（余额制 / 订阅制）

日期：2026-08-17
设计者：主 Agent（产品/技术负责人）
状态：待用户确认后进入开发

## 背景

用户需求（2026-08-17）：
1. 每次打开 DSH 时，检测当前绑定的是余额制 API 还是订阅制 API。
2. 显示分两种：余额制 → 余额制版字符标签；订阅制 → 订阅制版字符标签。切换是**直接替换**，不是新增。
3. 布局：居中对齐、不超过对话框左右边界；影响范围仅限插件自己加的字符，不动原版底部信息栏。

用户现状：未订阅 OpenCode Go；本机有 Codex（ChatGPT Plus 合并订阅），当前仅剩周额度（5 小时窗口已被 OpenAI 移除）。

## 一、检测逻辑（balance vs subscription）

### 判定依据：当前激活模型的 provider 标识
- 已知订阅制 provider 集合 → 订阅制模式：
  - `codex` / `chatgpt` → Codex（ChatGPT Plus/Pro）
  - `opencode-go` / `opencode` → OpenCode Go
- 其余（deepseek / openai / openrouter / moonshot / zhipu / anthropic / google / …）→ 余额制模式（现状）
- 未知 provider → 余额制兜底 + 提示

### 凭据可用性探测（决定订阅源能否取到真实数据）
- Codex：`~/.codex/auth.json` 存在 OAuth tokens（access_token / refresh_token）→ 可用
- OpenCode Go：DSH credentials `OPENCODE_GO_API_KEY` 或 `~/.local/share/opencode/auth.json` 含 `opencode-go` 条目 → 可用；否则显示"未配置"引导

### 手动覆盖（防误判）
- 配置 `billingMode: 'auto' | 'balance' | 'subscription'`（auto 为默认，手动可强制）

### 检测时机
- 插件启动时 + 当前模型 provider 变化时（复用现有 modelSelection() 轮询/刷新机制）

## 二、显示逻辑（同一位置替换）

### 余额制版（现状，不动）
服务商+模型 | 余额（真实 API/记账回退）| 时段（高峰价/空闲价）| 倒计时 | 本对话花费
hover：定价明细 / 今天·近一月·全部花费

### 订阅制版（新增，替换余额制版；用户 2026-08-17 拍板：三窗口全显示 + 精简信息）
**只显示三类信息（用户明确：此时"服务商"指订阅服务如 OpenCode Go / Codex，不是模型商）：**
1. 模型名称：订阅服务名 + 具体模型（如 `OpenCode Go · DeepSeek V4 Flash` / `Codex · GPT-5-Codex`）
2. 额度信息：三窗口全显示 `5h 9% · 周 62% · 月 40%`（短标签 + 已用百分比，数值加粗）
3. 重置时间：取最紧窗口（usedPercent 最高且存在）的倒计时，如 `距重置 1d 21h`

**不显示（余额制专属信息全部移除）：** 余额、时段（高峰价/空闲价）、距高峰倒计时、本对话花费、本对话 token 用量。

hover（title）浮窗：订阅源 + 套餐名 + 三窗口各自明细（标签、已用百分比、重置时刻、重置剩余）。

- 窗口缺失（如 Codex 无 5 小时窗口）→ 该标签跳过不显示、不占位、不报错
- 预警：任一窗口剩余 ≤20%（usedPercent ≥80%）→ 红色百分比与无框 `低` 字提示（title 说明是哪个窗口告急）
- compact 密度下订阅制显示适当精简（至少显示最紧窗口）
- 布局预算示例：`OpenCode Go · DeepSeek V4 Flash | 5h 9% · 周 62% · 月 40% | 距重置 1d 21h`，字符量满足 684px 预算

### 不变的部分
- 原生统计行（轮/步/LLM 耗时/缓存/tok，row1）完全不动
- 布局：居中对齐、不超边界（现有 .bi-root 样式复用）
- 密度切换（完整/简洁）机制不变

## 三、统一订阅额度数据模型

host 端所有订阅源产出同一结构，client 端一套渲染：

```js
{
  provider: 'codex' | 'opencode-go',
  plan: 'ChatGPT Plus' | 'OpenCode Go',   // 显示名
  windows: [
    { key: 'five_hour', label: '5 小时', usedPercent: 9,  resetsAt: 1784000000000 },
    { key: 'seven_day', label: '周',    usedPercent: 62, resetsAt: 1785000000000 },
    { key: 'monthly',   label: '月',    usedPercent: 40, resetsAt: 1787000000000 },
  ],
  fetchedAt, error
}
```

## 四、数据源适配器

### 源 A：Codex（本次开发的主测试源，用户已有订阅）
- endpoint：`GET https://chatgpt.com/backend-api/wham/usage`
- 认证：`~/.codex/auth.json` 的 access_token（Bearer）+ refresh_token 续期逻辑
- 响应解析：
  - `usage.rate_limit.primary_window` / `secondary_window`：`{ used_percent, limit_window_seconds, reset_at }`
  - `usage.code_review_rate_limit`：同构（可选并入）
- 窗口映射：limit_window_seconds ≈ 18000 → five_hour；≈ 604800 → seven_day；≈ 2592000 → monthly
- 参考实现：f4ah6o/agent-limits（Rust，MIT）src/providers/codex/
- 风险：未公开 endpoint、可能变更/风控 → 防御性解析 + 失败保留旧快照 + 明确错误文案；开发第一步先做真实连通性验证，失败则用 mock 数据继续测显示逻辑
- 用户现状（仅周额度）即"窗口缺失"边界用例

### 源 B：OpenCode Go（本期做适配器，用户未订阅显示引导）
- endpoint：`GET https://opencode.ai/zen/go/v1/usage`，Bearer
- 响应：`usage.rolling / weekly / monthly`：`{ status, percent, resetsAt }`
- 认证优先级：DSH credentials `OPENCODE_GO_API_KEY` → `~/.local/share/opencode/auth.json` 的 `opencode-go` 条目
- 未配置 → `{ error: { kind: 'no-key' } }` → 客户端显示"未配置 OpenCode Go"引导（不崩溃）

## 五、改动范围

| 文件 | 改动 |
| --- | --- |
| plugin/src/host.js | 新增 SUBSCRIPTION_PROVIDERS 集合 + 检测函数；新增订阅额度快照（复用 balance 刷新机制）；新增 SUBSCRIPTIONS 适配器（codex / opencode-go）；RPC 新增 getSubscriptionSnapshot / getBillingMode；getConfig 增加 billingMode |
| plugin/src/client-bundle.js | state 增加 subscription / billingMode；row2 按模式分支渲染（余额制=现状；订阅制=新组件）；hover 三窗口明细；预警样式 |
| plugin/src/host.js 样式 | 复用 .bi-peak/.bi-err/.bi-num；必要时补额度样式类 |
| tests/run-all.mjs | 新增用例：模式检测（provider 映射）、Codex 响应解析（含窗口缺失）、OpenCode Go 响应解析、快照失败回退 |
| README / README.zh-CN | 双模式说明 + 订阅源配置说明 |
| CHANGELOG | v1.1.0 条目 |

## 六、不做的事（明确排除）
- 不改原生 stats 投影的渲染（row1 原样）
- 不做余额/订阅混算；两种模式是互斥替换
- 不把 Codex 订阅"绑定到 DeepSeek 官方 API"（概念上不存在，用户已澄清）
- 不引入外部依赖库；沿用纯 ESM + fetch 架构

## 七、验收标准（Gate）
1. provider=codex/opencode-go 时 row2 显示订阅制版；provider=deepseek 时显示余额制版；切换 provider 后 row2 内容替换、无叠加。
2. Codex 真实连通（或 mock）：周窗口显示百分比+重置倒计时；5 小时窗口缺失时不显示、不报错。
3. 任一窗口剩余 ≤20% 显示红色百分比与无框 `低` 字；全部剩余 >20% 不显示预警。
4. 订阅源请求失败时保留上次快照并显示"刷新失败"提示；无快照时显示明确错误文案。
5. 布局：行宽不超 684px 可用预算（省位置版）；居中；单击仍可切换密度。
6. row1 保留轮次、步骤、LLM/工具耗时、缓存命中及输入/输出 token；允许为统一排版调整字重与间距。
7. tests/run-all.mjs 的全部测试项全绿。
8. 未配置 OpenCode Go 时显示引导文案，不崩溃。

## 八、工作量
- host：检测 + 2 适配器 + 快照 + RPC ≈ 120–160 行
- client：模式分支 + 订阅制组件 + hover ≈ 80–120 行
- 测试：5–8 个新用例
- 流程：dev-qa 阶段（开发子 Agent + 独立 QA 子 Agent），完成后按 Stage-Gate 汇报确认再发布
