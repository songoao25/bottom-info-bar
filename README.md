# Bottom Info Bar（底部信息栏插件）

[![License: MIT](https://img.shields.io/github/license/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/bottom-info-bar)](https://github.com/songoao25/bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/bottom-info-bar/ci.yml)](https://github.com/songoao25/bottom-info-bar/actions)

> DeepSeek Harness 底部信息栏：替换对话输入框下方的原生统计栏，把「原生统计 + 模型与余额 + 峰谷定价 + 真实花费」合并为一条信息栏。安装一次，每次打开 DeepSeek Harness 自动生效。

*An information bar for DeepSeek Harness: replaces the native stats line under the composer with provider/model, live balance, peak/off-peak pricing with countdown, and real per-session spend.*

## 特性

- **一体替换**：默认替换原生统计栏，原生信息（轮·步 / LLM 耗时 / 工具调用 / 首 token 平均 / tok/s / 缓存命中 / 输入输出 tokens）照常显示、格式与原生一致
- **服务商 + 具体模型**：自动识别并美化显示（DeepSeek V4 Flash、Kimi K3、GLM 4.6 …），服务商名加粗
- **真实余额**：DeepSeek `/user/balance` 真实 API，60 秒自动刷新；失败保留上次快照并提示，不中断使用
- **峰谷价 + 倒计时**：高峰价（琥珀色加粗）/ 空闲价（绿色加粗）+ 距下次切换倒计时；无峰谷价的服务商自动隐藏
- **真实花费**：逐请求记账（`llm/stream` usage × 单价），本对话 / 今天 / 近一月 / 全部 精确聚合，**记账数据落盘持久化（重启不丢失）**
- **数字加粗**：余额、倒计时、花费与统计数字统一加粗，一目了然
- **完整 / 简洁**：单击整条信息栏在两态间切换（防抖 + 严格两态）
- **预警**：余额低于 ¥20 时显示 ⚠

## 安装

需要：已安装 DeepSeek Harness（`dsh` CLI）与 [pnpm](https://pnpm.io/)，使用 Web 界面（`dsh web`）。

### 方式一：一键脚本（推荐）

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
cd bottom-info-bar
./install.sh            # 默认安装到 web profile；可用 --profile <name> 指定
```

### 方式二：dsh 插件命令

```bash
git clone https://github.com/songoao25/bottom-info-bar.git
dsh plugin --profile web add /path/to/bottom-info-bar/plugin
```

安装完成后**重启 DeepSeek Harness**（或刷新页面），底部信息栏自动出现，无需任何手动操作。

详细说明见 [docs/INSTALL.md](docs/INSTALL.md)。

## 使用

- **hover 查看详情**：余额（余额金额）、高峰价/空闲价（输入/缓存/输出单价）、倒计时（下次切换时刻）、本对话花费（今天 / 近一月 / 全部）
- **单击信息栏**：切换 完整 / 简洁 两态

## 配置

- 余额需要配置 DeepSeek API Key：在 **设置 → 模型** 中填写（环境变量名 `DEEPSEEK_API_KEY`）。未配置时信息栏会给出引导文案，不影响其他功能。
- 数据口径：高峰时段为北京时间 9:00–12:00、14:00–18:00；价格表内置 DeepSeek V4 系列与 OpenAI 示例价，未收录模型不参与花费统计。

### 数据存储（插件专属目录）

本插件的金额数据独立保存在自己的数据目录，与其他插件 / DSH 配置互不干扰：

```
~/.dsh/bottom-info-bar/
└── usage-records.json      # 逐请求记账明细（重启不丢失）
```

- **位置**：`~/.dsh/bottom-info-bar/`（目录权限 0700、文件权限 0600，仅当前用户可读）；
- **覆盖**：设置环境变量 `BOTTOM_INFO_BAR_DATA_DIR` 可把整个数据目录改到别处（如移动硬盘 / 云同步目录）；
- **内容**：每条记录为一次 `llm/stream` 请求的用量（`ts / model / provider / sessionId / input / cacheRead / cacheWrite / output`），不包含任何对话内容与 API Key；
- **上限**：最多保留 3000 条（按写入顺序裁剪）；
- **花费口径**：按**当前服务商币种**聚合（DeepSeek 为 CNY，OpenAI 示例价为 USD），跨币种记录不混加；未收录模型不参与花费统计；
- **清空**：删除该文件即重置全部统计（卸载插件不会自动删除，属你的数据）。

## 卸载

```bash
cd bottom-info-bar
./uninstall.sh
# 或：dsh plugin --profile web remove bottom-info-bar
```

重启后原生统计栏自动恢复，插件无残留（记账数据文件保留于 `~/.dsh/bottom-info-bar/`，可手动删除清空统计）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 安装后刷新页面没看到信息栏 | 需**重启** `dsh web`（宿主进程加载插件） |
| 余额显示"未配置 DEEPSEEK_API_KEY" | 在 设置→模型 配置 DeepSeek Key |
| 余额显示"⚠ 刷新失败，显示上次快照" | 网络/Key 临时故障，60s 后自动重试 |
| 想改回原生统计栏 | 卸载本插件并重启 |

## 开发

- 源码：`plugin/src/host.js`（host）+ `plugin/src/client-bundle.js`（client）
- 构建：`cd plugin && npm run build`（生成 `lib/`）
- 测试：`node tests/run-all.mjs`

## 许可证

[MIT](LICENSE)
