// host.js 审计必修项回归（端到端，桩环境，直接 import 源码无需先 build）：
// ① 余额 seq 竞态：慢请求凭据失败不得覆盖新快照（审计缺陷 #3）
// ② 余额失败保留旧快照：credentials / no-key 失败仅换 error，data/fetchedAt 保留（审计缺陷 #3）
// ③ 余额/花费币种随活跃模型服务商：OpenAI 模型激活 → USD 估算余额 + USD 花费，不再显示 DeepSeek ¥ / ¥0（审计缺陷 #6）
// ④ llm/stream next() 失败向上传播，不吞成空流（审计缺陷 #5）
// ⑤ 异常 usage（NaN/Infinity/负数）记账清洗：汇总保持有限、落盘为 0（审计缺陷 #2 端到端）
// 纯函数层（sanitizeTokens / isValidUsageRecord）见 tests/test-usage-sanitize.js。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpData = mkdtempSync(join(tmpdir(), 'bib-host-fixes-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmpData
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode-auth.json')

const plugin = (await import('../plugin/src/host.js')).default

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

// ---------- 桩工具 ----------
function makeStub(providerId, model) {
  const captured = { route: null, llmListener: null }
  const credDeferreds = []
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: providerId || 'deepseek-official', model: model || 'deepseek-v4-flash' }) }
      }
      return undefined
    },
    credentials: {
      resolve: () => {
        // 每次调用返回一个可手动 resolve/reject 的 deferred（测试可控的竞态时序）
        const d = {}
        d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
        credDeferreds.push(d)
        return d.promise
      },
    },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on(event, listener) { if (event === 'llm/stream') captured.llmListener = listener; return () => {} },
    inject(services, cb) {
      const webCtx = {
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        webServer: { register(route) { captured.route = route; return () => {} } },
      }
      cb(webCtx)
      return () => {}
    },
  }
  return { captured, ctx, credDeferreds }
}

function makeReq(path, method, body, headers) {
  const listeners = {}
  const req = {
    url: path,
    method: method || 'GET',
    headers: headers || {},
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req },
    destroy() {},
  }
  return {
    req,
    emit() {
      if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body))
      for (const cb of listeners.end || []) cb()
    },
  }
}
async function invoke(route, path, method, body, headers) {
  const { req, emit } = makeReq(path, method, body, headers)
  let status = 0
  let payload = null
  const res = {
    writeHead(s) { status = s },
    end(b) { try { payload = JSON.parse(b) } catch { payload = String(b) } },
  }
  const pending = route.handler(req, res)
  emit()
  await pending
  return { status, payload }
}
async function feedUsage(listener, usage, opts) {
  const options = Object.assign({ model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's-usage' }, opts || {})
  async function* fakeStream() {
    yield { type: 'usage', usage }
    yield { type: 'finish' }
  }
  const iter = listener(options, async () => fakeStream())
  for await (const c of iter) { /* drain */ }
}

// fetch 桩：DeepSeek 余额 API 返回 88.5 CNY；版本检查返回当前版本，避免混入余额 API 调用计数。
let fetchCalls = 0
globalThis.fetch = async (url) => {
  let parsedUrl = null
  try { parsedUrl = new URL(String(url)) } catch { /* 余额测试的 URL 桩继续走下方分支 */ }
  if (parsedUrl && parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'registry.npmjs.org'
      && parsedUrl.pathname === '/dsh-bottom-info-bar/latest') {
    return { ok: true, status: 200, json: async () => ({ version: '1.4.0' }) }
  }
  fetchCalls += 1
  return {
    ok: true,
    status: 200,
    json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '88.5', granted_balance: '0', topped_up_balance: '88.5' }] }),
  }
}

// ================= ①② 余额 seq 竞态 + 失败保留旧快照 =================
{
  const { captured, ctx, credDeferreds } = makeStub()
  const disposer = plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 30))
  // 触发第二次刷新（seq=2）
  const r1 = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/setActiveProvider', 'POST', JSON.stringify({ provider: 'deepseek' }), { 'sec-fetch-site': 'same-origin' })
  check('setActiveProvider 触发二次余额刷新', r1.status === 200 && r1.payload.activeProvider === 'deepseek')
  await new Promise((r) => setTimeout(r, 10))
  check('两次凭据请求均已挂起（seq=1 与 seq=2）', credDeferreds.length === 2, String(credDeferreds.length))
  // seq=2 先成功 → 写入新快照 88.5
  credDeferreds[1].resolve({ value: 'sk-test' })
  await new Promise((r) => setTimeout(r, 30))
  {
    const b = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getBalanceSnapshot', 'GET')
    check('新快照（seq=2）成功写入：total=88.5 / CNY / 无 error', b.status === 200 && b.payload.data && b.payload.data.total === 88.5 && b.payload.data.currency === 'CNY' && b.payload.error === null, JSON.stringify(b.payload))
    check('余额 API 恰好调用 1 次（仅 seq=2 成功路径）', fetchCalls === 1, String(fetchCalls))
  }
  // 旧请求（seq=1）此刻才失败：seq guard 必须阻止其覆盖新快照
  credDeferreds[0].reject(new Error('cred store down'))
  await new Promise((r) => setTimeout(r, 30))
  {
    const b = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getBalanceSnapshot', 'GET')
    check('慢请求凭据失败不覆盖新快照（seq guard）', b.payload && b.payload.data && b.payload.data.total === 88.5 && b.payload.error === null, JSON.stringify(b.payload))
  }
  // 第三次刷新（seq=3）：no-key 失败 → 保留旧快照，仅换 error
  await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/setActiveProvider', 'POST', JSON.stringify({ provider: 'deepseek' }), { 'sec-fetch-site': 'same-origin' })
  await new Promise((r) => setTimeout(r, 10))
  check('第三次凭据请求已发起', credDeferreds.length === 3, String(credDeferreds.length))
  credDeferreds[2].resolve(undefined) // 未配置 Key → no-key 分支
  await new Promise((r) => setTimeout(r, 30))
  {
    const b = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getBalanceSnapshot', 'GET')
    check('no-key 失败保留旧快照：data.total 仍 88.5', b.payload && b.payload.data && b.payload.data.total === 88.5, JSON.stringify(b.payload))
    check('no-key 失败仅换 error.kind=no-key', b.payload && b.payload.error && b.payload.error.kind === 'no-key')
  }
  disposer()
}

// ================= ③ 币种随活跃模型服务商（OpenAI 激活） =================
{
  const { captured, ctx } = makeStub('openai', 'gpt-4o')
  const disposer = plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 30))
  {
    const b = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getBalanceSnapshot', 'GET')
    check('OpenAI 激活：余额 provider=openai（非恒 deepseek）', b.status === 200 && b.payload.provider === 'openai', JSON.stringify(b.payload && b.payload.provider))
    check('OpenAI 激活：余额为估算（estimate=true）', b.payload && b.payload.estimate === true)
    check('OpenAI 激活：币种 USD（非 CNY）', b.payload && b.payload.data && b.payload.data.currency === 'USD', JSON.stringify(b.payload && b.payload.data))
    check('OpenAI 激活：估算余额 = 起始 20', b.payload && b.payload.data && b.payload.data.total === 20, JSON.stringify(b.payload && b.payload.data))
  }
  await feedUsage(captured.llmListener, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2000 }, { model: 'gpt-4o', provider: 'openai', sessionId: 's-usd' })
  const r = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-usd' }))
  check('OpenAI 记账：本对话有 USD 花费', r.payload && r.payload.currentSession && r.payload.currentSession.costs && r.payload.currentSession.costs.USD > 0, JSON.stringify(r.payload && r.payload.currentSession))
  check('OpenAI 记账：今天花费 > 0（修复前显示 ¥0）', typeof r.payload.todaySpend === 'number' && r.payload.todaySpend > 0, 'todaySpend=' + r.payload.todaySpend)
  check('OpenAI 记账：全部花费 > 0（修复前显示 ¥0）', typeof r.payload.totalSpend === 'number' && r.payload.totalSpend > 0, 'totalSpend=' + r.payload.totalSpend)
  // 币种隔离：追加一条 DeepSeek（CNY）记录，今天花费应保持不变
  await feedUsage(captured.llmListener, { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1000 }, { model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's-cny' })
  const r2 = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-usd' }))
  check('USD 活跃下 CNY 记录不混入今天花费（币种隔离）', r2.payload && r2.payload.todaySpend === r.payload.todaySpend, 'before=' + r.payload.todaySpend + ' after=' + r2.payload.todaySpend)
  disposer()
}

// ================= ④ llm/stream next() 失败向上传播 =================
{
  const { captured, ctx } = makeStub()
  const disposer = plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 30))
  const iter = captured.llmListener(
    { model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's-broken' },
    async () => { throw new Error('upstream boom') }
  )
  let thrown = null
  try { for await (const c of iter) { /* 不应产出任何 chunk */ } } catch (err) { thrown = err }
  check('llm/stream next() 失败 → 原异常向上传播（不吞成空流）', thrown !== null && thrown.message === 'upstream boom', thrown ? thrown.message : '未抛出')
  const rb = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-broken' }))
  check('next() 失败的请求不记账（currentSession null）', rb.payload && rb.payload.currentSession === null, JSON.stringify(rb.payload && rb.payload.currentSession))
  disposer()
}

// ================= ⑤ 异常 usage 记账清洗（含落盘校验） =================
{
  const { captured, ctx } = makeStub()
  const disposer = plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 30))
  await feedUsage(captured.llmListener, { uncachedInputTokens: NaN, cacheReadTokens: Infinity, cacheWriteTokens: -100, outputTokens: 500 }, { sessionId: 's-abnormal' })
  const ra = await invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-abnormal' }))
  const ca = ra.payload && ra.payload.currentSession
  check('异常 usage 清洗后本会话 tokens 有限且 = 500', ca && Number.isFinite(ca.tokens) && ca.tokens === 500, JSON.stringify(ca))
  check('异常 usage 清洗后花费为有限正数（不出现 ¥NaN）', ca && ca.costs && Number.isFinite(ca.costs.CNY) && ca.costs.CNY > 0, JSON.stringify(ca && ca.costs))
  check('全部花费汇总保持有限（NaN 未污染）', typeof ra.payload.totalSpend === 'number' && Number.isFinite(ra.payload.totalSpend), 'totalSpend=' + ra.payload.totalSpend)
  disposer() // 冲刷落盘
  const saved = JSON.parse(readFileSync(join(tmpData, 'usage-records.json'), 'utf8'))
  const rec = saved.find((x) => x.sessionId === 's-abnormal')
  check('落盘异常记录数值已清洗（NaN/Infinity/负数 → 0，output 保留 500）', rec && rec.input === 0 && rec.cacheRead === 0 && rec.cacheWrite === 0 && rec.output === 500, JSON.stringify(rec))
}

rmSync(tmpData, { recursive: true, force: true })

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
