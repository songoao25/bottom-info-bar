// Bottom Info Bar（底部信息栏插件）— host half（静态 bundle 形态）
// 业务：余额真实 API / 峰谷定价 / llm/stream 记账 / 会话聚合 / 显示名识别
// RPC：webServer HTTP 路由（GET/POST /_dsh/bottom-info-bar/<method>，JSON 进出，同源防护）
// 依赖：inject ['credentials', 'shell', 'timer', 'settings']；可选服务 webServer（ctx.inject 等待）
// 记账持久化：usageRecords 落盘 ~/.dsh/bottom-info-bar/usage-records.json（可用环境变量
// BOTTOM_INFO_BAR_DATA_DIR 覆盖目录），重启后真实累计花费不丢失。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const DATA_DIR = process.env.BOTTOM_INFO_BAR_DATA_DIR || join(homedir(), '.dsh', 'bottom-info-bar')
const DATA_FILE = join(DATA_DIR, 'usage-records.json')

// ---------- 双模式（余额制 / 订阅制）配置 ----------
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额（可在此增删）
const SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex']
// 订阅窗口时长（秒）：5 小时 / 7 天 / 30 天；映射带 5% 容差（接口值可能微调）
const WINDOW_SECONDS = { five_hour: 18000, seven_day: 604800, monthly: 2592000 }
const WINDOW_LABELS = { five_hour: '5小时', seven_day: '周', monthly: '月' }
const WINDOW_ALERT_PERCENT = 90 // 任一窗口已用百分比 ≥ 该值 → 客户端红色 ⚠ 预警
const CODEX_PLAN_NAMES = { plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team', enterprise: 'ChatGPT Enterprise' }
// OpenAI OAuth 公开 client_id（Codex CLI 开源常量，仓库 https://github.com/openai/codex 同款，非密钥）——
// 用于 Codex access_token 续期请求，任何人可见，不属机密；保留本注释防止未来安全审计误判为凭证泄漏。
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann' // OpenAI OAuth 公开 client_id（token 续期用，非密钥）
const SUBSCRIPTION_REFRESH_MS = 60000 // 订阅额度快照刷新周期（与余额一致）
const SUBSCRIPTION_RETRY_BACKOFF_MS = 60000 // 订阅刷新失败后退避期：期内不重试（减少对未公开 wham 接口的请求 + 避免"刷新失败"提示闪烁）
// 订阅源 auth 文件路径（可用环境变量覆盖——测试隔离用，避免测试误读真实登录态）
const CODEX_AUTH_FILE = process.env.BOTTOM_INFO_BAR_CODEX_AUTH || join(homedir(), '.codex', 'auth.json')
const OPENCODE_AUTH_FILE = process.env.BOTTOM_INFO_BAR_OPENCODE_AUTH || join(homedir(), '.local', 'share', 'opencode', 'auth.json')

// ---------- ChatGPT 订阅官方 OAuth 绑定（v1.2.0）：PKCE S256 + state + 本地回调（仅 127.0.0.1） ----------
// 回调端口：生产必须为 1455——redirect_uri 与 OpenAI 注册值固定一致；BOTTOM_INFO_BAR_OAUTH_PORT 仅测试隔离
// 用（临时端口，绝不监听真实 1455 / 绝不触碰真实 auth.json）。回调等待超时生产 5 分钟，
// BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS 仅供测试缩短。
const OAUTH_CALLBACK_TIMEOUT_MS = Number(process.env.BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS) > 0 ? Number(process.env.BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS) : 5 * 60 * 1000
const OAUTH_CALLBACK_PATH = '/auth/callback'
const OAUTH_SCOPE = 'openid profile email offline_access'
// 从 access_token JWT payload 提取 account_id 的 claim 路径（pi-ai 同款；wham 额度接口需要 account_id）
const CODEX_JWT_ACCOUNT_CLAIM = 'https://api.openai.com/auth'

// ---------- 双模式纯逻辑（模式检测 / 窗口映射 / 响应解析；单测直接提取） ----------

// 窗口时长（秒）→ 窗口键：18000≈5小时 / 604800≈7天 / 2592000≈30天，5% 容差；未知返回 null
function codexWindowKey(limitWindowSeconds) {
  if (typeof limitWindowSeconds !== 'number' || !isFinite(limitWindowSeconds)) return null
  for (const key in WINDOW_SECONDS) {
    const target = WINDOW_SECONDS[key]
    if (Math.abs(limitWindowSeconds - target) / target <= 0.05) return key
  }
  return null
}

// 订阅 provider → 订阅源标识（codex / opencode-go）；非订阅 provider → null
function subscriptionSourceFor(providerId) {
  if (providerId === 'codex' || providerId === 'chatgpt' || providerId === 'openai-codex') return 'codex'
  if (providerId === 'opencode-go' || providerId === 'opencode') return 'opencode-go'
  return null
}

// ---------- M5：DSH 目录名 → 展示名（模型名/服务商名与模型切换器完全一致） ----------
// 模型切换器显示 DSH LLM 目录的 model.name（如 id=deepseek-v4-flash 的 name="DeepSeek-V4-Flash"）。
// 以下两个纯函数只做"缓存优先 → 回退"解析；缓存由 apply 内异步填充（llm.listModels / llm.listProviders）。
// modelDisplay：优先缓存里的 DSH 目录 name；缓存缺失/未知模型回退原始 model id（不做自建美化）
function modelDisplayFromCache(model, provider, cache) {
  if (model && provider && cache) {
    const provMap = cache[provider]
    if (provMap && typeof provMap[model] === 'string' && provMap[model].length > 0) return provMap[model]
  }
  return model || '未知模型'
}
// providerDisplay：优先 DSH 目录 name（llm.listProviders()）；缺失回退静态映射；再回退大写首字母
function providerDisplayFromCache(providerId, cache, staticMap) {
  if (!providerId) return '未知服务商'
  if (cache && typeof cache[providerId] === 'string' && cache[providerId].length > 0) return cache[providerId]
  if (staticMap && staticMap[providerId]) return staticMap[providerId]
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

// 余额制/订阅制判定：billingMode='auto' 按 provider 检测；'balance'/'subscription' 手动强制覆盖
function detectBillingMode(providerId, billingMode) {
  if (billingMode === 'balance' || billingMode === 'subscription') {
    return { mode: billingMode, provider: providerId || '', reason: 'manual-override' }
  }
  const sub = SUBSCRIPTION_PROVIDERS.indexOf(providerId) >= 0
  return { mode: sub ? 'subscription' : 'balance', provider: providerId || '', reason: 'provider:' + (providerId || 'unknown') }
}

// wham 响应的 plan_type → 显示名（未收录的 plan 类型按大写首字母兜底）
function planDisplayName(planType) {
  if (typeof planType === 'string' && planType.length > 0) {
    const known = CODEX_PLAN_NAMES[planType]
    if (known) return known
    return 'ChatGPT ' + planType.charAt(0).toUpperCase() + planType.slice(1)
  }
  return 'ChatGPT Plus/Pro'
}

// 解析 Codex wham usage 响应：顶层 rate_limit.primary_window / secondary_window → 统一窗口数组
// （wham 响应无 usage 包装层；结构异常返回 null；窗口缺失 / 未知时长 / 无百分比自动跳过，不报错、不占位）
function parseCodexUsage(body) {
  if (!body || typeof body !== 'object') return null
  const rl = body.rate_limit
  if (!rl || typeof rl !== 'object') return null
  const windows = []
  for (const slot of ['primary_window', 'secondary_window']) {
    const win = rl[slot]
    if (!win || typeof win !== 'object') continue
    const key = codexWindowKey(win.limit_window_seconds)
    if (!key) continue
    const used = win.used_percent
    if (typeof used !== 'number' || !isFinite(used)) continue
    windows.push({
      key: key,
      label: WINDOW_LABELS[key],
      usedPercent: Math.round(used),
      resetsAt: typeof win.reset_at === 'number' && isFinite(win.reset_at) ? win.reset_at * 1000 : null,
    })
  }
  // 同一窗口键去重（primary 优先）；保持出现顺序
  const seen = {}
  const unique = []
  for (const w of windows) {
    if (seen[w.key]) continue
    seen[w.key] = true
    unique.push(w)
  }
  return { plan: planDisplayName(body.plan_type), windows: unique }
}

// OpenCode Go 窗口键（rolling=5小时滚动窗口 / weekly / monthly）
function openCodeGoWindowKey(apiKey) {
  if (apiKey === 'rolling') return 'five_hour'
  if (apiKey === 'weekly') return 'seven_day'
  if (apiKey === 'monthly') return 'monthly'
  return null
}

// 归一化重置时刻：数值（秒或毫秒）→ 毫秒；ISO 字符串 → 毫秒；无法解析 → null
function normalizeResetAt(value) {
  if (typeof value === 'number' && isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return isNaN(t) ? null : t
  }
  return null
}

// 解析 OpenCode Go usage 响应：usage.rolling / weekly / monthly → 统一窗口数组
// status 非 'ok' 的窗口跳过（如额度超限 / 接口异常）；结构异常返回 null
function parseOpenCodeGoUsage(body) {
  if (!body || typeof body !== 'object') return null
  const usage = body.usage
  if (!usage || typeof usage !== 'object') return null
  const windows = []
  for (const apiKey of ['rolling', 'weekly', 'monthly']) {
    const win = usage[apiKey]
    if (!win || typeof win !== 'object') continue
    if (win.status !== 'ok') continue
    const percent = win.percent
    if (typeof percent !== 'number' || !isFinite(percent)) continue
    const key = openCodeGoWindowKey(apiKey)
    windows.push({
      key: key,
      label: WINDOW_LABELS[key],
      usedPercent: Math.round(percent),
      resetsAt: normalizeResetAt(win.resetsAt),
    })
  }
  return { plan: 'OpenCode Go', windows: windows }
}

// 快照更新规则（"失败保留旧快照"的纯函数形态）：失败保留旧 data/fetchedAt 只换 error；成功换 data 并更新 fetchedAt
function mergeSubscriptionResult(prev, result) {
  if (!result || result.error) {
    return {
      data: prev && prev.data ? prev.data : null,
      fetchedAt: prev && prev.fetchedAt ? prev.fetchedAt : null,
      error: result ? result.error : { kind: 'exception', message: '订阅额度请求未知异常' },
    }
  }
  return { data: result.data || null, fetchedAt: Date.now(), error: null }
}

// ---------- Codex 桥接（v1.2.0）纯逻辑：订阅令牌看护（读 auth.json → 判定过期 → 续期 → 原子写回 → 注入 DSH 凭据） ----------
// 令牌寿命兜底（秒）：JWT exp 不可解析时按 last_refresh + 10 天估算（实测 Codex access_token iat/exp 差 = 864000s）
const CODEX_TOKEN_FALLBACK_LIFETIME_SEC = 864000
// 过期前提前量（秒）：JWT 剩余寿命 < 45 分钟才续期（10 天寿命下极少触发，避免窗口内过期）
const CODEX_REFRESH_AHEAD_SEC = 45 * 60
// 桥接同步周期（毫秒）：启动即跑一次 + 每 30 分钟维护（与订阅额度刷新相互独立）
const CODEX_SYNC_INTERVAL_MS = 30 * 60 * 1000

// base64url → UTF-8 字符串（JWT payload 段解码：-/_ 换回 +// 后按标准 base64 解，容忍缺 padding）
function decodeBase64Url(input) {
  if (typeof input !== 'string' || input.length === 0) return null
  try {
    return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch (err) {
    return null
  }
}

// JWT exp 解码（秒）：标准 JWT 取第 2 段 payload 的 exp；非 JWT/损坏/缺 exp → null（调用方走 last_refresh 兜底）
function decodeJwtExp(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const raw = decodeBase64Url(parts[1])
  if (raw == null) return null
  let payload = null
  try { payload = JSON.parse(raw) } catch (err) { return null }
  const exp = payload && payload.exp
  return typeof exp === 'number' && isFinite(exp) && exp > 0 ? exp : null
}

// 归一化令牌过期时刻（秒）：JWT exp 优先；无效 → last_refresh（毫秒）+ 10 天兜底；两者皆无 → null
function codexExpiresAt(expSeconds, lastRefreshMs) {
  if (typeof expSeconds === 'number' && isFinite(expSeconds) && expSeconds > 0) return expSeconds
  if (typeof lastRefreshMs === 'number' && isFinite(lastRefreshMs) && lastRefreshMs > 0) {
    return Math.floor(lastRefreshMs / 1000) + CODEX_TOKEN_FALLBACK_LIFETIME_SEC
  }
  return null
}

// 续期决策（秒精度）：剩余 < 45 分钟或无法判定过期 → true（保守续期，宁多刷不放过期）
function codexNeedsRefresh(expiresAtSeconds, nowSeconds) {
  if (expiresAtSeconds == null) return true
  return expiresAtSeconds - nowSeconds < CODEX_REFRESH_AHEAD_SEC
}

// 读 auth.json：{ ok:true, auth } 或 { ok:false, reason:'missing'|'corrupt' }（缺失/损坏一律不抛异常）
function readCodexAuthFile(filePath) {
  let raw = null
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    return { ok: false, reason: err && err.code === 'ENOENT' ? 'missing' : 'corrupt' }
  }
  let auth = null
  try {
    auth = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'corrupt' }
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return { ok: false, reason: 'corrupt' }
  return { ok: true, auth: auth }
}

// 原子写回 auth.json：只更新 access_token/refresh_token/last_refresh，保留完整结构（auth_mode/OPENAI_API_KEY/
// tokens 内 account_id、id_token 等一律不动——绝不弄坏 Codex CLI 登录态）；tmp+rename 防写一半；0600 权限
function writeAuthJson(filePath, currentAuth, accessToken, refreshToken, lastRefreshIso) {
  const updated = {
    ...currentAuth,
    tokens: { ...(currentAuth.tokens && typeof currentAuth.tokens === 'object' ? currentAuth.tokens : {}), access_token: accessToken, refresh_token: refreshToken },
    last_refresh: lastRefreshIso,
  }
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, filePath)
  return updated
}

// 用 refresh_token 向官方 OAuth 端点换新令牌对；凭据仅经 HTTPS body 传递（不进子进程，无 shell 注入面）
// 响应缺 access_token（空串/null）→ 返回 null（调用方不得写回）；refresh_token 未轮换 → 返回 null 字段表示沿用旧值
async function refreshCodexTokenPair(refreshToken) {
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CODEX_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const body = await res.json()
    if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) return null
    return {
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : null,
    }
  } catch (err) {
    return null // 网络/超时等异常 → 调用方按"续期失败"降级（保留旧凭据）
  }
}

// ---------- ChatGPT 订阅官方 OAuth 绑定（v1.2.0）纯逻辑：PKCE / 授权 URL / 回调解析 / 令牌交换 / 写回 ----------
// 安全铁律：verifier/state/令牌仅内存（verifier 用完即弃）；不打印、不进日志、不进仓库；唯一落盘 =
// ~/.codex/auth.json（0600）与 DSH 凭据库（0600）；回调 server 仅 127.0.0.1 + state 校验防 CSRF。

// OAuth 回调端口：生产必须为 1455（redirect_uri 与 OpenAI 注册值固定一致）；BOTTOM_INFO_BAR_OAUTH_PORT 仅测试隔离用
function oauthCallbackPort() {
  const v = Number(process.env.BOTTOM_INFO_BAR_OAUTH_PORT)
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : 1455
}

// PKCE 对：verifier = 32 字节 base64url；challenge = 对 verifier 做 sha256 哈希后再 base64url 编码（S256）
function createPkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier: verifier, challenge: challenge }
}

// 构造授权跳转 URL（auth.openai.com/oauth/authorize；参数与 pi-ai/Codex CLI 一致；不含任何机密）
function buildAuthorizeUrl(state, codeChallenge) {
  const url = new URL('https://auth.openai.com/oauth/authorize')
  url.searchParams.set('client_id', CODEX_OAUTH_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', 'http://localhost:' + oauthCallbackPort() + OAUTH_CALLBACK_PATH)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', OAUTH_SCOPE)
  return url.toString()
}

// 解析回调（完整 URL 的 query/hash、查询串、手贴 'code#state'、裸 code）；缺参返回 null 字段
function parseCallbackUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return { code: null, state: null }
  const raw = url.trim()
  // ① 完整 URL：query 参数优先，hash 参数兜底（兼容 OAuth hash 响应）
  try {
    const u = new URL(raw)
    let code = u.searchParams.get('code')
    let state = u.searchParams.get('state')
    if (u.hash && u.hash.length > 1) {
      const hp = new URLSearchParams(u.hash.slice(1))
      if (code == null) code = hp.get('code')
      if (state == null) state = hp.get('state')
    }
    return { code: code, state: state }
  } catch (err) { /* 非完整 URL → ②/③/④ */ }
  // ② 手贴格式 'code#state'
  if (raw.indexOf('#') >= 0 && raw.indexOf('://') < 0) {
    const parts = raw.split('#')
    const first = parts[0]
    if (first && first.indexOf('=') < 0) {
      const rest = parts.slice(1).join('#')
      const sp = new URLSearchParams(rest)
      return { code: first, state: sp.get('state') != null ? sp.get('state') : rest }
    }
  }
  // ③ 查询串 'code=..&state=..'
  const q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : raw
  const sp2 = new URLSearchParams(q)
  if (sp2.has('code') || sp2.has('state')) return { code: sp2.get('code'), state: sp2.get('state') }
  // ④ 裸 code（手动粘贴单值）
  if (raw.length > 0 && raw.indexOf('=') < 0 && raw.indexOf('#') < 0) return { code: raw, state: null }
  return { code: null, state: null }
}

// 从 access_token JWT payload 提取 chatgpt_account_id（wham 额度接口所需）；失败 → null
function codexAccountIdFromJwt(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const raw = decodeBase64Url(parts[1])
  if (raw == null) return null
  let payload = null
  try { payload = JSON.parse(raw) } catch (err) { return null }
  const auth = payload && payload[CODEX_JWT_ACCOUNT_CLAIM]
  const id = auth && auth.chatgpt_account_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// 构造 OAuth 绑定后的 auth.json 对象：保留既有结构（codex CLI/OpenCode 兼容），仅替换令牌字段 + last_refresh；
// account_id 优先从新 access_token 提取，提取失败保留旧值；全新文件给出标准骨架 {auth_mode:'oauth', ...}
function buildOAuthAuthObject(existing, exchange, nowIso) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const baseTokens = base.tokens && typeof base.tokens === 'object' && !Array.isArray(base.tokens) ? base.tokens : {}
  const tokens = Object.assign({}, baseTokens)
  tokens.access_token = exchange.access_token
  if (typeof exchange.refresh_token === 'string' && exchange.refresh_token.length > 0) tokens.refresh_token = exchange.refresh_token
  if (typeof exchange.id_token === 'string' && exchange.id_token.length > 0) tokens.id_token = exchange.id_token
  const accountId = codexAccountIdFromJwt(exchange.access_token)
  if (accountId) tokens.account_id = accountId
  return {
    auth_mode: 'oauth',
    OPENAI_API_KEY: typeof base.OPENAI_API_KEY === 'string' && base.OPENAI_API_KEY.length > 0 ? base.OPENAI_API_KEY : null,
    tokens: tokens,
    last_refresh: nowIso,
  }
}

// 解绑：仅清令牌字段并原子写回（保留 auth_mode/OPENAI_API_KEY/account_id 等结构——auth.json 是 codex CLI
// 等工具共用的标准位置，保留骨架更接近"已登出"语义，也便于重新绑定与 CLI 兼容）；tmp+rename 防写一半；0600
function clearCodexAuthTokens(filePath, currentAuth) {
  const base = currentAuth && typeof currentAuth === 'object' && !Array.isArray(currentAuth) ? currentAuth : {}
  const tokens = Object.assign({}, base.tokens && typeof base.tokens === 'object' && !Array.isArray(base.tokens) ? base.tokens : {})
  delete tokens.access_token
  delete tokens.refresh_token
  delete tokens.id_token
  const updated = Object.assign({}, base, { tokens: tokens, last_refresh: null })
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, filePath)
  return updated
}

// 用授权码向官方端点换令牌对（PKCE verifier 证明持码者身份）；凭据仅经 HTTPS body 传递（不进子进程）；
// 响应缺 access_token → { ok:false }（调用方不得写回）；网络/超时异常 → { ok:false, status:null }
async function exchangeAuthorizationCode(code, verifier) {
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CODEX_OAUTH_CLIENT_ID,
        code: code,
        code_verifier: verifier,
        redirect_uri: 'http://localhost:' + oauthCallbackPort() + OAUTH_CALLBACK_PATH,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = await res.json()
    if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) return { ok: false, status: res.status }
    return {
      ok: true,
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : null,
      id_token: typeof body.id_token === 'string' && body.id_token.length > 0 ? body.id_token : null,
    }
  } catch (err) {
    return { ok: false, status: null } // 网络/超时等异常 → 调用方按"交换失败"处理
  }
}

// 本地回调 server：仅监听 127.0.0.1；仅接受 /auth/callback；校验 state（防 CSRF/中间人）；
// 端口占用（EADDRINUSE）等监听失败 → resolve(null)（调用方返回明确错误，不崩溃）
function startOAuthCallbackServer(expectedState, onCode, port) {
  return new Promise(function (resolve) {
    let settled = false
    const fail = function () { if (!settled) { settled = true; resolve(null) } }
    const server = createServer(function (req, res) {
      let pathname = '/'
      let params = null
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        pathname = url.pathname
        params = url.searchParams
      } catch (err) {
        respondOAuthPage(res, 400, 'OAuth 回调地址无效')
        return
      }
      if (pathname !== OAUTH_CALLBACK_PATH) {
        respondOAuthPage(res, 404, '回调路径不存在')
        return
      }
      if (params.get('state') !== expectedState) {
        respondOAuthPage(res, 400, 'OAuth 状态校验失败，请重试')
        return
      }
      const code = params.get('code')
      if (!code) {
        respondOAuthPage(res, 400, '缺少授权码')
        return
      }
      respondOAuthPage(res, 200, '授权完成，可关闭此页')
      onCode(code)
    })
    server.on('error', fail)
    server.listen(port, '127.0.0.1', function () {
      if (!settled) {
        settled = true
        resolve({
          server: server,
          port: port,
          close: function () { try { server.close() } catch (err) { /* 忽略 */ } },
        })
      }
    })
  })
}

// 回调页响应（纯静态 HTML，无用户输入拼接风险；message 均为本模块常量）
function respondOAuthPage(res, status, message) {
  const safe = String(message).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>ChatGPT 授权</title></head>' +
    '<body style="font-family:system-ui,sans-serif;padding:3rem 2rem;text-align:center;background:#f7f7f8">' +
    '<h2 style="color:#0d0d0d">' + safe + '</h2>' +
    '<p style="color:#555">你可以关闭此页面，返回 DSH 继续。</p>' +
    '</body></html>'
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(html)
}

function loadUsageRecords() {
  try {
    if (!existsSync(DATA_FILE)) return []
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (r) {
      return r && typeof r === 'object' && typeof r.ts === 'number'
        && typeof r.input === 'number' && typeof r.output === 'number'
        && typeof r.model === 'string' && typeof r.provider === 'string';
    });
  } catch (err) { /* 文件损坏/不可读 → 从空开始，不影响主流程 */ return [] }
}

export default {
  inject: ['credentials', 'shell', 'timer', 'settings'],
  apply(ctx) {
    // ---------- 定价表（元/美元 · 百万 tokens；DeepSeek 官方 2026-08-17；OpenAI 为 2026 官方价示例） ----------
    const PRICING = {
      'deepseek-v4-flash': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.10, inputCacheMiss: 3.0, output: 9.0 },
        offpeak:{ inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
      },
      'deepseek-v4-pro': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.30, inputCacheMiss: 9.0, output: 27.0 },
        offpeak:{ inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
      },
      'deepseek-chat': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.5, inputCacheMiss: 2.0, output: 8.0 } },
      'gpt-4o':        { currency: 'USD', mode: 'flat', price: { inputCacheHit: 1.25, inputCacheMiss: 2.5, output: 10.0 } },
      'gpt-4o-mini':   { currency: 'USD', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.15, output: 0.6 } },
    };
    function modelCurrency(model) {
      const entry = PRICING[model];
      if (entry && entry.currency) return entry.currency;
      return model && model.indexOf('gpt') === 0 ? 'USD' : 'CNY';
    }
    const DEFAULT_MODEL = 'deepseek-v4-flash';
    const SCENARIOS = [
      { id: 'qa',       label: '日常问答',            outputK: 2,   inputK: 4 },
      { id: 'coding',   label: '中等编码任务',        outputK: 15,  inputK: 30 },
      { id: 'doc',      label: '长文档分析/代码审查', outputK: 40,  inputK: 120 },
      { id: 'refactor', label: '大工程重构（多轮）',  outputK: 150, inputK: 500 },
      { id: 'subagent', label: '子代理工作流',        outputK: 300, inputK: 1000 },
    ];
    const CALIB_SESSIONS = 10;
    const SPEND_DAYS = 7;
    const ALERT_THRESHOLD = 20; // 默认预警阈值（¥/$）

    // ---------- 服务商适配器（余额仅 DeepSeek 真实 API；OpenAI 为记账回退估算） ----------
    const PROVIDERS = {
      deepseek: {
        id: 'deepseek', displayName: 'DeepSeek', credential: 'DEEPSEEK_API_KEY',
        balanceAPI: 'https://api.deepseek.com/user/balance',
        estimate: false,
        parseBalance: function (body) {
          const list = body && Array.isArray(body.balance_infos) ? body.balance_infos : [];
          let cny = null;
          for (let i = 0; i < list.length; i++) {
            if (list[i].currency === 'CNY') { cny = list[i]; break; }
          }
          const rec = cny || list[0];
          if (!rec) return null;
          return {
            currency: rec.currency || 'CNY',
            total: parseFloat(rec.total_balance) || 0,
            granted: parseFloat(rec.granted_balance) || 0,
            toppedUp: parseFloat(rec.topped_up_balance) || 0,
          };
        },
      },
      openai: {
        id: 'openai', displayName: 'OpenAI', credential: 'OPENAI_API_KEY',
        balanceAPI: null, // 无公开余额 API → 记账回退
        estimate: true,
        initialTopUp: 20, // USD 起始充值额（内存态）
      },
    };

    // ---------- 配置（内存态） ----------
    let config = {
      displayMode: 'replace',
      infoDensity: 'full', // 'full' 完整 | 'compact' 简洁
      activeProvider: 'deepseek',
      alertThreshold: ALERT_THRESHOLD,
      billingMode: 'auto', // 'auto' 按 provider 检测余额/订阅 | 'balance'/'subscription' 手动强制覆盖
    };

    // ---------- 余额快照（60s 定时刷新；失败保留上次快照） ----------
    let balances = {}; // { [providerId]: { data, fetchedAt, error } }

    function providerSpend(providerId) {
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.provider !== providerId) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return total;
    }

    const balanceSeq = {}; // 每 provider 刷新序号：仅最新一次请求可写入快照，防慢请求覆盖新数据

    function refreshProviderBalance(pid) {
      const prov = PROVIDERS[pid];
      if (!prov) return;
      const seq = (balanceSeq[pid] || 0) + 1;
      balanceSeq[pid] = seq;
      if (!prov.balanceAPI) {
        // 记账回退：估算余额 = 起始充值额 - 累计花费
        const spend = providerSpend(pid);
        const total = Math.max(0, prov.initialTopUp - spend);
        balances[pid] = { data: { currency: 'USD', total: total, granted: 0, toppedUp: prov.initialTopUp }, fetchedAt: Date.now(), error: null };
        return;
      }
      (async function () {
        let cred = null;
        try {
          cred = await ctx.credentials.resolve(prov.credential);
        } catch (err) {
          balances[pid] = { data: null, fetchedAt: null, error: { kind: 'credentials', message: '凭据读取失败' } };
          return;
        }
        if (!cred || !cred.value) {
          balances[pid] = { data: null, fetchedAt: null, error: { kind: 'no-key', message: '未配置 ' + prov.credential } };
          return;
        }
        try {
          // API Key 经 HTTP 头传递，不进子进程命令行（避免 ps 可见 / shell 注入）
          const res = await fetch(prov.balanceAPI, {
            headers: { Authorization: 'Bearer ' + cred.value },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
            return;
          }
          const body = await res.json();
          const parsed = prov.parseBalance(body);
          if (!parsed) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'parse', message: '响应格式异常' } };
            return;
          }
          if (balanceSeq[pid] === seq) balances[pid] = { data: parsed, fetchedAt: Date.now(), error: null };
        } catch (err) {
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      })();
    }

    function refreshAllBalances() {
      for (const pid in PROVIDERS) refreshProviderBalance(pid);
    }

    // ---------- 订阅额度快照（复用余额模式：周期刷新 / 失败保留旧快照 / seq 防旧覆盖） ----------
    let subscriptions = {}; // { [sourceKey]: { data: {provider,plan,windows}, fetchedAt, error } }
    const subscriptionSeq = {}; // 每 source 刷新序号：仅最新一次请求可写入快照
    const subscriptionInFlight = {}; // { [sourceKey]: Promise } 并发去重（同一时刻只发一个请求）
    const subscriptionRequested = {}; // 仅"客户端请求过"的源进入 60s 周期刷新（余额制下不打扰订阅接口）
    const subscriptionLastFailAt = {}; // { [sourceKey]: ms } 上次订阅刷新失败时刻（失败退避：期内不重试）

    async function fetchWhamUsage(token, accountId) {
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      if (accountId) headers['ChatGPT-Account-Id'] = accountId;
      const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: headers,
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch (err) { /* 非 JSON 响应体 → 交由解析层判定结构异常 */ }
      return { ok: res.ok, status: res.status, body: body };
    }

    async function fetchCodexUsage() {
      let auth = null;
      try {
        auth = JSON.parse(readFileSync(CODEX_AUTH_FILE, 'utf8'));
      } catch (err) {
        return { error: { kind: 'no-key', message: '未找到 ChatGPT 订阅登录凭证（~/.codex/auth.json）' } };
      }
      const tokens = auth && auth.tokens;
      const access = tokens && tokens.access_token;
      const refresh = tokens && tokens.refresh_token;
      const accountId = tokens && tokens.account_id;
      if (typeof access !== 'string' || access.length === 0) {
        return { error: { kind: 'no-key', message: 'ChatGPT 订阅登录凭证缺少 access_token' } };
      }
      let token = access;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetchWhamUsage(token, accountId);
        if (r.status === 401 && attempt === 0 && typeof refresh === 'string' && refresh.length > 0) {
          const pair = await refreshCodexTokenPair(refresh);
          if (!pair) return { error: { kind: 'auth', message: 'Codex access_token 过期且续期失败' } };
          token = pair.access_token;
          continue;
        }
        if (!r.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + r.status + '）' } };
        const parsed = parseCodexUsage(r.body);
        if (!parsed) return { error: { kind: 'parse', message: '响应格式异常' } };
        return { data: { provider: 'codex', plan: parsed.plan, windows: parsed.windows } };
      }
      return { error: { kind: 'http', message: '请求失败（HTTP 401）' } };
    }

    // OpenCode Go key 解析：DSH credentials（OPENCODE_GO_API_KEY）→ opencode auth.json（opencode-go → opencode）
    async function resolveOpenCodeGoKey() {
      try {
        const cred = await ctx.credentials.resolve('OPENCODE_GO_API_KEY');
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 回退到 auth.json */ }
      try {
        const auth = JSON.parse(readFileSync(OPENCODE_AUTH_FILE, 'utf8'));
        for (const name of ['opencode-go', 'opencode']) {
          const entry = auth && auth[name];
          if (entry && typeof entry === 'object') {
            if (typeof entry.key === 'string' && entry.key.length > 0) return entry.key;
            if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return entry.apiKey;
          }
        }
      } catch (err) { /* 未配置 → 返回 null */ }
      return null;
    }

    async function fetchOpenCodeGoUsage() {
      const key = await resolveOpenCodeGoKey();
      if (!key) {
        return { error: { kind: 'no-key', message: '未配置 OpenCode Go（OPENCODE_GO_API_KEY 或 opencode auth.json）' } };
      }
      try {
        const res = await fetch('https://opencode.ai/zen/go/v1/usage', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
        const body = await res.json();
        const parsed = parseOpenCodeGoUsage(body);
        if (!parsed) return { error: { kind: 'parse', message: '响应格式异常' } };
        return { data: { provider: 'opencode-go', plan: parsed.plan, windows: parsed.windows } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    const SUBSCRIPTION_SOURCES = {
      codex: { fetch: fetchCodexUsage },
      'opencode-go': { fetch: fetchOpenCodeGoUsage },
    };

    // 触发一次刷新（并发去重 + seq 防旧覆盖）；返回本次刷新 Promise
    function kickSubscriptionRefresh(sourceKey) {
      const src = SUBSCRIPTION_SOURCES[sourceKey];
      if (!src) return Promise.resolve();
      if (subscriptionInFlight[sourceKey]) return subscriptionInFlight[sourceKey];
      const seq = (subscriptionSeq[sourceKey] || 0) + 1;
      subscriptionSeq[sourceKey] = seq;
      subscriptionInFlight[sourceKey] = src.fetch().then(function (result) {
        if (subscriptionSeq[sourceKey] === seq) {
          subscriptions[sourceKey] = mergeSubscriptionResult(subscriptions[sourceKey], result);
          // 失败退避记录：失败记时刻（期内不重试），成功清零
          if (result && result.error) subscriptionLastFailAt[sourceKey] = Date.now();
          else subscriptionLastFailAt[sourceKey] = 0;
        }
      }).catch(function (err) {
        if (subscriptionSeq[sourceKey] === seq) {
          subscriptions[sourceKey] = mergeSubscriptionResult(subscriptions[sourceKey], {
            error: { kind: 'exception', message: String((err && err.message) || err) },
          });
          subscriptionLastFailAt[sourceKey] = Date.now();
        }
      }).finally(function () {
        subscriptionInFlight[sourceKey] = null;
      });
      return subscriptionInFlight[sourceKey];
    }

    // 60s 周期刷新：仅刷新客户端请求过的源（余额制模式下不打扰未公开的订阅接口）；失败退避期内跳过
    function refreshActiveSubscriptions() {
      const nowMs = Date.now();
      for (const sourceKey in SUBSCRIPTION_SOURCES) {
        if (!subscriptionRequested[sourceKey]) continue;
        const lastFailAt = subscriptionLastFailAt[sourceKey] || 0;
        if (nowMs - lastFailAt < SUBSCRIPTION_RETRY_BACKOFF_MS) continue;
        kickSubscriptionRefresh(sourceKey);
      }
    }

    // RPC：当前订阅额度快照 + 模式判定（非订阅模式直接返回，不发任何订阅请求）
    async function getSubscriptionSnapshotRpc() {
      const sel = modelSelection();
      const bm = detectBillingMode(sel.provider, config.billingMode);
      const out = { mode: bm.mode, provider: sel.provider, reason: bm.reason, source: null, plan: null, windows: [], fetchedAt: null, error: null };
      if (bm.mode !== 'subscription') return out;
      const sourceKey = subscriptionSourceFor(sel.provider);
      if (!sourceKey) return out;
      out.source = sourceKey;
      subscriptionRequested[sourceKey] = true; // 该源进入 60s 周期刷新
      const snap = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      const nowMs = Date.now();
      const lastFailAt = subscriptionLastFailAt[sourceKey] || 0;
      // 失败退避：快照过期（>60s 无成功）且距上次失败 ≥ 退避期（60s）才重试——
      // 减少对未公开 wham 接口的请求，也避免"刷新失败"提示随每次轮询反复闪烁（失败期内直接读缓存快照）
      const stale = (!snap.fetchedAt || (nowMs - snap.fetchedAt) > SUBSCRIPTION_REFRESH_MS)
        && (nowMs - lastFailAt) >= SUBSCRIPTION_RETRY_BACKOFF_MS;
      if (stale) {
        const inflight = kickSubscriptionRefresh(sourceKey);
        // 从未成功过（无旧数据）→ 等本次刷新返回最新结果（含错误），避免退避重试后仍返回旧失败快照；
        // 已有旧数据 → 后台刷新，本次直接返回快照（不阻塞轮询）
        if (!snap.data) await inflight;
      }
      const cur = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      if (cur.data) { out.plan = cur.data.plan; out.windows = cur.data.windows; }
      out.fetchedAt = cur.fetchedAt;
      out.error = cur.error;
      return out;
    }

    // ---------- 北京时间峰谷判定 ----------
    function beijingMinutes(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
    function currentPeriod(nowMs) {
      const m = beijingMinutes(nowMs);
      return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60) ? 'peak' : 'offpeak';
    }
    function nextSwitchAt(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const cur = d.getUTCHours() * 60 + d.getUTCMinutes();
      const bounds = [9, 12, 14, 18];
      for (let i = 0; i < bounds.length; i++) {
        const b = bounds[i] * 60;
        if (b > cur) {
          return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), bounds[i], 0, 0) - 8 * 3600 * 1000).getTime();
        }
      }
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 9, 0, 0) - 8 * 3600 * 1000).getTime();
    }
    function nextPeriodLabel(nowMs) {
      const at = nextSwitchAt(nowMs);
      const d = new Date(at + 8 * 3600 * 1000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return { at: at, atLabel: hh + ':' + mm, nextIsPeak: currentPeriod(at) === 'peak' };
    }
    function beijingDayKey(ts) {
      const d = new Date(ts + 8 * 3600 * 1000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }

    // ---------- 当前模型识别 ----------
    function modelSelection() {
      const svc = ctx.get('agentDefaultModel');
      let fallback = false;
      let provider = '';
      let model = DEFAULT_MODEL;
      if (svc && typeof svc.currentSelection === 'function') {
        try {
          const s = svc.currentSelection();
          if (s && typeof s.model === 'string' && s.model.length > 0) {
            provider = typeof s.provider === 'string' ? s.provider : '';
            model = s.model;
          } else {
            fallback = true;
          }
        } catch (err) {
          fallback = true;
        }
      } else {
        fallback = true;
      }
      return { provider: provider, model: model, fallback: fallback };
    }

    // ---------- 服务商显示名静态映射（M5 起为 providerDisplayFromCache 的回退层） ----------
    const PROVIDER_DISPLAY = {
      deepseek: 'DeepSeek',
      'deepseek-official': 'DeepSeek',
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      moonshot: 'Moonshot',   // Kimi
      zhipu: 'Zhipu',         // GLM
      glm: 'GLM',
      kimi: 'Kimi',
      qwen: 'Qwen',
      anthropic: 'Anthropic',
      google: 'Google',
      gemini: 'Gemini',
      mistral: 'Mistral',
      xai: 'xAI',
      groq: 'Groq',
    };

    // ---------- DSH 模型/服务商目录名缓存（M5：与模型切换器完全一致） ----------
    // llm.listModels(provider) → DSH LLM 目录 { id, name }；llm.listProviders() → { id, name }。
    // 缓存异步填充：启动即刷 + llm/adapters-updated 事件刷新 + getPricing 首次缺缓存时按需等待；
    // llm 服务缺失/查询失败保留旧缓存（stale 可接受），展示层回退原始 id / 静态映射，绝不崩溃。
    let modelNameCache = {};    // { provider: { modelId: name } }
    let providerNameCache = {}; // { provider: name }
    let modelCatalogRefreshed = {}; // { provider: true } 已尝试刷新（防 getPricing 反复打目录）

    async function refreshModelCatalog(provider) {
      const llm = ctx.get ? ctx.get('llm') : null;
      if (!llm || typeof llm.listModels !== 'function' || !provider) return;
      try {
        const models = await llm.listModels(provider);
        const map = {};
        if (Array.isArray(models)) {
          for (let i = 0; i < models.length; i++) {
            const m = models[i];
            if (m && typeof m.id === 'string' && m.id.length > 0 && typeof m.name === 'string' && m.name.length > 0) map[m.id] = m.name;
          }
        }
        modelNameCache[provider] = map;
      } catch (err) { /* 目录查询失败保留旧缓存，绝不崩溃 */ }
      try {
        const provs = typeof llm.listProviders === 'function' ? await llm.listProviders() : null;
        if (Array.isArray(provs)) {
          for (let i = 0; i < provs.length; i++) {
            const p = provs[i];
            if (p && typeof p.id === 'string' && p.id.length > 0 && typeof p.name === 'string' && p.name.length > 0) providerNameCache[p.id] = p.name;
          }
        }
      } catch (err) { /* 同上 */ }
      modelCatalogRefreshed[provider] = true;
    }

    // 刷新当前激活 provider 的目录名缓存（启动 / llm/adapters-updated / 切模型后按需调用）
    function refreshActiveModelCatalog() {
      const sel = modelSelection();
      return refreshModelCatalog(sel.provider);
    }

    // ---------- 定价计算 ----------
    function computePricing(nowMs) {
      const sel = modelSelection();
      const entry = PRICING[sel.model];
      const period = entry && entry.mode === 'peak-valley' ? currentPeriod(nowMs) : 'flat';
      let prices = null;
      if (entry) {
        prices = entry.mode === 'peak-valley' ? entry[period] : entry.price;
      }
      const switchInfo = entry && entry.mode === 'peak-valley' ? nextPeriodLabel(nowMs) : null;
      return {
        model: sel.model,
        provider: sel.provider,
        providerDisplay: providerDisplayFromCache(sel.provider, providerNameCache, PROVIDER_DISPLAY),
        modelDisplay: modelDisplayFromCache(sel.model, sel.provider, modelNameCache),
        fallback: sel.fallback || !entry,
        mode: entry ? entry.mode : 'unknown',
        period: period,
        prices: prices,
        nextSwitch: switchInfo,
        refreshedAt: nowMs,
      };
    }

    // ---------- 当前激活服务商余额（含预警） ----------
    function activeBalanceSummary(providerId, nowMs) {
      const pid = providerId || config.activeProvider;
      const prov = PROVIDERS[pid] || PROVIDERS.deepseek;
      const snap = balances[pid] || { data: null, fetchedAt: null, error: null };
      let alert = null;
      if (snap.data && snap.data.total != null) {
        const threshold = config.alertThreshold;
        const total = snap.data.total;
        alert = {
          active: total < threshold,
          threshold: threshold,
          currency: snap.data.currency || 'CNY',
          total: total,
        };
      }
      return {
        provider: prov.id,
        displayName: prov.displayName,
        estimate: !!prov.estimate,
        currency: snap.data ? snap.data.currency : (prov.id === 'deepseek' ? 'CNY' : 'USD'),
        data: snap.data,
        fetchedAt: snap.fetchedAt,
        error: snap.error,
        alert: alert,
        now: nowMs,
      };
    }

    // ---------- 用量记账（llm/stream waterfall；落盘持久化，重启不丢失） ----------
    let usageRecords = loadUsageRecords(); // { ts, model, provider, sessionId, purpose, input, cacheRead, cacheWrite, output }
    let saveDisposer = null;
    let dirty = false;

    function flushSave() {
      if (saveDisposer) { saveDisposer(); saveDisposer = null; }
      try {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        // 原子写：先写临时文件再 rename，避免进程崩溃/写一半留下损坏 JSON 导致历史归零
        const tmp = DATA_FILE + '.tmp';
        writeFileSync(tmp, JSON.stringify(usageRecords), { mode: 0o600 });
        renameSync(tmp, DATA_FILE);
        dirty = false; // 写盘成功后才清除脏标记：失败时保留，卸载冲刷可重试
      } catch (err) { /* 落盘失败不影响主流程；保留 dirty，下次记账/卸载时重试 */ console.warn('[bottom-info-bar] 记账落盘失败', String((err && err.message) || err)); }
    }

    // 防抖落盘：记账后 4s 内合并写入；插件卸载时立即冲刷
    function scheduleSave() {
      dirty = true;
      if (saveDisposer) return;
      saveDisposer = ctx.timeout(function () {
        saveDisposer = null;
        if (dirty) flushSave();
      }, 4000);
    }

    function recordUsage(options, usage) {
      const rec = {
        ts: Date.now(),
        model: options.model || '',
        provider: options.provider || '',
        sessionId: options.sessionId || '',
        purpose: options.purpose || '',
        input: usage.uncachedInputTokens != null ? usage.uncachedInputTokens : (usage.inputTokens || 0),
        cacheRead: usage.cacheReadTokens || 0,
        cacheWrite: usage.cacheWriteTokens || 0,
        output: usage.outputTokens || 0,
      };
      usageRecords.push(rec);
      if (usageRecords.length > 3000) usageRecords.splice(0, usageRecords.length - 3000);
      scheduleSave();
    }

    ctx.on('llm/stream', async function* (options, next) {
      let stream;
      try {
        stream = await next();
      } catch (err) {
        console.warn('[bottom-info-bar] llm/stream 获取失败，本次不记账', String((err && err.message) || err));
        return;
      }
      try {
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'usage' && chunk.usage) {
            try { recordUsage(options, chunk.usage); } catch (err) { /* 记账失败不影响请求 */ }
          }
          yield chunk;
        }
      } catch (err) {
        throw err;
      }
    });

    // M5：适配器/目录变更（模型增删、provider 改名）→ 重建目录名缓存，信息栏模型名与切换器保持一致
    ctx.on('llm/adapters-updated', function () {
      modelCatalogRefreshed = {};
      refreshActiveModelCatalog();
    });

    // ---------- 花费计算 ----------
    function costOf(record, forceOffpeak) {
      const entry = PRICING[record.model];
      if (!entry) return null;
      let p;
      if (entry.mode === 'peak-valley') {
        p = forceOffpeak ? entry.offpeak : entry[currentPeriod(record.ts)];
      } else {
        p = entry.price;
      }
      const missInput = record.input + record.cacheWrite;
      return (missInput * p.inputCacheMiss + record.cacheRead * p.inputCacheHit + record.output * p.output) / 1e6;
    }

    // ---------- 会话聚合与中位数 ----------
    function median(arr) {
      if (!arr || arr.length === 0) return 0;
      const s = arr.slice().sort(function (a, b) { return a - b; });
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    }

    function sessionTotals() {
      const map = new Map();
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        const key = r.sessionId || (r.provider + '/' + r.model + '#' + r.ts);
        let s = map.get(key);
        if (!s) {
          s = { sessionId: r.sessionId, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {}, lastTs: r.ts };
          map.set(key, s);
        }
        s.input += r.input;
        s.cacheRead += r.cacheRead;
        s.cacheWrite += r.cacheWrite;
        s.output += r.output;
        const c = costOf(r, false);
        if (c != null) {
          const cur = modelCurrency(r.model);
          s.costs[cur] = (s.costs[cur] || 0) + c;
        }
        if (r.ts > s.lastTs) s.lastTs = r.ts;
      }
      return Array.from(map.values()).sort(function (a, b) { return a.lastTs - b.lastTs; });
    }

    function calibrationFrom(sessions, n) {
      if (!sessions || sessions.length === 0) return null;
      const recent = sessions.slice(-n);
      const count = recent.length;
      return {
        count: count,
        label: '基于你最近 ' + count + ' 次会话',
        medianInput: median(recent.map(function (s) { return s.input; })),
        medianCacheRead: median(recent.map(function (s) { return s.cacheRead; })),
        medianCacheWrite: median(recent.map(function (s) { return s.cacheWrite; })),
        medianOutput: median(recent.map(function (s) { return s.output; })),
      };
    }

    // 会话 ID 归一化：DSH 部分路径会给 sessionId 加 'session-' 前缀，去掉后统一比较
    function normalizeSessionId(id) {
      if (!id) return '';
      return String(id).replace(/^session-/, '');
    }

    function currentSessionSummary(sessions, sessionId) {
      if (!sessions || sessions.length === 0) return null;
      if (!sessionId) return null; // 无可用会话 ID：不猜测归属，客户端显示 ¥0.000，而非回退最近会话
      const norm = normalizeSessionId(sessionId);
      let target = null;
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (normalizeSessionId(sessions[i].sessionId) === norm) { target = sessions[i]; break; }
      }
      if (!target) return null; // 明确传入但未命中（新对话尚无记账）→ 客户端显示 ¥0.000
      const denom = target.input + target.cacheRead + target.cacheWrite;
      const tokens = target.input + target.cacheRead + target.cacheWrite + target.output;
      return {
        input: target.input,
        cacheRead: target.cacheRead,
        cacheWrite: target.cacheWrite,
        output: target.output,
        tokens: tokens,
        costs: target.costs || {},
        hitRate: denom > 0 ? Math.round((target.cacheRead / denom) * 1000) / 10 : null,
      };
    }

    function activeCurrency() {
      const snap = balances[config.activeProvider];
      if (snap && snap.data && snap.data.currency) return snap.data.currency;
      const entry = PRICING[DEFAULT_MODEL];
      return entry ? entry.currency : 'CNY';
    }

    function spendSummary(nowMs) {
      const snap = balances[config.activeProvider] || { data: null };
      const balance = snap.data ? snap.data.total : null;
      const cur = activeCurrency();
      const cutoff = nowMs - SPEND_DAYS * 86400 * 1000;
      let total = 0;
      let offpeakTotal = 0;
      const daySet = new Set();
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.ts < cutoff) continue;
        if (modelCurrency(r.model) !== cur) continue; // 只聚合活动币种，避免跨币种相加
        const c = costOf(r, false);
        if (c == null) continue;
        total += c;
        const oc = costOf(r, true);
        if (oc != null) offpeakTotal += oc;
        daySet.add(beijingDayKey(r.ts));
      }
      if (total <= 0 || balance == null) return null;
      const daysActive = Math.max(1, daySet.size);
      const dailySpend = total / daysActive;
      const offpeakDailySpend = offpeakTotal / daysActive;
      return {
        days: SPEND_DAYS,
        daysActive: daysActive,
        totalSpend: Math.round(total * 100) / 100,
        dailySpend: Math.round(dailySpend * 100) / 100,
        balance: balance,
        daysLeft: dailySpend > 0 ? Math.round(balance / dailySpend * 10) / 10 : null,
        offpeakDailySpend: Math.round(offpeakDailySpend * 100) / 100,
        offpeakDaysLeft: offpeakDailySpend > 0 ? Math.round(balance / offpeakDailySpend * 10) / 10 : null,
        note: '基于过去 ' + SPEND_DAYS + ' 天消耗速度的估算',
      };
    }

    // ---------- 今日花费（北京时间当日累计，仅活动币种） ----------
    function todaySpend(nowMs) {
      const key = beijingDayKey(nowMs);
      const cur = activeCurrency();
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (beijingDayKey(r.ts) !== key) continue;
        if (modelCurrency(r.model) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 本月/近30天花费（仅活动币种） ----------
    function monthSpend(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      const cur = activeCurrency();
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        const rd = new Date(r.ts + 8 * 3600 * 1000);
        if (rd.getUTCFullYear() + '-' + String(rd.getUTCMonth() + 1).padStart(2, '0') !== key) continue;
        if (modelCurrency(r.model) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }
    function last30dSpend(nowMs) {
      const cutoff = nowMs - 30 * 86400 * 1000;
      const cur = activeCurrency();
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.ts < cutoff) continue;
        if (modelCurrency(r.model) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 场景估算 ----------
    function scenarioCost(sc, rate, prices) {
      const input = sc.inputK * 1000;
      const output = sc.outputK * 1000;
      const inputCost = input * (rate * prices.inputCacheHit + (1 - rate) * prices.inputCacheMiss);
      const outputCost = output * prices.output;
      return (inputCost + outputCost) / 1e6;
    }

    function computeEstimate(nowMs) {
      const pricing = computePricing(nowMs);
      const bal = activeBalanceSummary(config.activeProvider, nowMs);
      const balance = bal.data ? bal.data.total : null;
      const currency = bal.currency || 'CNY';

      let conversion = null;
      if (balance != null && pricing.prices) {
        const p = pricing.prices;
        const outputTokens = (balance * 1e6) / p.output;
        const inputTokens = (balance * 1e6) / p.inputCacheMiss;
        conversion = {
          outputTokens: Math.floor(outputTokens),
          outputHanzi: Math.floor(outputTokens * 0.5),
          outputWords: Math.floor(outputTokens * 0.75),
          outputBooks: (outputTokens * 0.5) / 200000,
          inputTokens: Math.floor(inputTokens),
          inputHanzi: Math.floor(inputTokens * 0.5),
        };
      }

      let scenarios = [];
      if (balance != null && pricing.prices) {
        const p = pricing.prices;
        const peakPrices = pricing.mode === 'peak-valley' ? PRICING[pricing.model].peak : p;
        const offpeakPrices = pricing.mode === 'peak-valley' ? PRICING[pricing.model].offpeak : p;
        scenarios = SCENARIOS.map(function (sc) {
          return {
            id: sc.id, label: sc.label, outputK: sc.outputK, inputK: sc.inputK,
            optimistic: Math.floor(balance / scenarioCost(sc, 1.0, offpeakPrices)),
            pessimistic: Math.floor(balance / scenarioCost(sc, 0, peakPrices)),
            baseline: Math.floor(balance / scenarioCost(sc, 0.5, p)),
            offpeakBase: Math.floor(balance / scenarioCost(sc, 0.5, offpeakPrices)),
          };
        });
        const calib = calibrationFrom(sessionTotals(), CALIB_SESSIONS);
        if (calib && calib.medianOutput > 0) {
          const sc = {
            id: 'calibrated', label: '你的典型会话',
            outputK: Math.max(1, Math.round(calib.medianOutput / 1000)),
            inputK: Math.max(1, Math.round((calib.medianInput + calib.medianCacheRead + calib.medianCacheWrite) / 1000)),
            calibrated: true, calibrationCount: calib.count,
          };
          scenarios.unshift({
            id: sc.id, label: sc.label, outputK: sc.outputK, inputK: sc.inputK,
            calibrated: true, calibrationCount: sc.calibrationCount,
            optimistic: Math.floor(balance / scenarioCost(sc, 1.0, offpeakPrices)),
            pessimistic: Math.floor(balance / scenarioCost(sc, 0, peakPrices)),
            baseline: Math.floor(balance / scenarioCost(sc, 0.5, p)),
            offpeakBase: Math.floor(balance / scenarioCost(sc, 0.5, offpeakPrices)),
          });
        }
      }

      return {
        currency: currency,
        balance: balance,
        conversion: conversion,
        scenarios: scenarios,
        calibration: calibrationFrom(sessionTotals(), CALIB_SESSIONS),
        pricing: pricing,
        fetchedAt: balances[config.activeProvider] ? balances[config.activeProvider].fetchedAt : null,
        stale: !!balances[config.activeProvider] && balances[config.activeProvider].error !== null && balances[config.activeProvider].data !== null,
        error: balances[config.activeProvider] ? balances[config.activeProvider].error : null,
      };
    }

    // ---------- 全部花费 ----------
    function totalSpend() {
      const cur = activeCurrency();
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (modelCurrency(r.model) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 用量汇总 ----------
    function getUsageSummary(nowMs, sessionId) {
      const sessions = sessionTotals();
      return {
        sessions: sessions.length,
        calibration: calibrationFrom(sessions, CALIB_SESSIONS),
        currentSession: currentSessionSummary(sessions, sessionId),
        spend: spendSummary(nowMs),
        todaySpend: todaySpend(nowMs),
        monthSpend: monthSpend(nowMs),
        last30dSpend: last30dSpend(nowMs),
        totalSpend: totalSpend(),
        now: nowMs,
      };
    }

    // ---------- 服务商列表 ----------
    function providerList(nowMs) {
      const out = [];
      for (const pid in PROVIDERS) {
        const prov = PROVIDERS[pid];
        const snap = balances[pid] || { data: null, fetchedAt: null, error: null };
        out.push({
          id: prov.id,
          displayName: prov.displayName,
          estimate: !!prov.estimate,
          active: pid === config.activeProvider,
          currency: snap.data ? snap.data.currency : (pid === 'deepseek' ? 'CNY' : 'USD'),
          total: snap.data ? snap.data.total : null,
          fetchedAt: snap.fetchedAt,
          error: snap.error,
        });
      }
      return out;
    }

    // ---------- 花费趋势 ----------
    function spendTrend(nowMs, days) {
      const d = days === 30 ? 30 : 7;
      const points = [];
      const byModel = {};
      for (let i = d - 1; i >= 0; i--) {
        const dayStart = new Date(nowMs + 8 * 3600 * 1000);
        dayStart.setUTCDate(dayStart.getUTCDate() - i);
        dayStart.setUTCHours(0, 0, 0, 0);
        const startMs = dayStart.getTime() - 8 * 3600 * 1000;
        const endMs = startMs + 86400 * 1000;
        const label = String(dayStart.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dayStart.getUTCDate()).padStart(2, '0');
        let spend = 0;
        let offpeak = 0;
        for (let j = 0; j < usageRecords.length; j++) {
          const r = usageRecords[j];
          if (r.ts < startMs || r.ts >= endMs) continue;
          const c = costOf(r, false);
          if (c == null) continue;
          spend += c;
          const oc = costOf(r, true);
          if (oc != null) offpeak += oc;
        }
        points.push({ label: label, spend: Math.round(spend * 1000) / 1000, offpeak: Math.round(offpeak * 1000) / 1000 });
      }
      const cutoff = nowMs - d * 86400 * 1000;
      for (let j = 0; j < usageRecords.length; j++) {
        const r = usageRecords[j];
        if (r.ts < cutoff) continue;
        const c = costOf(r, false);
        if (c == null) continue;
        const key = r.model || r.provider;
        byModel[key] = (byModel[key] || 0) + c;
      }
      const byModelList = Object.keys(byModel).map(function (m) {
        return { model: m, spend: Math.round(byModel[m] * 1000) / 1000 };
      }).sort(function (a, b) { return b.spend - a.spend; });
      return { days: d, points: points, byModel: byModelList, now: nowMs };
    }

    // ---------- Codex 桥接（v1.2.0）：把 ~/.codex/auth.json 的订阅令牌自动喂给 DSH 的 openai-codex 路由 ----------
    // 内存状态（RPC getCodexBridgeStatus 暴露，供调试/信息栏未来使用）；令牌值永不进状态/日志/仓库
    let codexBridgeState = { ok: false, lastSyncAt: null, expiresAt: null, error: null, routeConfigured: false };
    let codexInjectedToken = null; // 上次注入的令牌（同值跳过：避免无谓写盘与 credentials/updated 广播）

    // 启动时一次：注册 openai-codex 模型路由（先读后写幂等——用户已有配置绝不被覆盖）
    async function ensureCodexRoute() {
      const settings = ctx.settings || ctx.get('settings');
      if (!settings || typeof settings.get !== 'function' || typeof settings.mutate !== 'function') {
        codexBridgeState.error = { kind: 'settings', message: 'settings 服务未就绪，下个周期重试' };
        return; // 服务晚就绪 → 下个 interval tick 由 syncCodexToken 顺延重试
      }
      try {
        const cur = settings.get('llm-pi-ai');
        const providers = cur && typeof cur === 'object' && cur.providers && typeof cur.providers === 'object' ? cur.providers : {};
        const existing = providers['openai-codex'];
        if (existing && typeof existing.apiKeyEnv === 'string' && existing.apiKeyEnv.length > 0) {
          // 自我升级：桥接自有的旧默认配置（apiKeyEnv=OPENAI_CODEX_API_KEY）→ 补齐/修正桥接默认值，保留其余字段：
          //   ①显示名 Codex → ChatGPT（Codex 与 ChatGPT 已合并，实际 provider 显示 ChatGPT）
          //   ②transport 补 'sse'——pi-ai 默认 transport=auto 优先走 WebSocket 连 chatgpt.com/backend-api，
          //     实测不稳定（偶发整轮 "WebSocket error" 失败）；sse=HTTP SSE 通道，与官方 codex 客户端同协议，更稳。
          //   用户自定义配置（apiKeyEnv 非桥接注入值）绝不覆盖；升级只发生一次（补齐后 guard 不再命中）
          if (existing.apiKeyEnv === 'OPENAI_CODEX_API_KEY') {
            const patch = {};
            if (existing.displayName === 'Codex') patch.displayName = 'ChatGPT';
            if (existing.transport !== 'sse') patch.transport = 'sse';
            if (Object.keys(patch).length > 0) {
              try {
                await settings.mutate('llm-pi-ai', [{
                  op: 'set',
                  path: ['providers', 'openai-codex'],
                  value: Object.assign({}, existing, patch),
                }]);
              } catch (upErr) {
                codexBridgeState.error = { kind: 'settings', message: 'openai-codex 路由升级失败，稍后重试' };
                console.warn('[bottom-info-bar] Codex 路由升级失败（稍后自动重试）', String((upErr && upErr.message) || upErr));
              }
            }
          }
          codexBridgeState.routeConfigured = true; // 已配置（含用户自定义）→ 幂等返回，不覆盖
          return;
        }
        await settings.mutate('llm-pi-ai', [{
          op: 'set',
          path: ['providers', 'openai-codex'],
          value: { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'ChatGPT', transport: 'sse' },
        }]);
        codexBridgeState.routeConfigured = true;
      } catch (err) {
        // mutate 失败（settings-rejected / 持久层异常）→ 记录并下个 tick 重试，不崩溃
        codexBridgeState.error = { kind: 'settings', message: 'openai-codex 路由注册失败，稍后重试' };
        console.warn('[bottom-info-bar] Codex 路由注册失败（稍后自动重试）', String((err && err.message) || err));
      }
    }

    // 启动即跑 + 30min 周期：读 auth.json → 判定过期 → 续期/写回 → 注入凭据；全程兜底不抛异常
    async function syncCodexToken() {
      try {
        await syncCodexTokenOnce();
      } catch (err) {
        codexBridgeState = { ok: false, lastSyncAt: Date.now(), expiresAt: null, error: { kind: 'exception', message: 'Codex 桥接同步异常' } };
      }
    }

    async function syncCodexTokenOnce() {
      if (!codexBridgeState.routeConfigured) await ensureCodexRoute(); // settings 晚就绪/注册失败 → 顺延重试（幂等）
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const read = readCodexAuthFile(CODEX_AUTH_FILE);
      if (!read.ok) {
        // 未登录态（auth.json 缺失/损坏）→ 状态标记 + 引导文案，不崩溃
        codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: { kind: 'no-login', message: '未找到 ChatGPT 订阅登录凭证（~/.codex/auth.json），请在 DSH 设置「ChatGPT 订阅」页授权绑定' }, routeConfigured: codexBridgeState.routeConfigured };
        return;
      }
      const auth = read.auth;
      const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {};
      const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
      const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
      const lastRefreshMs = Date.parse(auth.last_refresh);
      if (!access) {
        codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: { kind: 'no-key', message: 'ChatGPT 订阅登录凭证缺少 access_token' }, routeConfigured: codexBridgeState.routeConfigured };
        return;
      }
      let expiresAtSec = codexExpiresAt(decodeJwtExp(access), lastRefreshMs);
      let token = null; // 本次确定写入 DSH 凭据库的令牌（null = 不注入，保留旧凭据）
      let error = null;

      if (codexNeedsRefresh(expiresAtSec, nowSec)) {
        if (!refresh) {
          error = { kind: 'auth', message: 'ChatGPT 订阅令牌临近过期但缺少 refresh_token，请重新授权绑定' };
        } else {
          const pair = await refreshCodexTokenPair(refresh);
          if (pair) {
            try {
              const nextRefresh = pair.refresh_token || refresh; // 响应未轮换 refresh_token → 沿用旧值
              const updated = writeAuthJson(CODEX_AUTH_FILE, auth, pair.access_token, nextRefresh, new Date().toISOString());
              token = pair.access_token;
              expiresAtSec = codexExpiresAt(decodeJwtExp(pair.access_token), Date.parse(updated.last_refresh));
            } catch (err) {
              // 写回失败（磁盘只读等）→ 新令牌仍内存可用（注入本次会话），下个周期重试写回
              token = pair.access_token;
              expiresAtSec = codexExpiresAt(decodeJwtExp(pair.access_token), nowMs);
              error = { kind: 'write', message: '续期成功但写回 auth.json 失败' };
            }
          } else {
            // 续期失败（401 refresh_token 失效 / 网络异常）→ 重读文件：Codex CLI 可能已自行轮换令牌
            const reRead = readCodexAuthFile(CODEX_AUTH_FILE);
            const reAuth = reRead.ok ? reRead.auth : null;
            const reTokens = reAuth && reAuth.tokens && typeof reAuth.tokens === 'object' ? reAuth.tokens : {};
            const reAccess = typeof reTokens.access_token === 'string' ? reTokens.access_token : '';
            const reRefreshMs = reAuth && typeof reAuth.last_refresh === 'string' ? Date.parse(reAuth.last_refresh) : NaN;
            if (reAuth && reAccess && !isNaN(reRefreshMs) && (isNaN(lastRefreshMs) || reRefreshMs > lastRefreshMs)) {
              // CLI 已轮换 → 采用文件里的新令牌（不再用过期 refresh_token 重试）
              token = reAccess;
              expiresAtSec = codexExpiresAt(decodeJwtExp(reAccess), reRefreshMs);
            } else {
              error = { kind: 'auth', message: 'ChatGPT 订阅令牌续期失败（refresh_token 可能失效），请重新授权绑定' };
            }
          }
        }
      } else {
        token = access; // 未临近过期 → 直接用现有令牌
      }

      // 注入凭据：成功取得令牌才注入；同值跳过（内存比对），避免无谓写盘与 credentials/updated 广播
      if (token && token !== codexInjectedToken) {
        try {
          await ctx.credentials.set('OPENAI_CODEX_API_KEY', token);
          codexInjectedToken = token;
        } catch (err) {
          if (!error) error = { kind: 'credentials', message: 'Codex 凭据注入失败' };
        }
      }
      codexBridgeState = {
        ok: !error,
        lastSyncAt: nowMs,
        expiresAt: expiresAtSec != null ? expiresAtSec * 1000 : null,
        error: error,
        routeConfigured: codexBridgeState.routeConfigured,
      };
    }

    // ---------- ChatGPT 订阅官方 OAuth 绑定（v1.2.0）：startCodexOAuth / unbindCodex（RPC 触发，client 设置页按钮调用） ----------
    let oauthInFlight = false; // OAuth 授权进行中（防并发：绝不同时存在两个回调 server/state）
    let oauthLastError = null; // 最近一次 OAuth 流程错误（状态 RPC 透出；令牌值永不进入）

    function deferred() {
      let resolve = null;
      const promise = new Promise(function (res) { resolve = res; });
      return { promise: promise, resolve: resolve };
    }

    // 打开系统浏览器（macOS open / Windows start / Linux xdg-open；经 ctx.shell，URL 经引号包裹防注入）；
    // 失败不致命——authorizeUrl 已随 RPC 返回，client 可 window.open 兜底
    async function openOAuthBrowser(authorizeUrl) {
      const shell = (ctx && ctx.shell) || ctx.get('shell');
      if (!shell || typeof shell.run !== 'function') return false;
      const platform = typeof process !== 'undefined' && process.platform ? process.platform : '';
      const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd /c start ""' : 'xdg-open';
      const safeUrl = String(authorizeUrl).replace(/["$`\\]/g, '\\$&');
      const request = { command: openCmd + ' "' + safeUrl + '"' };
      try {
        const result = await shell.run(typeof shell.resolve === 'function' ? shell.resolve(request) : request);
        return !result || result.exitCode === 0 || result.exitCode === undefined;
      } catch (err) {
        return false;
      }
    }

    // OAuth 流程主体（startCodexOAuthRpc 启动回调 server 后后台继续；所有失败/超时只记录状态，不崩溃、不打印令牌）
    async function runCodexOAuthFlow(pkce, state, serverHandle, authorizeUrl, waitCode) {
      let timer = null;
      try {
        await openOAuthBrowser(authorizeUrl);
        // 等待浏览器回调（超时 5 分钟；测试可经 BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS 缩短）
        const code = await Promise.race([
          waitCode.promise,
          new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, OAUTH_CALLBACK_TIMEOUT_MS); }),
        ]);
        if (!code) { oauthLastError = { kind: 'timeout', message: 'OAuth 授权超时（5 分钟），请重试' }; return; }
        // 换令牌（PKCE verifier 仅内存，用完即弃）
        const exchanged = await exchangeAuthorizationCode(code, pkce.verifier);
        if (!exchanged.ok) {
          oauthLastError = { kind: 'exchange', message: 'OAuth 令牌交换失败（' + (exchanged.status != null ? 'HTTP ' + exchanged.status : '网络错误') + '），请重试' };
          return;
        }
        // 构造 auth.json（保留既有结构；account_id 从 JWT 提取）→ 原子写 0600
        const nowIso = new Date().toISOString();
        const read = readCodexAuthFile(CODEX_AUTH_FILE);
        const authToWrite = buildOAuthAuthObject(read.ok ? read.auth : null, exchanged, nowIso);
        try {
          writeAuthJson(CODEX_AUTH_FILE, authToWrite, exchanged.access_token, authToWrite.tokens.refresh_token != null ? authToWrite.tokens.refresh_token : null, nowIso);
        } catch (err) {
          oauthLastError = { kind: 'write', message: 'OAuth 绑定成功但写入 auth.json 失败' };
          return;
        }
        // 注入 DSH 凭据（写入即下次生效，无需重启）
        try {
          await ctx.credentials.set('OPENAI_CODEX_API_KEY', exchanged.access_token);
          codexInjectedToken = exchanged.access_token;
        } catch (err) {
          oauthLastError = { kind: 'credentials', message: 'OAuth 绑定成功但凭据注入失败' };
        }
        const expiresAtSec = codexExpiresAt(decodeJwtExp(exchanged.access_token), Date.parse(nowIso));
        codexBridgeState = {
          ok: true,
          lastSyncAt: Date.now(),
          expiresAt: expiresAtSec != null ? expiresAtSec * 1000 : null,
          error: null,
          routeConfigured: codexBridgeState.routeConfigured,
        };
      } catch (err) {
        oauthLastError = { kind: 'exception', message: 'OAuth 绑定异常：' + String((err && err.message) || err) };
      } finally {
        if (timer) clearTimeout(timer);
        try { serverHandle.close(); } catch (err) { /* 忽略 */ }
        oauthInFlight = false;
      }
    }

    // RPC：启动官方 OAuth 授权（PKCE + state + 本地回调；并发保护；端口占用同步返回错误，不进入后台流程）
    async function startCodexOAuthRpc() {
      if (oauthInFlight) return { ok: false, oauthInFlight: true, error: { kind: 'in-flight', message: 'OAuth 授权进行中，请稍候' } };
      oauthInFlight = true;
      oauthLastError = null;
      const pkce = createPkcePair();
      const state = randomBytes(16).toString('hex');
      const port = oauthCallbackPort();
      const waitCode = deferred();
      const serverHandle = await startOAuthCallbackServer(state, function (code) { waitCode.resolve(code); }, port);
      if (!serverHandle) {
        oauthInFlight = false;
        return { ok: false, oauthInFlight: false, error: { kind: 'port-busy', message: 'OAuth 回调端口 ' + port + ' 被占用，请关闭占用该端口的程序（如正在运行的 codex CLI 登录）后重试' } };
      }
      const authorizeUrl = buildAuthorizeUrl(state, pkce.challenge);
      // 后台继续，不阻塞 RPC（流程内部 try/catch/finally 全覆盖；此处 catch 兜底防意外拒绝）
      runCodexOAuthFlow(pkce, state, serverHandle, authorizeUrl, waitCode).catch(function (err) {
        oauthLastError = { kind: 'exception', message: 'OAuth 绑定异常：' + String((err && err.message) || err) };
      });
      return { ok: true, authorizeUrl: authorizeUrl, oauthInFlight: true };
    }

    // RPC：解绑（清 auth.json 令牌字段保留结构 + credentials.unset + 状态=未绑定）
    async function unbindCodexRpc() {
      if (oauthInFlight) return { ok: false, error: { kind: 'in-flight', message: 'OAuth 授权进行中，请先完成或等待超时' } };
      try {
        const read = readCodexAuthFile(CODEX_AUTH_FILE);
        if (read.ok) clearCodexAuthTokens(CODEX_AUTH_FILE, read.auth);
        try {
          await ctx.credentials.unset('OPENAI_CODEX_API_KEY');
        } catch (err) { /* 凭据库未配置该键时 unset 无害 */ }
        codexInjectedToken = null;
        codexBridgeState = { ok: false, lastSyncAt: Date.now(), expiresAt: null, error: { kind: 'unbound', message: '已解绑 ChatGPT 订阅' }, routeConfigured: codexBridgeState.routeConfigured };
        return { ok: true, bound: false };
      } catch (err) {
        return { ok: false, error: { kind: 'exception', message: '解绑失败：' + String((err && err.message) || err) } };
      }
    }

    // ---------- RPC 路由（webServer HTTP，替代动态沙箱 harness.handle） ----------
    const ROUTE_PREFIX = '/_dsh/bottom-info-bar';
    const ROUTES = {
      getBalanceSnapshot: function (args) {
        const pid = args && typeof args === 'object' && args.provider ? String(args.provider) : '';
        return activeBalanceSummary(pid || undefined, Date.now());
      },
      getPricing: async function () {
        // M5：首次遇到未刷新过的 provider → 等待一次目录名拉取（llm 缺失则直接回退），
        // 保证模型名/服务商名与模型切换器一致；已刷新过则零等待直接读缓存
        const sel = modelSelection();
        const llm = ctx.get ? ctx.get('llm') : null;
        if (llm && !modelCatalogRefreshed[sel.provider]) await refreshModelCatalog(sel.provider);
        return computePricing(Date.now());
      },
      getEstimate: function () {
        return computeEstimate(Date.now());
      },
      getUsageSummary: function (args) {
        const sessionId = args && typeof args === 'object' ? String(args.sessionId || '') : '';
        return getUsageSummary(Date.now(), sessionId);
      },
      getProviders: function () {
        return { providers: providerList(Date.now()), activeProvider: config.activeProvider };
      },
      setActiveProvider: function (args) {
        const pid = args && typeof args === 'object' ? args.provider : null;
        if (pid && Object.hasOwn(PROVIDERS, pid)) {
          config.activeProvider = pid;
          refreshProviderBalance(pid);
        }
        return { activeProvider: config.activeProvider };
      },
      getSpendTrend: function (args) {
        const days = args && typeof args === 'object' ? Number(args.days) : 7;
        return spendTrend(Date.now(), days);
      },
      getConfig: function () {
        return { displayMode: config.displayMode, infoDensity: config.infoDensity, activeProvider: config.activeProvider, alertThreshold: config.alertThreshold, billingMode: config.billingMode };
      },
      getBillingMode: function () {
        // 纯本地计算（零网络开销；客户端 2s 高频轮询专用）：返回 mode+provider+model，
        // 客户端据此检测模型/服务商切换并立即完整刷新信息栏
        const sel = modelSelection();
        return Object.assign(detectBillingMode(sel.provider, config.billingMode), { model: sel.model });
      },
      getSubscriptionSnapshot: function () {
        return getSubscriptionSnapshotRpc();
      },
      getCodexBridgeStatus: function () {
        // 只读状态：bound 以 auth.json 实际令牌为准（文件=唯一事实源）；令牌值绝不进状态/响应
        const read = readCodexAuthFile(CODEX_AUTH_FILE);
        const tokens = read.ok && read.auth.tokens && typeof read.auth.tokens === 'object' ? read.auth.tokens : {};
        const bound = typeof tokens.access_token === 'string' && tokens.access_token.length > 0;
        const plan = subscriptions.codex && subscriptions.codex.data ? subscriptions.codex.data.plan : null;
        return {
          ok: codexBridgeState.ok,
          bound: bound,
          plan: plan,
          expiresAt: codexBridgeState.expiresAt,
          lastSyncAt: codexBridgeState.lastSyncAt,
          oauthInFlight: oauthInFlight,
          error: oauthLastError || codexBridgeState.error,
          routeConfigured: codexBridgeState.routeConfigured,
        };
      },
      startCodexOAuth: function () {
        return startCodexOAuthRpc();
      },
      unbindCodex: function () {
        return unbindCodexRpc();
      },
      setDisplayMode: function (args) {
        const mode = args && typeof args === 'object' ? args.mode : null;
        if (mode === 'extend' || mode === 'replace') config.displayMode = mode;
        return { displayMode: config.displayMode };
      },
      setInfoDensity: function (args) {
        const d = args && typeof args === 'object' ? args.density : null;
        if (d === 'full' || d === 'compact') config.infoDensity = d;
        return { infoDensity: config.infoDensity };
      },
    };
    const MUTATING = { setActiveProvider: true, setDisplayMode: true, setInfoDensity: true, getSubscriptionSnapshot: true, startCodexOAuth: true, unbindCodex: true };

    function sameOrigin(req) {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site') return false;
      const origin = req.headers.origin;
      if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';
      const host = req.headers.host;
      if (host === undefined) return false;
      try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
      } catch {
        return false;
      }
    }

    function readBody(req, maxBytes) {
      return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
          size += chunk.length;
          if (size > maxBytes) {
            const err = new Error('body too large');
            err.status = 413;
            reject(err);
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', reject);
      });
    }

    function respond(res, status, payload) {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
    }

    ctx.inject(['webServer'], function (webCtx) {
      webCtx.effect(function () {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: async function (req, res) {
            try {
              const url = new URL(req.url || '/', 'http://localhost');
              const path = url.pathname;
              if (!path.startsWith(ROUTE_PREFIX + '/')) {
                respond(res, 404, { error: 'not found' });
                return;
              }
              const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1));
              const fn = Object.hasOwn(ROUTES, method) ? ROUTES[method] : null;
              if (typeof fn !== 'function') {
                respond(res, 404, { error: 'unknown method: ' + method });
                return;
              }
              if (Object.hasOwn(MUTATING, method) && !sameOrigin(req)) {
                respond(res, 403, { error: 'cross-origin request rejected' });
                return;
              }
              let args = {};
              if (req.method === 'POST' || req.method === 'PUT') {
                const raw = await readBody(req, 64 * 1024);
                if (raw.length > 0) {
                  try { args = JSON.parse(raw); } catch (e) { respond(res, 400, { error: 'invalid JSON body' }); return; }
                }
              }
              const result = await fn(args);
              respond(res, 200, result);
            } catch (err) {
              const status = (err && err.status) || 500;
              respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) });
            }
          },
        });
        return function () { dispose(); };
      }, 'bottom-info-bar: Web routes');
    });

    // ---------- 启动即刷 + 60s 定时刷新 ----------
    refreshAllBalances();
    refreshActiveSubscriptions(); // 惰性：无客户端请求过订阅源则不发起网络请求
    refreshActiveModelCatalog(); // M5：启动即拉一次 DSH 目录名（llm 缺失时静默回退，绝不崩溃）
    ctx.interval(refreshAllBalances, 60000);
    ctx.interval(refreshActiveSubscriptions, 60000);

    // ---------- Codex 桥接启动：注册路由 + 立即同步 + 30min 周期维护（令牌仅内存/凭据库/auth.json，不打印） ----------
    ensureCodexRoute();
    syncCodexToken();
    ctx.interval(syncCodexToken, CODEX_SYNC_INTERVAL_MS);

    // 卸载时冲刷未落盘的记账记录
    return function () {
      if (dirty) flushSave();
    };
  },
};
