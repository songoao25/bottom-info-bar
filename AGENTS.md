# AGENTS.md — 给 AI 编码助手/Agent 的仓库说明

本文件帮助 AI 编码助手（如 DeepSeek Harness、Cursor、Claude Code 等）快速理解本仓库。

## 这是什么

「底部信息栏」——DeepSeek Harness（DSH）的一个插件（plugin）。把输入框下面那行原生统计信息换成单行信息栏：服务商与模型、实时余额、高峰/低谷定价及倒计时、按会话/今日/本月/累计的真实花费。装一次，每次启动自动生效。自动识别订阅制（Codex / OpenCode Go）还是余额制，两种模式互斥不重叠。

## 仓库结构

- `plugin/` — 插件本体
  - `plugin/cordis.patch.yml` — 插件组合补丁
  - `plugin/package.json` — 依赖与脚本
  - `plugin/src/` — 源码
  - `plugin/scripts/` — 构建脚本
- `install.sh` / `uninstall.sh` — 一键安装/卸载（默认装到 web profile，可用 --profile 覆盖）
- `tests/` — 静态/烟雾测试与多个单测（dual-mode、display-name、density-toggle、spend-accounting、static-client）
- `docs/` — INSTALL、DUAL-MODE-DESIGN、OPENCODE-GO-SUPPORT-EVAL
- `.github/` — CI、CodeQL、Dependabot、Issue/PR 模板

## 关键约定

- 修改 `plugin/` 后需重启 `dsh web`（插件在宿主启动时组合，刷新页面不够）
- 订阅配额只读：本插件只读 `~/.codex/auth.json` 与 OpenCode Go 配额接口来显示，不负责绑定/刷新/路由；绑定 ChatGPT 账号请装配套插件 dsh-chatgpt-subscription（独立仓库）
- 花费记录持久化到 `~/.dsh/dsh-bottom-info-bar/usage-records.json`，重启不丢
- 对外文档（README/CHANGELOG）只写用户视角功能，严禁开发过程流水账与内部代号
- 提交遵循 Conventional Commits（feat/fix/docs/test/chore）
- 分发铁律：零密钥、零个人路径、作者署名 songoao25、只用语义化版本号

## 常用命令

- 安装：`./install.sh`；卸载：`./uninstall.sh`
- 用 dsh plugin 命令安装：`dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin`
- 跑测试：见 `tests/run-all.mjs`
- CI 检查项：`.github/workflows/ci.yml`
