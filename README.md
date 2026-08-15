# Bottom Info Bar（底部信息栏插件）

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
- 记账数据：持久化保存于 `~/.dsh/bottom-info-bar/usage-records.json`（重启不丢失；删除该文件即清空统计）。

## 卸载

```bash
cd bottom-info-bar
./uninstall.sh
# 或：dsh plugin --profile web remove bottom-info-bar
```

重启后原生统计栏自动恢复，无残留。

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
