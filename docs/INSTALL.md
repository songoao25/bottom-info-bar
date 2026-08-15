# 安装 / 卸载 / 故障恢复

## 前置条件

- 已安装 DeepSeek Harness（`dsh` CLI 在 PATH 中）
- 已安装 [pnpm](https://pnpm.io/)
- 使用 Web 界面（`dsh web`）

## 安装

三种方式任选其一：

```bash
# 方式一：一键脚本（推荐）
git clone https://github.com/songoao25/bottom-info-bar.git
cd bottom-info-bar
./install.sh
# 默认安装到 web profile；指定其他 profile：
./install.sh --profile tui

# 方式二：dsh 插件命令
git clone https://github.com/songoao25/bottom-info-bar.git
dsh plugin --profile web add /path/to/bottom-info-bar/plugin
```

### 安装原理

`dsh plugin add` 会：

1. 用 pnpm 把插件包安装到 profile 目录（`~/.dsh/profiles/<name>/`）；
2. 检测到包声明了 `dsh.bundle`（`plugin/cordis.patch.yml`），自动把包名加入 profile 的 bundle 层列表（`dsh.profile.bundles`）；
3. 下次启动 `dsh` 时，插件随 profile 自动加载——host 注册 HTTP 路由、client 注入页面信息栏。

**注意：安装后需要重启 `dsh web`（或重启 DSH）才会生效**——宿主进程在启动时组合插件。刷新页面不足以加载 host 端。

### 验证安装成功

```bash
dsh --profile web --dump-config | grep -A2 bottom-info-bar
# 应看到 bottom-info-bar 行（bundle 层已生效）
```

重启后页面底部输入框下方出现信息栏即安装成功。

## 配置余额

在 **设置 → 模型** 中配置 DeepSeek API Key（环境变量名 `DEEPSEEK_API_KEY`）。
未配置时信息栏显示引导文案，其余功能（统计/定价/记账）不受影响。

## 更新版本

```bash
cd bottom-info-bar
git pull
dsh plugin --profile web update bottom-info-bar   # 用 pnpm 更新到新版本
# 重启 dsh web
```

## 卸载

```bash
cd bottom-info-bar
./uninstall.sh
# 或手动：
dsh plugin --profile web remove bottom-info-bar
```

重启后原生统计栏自动恢复（插件 unload 时槽位自动退位，这是 DSH 插槽特性），无残留文件。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 信息栏不出现 | ① 没重启：需重启 `dsh web`；② 装错 profile：确认启动用的 profile 与安装目标一致；③ `dsh --profile web --dump-config` 里没有 bottom-info-bar：重新执行安装 |
| 安装报 `pnpm not found` | 安装 pnpm：`npm i -g pnpm` 或 `corepack enable` |
| 安装报 `bottom-info-bar` 找不到 | 检查插件路径正确（`install.sh` 位于仓库根，内部自动指向 `plugin/` 子目录） |
| 余额显示未配置/刷新失败 | 见 README「常见问题」 |
| 想彻底回到原生状态 | 卸载 + 重启，系统统计栏自动恢复 |
