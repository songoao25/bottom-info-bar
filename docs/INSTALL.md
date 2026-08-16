# 安装 / 卸载 / 故障恢复

## 前置条件

- 已安装 DeepSeek Harness（`dsh` CLI 在 PATH 中）
- 已安装 [pnpm](https://pnpm.io/)
- 使用 Web 界面（`dsh web`）

## 安装

两种方式任选其一：

```bash
# 方式一：一键脚本（推荐）
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh
# 默认安装到 web profile；其他 profile 需以 `dsh web` 方式使用：
./install.sh --profile <profile名>

# 方式二：dsh 插件命令（先构建，plugin/lib/ 由 build 生成、不入 git）
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar/plugin && node scripts/build.mjs
cd ..
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

### 安装原理

`dsh plugin add` 会：

1. 用 pnpm 把插件包安装到 profile 目录（`~/.dsh/profiles/<name>/`）；
2. 检测到包声明了 `dsh.bundle`（`plugin/cordis.patch.yml`），自动把包名加入 profile 的 bundle 层列表（`dsh.profile.bundles`）；
3. 下次启动 `dsh` 时，插件随 profile 自动加载——host 注册 HTTP 路由、client 注入页面信息栏。

**注意：安装后需要重启 `dsh web`（或重启 DSH）才会生效**——宿主进程在启动时组合插件。刷新页面不足以加载 host 端。

### 验证安装成功

```bash
dsh --profile web --dump-config | grep -A2 dsh-bottom-info-bar
# 应看到 dsh-bottom-info-bar 行（bundle 层已生效）
```

重启后页面底部输入框下方出现信息栏即安装成功。

## 配置余额

在 **设置 → 模型** 中配置 DeepSeek API Key（环境变量名 `DEEPSEEK_API_KEY`）。
未配置时信息栏显示引导文案，其余功能（统计/定价/记账）不受影响。

## 配置订阅额度（可选，v1.1.0）

信息栏会自动检测当前模型所属模式：**订阅制**（Codex / OpenCode Go）显示三窗口额度，**余额制**（DeepSeek 等）显示余额。订阅额度数据源：

- **Codex / ChatGPT**：信息栏**只读** `~/.codex/auth.json` 中的 access_token 查询额度（`chatgpt.com/backend-api/wham/usage`），token 仅在本机内存中使用，不落盘、不记录、不续期、不写回。令牌的**绑定 / 续期**由独立插件 [**dsh-chatgpt-subscription**](https://github.com/songoao25)（独立仓库）负责——安装并绑定后，本信息栏即可显示订阅额度；令牌缺失或失效时信息栏显示「未绑定 / 重新绑定」引导。
- **OpenCode Go**：在 **设置 → 模型** 配置 `OPENCODE_GO_API_KEY`（或先用 opencode CLI 登录其订阅，写入 `~/.local/share/opencode/auth.json` 的 `opencode-go` 条目）。未配置时信息栏显示"未配置 OpenCode Go"引导，不报错。

## 更新版本

```bash
cd dsh-bottom-info-bar
git pull
dsh plugin --profile web update dsh-bottom-info-bar   # 用 pnpm 更新到新版本
# 重启 dsh web
```

## 卸载

```bash
cd dsh-bottom-info-bar
./uninstall.sh
# 或手动：
dsh plugin --profile web remove dsh-bottom-info-bar
```

重启后原生统计栏自动恢复（插件 unload 时槽位自动退位，这是 DSH 插槽特性）。插件代码无残留；记账数据文件 `~/.dsh/dsh-bottom-info-bar/usage-records.json` 属持久化数据，卸载不会删除，如需清空统计请手动删除。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 信息栏不出现 | ① 没重启：需重启 `dsh web`；② 装错 profile：确认启动用的 profile 与安装目标一致；③ `dsh --profile web --dump-config` 里没有 dsh-bottom-info-bar：重新执行安装 |
| 安装报 `pnpm not found` | 安装 pnpm：`npm i -g pnpm` 或 `corepack enable` |
| 安装报 `dsh-bottom-info-bar` 找不到 | 检查插件路径正确（`install.sh` 位于仓库根，内部自动指向 `plugin/` 子目录） |
| 余额显示未配置/刷新失败 | 见 README「常见问题」 |
| 想彻底回到原生状态 | 卸载 + 重启，系统统计栏自动恢复 |
