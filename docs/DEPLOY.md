# 部署文档：dsh-bottom-info-bar v1.2.0

## 产品形态
DeepSeek Harness（DSH）静态插件（bundle），本地安装、本地运行，无云端依赖。

## 部署方式
### 首次安装 / 升级
```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # 默认安装到 web profile；--profile <name> 覆盖
```
安装脚本自动：构建插件产物（`plugin/scripts/build.mjs`）→ `dsh plugin --profile web add plugin/`。

### 升级注意事项
- v1.2.0 不改变信息栏本体行为，无需卸载旧版，直接重装即可。
- 记账数据文件 `~/.dsh/dsh-bottom-info-bar/usage-records.json` 自动沿用，**无需迁移**。

## 生效方式（重要）
- 插件在 DSH 宿主**启动时组合**（cordis.patch.yml 挂载）。
- **修改 `plugin/` 或升级后必须重启 `dsh web`**（刷新页面不够）。
- 重启后验证：打开 **设置 → 信息概览** 与 **对话页顶部标签栏 → 信息概览**。

## 冒烟测试结果（真机）
| 检查项 | 预期 | 结果 |
|---|---|---|
| 设置页入口 | 导航出现「信息概览」，点击进入页面 | 待真机验证（重启后） |
| 标签栏入口 | 对话顶部标签栏出现「信息概览」标签 | 待真机验证（重启后） |
| 花费总览卡 | 今日/本月/近30天/累计 与信息栏一致 | 待真机验证（重启后） |
| 明细/统计/趋势 | 渲染真实本地数据 | 待真机验证（重启后） |
| 控制台 | 无报错 | 待真机验证（重启后） |

（注：自动化测试 8 项全绿已覆盖数据接口与页面静态逻辑；以上为浏览器端最终视觉验证。）

## 回滚方案
- **回滚命令**：
```bash
git checkout v1.1.0 -- plugin && cd plugin && npm run build && cd .. && ./install.sh
# 或卸载后安装 v1.1.0 Release 包
./uninstall.sh && git clone ... # v1.1.0 tag
```
- 数据文件不受影响（v1.2.0 无写盘变更）。
- 页面异常不阻塞信息栏：双入口注册隔离，页面失败不影响信息栏本体。

## 上线检查清单
- [ ] 全量测试 `node tests/run-all.mjs` 8 项全绿
- [ ] 安全审计通过（docs/AUDIT.md）
- [ ] README / CHANGELOG / 版本号 / tag / Release 四件套同步
- [ ] 重启后双入口可进、数据渲染正确
