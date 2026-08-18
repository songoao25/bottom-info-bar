# 底部信息栏插件

[**English**](README.md) | **中文**

[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/dsh-bottom-info-bar/ci.yml)](https://github.com/songoao25/dsh-bottom-info-bar/actions)

**DeepSeek Harness 适配度最高的底部信息栏**，也是原生统计栏的一体替换：单行展示**实时余额**与**订阅额度**（ChatGPT & OpenCode Go），以及服务商与模型、峰谷定价、真实花费，一眼看清。**智能简洁**——自动识别余额制/订阅制、严格单行、完整/简洁两态切换；**不冲突**——替换原生栏而非叠加，两种计费模式互斥绝不重叠；**和原生一样**——模型名/服务商名与模型切换器完全一致、布局与原生统计栏一致。安装一次，每次启动自动生效。

## 展示预览

![底部信息栏预览：ChatGPT 订阅账户、DeepSeek API 接入和 OpenCode Go 订阅账户](/assets/bottom-info-bar-preview.jpeg)

长图从上至下依次展示 **ChatGPT 订阅账户**、**DeepSeek API 接入** 和 **OpenCode Go 订阅账户**；每种账户均依次展示**完整模式**和**简洁模式**。

## 特性

- **双模式信息栏**：自动检测当前服务商是**订阅制**（Codex / OpenCode Go）还是**余额制**，两种模式互斥替换、绝不叠加；余额制保持原样。
- **订阅额度显示（ChatGPT & OpenCode Go）**：当前服务商为订阅制时，信息栏显示**订阅服务 + 模型**（如 `OpenCode Go · V4 Flash`）、**5小时 / 周 / 月** 三窗口**剩余额度**（剩余 = 100 − 已用，数值加粗并带颜色：**剩余 >20% 绿色**，**剩余 ≤20% 琥珀色**），以及**距重置倒计时**（天级格式如 `距重置 1d 21h`）。简洁模式优先显示时间最短的窗口（5小时优先；若无则降级到周/月），完整模式显示全部三个窗口。任一窗口剩余 ≤20% 时显示 ⚠ 预警。**额度与倒计时严格来自同一窗口**，确保信息匹配。额度来自**两个订阅数据源**：
  - **ChatGPT / Codex**：只读 `~/.codex/auth.json` 令牌查询 ChatGPT 订阅额度（Plus / Pro / Team / Enterprise，5小时 / 周 / 月 三窗口）。**绑定 / 令牌续期 / ChatGPT 模型路由不在本插件内**——请安装配套插件 [**dsh-chatgpt-subscription**](https://github.com/songoao25)（独立仓库）绑定 ChatGPT 账号；本插件只读令牌显示额度。令牌缺失/失效时显示「未绑定 / 重新绑定」引导，不报错。**悬停 "⚠ 刷新失败"** 可查看自动重试说明
  - **OpenCode Go**：经 `OPENCODE_GO_API_KEY`（设置 → 模型）或 opencode CLI 登录（`~/.local/share/opencode/auth.json` 的 `opencode-go` 条目）读取 `opencode.ai/zen/go/v1/usage` 额度；未配置时显示「未配置 OpenCode Go」引导，不报错
  两个数据源都会显示各自的**剩余额度**与三窗口的**重置时间**，随时掌握额度何时恢复。
- **一体替换**：默认替换原生统计栏，原生信息（轮·步 / LLM 耗时 / 工具调用 / 缓存命中 / 输入输出 tokens）照常显示、格式与原生一致；**首 token 平均 / tok/s** 两个速度指标移入 hover 浮窗，单行一眼看完
- **服务商 + 具体模型**：模型名/服务商名与模型切换器**完全一致**（读取 DSH 模型目录 `name`，如 `DeepSeek-V4-Flash`），服务商名加粗；服务商名已是模型名前缀时只显示模型名（切换器样式）
- **实时余额**：DeepSeek `/user/balance` 真实 API，60 秒自动刷新；失败保留上次快照并提示，不中断使用
- **峰谷价 + 倒计时**：高峰价（琥珀色加粗）/ 空闲价（绿色加粗）+ 距下次切换倒计时；无峰谷价的服务商自动隐藏
- **真实花费**：逐请求记账（`llm/stream` usage × 单价），按 **本对话 / 今天 / 近一月 / 全部** 精确聚合，**记账数据落盘持久化（重启不丢失）**
- **信息概览**：一个完整的使用追踪页面，有**两个入口**——**设置 → 信息概览**，或**对话页顶部标签栏 → 信息概览**，两个入口进入的是同一个页面。页面包含**花费总览卡**（今日 / 本月 / 近30天 / 累计，与信息栏口径一致）、**花费趋势图**（近 7 天 / 30 天每日花费柱状图，可切换）、**各模型用量统计**（按模型聚合调用次数 / token / 费用，费用降序排列并带占比条）、**使用记录明细**（时间 / 模型 / 服务商 / 输入·缓存·输出 token / 费用，最新在前，可加载更多）。页面每 30 秒自动刷新；数据全部来自本地记账文件（`usage-records.json`），不联网、不上传
- **数字加粗**：余额、倒计时、花费与统计数字统一加粗，一目了然
- **完整 / 简洁**：单击整条信息栏在两态间切换（防抖 + 严格两态）
- **余额预警**：余额低于 ¥20 时显示 ⚠

## 环境要求

- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai)（`dsh` CLI）并通过 Web 界面使用（`dsh web`）
- 已安装 [pnpm](https://pnpm.io/)（`dsh plugin` 依赖）

## 安装

### 方式一：一键脚本（推荐）

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # 默认安装到 web profile；可用 --profile <name> 指定
```

### 方式二：dsh 插件命令

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

> **安装后需重启 `dsh web`**：插件在宿主进程启动时组合加载，仅刷新页面不足以生效。

详细安装、故障排查与升级说明见 [docs/INSTALL.md](docs/INSTALL.md)。

## 使用

- **hover 查看详情**：余额金额、输入/缓存/输出单价、下次价格切换时刻、本对话花费（今天 / 近一月 / 全部）
- **单击信息栏**：切换 完整 / 简洁 两态
- **打开信息概览**：进入 **设置 → 信息概览**，或点击对话页顶部标签栏的「信息概览」标签

## 配置

- **API Key**：在 **设置 → 模型** 中配置 DeepSeek API Key（环境变量名 `DEEPSEEK_API_KEY`）。未配置时信息栏给出引导文案，其余功能不受影响。
- **模式**：按当前服务商自动切换 余额制 / 订阅制（`codex` / `chatgpt` / `opencode-go` / `opencode` / `openai-codex` → 订阅制，其余 → 余额制）；内部提供 `billingMode: 'auto' | 'balance' | 'subscription'` 开关（默认 `auto`）可强制指定模式。
- **数据口径**：高峰时段为北京时间 9:00–12:00、14:00–18:00；价格表内置 DeepSeek V4 系列与 OpenAI 参考价，未收录模型不参与花费统计。
- **订阅额度数据源**：
  - **ChatGPT（Codex）**：安装配套插件 [**dsh-chatgpt-subscription**](https://github.com/songoao25)（独立仓库）并绑定 ChatGPT 账号一次——该插件负责维护 `~/.codex/auth.json`（0600）中的令牌并注册 ChatGPT 模型。本信息栏**只读**该令牌查询额度（`chatgpt.com/backend-api/wham/usage`），**不续期、不写回、不注入凭据**；无令牌显示「未绑定 — 安装 dsh-chatgpt-subscription 授权」引导，令牌失效显示「重新绑定」引导。token 绝不打印 / 进日志 / 入库
  - **OpenCode Go**：在 **设置 → 模型** 配置 `OPENCODE_GO_API_KEY`，或先用 opencode CLI 登录订阅（写入 `~/.local/share/opencode/auth.json` 的 `opencode-go` 条目）。未配置时显示"未配置 OpenCode Go"引导，不报错。

#### ChatGPT 订阅：已知限制

- `chatgpt.com` 后端为**非公开接口**，可能随时变更或失效；失效时自动降级（保留上次快照、自动重试），绝不崩溃
- 可用模型以订阅计划为准，模型接入由配套插件 **dsh-chatgpt-subscription** 提供

### 数据存储（插件专属目录）

本插件的金额数据独立保存在自己的数据目录，与其他插件 / DSH 配置互不干扰：

```
~/.dsh/dsh-bottom-info-bar/
└── usage-records.json      # 逐请求记账明细（重启不丢失）
```

- **位置**：`~/.dsh/dsh-bottom-info-bar/`（目录权限 0700、文件权限 0600，仅当前用户可读）
- **覆盖**：设置环境变量 `DSH_BOTTOM_INFO_BAR_DATA_DIR` 可将整个数据目录改到别处（如移动硬盘 / 云同步目录）
- **内容**：每条记录为一次 `llm/stream` 请求的用量（`ts / model / provider / sessionId / input / cacheRead / cacheWrite / output`），**不含任何对话内容与 API Key**
- **上限**：最多保留 3000 条（按写入顺序裁剪）
- **花费口径**：按当前服务商币种聚合（DeepSeek 为 CNY，OpenAI 参考价为 USD），跨币种记录不混加；未收录模型不参与花费统计
- **清空**：删除该文件即重置全部统计（卸载插件不会自动删除，属你的数据）

## 卸载

```bash
cd dsh-bottom-info-bar
./uninstall.sh                        # 仅卸载插件
# 或：dsh plugin --profile web remove dsh-bottom-info-bar
```

ChatGPT 订阅（绑定与令牌维护）由独立插件 `dsh-chatgpt-subscription` 负责，卸载本信息栏插件不会触碰它。

重启后原生统计栏自动恢复，插件无残留（记账数据文件保留于 `~/.dsh/dsh-bottom-info-bar/`，如需重置统计请手动删除）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 安装后刷新页面没看到信息栏 | 需**重启** `dsh web`（宿主进程加载插件） |
| 余额显示「未配置 DEEPSEEK_API_KEY」 | 在 设置 → 模型 配置 DeepSeek Key |
| 余额显示「⚠ 刷新失败，显示上次快照」 | 网络/Key 临时故障，60s 后自动重试。**将鼠标悬停在警告上**可查看详细解释和重试时间 |
| 显示「未配置 OpenCode Go」 | 在 设置 → 模型 配置 `OPENCODE_GO_API_KEY`，或用 opencode CLI 登录 OpenCode Go |
| 如何绑定 ChatGPT 订阅？ | 安装配套插件 **dsh-chatgpt-subscription**，在官方页面用 ChatGPT 账号授权——它维护的令牌即本信息栏额度显示所读取的令牌 |
| ChatGPT 额度显示异常/为空 | wham 接口未公开、可能变更；失败自动保留上次快照并 60s 重试。**悬停 "⚠ 刷新失败"** 可查看重试说明 |
| 简洁模式为什么显示不同的窗口？ | 简洁模式优先显示时间最短的窗口（5小时 > 周 > 月），因为刷新最快。若 5 小时窗口不可用，则降级到周或月窗口。**额度与倒计时严格来自同一窗口**，确保信息匹配 |
| 为什么看不到模型的思考过程？ | DSH 界面层不渲染模型的内部思考过程，属 DSH 自身界面限制，非插件问题 |
| 想改回原生统计栏 | 卸载本插件并重启 |

## 开发

- **源码**：`plugin/src/host.js`（host）+ `plugin/src/client-bundle.js`（client）
- **构建**：`cd plugin && npm run build`（生成 `lib/`）
- **测试**：`node tests/run-all.mjs`

## 许可证

[MIT](LICENSE) © 2026 songoao25
