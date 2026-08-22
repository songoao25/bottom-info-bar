# 插件更新机制二次调研（V2）：npm 一行更新可行性 + 市场案例 + 推荐架构

> 调研人：产品调研工程师（虚拟产品团队）｜日期：2026-08-20
> 任务：重新研究插件更新——重点回答 ① DSH 安装/更新真实机制（npm 包 / package.json / dsh plugin add-update-remove / pnpm link 与 npm 包安装差异 / plugin 子目录发布 npm 的方法）；② "npm 一行更新"能否变成用户可用方式（给证据与验证命令）；③ 市场真实案例（VS Code / Obsidian / Raycast / Homebrew / npm CLI / Claude Code / Cline）；④ 面向非技术个人开发者的最终架构推荐（npm 发布 + DSH 加载 + 检查/提示/更新职责 + 安全/回滚/版本通知）。
> 只调研与评估：不改代码、不 commit。上一份结论（UPDATE-RESEARCH.md）中与本报告冲突之处，以本报告（基于源码与官方文档的第一手证据）为准。

---

## 0. 结论摘要（TL;DR）

- **DSH 的 `dsh plugin` 命令就是 pnpm 转发器**（本机已读其源码 lib/plugin-9h8shc4d.js，129 行）：`dsh plugin --profile <name> add/update/remove ...` = 在 profile 目录里执行 `pnpm ...`，成功后自动把「声明了 `dsh.bundle` 的依赖」登记进 `dsh.profile.bundles`。**没有独立的插件更新机制，更新能力完全等于 pnpm 的更新能力。**
- **npm 一行更新是可行的，但有硬前提**：插件必须**先发布到 npm registry**（当前 `dsh-bottom-info-bar` 未发布，registry 实测 `Not Found`）。发布后：
  - 安装一行：`dsh plugin --profile web add dsh-bottom-info-bar`
  - 更新一行：`dsh plugin --profile web update dsh-bottom-info-bar --latest`
  - 回滚一行：`dsh plugin --profile web add dsh-bottom-info-bar@1.3.0`
  - 这三行都由官方机制 + 源码证明可用（registry 依赖 pnpm 可解析，reconcile 保证 bundle 仍在层栈）。
- **对当前 symlink 安装形态（本插件现状，`link:` 绝对路径 + node_modules symlink），任何 npm/pnpm 更新命令都无效**——link 内容就是本地目录本身，pnpm 永远认为它"已是最新"。这类用户只能走 git 更新（fetch + checkout tag + 重建 + 重启）。
- **npm 包发布本身零障碍**：`plugin/` 已自成完整 npm 包（package.json 声明 name/version/files/prepack 构建，lib/、cordis.patch.yml、README.md、LICENSE 全在场），`cd plugin && npm publish` 即可；无需根 package.json；**不需要 install/postinstall 脚本**（tarball 里带构建产物，规避 pnpm 的 allowBuilds 拦截）。
- **市场共识**：检查要低频（小时级）；**"提示更新 + 用户确认执行"是默认**，无人值守全自动只出现在有签名/官方市场等强信任基础的产品（VS Code、Raycast）；"更新后重启生效"是普遍接受的模式；跳过版本、发布说明、回滚是标配；Claude Code 的市场自动 pull 屡屡失效，说明"全自动"连大厂都做不稳。
- **推荐架构（第 4 章）**：双轨分发（symlink 用户走 git、registry 用户走 pnpm 一行）+ 宿主插件做"检查+提示"（npm registry 为源）+ **更新执行交给外部命令/脚本**（update.sh），不推荐宿主进程内自更新；安全靠"来源固定 + 不自动执行 + 用户确认 + 可回滚"。

---

## 1. DSH 插件安装/更新机制实证（源码级）

### 1.1 `dsh plugin` = pnpm 转发器（第一手源码）

本机 dsh 版本 0.1.0-rc.7，安装于 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/`。其 `lib/plugin-9h8shc4d.js`（129 行）实现 `dsh plugin`，关键代码逻辑：

1. **初始化**：profile 目录（`$DSH_HOME/profiles/<name>`）没有 package.json 时，用 `initProfile` 创建（默认首个 bundle 为 `@deepseek-ai/dsh-base`）。
2. **转发**：`spawnSync("pnpm", args, { cwd: profileDir })` —— 把 `dsh plugin` 后面的所有参数**原样转发给 pnpm**（`add`/`remove`/`update`/`why` 等 pnpm 子命令照常可用）。
3. **对账（reconcile）**：pnpm 成功后执行 `reconcilePlugins` —— 扫描 profile 的 dependencies，凡解析到的包声明了 `dsh.bundle.patch` 就**加入** `dsh.profile.bundles`；被移除或新版失去 `dsh.bundle` 声明的就**移出**。源码注释原文：*"Reconciling by installed state, not by dependency diff, means `update` activates a package that gained its `dsh.bundle` declaration in a newer version"*（按安装后状态对账，所以 `update` 能让"新版才声明 bundle"的包自动激活）。
4. **路径锚定**：相对路径 spec（`.`/`../plugin`/`file:`/`link:` 形式）会锚定到用户执行 dsh 时的 cwd，防止 `add .` 把 profile 自己链接进去；绝对路径、registry 包名、git spec 原样透传。
5. **git 安装提示**：git spec 安装失败时提示把 pnpm 打印的 key 加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`（本机 web profile 的 pnpm-workspace.yaml 已见 `allowBuilds: {'@jackwener/opencli': true}`，机制在起作用）。

> **含义**：`dsh plugin update` 存在，但语义 = pnpm update；对 `link:` 本地目录依赖无效（见 1.3）。

### 1.2 本地开发安装形态（symlink）

`~/.dsh/profiles/web/package.json`：

```json
"dependencies": {
  "dsh-bottom-info-bar": "link:/path/to/dsh-bottom-info-bar/plugin",
  "dsh-chatgpt-subscription": "link:/path/to/dsh-chatgpt-subscription",
  ...
},
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-bottom-info-bar", ...] } }
```

`node_modules/dsh-bottom-info-bar` 是指向本地插件目录的符号链接。

→ `link:` 安装会使 node_modules 指向本地 git checkout；这是开发安装形态，不代表 npm 用户的安装形态。

### 1.3 pnpm link/symlink 安装 vs npm registry 包安装的差异

| 维度 | `link:` 本地目录（现状） | registry 包（未来 npm 发布后） | `github:`/git spec（不推荐） |
|---|---|---|---|
| node_modules 形态 | **symlink 指向本地源码目录** | pnpm store 内容寻址 + 硬链接 | pnpm store 下载的 ref tarball |
| package.json 记录 | `"pkg": "link:/abs/path"` | `"pkg": "^1.3.0"`（pnpm add 默认 ^range） | `"pkg": "github:user/repo"` |
| `pnpm update <pkg>` | **无效（no-op）**：内容=本地目录，无版本可解析 | 有效：按 range 解析 registry 最新版，回写新 range | 有效但不可靠（见下） |
| 更新语义 | 只能靠 git fetch/checkout | 一行 `dsh plugin ... update --latest` | ref 重解析 |
| 是否可回滚 | git checkout 旧 tag | 一行 `add pkg@旧版本` | 改 ref |

- pnpm 官方文档（pnpm.io/cli/update）：`pnpm update` 按 package.json 的 range 把依赖解析到最新版本并**回写新 range**；`--latest` 强制到最新稳定版。**这一切的前提是"版本可解析"——link 依赖没有版本概念**。
- git 依赖的坑（规避理由）：pnpm 曾有 commit（f394cfc，*"not update git protocol dependency"*）修复 git 协议依赖不更新的问题；且上一份调研已实测 `pnpm add github:songoao25/dsh-bottom-info-bar/plugin` 失败（pnpm github: 协议不支持子目录路径）。→ **git spec 不做主路径**。

### 1.4 npm 包安装路径是官方一等公民（bundle 概念 + 真实上架先例）

- 官方文档（docs/user/develop/basic/publish.md）：**bundle = 一个 npm 包**，其 package.json 声明 `dsh.bundle.patch`；**profile = 一个目录**，声明 `dsh.profile.bundles`。安装教程：`dsh plugin --profile demo add ./hello-plugin`（本地目录），官方同样支持 registry 包名（`dsh plugin` 把参数透传给 pnpm，pnpm 支持 registry 名）。`dsh plugin --profile demo remove dsh-hello-plugin` 同时移除依赖与 layer。
- **真实上架先例（npm 实测）**：`dsh-plugin-manager-community@0.1.3` 已在 npm registry，其 manifest 声明 `dsh.bundle.patch: ./cordis.patch.yml` + `client.inject`（web 平台），与我们插件的形态完全同构 → **npm 分发 DSH bundle 是社区已验证的路径**。
- 本插件状态实测：`GET https://registry.npmjs.org/dsh-bottom-info-bar/latest` → `Not Found`（尚未发布）。

### 1.5 monorepo/plugin 子目录如何发布 npm（本仓库现状已满足）

`plugin/` 已经是**自足 npm 包**：

```
plugin/
├── package.json   # name: dsh-bottom-info-bar, version: 1.3.0, type: module
├── cordis.patch.yml  # dsh.bundle.patch
├── lib/           # 构建产物（scripts/build.mjs 生成，含 index.js/client.js）
├── README.md / LICENSE
└── scripts/build.mjs
```

- package.json 的 `files: ["lib", "cordis.patch.yml", "README.md", "LICENSE"]`、`prepack: "npm run build"`、`exports`（含 `./client`、`./cordis.patch.yml`）**全部就绪**。
- 发布方法：`cd plugin && npm publish`（或先 `npm pack` 预览 tarball）。**不需要在仓库根放 package.json**；也不需要 npm workspaces（plugin/ 无本地依赖需要 workspace 解析）。
- `publishConfig.directory` 不是 npm publish 原生子目录发布机制（那是 changesets 等工具链约定），**本仓库用"在 plugin/ 目录里 publish"即可**，CI 里 `working-directory: plugin` 一行配置。
- **install script 问题**：tarball 里自带构建产物 → **安装时零脚本**，不被 pnpm 的 `allowBuilds` 拦截（本机 profile 的 pnpm-workspace.yaml 已证明该拦截机制存在，能避开就避开）。`prepack` 保证发布瞬间重新构建，避免手残把旧 lib/ 发上去。
- 备选安装源（同一发布流程的副产品）：`npm pack` 得到 `dsh-bottom-info-bar-1.3.0.tgz`，可挂到 GitHub Release 资产上，用户 `dsh plugin --profile web add ./dsh-bottom-info-bar-1.3.0.tgz`（pnpm 按 tarball 安装，非 symlink）——覆盖"离线 / 不想用 npm"的用户，更新 = 换新 tarball 重装。

### 1.6 `dsh plugin` 各子命令语义与验证命令

| 命令（registry 安装后） | 语义 | 来源证据 |
|---|---|---|
| `dsh plugin --profile web add dsh-bottom-info-bar` | pnpm add 最新版 + 加入 bundles | publish.md + 源码 reconcile |
| `dsh plugin --profile web add dsh-bottom-info-bar@1.3.0` | 装指定版本（回滚用） | pnpm add 语义 |
| `dsh plugin --profile web update dsh-bottom-info-bar --latest` | 仅更新本插件到最新（**必须带包名**，裸 `update` 会更新 profile 里所有插件） | pnpm update 官方文档 + 源码转发 |
| `dsh plugin --profile web remove dsh-bottom-info-bar` | 移除依赖 + bundles 层 | publish.md |
| `dsh plugin --profile web why dsh-bottom-info-bar` | 查看依赖原因 | pnpm why |
| `dsh plugin --profile web add ./xxx.tgz` | 从 tarball 安装 | pnpm add 本地文件 |

---

## 2. "npm 一行更新"能否变成用户可用方式 —— 能，但必须先发布 npm

### 2.1 结论

| 候选方式 | 对当前 symlink 用户 | 对 registry 用户（npm 发布后） | 判定 |
|---|---|---|---|
| `dsh plugin --profile web update dsh-bottom-info-bar --latest` | ✗ 无效（link 无版本可解析） | ✓ **一行更新**（pnpm 转发，官方机制） | **推荐主路径** |
| `dsh plugin --profile web add dsh-bottom-info-bar` | ✗ 会用 registry 包**替换** link 安装（等于改安装形态） | ✓ 一行安装/重装 | 安装主路径 |
| `pnpm update`（在 profile 目录裸跑） | ✗ | ⚠️ 会更新**所有**插件依赖（殃及其他插件），需限定包名 | 不推荐裸用 |
| `npm install -g ...` | ✗ 不适用 | ✗ 不适用 | 插件不是全局包；npm 全局只能更新 dsh 本体 |
| `npx` 包装器（发布独立 updater 小工具） | 部分（npx 拉新工具执行 git/pnpm 更新） | ✓ 技术上可行 | 二线方案，非技术用户徒增工具负担 |
| 宿主插件内 spawn pnpm 自更新 | ✗（link 更新不了） | ⚠️ 有竞态与自更新悖论（见 4.2） | 不推荐 |

### 2.2 证据链（为什么上面判定成立）

1. **机制证据（源码）**：`dsh plugin` 把参数原样转发给 pnpm（`spawnSync("pnpm", args, {cwd: profileDir})`），成功后 reconcile 到 bundles——源码第 1.1 节已引。pnpm 官方文档确认 `update <pkg> --latest` 把依赖升级到最新并回写 range。
2. **状态证据（本机）**：web profile 依赖是 `link:` 绝对路径，node_modules 是 symlink（1.2 节）→ pnpm 无从解析新版本 → 更新命令必然无效。这是"当前用户无法用 npm 更新"的根因，**不是 DSH 缺能力，是安装形态问题**。
3. **发布状态证据（npm 实测）**：`registry.npmjs.org/dsh-bottom-info-bar/latest` → `Not Found`；对照 `dsh-plugin-manager-community` 已上架且可正常被 pnpm 解析。→ 先发布，才有 registry 一行更新。
4. **先例证据**：dsh 本体 `@deepseek-ai/dsh` 在 npm 上（bin: dsh，dist 带 integrity + Sigstore signatures），用户安装 dsh 本身就是 npm 分发；社区 bundle `dsh-plugin-manager-community` 已上架。

### 2.3 验证命令清单（团队可逐步执行，不污染用户 web profile）

> 前 4 条用**临时 profile**（`--profile updatetest`）验证，完事 `rm -rf ~/.dsh/profiles/updatetest`，绝不动 web profile。

```bash
# ① 证明 link 安装 + update 无效（临时 profile）
mkdir -p /tmp/updtest-plugin && cd /tmp/updtest-plugin
#   （放一个最小 bundle package.json：name/version/main + dsh.bundle.patch）
dsh plugin --profile updatetest add /tmp/updtest-plugin
grep -A3 '"dependencies"' ~/.dsh/profiles/updatetest/package.json   # 期望 link:/tmp/updtest-plugin
dsh plugin --profile updatetest update                              # 期望：pnpm 认为已最新，无任何更新
# ② 证明 registry 包可被 dsh plugin 解析并进 bundles（用已上架的社区 bundle）
dsh plugin --profile updatetest add dsh-plugin-manager-community
grep '"bundles"' -A6 ~/.dsh/profiles/updatetest/package.json        # 期望出现 dsh-plugin-manager-community
# ③ 证明 update 指定包名 + --latest 语义
dsh plugin --profile updatetest update dsh-plugin-manager-community --latest
# ④ 回滚语义
dsh plugin --profile updatetest add dsh-plugin-manager-community@0.1.2
# ⑤ 发布前预览 tarball（不发布）
cd /path/to/dsh-bottom-info-bar/plugin && npm pack --dry-run
# ⑥ 发布后（真实用户路径，web profile）：
#    ./install.sh 改版为: dsh plugin --profile web add dsh-bottom-info-bar
#    update.sh:      dsh plugin --profile web update dsh-bottom-info-bar --latest && 提示重启
```

### 2.4 必要条件与代价（必须如实告知用户）

- **必须把 bundle 发布到 npm**（公开包 `dsh-bottom-info-bar`）：需要 npm 账号 / NPM_TOKEN（CI 自动发布），仓库需配置 secret——这是与 dsh-song-memory 相同的发布流程改造（该仓库已跑通 npm 上架，本仓库未做）。
- 发布后**新装用户**走 registry；**存量 symlink 用户**（含本机）安装形态不变，仍走 git 更新——所以更新机制必须双轨。
- 无论哪种更新，**都要重启 `dsh web` 才生效**（插件在启动组合时加载，官方文档与 AGENTS.md 一致）。

---

## 3. 市场真实案例（基于当前官方文档，已更新）

| 产品 | 检查 | 更新执行 | 重启 | 安全/信任措施 | 来源 |
|---|---|---|---|---|---|
| **VS Code 扩展** | 自动检查（内置 update service） | **自动安装**（静默下载，`extensions.autoUpdateDelay` 默认 **2 小时**，设 0 即发布即装）；可全局/单扩展关闭；`@updates` + Update All | 更新后**提示重启扩展宿主** | 官方 Marketplace 校验扩展 ID/发布者/内容哈希 | [官方文档](https://code.visualstudio.com/docs/editor/extension-marketplace) |
| **Obsidian 社区插件** | App 内设置页显示可更新项 | **用户手动点更新**（不自动安装） | 手动重载 | obsidian-releases 清单（community-plugins.json + versions.json 声明兼容范围）、社区审核、构建来源 provenance 徽章 | [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)、[官方论坛](https://forum.obsidian.md/t/verify-and-surface-build-provenance-for-community-plugins-trust-badges-now-provenance-drift-protection-on-updates-later/116923) |
| **Raycast 扩展** | Raycast App 内置 | **全自动更新**（store 单一 implicit latest 模型，作者不管理版本号） | 无感 | 官方 Store 审核 + API 兼容性检查（不匹配提示先升级 Raycast） | [官方 versioning 文档](https://developers.raycast.com/information/versioning) |
| **Homebrew** | 部分命令前**自动 `brew update`**（`HOMEBREW_AUTO_UPDATE_SECS` 控制周期，`HOMEBREW_NO_AUTO_UPDATE` 可关） | **升级本身要用户执行 `brew upgrade`** | 视软件而定 | formula/cask 由官方仓库 + 审计维护 | [官方 manpage](https://docs.brew.sh/Manpage) |
| **npm CLI 工具** | 无统一机制；`npm update -g` 手动 | 显式命令（`npm i -g npm@latest`、`gh`、`bun upgrade`、`volta upgrade`）；update-kit 类库演示"启动检查提示 + 按安装渠道自适应的显式应用"模式 | 重开终端 | npm integrity (sha512) + Sigstore 签名 | [update-kit](https://github.com/syi0808/update-kit)、npm registry 实测（@deepseek-ai/dsh 带 signatures） |
| **Claude Code marketplace** | `autoUpdate: true` 时启动 git pull（官方支持） | 启动时自动 pull（无人值守） | 新会话 | git 仓库即市场 | [官方 settings](https://code.claude.com/docs/zh-CN/settings)；**可靠性翻车实证**：[#67868](https://github.com/anthropics/claude-code/issues/67868)、[#26744](https://github.com/anthropics/claude-code/issues/26744)、[#41885](https://github.com/anthropics/claude-code/issues/41885)（fetch 但不 pull，更新不生效） |
| **Cline / Electron 桌面应用** | 启动/定时检查 | 后台下载 + **重启时安装**；或提示后安装 | 是 | 安装包签名（macOS 公证 / Windows 签名）、**失败自动回滚** | [electron-builder auto-update](https://www.electron.build/docs/features/auto-update)、[cline PR #13321](https://github.com/cline/cline/pull/13321) |
| **obsidian-github-updater**（与本场景最像的非官方直更工具） | 启动后检查 + 手动 Check Now | **用户手动点按钮** | 手动重载 | 语义化版本比较、忽略某版本、展示发布说明 | [仓库](https://github.com/Real-Fruit-Snacks/obsidian-github-updater) |

### 提炼出的业界共识（V2 更新版）

1. **默认"提示更新 + 用户确认执行"**；全自动只出现在有**签名/官方市场/内容哈希**等强信任基础的产品（VS Code、Raycast），且即便如此也要配"重启生效"提示。
2. **检查低频**：2 小时（VS Code 默认）~ 启动一次（obsidian-github-updater），从不高频轮询。
3. **"更新后重启生效"是普遍接受且必须明示的模式**（VS Code 重启扩展宿主 / Electron 重启安装）。
4. **跳过版本、发布说明、失败回滚是标配**；无人值守自动更新存在真实可靠性坑（Claude Code 案例：fetch 不 pull、启动节流），连大厂都翻车。
5. 更新源必须**固定且可校验**（官方市场 / 固定仓库 / npm registry + integrity）。

---

## 4. 推荐最终架构（面向非技术个人开发者）

### 4.1 用户画像约束（决定架构的出发点）

- 用户无技术背景：**零命令行、零理解成本、坏了要能自己回来**；"重启 DSH 后生效"是能接受的最复杂概念（已有先例：装插件也要重启）。
- 不能要求用户理解 profile/symlink/pnpm；所有动作要么自动、要么一个按钮。

### 4.2 总体架构：双轨分发 + 宿主检查提示 + 外部命令执行 + 重启生效

```
                 ┌────────────────────────── 宿主插件（DSH 进程内）──────────────────────────┐
  启动时 + 每 6h  │  检查更新源 → semver 比较 → 有新版本？ → 信息栏更新徽标 + 发布说明 + 忽略此版本 │
                 └──────────────────────────────┬───────────────────────────────────────────┘
                                                │ 用户点击【更新】
                        ┌───────────────────────┴────────────────────────┐
       A) symlink 用户（现状）                                B) registry 用户（npm 发布后）
       update.sh（git）：                                  update.sh（pnpm）：
       git fetch + checkout tag                             dsh plugin --profile web update \
       + node plugin/scripts/build.mjs                          dsh-bottom-info-bar --latest
                        └───────────────────────┬────────────────────────┘
                                                ▼
                                  提示"重启 dsh web 生效"，信息栏挂"待重启"角标
```

- **检查（谁做）**：**宿主插件内做**（fetch 版本源，纯只读）。这是唯一能让"非技术用户零操作发现新版本"的方式。
  - 更新源（发布 npm 后）用 **npm registry**：`GET https://registry.npmjs.org/dsh-bottom-info-bar/latest` → 返回 `{version, ...}`。理由：无 GitHub 60 次/小时/IP 限流压力、无需 token、与分发渠道同源（registry 上有的才提示，杜绝"提示了却装不到"）。未发布期继续用 GitHub API（现方案，限流容错已设计）。
  - 频率：启动后延迟数秒 1 次 + 每 6 小时 1 次；失败**静默**，绝不影响核心功能。
- **提示（谁做）**：宿主插件内做——信息栏更新徽标（不抢焦点、不弹系统通知）+ 点击看发布说明 +「更新 / 忽略此版本」。
- **更新执行（谁做）**：**外部命令/脚本（update.sh），或宿主内仅做"展示命令/引导"**。明确不推荐宿主进程内 spawn pnpm 自更新，理由：
  1. **自更新悖论**：更新后当前进程里加载的仍是旧代码，无论如何都要重启——那"进程内执行"相比"脚本执行"没有体验收益，只有额外风险。
  2. **竞态**：宿主进程内再跑一个 pnpm 去改自己正在使用的 node_modules，与 DSH 进程并发读写同一目录，有损坏风险；pnpm 失败时无干净回退。
  3. **profile 探测**：插件不知道自己装在哪个 profile（可能多个），进程内执行需要探测逻辑 + 锁文件，复杂度陡增。
  4. 业界做法佐证：即便 VS Code（自动安装）也是**由扩展宿主/安装服务执行、下载完成后重启时安装**，插件本体从不自改；更新执行天然在"进程外"。
  - update.sh 形态（一期就做，双轨自适应）：检测 profile 里自己是 `link:` 还是 registry 版本 → 走 A 或 B 分支 → 完成后提示重启。宿主插件在更新面板里可以"一键复制命令"或直接给出脚本路径，把动作收敛成"一个按钮 + 一个回车"。
- **重启生效**：状态文件（沿用 `~/.dsh/dsh-bottom-info-bar/updater-state.json`）记 `pendingRestartVersion`，信息栏持续挂"待重启"角标，直到检测到版本生效。

### 4.3 安全 / 回滚 / 版本通知

| 主题 | 设计 |
|---|---|
| **供应链** | 更新源硬编码（npm 包名 `dsh-bottom-info-bar` + 固定 GitHub 仓库），HTTPS；**默认不自动执行**，用户确认是最后一道闸；registry 安装自动获得 pnpm-lock.yaml 的 sha512 integrity 校验；npm 发布可开 `--provenance`（Sigstore 签名，dsh 本体已带 signatures 先例）；发布者账号双因素。 |
| **版本策略** | 严格 semver；profile 依赖保持 `^range`（锁定 major）；major 升级在更新面板显著提示 breaking change（release body 约定标记）。 |
| **回滚** | registry 用户：一行 `dsh plugin --profile web add dsh-bottom-info-bar@<旧版>`；symlink 用户：`git checkout <旧tag>` + 重建；状态文件记 `lastGoodVersion`；更新失败自动提示回滚命令。 |
| **跳过/忽略** | 「忽略此版本」持久化到 updater-state.json（与 usage-records.json 同目录，沿用现有 DATA_DIR 机制）；忽略的 tag 不再提示。 |
| **版本通知** | 轮询 npm registry latest（与分发渠道一致、无限流痛点）；发布后 GitHub Release 与 npm 同步发（tag 不变，Release body 即发布说明）。 |
| **兼容性** | 更新面板展示目标版本的最低 DSH 要求（release body 约定），必要时比对 `dsh --version` 后拦截。 |

### 4.4 一期 / 二期切分

- **一期（本次迭代，覆盖当前 100% symlink 用户）**：宿主检查 + 提示 + 「一键 git 更新」脚本（fetch/checkout tag/重建/重启提示）+ 跳过版本 + 回滚提示。**同时**把发布流程改造立项（npm 发布，独立于更新机制，可与本迭代并行）——因为 registry 路径是二期更新的前提。
- **二期（npm 发布上线后）**：install.sh 改 registry 安装；update.sh 增加 registry 分支（`dsh plugin ... update --latest`）；检查源切 npm registry；"待重启"角标；tarball 资产 + SHA256 清单（覆盖离线用户）；再评估 npx updater 工具与宿主内受控子进程（需用户拍板才做）。
- **明确不做**：无人值守全自动更新（对照 Claude Code 的可靠性教训 + 非技术用户无法自救）。

### 4.5 需要用户拍板的决策点

1. **是否接受发布到 npm**（公开包名 `dsh-bottom-info-bar`）：需要注册 npm 账号、仓库配置 NPM_TOKEN secret、发布流程纳入 CI——这是"registry 一行更新"的硬前提。
2. **更新入口形态**：仅 update.sh 脚本（推荐一期）vs 宿主内"复制命令"引导 vs 二期 npx 工具。
3. 检查频率与提示 UI（信息栏徽标 vs 设置页）沿用上轮已定设计，不再反复。

---

## 5. 参考资料

**DSH 官方 / 源码（第一手）**
- 官方插件打包安装文档 publish.md：https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/publish.md
- 本机 dsh 0.1.0-rc.7 源码 `lib/plugin-9h8shc4d.js`（`dsh plugin` 实现，pnpm 转发 + reconcile）：/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/
- 官方 CLI 参考（`dsh plugin --profile <name> <args...>` 转发 pnpm）：https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/apps/cli/reference/README.zh.md
- 上期调研（基线）：docs/UPDATE-RESEARCH.md

**pnpm / npm 机制**
- pnpm update（range 回写、--latest、--global）：https://pnpm.io/cli/update
- pnpm add（本地目录/tarball/registry）：https://pnpm.io/cli/add
- pnpm link：https://pnpm.io/cli/link
- pnpm git 依赖更新修复 commit（f394cfc）：https://github.com/pnpm/pnpm/commit/f394cfccda7bc519ceee8c33fc9b68a0f4235532

**市场案例（官方文档/一手）**
- VS Code 扩展自动更新（extensions.autoUpdate / autoUpdateDelay 默认 2h / 重启扩展宿主）：https://code.visualstudio.com/docs/editor/extension-marketplace
- Raycast 扩展自动更新（store 单一 latest 模型）：https://developers.raycast.com/information/versioning
- Obsidian 社区插件清单机制：https://github.com/obsidianmd/obsidian-releases ；构建来源追踪：https://forum.obsidian.md/t/verify-and-surface-build-provenance-for-community-plugins-trust-badges-now-provenance-drift-protection-on-updates-later/116923
- Homebrew 自动更新（HOMEBREW_AUTO_UPDATE_SECS / HOMEBREW_NO_AUTO_UPDATE）：https://docs.brew.sh/Manpage
- Claude Code marketplace 设置（github/git 源的克隆与更新）：https://code.claude.com/docs/zh-CN/settings ；可靠性翻车 issue：#67868 https://github.com/anthropics/claude-code/issues/67868 、#26744 https://github.com/anthropics/claude-code/issues/26744 、#41885 https://github.com/anthropics/claude-code/issues/41885
- electron-updater（检查/下载/重启安装/签名/回滚）：https://www.electron.build/docs/features/auto-update
- update-kit（按安装渠道自适应的 CLI 自更新模式）：https://github.com/syi0808/update-kit
- obsidian-github-updater（与本场景最像的直更工具）：https://github.com/Real-Fruit-Snacks/obsidian-github-updater

**实测数据点（本机 2026-08-20）**
- `registry.npmjs.org/dsh-bottom-info-bar/latest` → `Not Found`（未发布）
- `registry.npmjs.org/dsh-plugin-manager-community/latest` → v0.1.3，声明 `dsh.bundle.patch`（社区 npm 分发先例）
- `registry.npmjs.org/@deepseek-ai/dsh/latest` → 0.1.0-rc.7，dist 带 integrity + signatures（npm 签名先例）
- `api.github.com/repos/songoao25/dsh-bottom-info-bar/releases/latest` → v1.3.0（匿名 200）
- 本地 DSH profile：`"dsh-bottom-info-bar": "link:/path/to/dsh-bottom-info-bar/plugin"` 与 node_modules symlink（开发安装形态）
