// Bottom Info Bar — 全量测试入口
// 用法：node tests/run-all.mjs（或 plugin 目录下 npm test）
// 覆盖：
//  - 静态 host 冒烟测试（webServer 路由 / RPC 分发 / 记账 / 同源防护）：tests/smoke-static-host.mjs
//  - 业务逻辑回归（峰谷边界 / 显示名识别 / 密度审计 / 花费聚合），指向正式源码：
//    plugin/src/host.js + plugin/src/client-bundle.js
// 注意：先执行 build（smoke 测试 import 的是 lib/ 产物，必须先重建避免测到陈旧代码）
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const HOST = join(root, 'plugin', 'src', 'host.js')

// 0) 重建 lib/（smoke 依赖构建产物）
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: join(root, 'plugin'), encoding: 'utf8' })
if (build.status !== 0) {
  console.error('build 失败：' + (build.stderr || build.stdout))
  process.exit(1)
}
console.log('build OK → lib/')

const cases = [
  ['smoke-static-host', ['tests/smoke-static-host.mjs'], join(root)],
  ['test-static-client（plugin/src/client-bundle.js）', ['tests/test-static-client.js'], join(root)],
  ['test-display-name（host.js）', ['tests/test-display-name.js'], join(root)],
  ['test-density-toggle（host.js + client-bundle.js）', ['tests/test-density-toggle.js'], join(root)],
  ['test-spend-accounting（host.js）', ['tests/test-spend-accounting.js'], join(root)],
  ['test-dual-mode（host.js 双模式逻辑 + client 订阅渲染）', ['tests/test-dual-mode.js'], join(root)],
  ['check-host（host.js）', ['tests/check-host.js', HOST], join(root)],
]

let failed = 0
for (const [name, args, cwd] of cases) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  const tail = (r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | ')
  const ok = r.status === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${tail || r.stderr}`)
  if (!ok) failed += 1
}
console.log(failed === 0 ? '\n全量测试全部通过' : `\n${failed} 项测试失败`)
process.exit(failed === 0 ? 0 : 1)
