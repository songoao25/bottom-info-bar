# Changelog

本项目的版本记录遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 优化

- **原生统计行单行显示**：隐藏「首 token 平均 / tok/s」两个低优先级速度字段，原生统计行在标准对话宽度（748px）下单行放得下；hover 信息浮窗仍可查看完整原生统计（含被隐藏字段）

### 修复

- **本对话金额归属**：新开对话不再显示上一个会话的花费（客户端多路获取当前会话 ID；宿主对空/未命中会话返回 ¥0.000 而非回退最近会话；会话 ID 前缀差异归一化）
- **回复完成即时更新金额**：会话统计变化时自动刷新，不再等最长 30 秒的轮询间隔

## [1.2.0] - 2026-08-17

> v1.2.0 尚未发布（未打 tag / 未发 Release）；本文档为发布前承诺说明。
> 已知限制：`chatgpt.com` 后端为非公开接口，可能变更或失效（失效时自动降级、不崩溃）；可用模型以订阅计划为准（如部分 `gpt-5.x` 可能仅 Pro 订阅可用）。

### Added

- **Codex 订阅桥接**：在 DSH 内直接使用 ChatGPT Plus/Pro 订阅额度对话——启动时幂等注册 `openai-codex` 模型路由（`llm-pi-ai.providers.openai-codex`，`apiKeyEnv: OPENAI_CODEX_API_KEY`），模型选择器出现 Codex 系列模型，选中即用，不填密钥、不扫码
- **令牌自动管理与续期**：读 `~/.codex/auth.json`（需先 `codex login` 一次）；JWT `exp` 判定过期（剩余 <45 分钟才续期），官方刷新接口续期后安全写回（保留 account_id 等字段、原子写 tmp+rename），最新令牌注入 DSH 凭据库立即生效；启动即同步一次 + 每 30 分钟周期
- **信息栏订阅制联动**：桥接启用后信息栏自动切订阅制，显示订阅窗口额度与距重置倒计时（如 `Codex · … | 周 43% | 距重置 1d 21h`）

### Security

- **令牌全程受控**：仅存于内存 + `~/.codex/auth.json`（0600）+ DSH 凭据库（0600）；不打印、不进日志、不进仓库
- **卸载清理**：`./uninstall.sh --purge-codex` 安全移除 `llm-pi-ai.providers.openai-codex` 配置（修改前自动备份）与 `OPENAI_CODEX_API_KEY` 凭据行，其余配置原样保留；`~/.codex/auth.json`（codex CLI 自身登录态）不动

## [1.1.0] - 2026-08-17

> v1.1.0 尚未发布（未打 tag / 未发 Release）；本文档为发布前承诺说明。

### Added

- **双模式信息栏（余额制 / 订阅制）**：按当前激活模型的 provider 自动检测——`codex` / `chatgpt` / `opencode-go` / `opencode` 走订阅制，其余走余额制；两种模式互斥替换、绝不叠加；内部 `billingMode: 'auto' | 'balance' | 'subscription'` 开关（默认 `auto`）可强制覆盖
- **订阅制额度显示（row2 只三类信息）**：**订阅服务 + 模型**（如 `OpenCode Go · V4 Flash`；"服务商"指订阅服务本身，不是模型厂商）| **`5h xx% · 周 xx% · 月 xx%`**（三窗口全显示，数值加粗）| **距重置倒计时**（最紧窗口，天级格式如 `1d 21h`）；余额 / 时段 / 本对话花费 / token 用量等余额制信息一律不显示；hover 浮窗展示订阅源、套餐名与每窗口的已用百分比 / 重置时刻 / 重置剩余
- **窗口缺失自适应**：某窗口不存在（如 Codex 无 5 小时窗口）自动跳过，不占位、不报错；compact 密度下订阅制精简为最紧窗口
- **额度预警**：任一窗口已用 ≥90% 红色 ⚠ 提示，title 说明哪个窗口告急
- **订阅数据源适配器**：Codex（`chatgpt.com/backend-api/wham/usage`，读 `~/.codex/auth.json`，access_token 过期自动用 refresh_token 续期一次，新 token 仅内存使用）与 OpenCode Go（`opencode.ai/zen/go/v1/usage`，DSH credentials `OPENCODE_GO_API_KEY` → opencode auth.json 两级解析，未配置显示引导不报错）
- **快照机制复用余额模式**：60 秒周期刷新、失败保留上次快照、seq 防旧请求覆盖新数据；新增 `getBillingMode` / `getSubscriptionSnapshot` 两个 RPC，`getConfig` 新增 `billingMode` 字段

### Security

- **订阅 token 零落盘**：Codex / OpenCode Go 的 token 只在本机内存中用于请求头，绝不写入任何文件、不打印、不进 git 历史、不进文档；错误信息不含 token 片段

### Fixed

- **测试隔离**：新增环境变量 `BOTTOM_INFO_BAR_CODEX_AUTH` / `BOTTOM_INFO_BAR_OPENCODE_AUTH` 覆盖订阅源凭证文件路径，测试不读取真实登录态、不发真实网络请求

## [1.0.0] - 2026-08-15

首个可分发版本。以静态插件包（bundle）形式安装，安装一次后每次打开 DeepSeek Harness 自动生效，无需手动重新加载。

### Added

- **一体替换原生统计栏**：原生统计（轮·步 / LLM 耗时 / 工具调用 / 首 token 平均 / tok/s / 缓存命中 / 输入输出 tokens）与本插件信息合并为一条，格式与原生一致
- **服务商 + 具体模型自动识别**：DeepSeek V4 Flash、Kimi K3、GLM 4.6 等自动美化显示，服务商名加粗
- **真实余额**：DeepSeek 余额 API 直连，60 秒自动刷新，失败保留上次快照
- **高峰价 / 空闲价**：分别以琥珀色 / 绿色加粗显示，附下次切换倒计时；无峰谷价的服务商自动隐藏
- **真实花费**：逐请求记账，本对话 / 今天 / 近一月 / 全部 精确聚合，hover 查看明细；**记账数据落盘持久化，重启不丢失**
- **数字加粗**：余额、倒计时、花费与统计数字统一加粗
- **完整 / 简洁**：单击整条信息栏切换
- **余额预警**：低于 ¥20 显示 ⚠

### Fixed

- **本对话花费始终显示**：新对话 / 对话刚开始（尚无记账）时不再隐藏，显示 `本对话 ¥0.000`；hover 仍可查看持久化的 今天 / 近一月 / 全部
- **原生统计行**：完整模式下对话刚开始即显示 `0 轮 · 0 步`，不再等第一步完成才出现

[1.0.0]: https://github.com/songoao25/bottom-info-bar/releases/tag/v1.0.0
