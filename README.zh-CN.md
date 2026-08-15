# Bottom Info Bar（底部信息栏插件）

[**English**](README.md) | **中文**

[![License: MIT](https://img.shields.io/github/license/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/bottom-info-bar/ci.yml)](https://github.com/songoao25/bottom-info-bar/actions)

为 [DeepSeek Harness](https://github.com/deepseek-ai) 设计的单行信息栏：替换对话输入框下方的原生统计栏，把「**服务商与模型 + 实时余额 + 峰谷定价 + 真实花费**」合并为一条，一眼看清。安装一次，每次启动自动生效。

## 特性

- **一体替换**：默认替换原生统计栏，原生信息（轮·步 / LLM 耗时 / 工具调用 / 首 token 平均 / tok/s / 缓存命中 / 输入输出 tokens）照常显示、格式与原生一致
- **服务商 + 具体模型**：自动识别并美化显示（DeepSeek V4 Flash、Kimi K3、GLM 4.6 …），服务商名加粗
- **实时余额**：DeepSeek `/user/balance` 真实 API，60 秒自动刷新；失败保留上次快照并提示，不中断使用
- **峰谷价 + 倒计时**：高峰价（琥珀色加粗）/ 空闲价（绿色加粗）+ 距下次切换倒计时；无峰谷价的服务商自动隐藏
- **真实花费**：逐请求记账（`llm/stream` usage × 单价），按 **本对话 / 今天 / 近一月 / 全部** 精确聚合，**记账数据落盘持久化（重启不丢失）**
- **数字加粗**：余额、倒计时、花费与统计数字统一加粗，一目了然
- **完整 / 简洁**：单击整条信息栏在两态间切换（防抖 + 严格两态）
- **余额预警**：余额低于 ¥20 时显示 ⚠

## 环境要求

- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai)（`dsh` CLI）并通过 Web 界面使用（`dsh web`）
- 已安装 [pnpm](https://pnpm.io/)（`dsh plugin` 依赖）

## 安装

### 方式一：一键脚本（推荐）

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
cd bottom-info-bar
./install.sh                # 默认安装到 web profile；可用 --profile <name> 指定
```

### 方式二：dsh 插件命令

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
dsh plugin --profile web add /path/to/bottom-info-bar/plugin
```

> **安装后需重启 `dsh web`**：插件在宿主进程启动时组合加载，仅刷新页面不足以生效。

详细安装、故障排查与升级说明见 [docs/INSTALL.md](docs/INSTALL.md)。

## 使用

- **hover 查看详情**：余额金额、输入/缓存/输出单价、下次价格切换时刻、本对话花费（今天 / 近一月 / 全部）
- **单击信息栏**：切换 完整 / 简洁 两态

## 配置

- **API Key**：在 **设置 → 模型** 中配置 DeepSeek API Key（环境变量名 `DEEPSEEK_API_KEY`）。未配置时信息栏给出引导文案，其余功能不受影响。
- **数据口径**：高峰时段为北京时间 9:00–12:00、14:00–18:00；价格表内置 DeepSeek V4 系列与 OpenAI 参考价，未收录模型不参与花费统计。

### 数据存储（插件专属目录）

本插件的金额数据独立保存在自己的数据目录，与其他插件 / DSH 配置互不干扰：

```
~/.dsh/bottom-info-bar/
└── usage-records.json      # 逐请求记账明细（重启不丢失）
```

- **位置**：`~/.dsh/bottom-info-bar/`（目录权限 0700、文件权限 0600，仅当前用户可读）
- **覆盖**：设置环境变量 `BOTTOM_INFO_BAR_DATA_DIR` 可将整个数据目录改到别处（如移动硬盘 / 云同步目录）
- **内容**：每条记录为一次 `llm/stream` 请求的用量（`ts / model / provider / sessionId / input / cacheRead / cacheWrite / output`），**不含任何对话内容与 API Key**
- **上限**：最多保留 3000 条（按写入顺序裁剪）
- **花费口径**：按当前服务商币种聚合（DeepSeek 为 CNY，OpenAI 参考价为 USD），跨币种记录不混加；未收录模型不参与花费统计
- **清空**：删除该文件即重置全部统计（卸载插件不会自动删除，属你的数据）

## 卸载

```bash
cd bottom-info-bar
./uninstall.sh
# 或：dsh plugin --profile web remove bottom-info-bar
```

重启后原生统计栏自动恢复，插件无残留（记账数据文件保留于 `~/.dsh/bottom-info-bar/`，如需重置统计请手动删除）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 安装后刷新页面没看到信息栏 | 需**重启** `dsh web`（宿主进程加载插件） |
| 余额显示「未配置 DEEPSEEK_API_KEY」 | 在 设置 → 模型 配置 DeepSeek Key |
| 余额显示「⚠ 刷新失败，显示上次快照」 | 网络/Key 临时故障，60s 后自动重试 |
| 想改回原生统计栏 | 卸载本插件并重启 |

## 开发

- **源码**：`plugin/src/host.js`（host）+ `plugin/src/client-bundle.js`（client）
- **构建**：`cd plugin && npm run build`（生成 `lib/`）
- **测试**：`node tests/run-all.mjs`

## 许可证

[MIT](LICENSE) © 2026 songoao25
