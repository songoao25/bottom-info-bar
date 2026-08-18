# 发布记录：dsh-bottom-info-bar v1.2.0

## 发布范围
新增「信息概览」页面（v1.2.0 新功能），信息栏本体行为不变。

| 项 | 值 |
|---|---|
| 版本 | v1.2.0（语义化版本：minor = 新功能） |
| 发布日期 | 2026-08-18 |
| 提交信息 | `feat: 新增「信息概览」页面——设置页与对话标签栏双入口的使用追踪` |
| Tag | `v1.2.0` |
| GitHub Release | https://github.com/songoao25/dsh-bottom-info-bar/releases/tag/v1.2.0 |
| 作者 | songoao25 |
| License | MIT |

## 本次新增（用户视角）
- **「信息概览」页面**：设置页左侧导航 + 对话页顶部标签栏 双入口，进入同一页面
- **花费总览卡**：今日 / 本月 / 近30天 / 累计 四个金额
- **花费趋势图**：近 7 / 30 天每日花费柱状图（可切换）
- **各模型用量统计**：调用次数 / token / 费用，费用降序 + 占比条
- **使用记录明细**：每笔调用记录（时间/模型/服务商/token/费用），最新在前，加载更多
- 页面每 30 秒自动刷新；数据来自本地记录文件，不联网、不上传

## GitHub 规范检查清单（发布前全绿）
- [x] README.md（英文）+ README.zh-CN.md（中文）已更新，中英互链
- [x] LICENSE（MIT，作者 songoao25）
- [x] CHANGELOG.md（Keep a Changelog，v1.2.0 已加）
- [x] 版本号：plugin/package.json 1.1.0 → 1.2.0，与 git tag 一致
- [x] .gitignore / .gitattributes / .editorconfig
- [x] 社区健康文件：CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / SUPPORT
- [x] CI：.github/workflows/ci.yml（push/PR 构建+测试）+ codeql.yml + dependabot.yml
- [x] AGENTS.md
- [x] 密钥扫描：git grep + git log 历史扫描 sk-* / BEGIN PRIVATE 零命中
- [x] 全量测试 8 项全绿（含新增 75 断言 test-info-overview）
- [x] 安全审计通过（零密钥 / 零个人路径 / 零新增依赖 / 响应最小化不含 sessionId）

## 回滚方案
- 插件为静态 bundle，GitHub Release 资产/源码 tag 即为回滚点：
  - **回滚命令**：`git checkout v1.1.0 -- plugin && cd plugin && npm run build && cd .. && ./install.sh`（或直接重装 v1.1.0 Release 包）
  - 数据文件 `~/.dsh/dsh-bottom-info-bar/usage-records.json` 不受影响（v1.2.0 不新增写盘、无数据迁移）
- 若页面出现异常但信息栏正常：可先继续使用（双入口注册有 try/catch 隔离，页面失败不影响信息栏）
