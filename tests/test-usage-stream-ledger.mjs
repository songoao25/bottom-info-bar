// Stream-to-ledger acceptance tests: a model response is one bill, even when
// DSH emits multiple usage snapshots; interrupted responses remain auditable.
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'bib-stream-ledger-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
const journalFile = join(dataDir, 'usage-records.journal.jsonl')
const snapshotFile = join(dataDir, 'usage-records.json')
const plugin = (await import('../plugin/src/host.js')).default

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

function makeStub() {
  const captured = { listener: null, route: null }
  return {
    captured,
    ctx: {
      get(name) { return name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) } : undefined },
      credentials: { resolve: async () => null },
      interval() { return () => {} },
      timeout() { return () => {} },
      on(name, listener) { if (name === 'llm/stream') captured.listener = listener; return () => {} },
      inject(services, callback) {
        callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, webServer: { register(route) { captured.route = route; return () => {} } } })
        return () => {}
      },
    },
  }
}

async function usageSummary(route, sessionId) {
  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/getUsageSummary', method: 'POST', headers: {}, on(name, listener) { (listeners[name] ||= []).push(listener); return req }, destroy() {} }
  let payload = null
  const pending = route.handler(req, { writeHead() {}, end(text) { payload = JSON.parse(text) } })
  const body = JSON.stringify({ sessionId, selection: { provider: 'deepseek', model: 'deepseek-v4-flash' } })
  for (const listener of listeners.data || []) listener(Buffer.from(body))
  for (const listener of listeners.end || []) listener()
  await pending
  return payload
}

async function drain(listener, sessionId, chunks) {
  async function* stream() {
    for (const chunk of chunks) {
      if (chunk instanceof Error) throw chunk
      yield chunk
    }
  }
  const iter = listener({ provider: 'deepseek', model: 'deepseek-v4-flash', sessionId }, async () => stream())
  let thrown = null
  try { for await (const chunk of iter) { /* preserve normal stream behavior */ } } catch (err) { thrown = err }
  return thrown
}

const first = makeStub()
const dispose = plugin.apply(first.ctx)

await drain(first.captured.listener, 'multi', [
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } },
  { type: 'usage', usage: { inputTokens: 300, outputTokens: 400 } },
  { type: 'finish' },
])
let summary = await usageSummary(first.captured.route, 'multi')
check('多条 usage 快照只记一笔', summary.currentSession && summary.currentSession.tokens === 700 && summary.sessions === 1, JSON.stringify(summary.currentSession))

const interrupted = await drain(first.captured.listener, 'interrupted', [
  { type: 'usage', usage: { inputTokens: 50, outputTokens: 25 } },
  new Error('upstream interrupted'),
])
summary = await usageSummary(first.captured.route, 'interrupted')
check('中断仍向上游抛错', interrupted && interrupted.message === 'upstream interrupted', interrupted && interrupted.message)
check('中断后保留已确认用量', summary.currentSession && summary.currentSession.tokens === 75, JSON.stringify(summary.currentSession))

// Unknown price records remain in the user-visible ledger but do not fabricate a cost.
const unknownIter = first.captured.listener({ provider: 'unknown', model: 'unknown-model', sessionId: 'unpriced' }, async function* () {
  yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8 } }
  yield { type: 'finish' }
})
for await (const chunk of unknownIter) { /* drain */ }

await drain(first.captured.listener, 'no-usage', [{ type: 'finish' }])
summary = await usageSummary(first.captured.route, 'no-usage')
check('无有效用量的回答不生成空账单', summary.currentSession === null, JSON.stringify(summary.currentSession))

// Two overlapping plugin instances may each write a snapshot, but both
// confirmed journal entries must survive a later reload.
const parallel = makeStub()
const disposeParallel = plugin.apply(parallel.ctx)
await Promise.all([
  drain(first.captured.listener, 'writer-a', [{ type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } }, { type: 'finish' }]),
  drain(parallel.captured.listener, 'writer-b', [{ type: 'usage', usage: { inputTokens: 11, outputTokens: 4 } }, { type: 'finish' }]),
])
disposeParallel()
dispose()
const recovered = makeStub()
const disposeRecovered = plugin.apply(recovered.ctx)
const writerA = await usageSummary(recovered.captured.route, 'writer-a')
const writerB = await usageSummary(recovered.captured.route, 'writer-b')
check('重叠实例写入后两个完整账单都可恢复', writerA.currentSession && writerA.currentSession.tokens === 10 && writerB.currentSession && writerB.currentSession.tokens === 15,
  JSON.stringify({ writerA: writerA.currentSession, writerB: writerB.currentSession }))
disposeRecovered()

const beforeFailure = JSON.parse(readFileSync(snapshotFile, 'utf8'))
const interruptedRecord = beforeFailure.find((record) => record.sessionId === 'interrupted')
const unpricedRecord = beforeFailure.find((record) => record.model === 'unknown-model')
check('中断账单标为 interrupted', interruptedRecord && interruptedRecord.status === 'interrupted', JSON.stringify(interruptedRecord))
check('未知价格模型保留用量但标为 unpriced', unpricedRecord && unpricedRecord.pricingStatus === 'unpriced' && !Object.hasOwn(unpricedRecord, 'cost'), JSON.stringify(unpricedRecord))
const clientSource = readFileSync(new URL('../plugin/src/client-bundle.js', import.meta.url), 'utf8')
check('底栏为账单未保存提供明确提示', clientSource.includes("'账单未保存'") && clientSource.includes('persistence.state'), '')

// Turn the journal pathname into a directory: appending must fail, and the
// failed bill must not appear in the visible total or snapshot.
renameSync(journalFile, journalFile + '.saved')
mkdirSync(journalFile)
const second = makeStub()
const disposeSecond = plugin.apply(second.ctx)
await drain(second.captured.listener, 'not-saved', [
  { type: 'usage', usage: { inputTokens: 9, outputTokens: 9 } },
  { type: 'finish' },
])
summary = await usageSummary(second.captured.route, 'not-saved')
check('流水写入失败明确下发状态', summary.persistence && summary.persistence.state === 'journal-failed', JSON.stringify(summary.persistence))
check('流水写入失败不把金额计入内存总账', summary.currentSession === null, JSON.stringify(summary.currentSession))
disposeSecond()

rmSync(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
