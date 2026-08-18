# 任务清单：信息概览页面（v1.2.0）

> 每个任务可独立完成、可独立验收（≈一次 PR 粒度）。开发按编号顺序执行。

| # | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| T1 | **host：新增 `getUsageRecords` RPC**（只读，返回记录明细，支持 offset/limit 分页，最新在前，每条含 ts/model/modelDisplay/providerDisplay/input/cacheRead/cacheWrite/output/cost/currency） | ① 单测：构造 N 条记录，调用返回正确倒序明细；② offset/limit 分页正确（越界安全）；③ 未知模型 cost=null 返回「—」由 client 处理（host 返回 null）；④ RPC 在 webServer 路由中可调用且不在 MUTATING 名单 | T0（建代码骨架） |
| T2 | **host：新增 `getModelStats` RPC**（按 model+provider 聚合：count/input/cacheRead/cacheWrite/output/cost/currency/costShare，按 cost 降序；含 totalCost/totalCurrency） | ① 单测：多模型记录聚合正确、占比和=1（±0.01）；② 未知模型（cost null）不入占比、不入 totalCost；③ 空记录返回空数组 | T1 |
| T3 | **client：`InfoOverviewPage` 组件**（4 模块：KPI 卡 / 7-30 天 CSS 柱状趋势 / 模型统计占比条 / 明细列表 + 加载更多） | ① 组件只依赖 rpc() 与自有样式，不读 slot props；② 加载中/空态/错误态齐全；③ 30s 轮询只刷 summary/trend/modelStats；④ 明细「加载更多」每批 20 条直至无更多；⑤ 金额千分位+2位小数、<¥0.01 显示「＜¥0.01」、Token 千分位 | T1、T2 |
| T4 | **client：双入口注册**（settings.section + conversation.view，id=`info-overview`，label=`信息概览`，渲染同一组件；注册 try/catch 隔离，一个失败不影响另一个与信息栏本体） | ① 静态测试：源码含两个 slots.register 且指向同一组件；② 注册失败静默不抛错（catch 验证）；③ 现有 composer.dock 注册不受影响 | T3 |
| T5 | **host：样式与主题**（client 新增 `.bi-ov-*` 样式块，全部用主题 token，深浅色自适应；图表柱高 calc 归一化、aria-label 无障碍） | ① 样式块独立注入、卸载清理；② 不覆盖 `.bi-*` 信息栏既有样式；③ 柱状图每柱含 aria-label/title | T3 |
| T6 | **QA 测试**（新增：`test-info-overview.js` 覆盖 T1/T2 单测 + `test-static-client` 扩展静态断言 T3/T4） | ① 新测试全绿；② 现有 6 项测试全绿（回归）；③ `tests/run-all.mjs` 纳入新用例 | T1–T5 |
| T7 | **安全审计**（独立审计：新 RPC 只读性、同源防护、无密钥/路径泄露、无注入、数据一致性） | ① 审计报告 `docs/AUDIT.md` 更新；② 无高危问题或已修复 | T6 |
| T8 | **文档与发布**（README/README.zh-CN 加「信息概览」说明与截图占位、CHANGELOG v1.2.0、版本号 1.1.0→1.2.0、构建通过、全量测试绿） | ① `npm run build` 成功；② 全量测试绿；③ 文档更新；④ 版本/tag/Release 就绪 | T7 |
| T9 | **真机验证**（重启 dsh web 后：设置页入口可进、标签栏入口可进、数字与信息栏一致、无报错） | ① 两入口打开同一页面；② KPI/明细/统计/趋势渲染真实数据；③ 浏览器控制台无错误 | T8 |

## 里程碑
- M1（T1–T2）：host 数据接口就绪 → 单测通过
- M2（T3–T5）：页面与入口就绪 → 静态测试通过
- M3（T6–T7）：质量门（QA + 安全审计）通过
- M4（T8–T9）：发布与真机验证完成
