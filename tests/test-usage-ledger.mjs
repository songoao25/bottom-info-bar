// Durable usage-ledger regression tests:
// - no silent 3000-record eviction
// - frozen historical charges survive price-table changes
// - corrupt snapshots recover from backup + every valid journal line
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'bib-ledger-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
const dataFile = join(dataDir, 'usage-records.json')
const backupFile = dataFile + '.bak'
const journalFile = join(dataDir, 'usage-records.journal.jsonl')

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

function record(id, sessionId, cost) {
  return { id, ts: 1787000000000, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId, purpose: '', input: 1, cacheRead: 0, cacheWrite: 0, output: 0, currency: 'CNY', cost }
}

function makeStub() {
  const captured = {}
  return {
    captured,
    ctx: {
      get(name) { return name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) } : undefined },
      credentials: { resolve: async () => null },
      interval() { return () => {} },
      timeout() { return () => {} },
      on(event, listener) { if (event === 'llm/stream') captured.listener = listener; return () => {} },
      inject(services, callback) {
        callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, webServer: { register(route) { captured.route = route; return () => {} } } })
        return () => {}
      },
    },
  }
}

async function invoke(route, method, body) {
  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/' + method, method: 'POST', headers: {}, on(event, cb) { (listeners[event] ||= []).push(cb); return req }, destroy() {} }
  let status = 0
  let payload = null
  const pending = route.handler(req, { writeHead(s) { status = s }, end(text) { payload = JSON.parse(text) } })
  for (const cb of listeners.data || []) cb(Buffer.from(JSON.stringify(body || {})))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, payload }
}

// A large existing account is loaded intact; the previous in-memory cap used
// to discard its oldest records every time a new request arrived.
const largeSnapshot = Array.from({ length: 3005 }, (_, i) => record('large-' + i, 'large-' + i, 0.001))
largeSnapshot.push(record('frozen-price', 'frozen-price', 3.14159))
writeFileSync(dataFile, JSON.stringify(largeSnapshot))
writeFileSync(journalFile, JSON.stringify(largeSnapshot[0]) + '\n') // duplicate id must not double-count

const plugin = (await import('../plugin/src/host.js')).default
let first = makeStub()
let dispose = plugin.apply(first.ctx)
let result = await invoke(first.captured.route, 'getUsageSummary', { sessionId: 'frozen-price', selection: { provider: 'deepseek', model: 'deepseek-v4-flash' } })
check('超过 3000 条的历史账本完整加载', result.status === 200 && result.payload.sessions === 3006, String(result.payload && result.payload.sessions))
check('有 id 的快照与日志重复记录只计算一次', result.payload.totalSpend === 6.147, String(result.payload.totalSpend))
check('历史账单使用发生时固化的 cost，而非当前定价表重算', result.payload.currentSession && result.payload.currentSession.costs.CNY === 3.14159, JSON.stringify(result.payload.currentSession))
dispose()

// Simulate a damaged main snapshot after an interrupted replacement.  The
// known-good backup and valid journal entries must still reconstruct the bill.
writeFileSync(dataFile, '{ not valid JSON')
writeFileSync(backupFile, JSON.stringify([record('backup-only', 'backup-only', 1)]))
writeFileSync(journalFile, [JSON.stringify(record('backup-only', 'backup-only', 1)), '{ torn line', JSON.stringify(record('journal-only', 'journal-only', 2))].join('\n') + '\n')
let second = makeStub()
dispose = plugin.apply(second.ctx)
result = await invoke(second.captured.route, 'getUsageSummary', { sessionId: 'journal-only', selection: { provider: 'deepseek', model: 'deepseek-v4-flash' } })
check('主快照损坏时从备份与日志恢复，而非整账归零', result.status === 200 && result.payload.sessions === 2 && result.payload.totalSpend === 3, JSON.stringify(result.payload))
check('损坏日志仅跳过坏行，后续完整记录仍可读取', result.payload.currentSession && result.payload.currentSession.costs.CNY === 2, JSON.stringify(result.payload.currentSession))
dispose()

// Legacy arrays did not have a stable request id.  The first upgraded run
// writes one back, so later snapshots and journals can deduplicate safely.
writeFileSync(dataFile, JSON.stringify([{ ts: 1787000000000, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'legacy', purpose: '', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }]))
writeFileSync(journalFile, '')
let third = makeStub()
dispose = plugin.apply(third.ctx)
dispose()
const migrated = JSON.parse(readFileSync(dataFile, 'utf8'))
check('旧 JSON 首次升级自动补稳定账单编号', migrated.length === 1 && typeof migrated[0].id === 'string' && migrated[0].id.indexOf('legacy-') === 0, JSON.stringify(migrated))

rmSync(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
