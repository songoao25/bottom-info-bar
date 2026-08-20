# QA 报告：v1.4.0 启动版本检查

## 结论

**通过，可以进入发布准备。** 本次复验未发现阻塞缺陷；未修改产品代码。

## 验证环境

- 项目：`dsh-bottom-info-bar`
- 版本：`1.4.0`
- 工作区：当前分支修复后的版本

## 执行结果

| 命令 | 结果 |
|---|---|
| `node plugin/scripts/build.mjs` | ✅ 通过，生成 `plugin/lib/index.js` 与 `plugin/lib/client.js` |
| `node tests/run-all.mjs` | ✅ 通过，全部测试通过 |
| `test-update-check` | ✅ 16 PASS / 0 FAIL |
| `git diff --check` | ✅ 通过 |

## v1.4.0 验收清单

| 验收项 | 结果 | 证据 |
|---|---|---|
| 每次 host 启动只请求一次固定 NPM URL | ✅ | `UPDATE_REGISTRY_URL` 固定为 `https://registry.npmjs.org/dsh-bottom-info-bar/latest`；`apply` 内只创建一次 `updateInfoPromise` |
| 当前版本动态读取 | ✅ | 从 `new URL('../package.json', import.meta.url)` 读取 `version` |
| 稳定 semver 比较 | ✅ | 真实测试覆盖 `1.4.1 > 1.4.0`、相等、旧版、`v` 前缀；预发布版本被拒绝 |
| 网络失败静默 | ✅ | 请求超时、非成功响应、解析/网络异常均返回不可用状态；client catch 后不影响信息栏 |
| client 只展示更新信息 | ✅ | 仅一次读取 `getUpdateInfo`；有更新时渲染红色 `↑ vX.Y.Z` 文本 |
| 无更新点击、浮窗或自动执行 | ✅ | 更新标签没有专属点击处理、链接、按钮、浮窗或命令执行逻辑 |
| 不破坏现有 load | ✅ | 全量回归测试通过，余额、订阅、记账、容错等既有测试均通过 |

## 备注

信息栏根节点保留原有的点击切换完整/简洁模式行为；更新标签没有新增独立交互行为。

## 缺陷

无。
