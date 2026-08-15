// Bottom Info Bar — 静态 host 冒烟测试（不依赖真实 DSH 运行环境）
// 桩 ctx（credentials/shell/timer/agentDefaultModel/on/inject/interval）→ 调 plugin.apply
// → 捕获 webServer 路由 → 用假 req/res 逐方法验证 HTTP 分发、记账、同源防护、配置切换、
//   记账持久化（落盘 → 重新 apply → 记录仍在）。
// 用法：node tests/smoke-static-host.mjs
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离数据目录：记账落盘与真实用户数据互不影响
const tmpData = mkdtempSync(join(tmpdir(), 'bib-smoke-'))
process.env.BOTTOM_INFO_BAR_DATA_DIR = tmpData
// 隔离订阅源凭证：指向不存在的 auth 文件 → no-key 分支，测试绝不读取真实登录态/发网络请求
process.env.BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex-auth.json')
process.env.BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode-auth.json')

const plugin = (await import('../plugin/lib/index.js')).default

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

// ---------- 桩环境 ----------
function makeStub(providerId, model) {
  const captured = { llmListener: null, route: null, intervalCalls: 0 }
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: providerId || 'deepseek-official', model: model || 'deepseek-v4-flash', reasoningEffort: 'high' }) }
      }
      return undefined
    },
    credentials: {
      resolve: async () => undefined, // 未配置 Key → 走 no-key 分支
    },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { captured.intervalCalls += 1; return () => {} },
    timeout() { return () => {} },
    on(event, listener) {
      if (event === 'llm/stream') captured.llmListener = listener
      return () => {}
    },
    inject(services, cb) {
      const webCtx = {
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        webServer: {
          register(route) { captured.route = route; return () => {} },
        },
      }
      cb(webCtx)
      return () => {}
    },
  }
  return { captured, ctx }
}

// ---------- 假 req/res ----------
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
async function feedUsage(listener) {
  async function* fakeStream() {
    yield { type: 'usage', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2000 } }
    yield { type: 'finish' }
  }
  const iter = listener({ model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's-usage' }, async () => fakeStream())
  const seen = []
  for await (const c of iter) seen.push(c.type)
  return seen
}

// ================= 第一次 apply =================
const first = makeStub()
const disposer1 = plugin.apply(first.ctx)
await new Promise((resolve) => setTimeout(resolve, 30))
check('插件默认导出且 apply 可调用', typeof plugin.apply === 'function')
check('webServer 路由已注册（prefix /_dsh/bottom-info-bar）',
  first.captured.route && first.captured.route.kind === 'prefix' && first.captured.route.path === '/_dsh/bottom-info-bar')

{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getBalanceSnapshot', 'GET')
  check('getBalanceSnapshot → 200 + no-key（未配置 Key）', r.status === 200 && r.payload && r.payload.error && r.payload.error.kind === 'no-key')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getPricing', 'GET')
  check('getPricing → 200 + DeepSeek + 模型名回退原始 id（无 llm 桩）+ peak-valley',
    r.status === 200 && r.payload.providerDisplay === 'DeepSeek' && r.payload.modelDisplay === 'deepseek-v4-flash' && r.payload.mode === 'peak-valley')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-test' }))
  check('getUsageSummary → 200 + sessions 计数', r.status === 200 && typeof r.payload.sessions === 'number' && typeof r.payload.totalSpend === 'number')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getConfig', 'GET')
  check('getConfig → 200 + 默认 full', r.status === 200 && r.payload.infoDensity === 'full')
  check('getConfig → 含 billingMode=auto', r.status === 200 && r.payload.billingMode === 'auto')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getBillingMode', 'GET')
  check('getBillingMode → 200 + balance（deepseek-official）', r.status === 200 && r.payload.mode === 'balance' && r.payload.provider === 'deepseek-official' && r.payload.reason === 'provider:deepseek-official')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, { 'sec-fetch-site': 'same-origin' })
  check('getSubscriptionSnapshot → 200 + balance 模式（不发订阅请求）', r.status === 200 && r.payload.mode === 'balance' && r.payload.source === null && r.payload.windows.length === 0)
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/unknownMethod', 'GET')
  check('未知方法 → 404', r.status === 404)
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/setInfoDensity', 'POST', JSON.stringify({ density: 'compact' }), { origin: 'https://evil.example' })
  check('跨源 setInfoDensity → 403', r.status === 403)
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/setInfoDensity', 'POST', JSON.stringify({ density: 'compact' }), { origin: 'http://localhost:3080', host: 'localhost:3080' })
  check('同源 setInfoDensity → 200 + compact', r.status === 200 && r.payload.infoDensity === 'compact')
}
{
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getConfig', 'GET')
  check('切换后 getConfig → compact', r.status === 200 && r.payload.infoDensity === 'compact')
}

// ---------- 订阅制模式（Codex / OpenCode Go provider；auth 文件被隔离为不存在 → no-key，不发网络） ----------
{
  const subCtx = makeStub('codex', 'gpt-5.3-codex')
  const subDisposer = plugin.apply(subCtx.ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  {
    const r = await invoke(subCtx.captured.route, '/_dsh/bottom-info-bar/getBillingMode', 'GET')
    check('getBillingMode → subscription（provider=codex）', r.status === 200 && r.payload.mode === 'subscription' && r.payload.reason === 'provider:codex')
  }
  {
    const r = await invoke(subCtx.captured.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, { 'sec-fetch-site': 'same-origin' })
    check('getSubscriptionSnapshot（codex 无凭证）→ no-key 错误 + 空窗口', r.status === 200 && r.payload.mode === 'subscription' && r.payload.source === 'codex' && r.payload.error && r.payload.error.kind === 'no-key' && Array.isArray(r.payload.windows) && r.payload.windows.length === 0 && r.payload.plan === null)
  }
  subDisposer()

  const ogCtx = makeStub('opencode-go', 'miimo-1.5-rc')
  const ogDisposer = plugin.apply(ogCtx.ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  {
    const r = await invoke(ogCtx.captured.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, { 'sec-fetch-site': 'same-origin' })
    check('getSubscriptionSnapshot（opencode-go 未配置）→ no-key 引导', r.status === 200 && r.payload.mode === 'subscription' && r.payload.source === 'opencode-go' && r.payload.error && r.payload.error.kind === 'no-key')
  }
  ogDisposer()
}

// ---------- llm/stream 记账 ----------
{
  const seen = await feedUsage(first.captured.llmListener)
  check('llm/stream 透传完整（usage + finish）', seen.length === 2 && seen[0] === 'usage' && seen[1] === 'finish')
  const r = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-usage' }))
  const cs = r.payload && r.payload.currentSession
  check('记账后本会话 tokens = 3000', cs && cs.tokens === 3000, JSON.stringify(cs))
  check('记账后本会话有 CNY 花费', cs && cs.costs && typeof cs.costs.CNY === 'number' && cs.costs.CNY > 0)
  check('全部花费 ≈ 本会话花费（totalSpend 3 位四舍五入 vs 原始值）',
    typeof r.payload.totalSpend === 'number' && Math.abs(r.payload.totalSpend - cs.costs.CNY) < 0.001,
    'totalSpend=' + r.payload.totalSpend + ' costs=' + cs.costs.CNY)
  const r2 = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 'nonexistent-session' }))
  check('新会话（sessionId 未命中）→ currentSession 为 null（不回退上一会话）', r2.payload && r2.payload.currentSession === null,
    JSON.stringify(r2.payload && r2.payload.currentSession))
  const r3 = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: '' }))
  check('空 sessionId → currentSession 为 null（绝不回退最近会话显示旧账）', r3.payload && r3.payload.currentSession === null,
    JSON.stringify(r3.payload && r3.payload.currentSession))
  const r4 = await invoke(first.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 'session-s-usage' }))
  check('session- 前缀归一化：session-s-usage 命中 s-usage 记录', r4.payload && r4.payload.currentSession !== null && r4.payload.currentSession.output === 2000,
    JSON.stringify(r4.payload && r4.payload.currentSession))
}

// ---------- 持久化：冲刷落盘 → 文件存在且含记录 ----------
const dataFile = join(tmpData, 'usage-records.json')
disposer1() // 触发 flushSave
{
  const saved = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : null
  check('记账落盘文件已生成', Array.isArray(saved) && saved.length >= 1)
  check('落盘记录含 s-usage 会话', Array.isArray(saved) && saved.some((r) => r.sessionId === 's-usage' && r.input === 1000 && r.output === 2000))
}

// ================= 第二次 apply（模拟重启后重载） =================
const second = makeStub()
const disposer2 = plugin.apply(second.ctx)
await new Promise((resolve) => setTimeout(resolve, 30))
{
  const r = await invoke(second.captured.route, '/_dsh/bottom-info-bar/getUsageSummary', 'POST', JSON.stringify({ sessionId: 's-usage' }))
  const cs = r.payload && r.payload.currentSession
  check('重启重载后记录仍在（tokens = 3000）', cs && cs.tokens === 3000, JSON.stringify(cs))
  check('重启重载后全部花费仍 > 0', typeof r.payload.totalSpend === 'number' && r.payload.totalSpend > 0)
}
disposer2()

// 清理
rmSync(tmpData, { recursive: true, force: true })

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
