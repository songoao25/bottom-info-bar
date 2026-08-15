// ChatGPT 订阅官方 OAuth 绑定（v1.2.0 O1，host 流程）审计：
// ① 纯函数：PKCE（verifier/challenge 格式与 sha256 推导）、buildAuthorizeUrl 参数完整、parseCallbackUrl
//   （query/hash/缺参/裸 code/手贴 code#state）、account_id 提取、auth.json 构造、解绑清令牌、令牌交换请求体
// ② 注入式集成（桩 fetch + 真实本地回调 server 于临时端口 + 临时 auth.json）：
//   授权成功全链路 / state 不匹配拒绝 / 非回调路径 404 / 超时清理 / 端口占用返回错误 / 解绑 / 并发保护
// ③ 静态安全断言：无 eyJ / console 不传 token / 状态 RPC 不含令牌值 / 回调仅 127.0.0.1
// 隔离铁律：BOTTOM_INFO_BAR_CODEX_AUTH + BOTTOM_INFO_BAR_DATA_DIR + BOTTOM_INFO_BAR_OAUTH_PORT +
//   BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS 全指向临时（绝不读真实 ~/.codex/auth.json、绝不监听真实 1455）；
//   fetch 全量桩（绝不发真实网络请求）
// 用法：node tests/test-codex-oauth.js（由 run-all.mjs 统一驱动，先 build 再测）
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { randomBytes, createHash } = crypto;
const { pathToFileURL } = require('url');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bib-codex-oauth-'));

// 找一个空闲端口（先监听 0 拿到端口再释放；随后设入环境变量，导入插件前生效）
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

// 本地 HTTP 请求（测试充当"浏览器"向回调 server 发回调）
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(new Error('本地回调请求超时')); });
  });
}

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

// 提取纯函数（与 test-codex-bridge.js 同法：括号计数提取 + eval；兼容 async function——必须从 'async'
// 起取整段，否则 eval 出的普通函数里出现 await 会语法错误）
function extractFn(name) {
  let start = hostSrc.indexOf('async function ' + name);
  if (start < 0) start = hostSrc.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < hostSrc.length) {
    const c = hostSrc[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  const body = hostSrc.slice(start, i + 1);
  return eval('(' + body + ')');
}

// 提取单行 const 字面量（值可能含 URL——如 'https://api.openai.com/auth' 里的 // 不能当注释处理，
// 因此优先匹配完整引号字符串，再回退到裸字面量）
function extractConst(name) {
  const re = new RegExp("const " + name + " = ('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`|\\[[^\\n]*?\\]|\\{[^\\n]*?\\}|[^\\n]+?)(?:\\s*//[^\\n]*)?\\n");
  const m = hostSrc.match(re);
  if (!m) throw new Error('未找到 const ' + name);
  return eval('(' + m[1] + ')');
}

// 供提取出的函数解析的模块级绑定（eval 闭包指向本模块作用域）
let writeFileSync = fs.writeFileSync;
let renameSync = fs.renameSync;
const CODEX_OAUTH_CLIENT_ID = extractConst('CODEX_OAUTH_CLIENT_ID');
const OAUTH_SCOPE = extractConst('OAUTH_SCOPE');
const OAUTH_CALLBACK_PATH = extractConst('OAUTH_CALLBACK_PATH');
const CODEX_JWT_ACCOUNT_CLAIM = extractConst('CODEX_JWT_ACCOUNT_CLAIM');
const decodeBase64Url = extractFn('decodeBase64Url');
const oauthCallbackPort = extractFn('oauthCallbackPort');
const createPkcePair = extractFn('createPkcePair');
const buildAuthorizeUrl = extractFn('buildAuthorizeUrl');
const parseCallbackUrl = extractFn('parseCallbackUrl');
const codexAccountIdFromJwt = extractFn('codexAccountIdFromJwt');
const buildOAuthAuthObject = extractFn('buildOAuthAuthObject');
const clearCodexAuthTokens = extractFn('clearCodexAuthTokens');
const exchangeAuthorizationCode = extractFn('exchangeAuthorizationCode');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + (typeof actual === 'object' ? '' : ' → ' + JSON.stringify(actual))); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

// ---------- 测试工具 ----------
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function makeJwt(payload) { return 'aaa.' + b64url(payload) + '.bbb'; }
const AUTH_PATH = () => process.env.BOTTOM_INFO_BAR_CODEX_AUTH;
function writeAuth(authObj) { fs.writeFileSync(AUTH_PATH(), JSON.stringify(authObj, null, 2), { mode: 0o600 }); }
function readAuth() { return JSON.parse(fs.readFileSync(AUTH_PATH(), 'utf8')); }
function makeAuth(opts) {
  const o = opts || {};
  return {
    auth_mode: 'oauth',
    OPENAI_API_KEY: 'sk-user-demo',
    tokens: {
      id_token: 'demo-id-token',
      access_token: o.access || makeJwt({ exp: Math.floor(Date.now() / 1000) + 3 * 86400 }),
      refresh_token: o.refresh || 'demo-refresh-token',
      account_id: 'acct_demo_001',
    },
    last_refresh: o.lastRefresh || new Date(Date.now() - 3600 * 1000).toISOString(),
  };
}
function stubFetch(handler) { globalThis.fetch = async (url, opts) => handler(url, opts); }
function jsonResponse(status, body) { return { ok: status >= 200 && status < 300, status: status, json: async () => body }; }
const settle = () => new Promise((r) => setTimeout(r, 60));

// ---------- 桩环境（apply 级集成；settings/credentials/shell/fetch/interval 全桩，零真实网络） ----------
function makeStubCtx() {
  const settingsStore = { providers: {} };
  const calls = { settingsMutate: [], credentialsSet: [], credentialsUnset: [], shellRun: [], fetch: [], interval: [], route: null };
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'high' }) };
      }
      return undefined;
    },
    settings: {
      get() { return settingsStore; },
      async mutate(ns, ops) { calls.settingsMutate.push({ ns: ns, ops: ops }); },
    },
    credentials: {
      resolve: async () => undefined,
      async set(name, value) { calls.credentialsSet.push({ name: name, value: value }); },
      async unset(name) { calls.credentialsUnset.push(name); },
    },
    shell: {
      resolve: (r) => r,
      async run(req) { calls.shellRun.push(req); return { exitCode: 0, stdout: { text: '' } }; },
    },
    interval(fn) { calls.interval.push(fn); return () => {}; },
    timeout() { return () => {}; },
    on() { return () => {}; },
    inject(services, cb) {
      const webCtx = {
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
        webServer: { register(route) { calls.route = route; return () => {}; } },
      };
      cb(webCtx);
      return () => {};
    },
  };
  return { ctx: ctx, calls: calls };
}

// 假 req/res + HTTP 调用（与 smoke-static-host.mjs 同构）
function makeReq(routePath, method, body, headers) {
  const listeners = {};
  const req = {
    url: routePath,
    method: method || 'GET',
    headers: headers || {},
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req; },
    destroy() {},
  };
  return {
    req,
    emit() {
      if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body));
      for (const cb of listeners.end || []) cb();
    },
  };
}
async function invoke(route, routePath, method, body, headers) {
  const { req, emit } = makeReq(routePath, method, body, headers);
  let status = 0, payload = null;
  const res = {
    writeHead(s) { status = s; },
    end(b) { try { payload = JSON.parse(b); } catch { payload = String(b); } },
  };
  const pending = route.handler(req, res);
  emit();
  await pending;
  return { status, payload };
}
let plugin = null;
async function boot() {
  const { ctx, calls } = makeStubCtx();
  const disposer = plugin.apply(ctx);
  await settle();
  return { ctx: ctx, calls: calls, disposer: disposer };
}
// 轮询 getCodexBridgeStatus 直到 oauthInFlight=false（或超时）
async function waitBound(b, timeoutMs) {
  const sameOrigin = { 'sec-fetch-site': 'same-origin' };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
    if (r.payload && r.payload.oauthInFlight === false) return r.payload;
    await settle();
  }
  const r = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
  return r.payload;
}

(async function main() {
  const origFetch = globalThis.fetch;
  // 隔离：临时端口 + 短超时（必须在导入插件之前设置，模块级常量读取 env）
  const port = await freePort();
  process.env.BOTTOM_INFO_BAR_OAUTH_PORT = String(port);
  process.env.BOTTOM_INFO_BAR_OAUTH_TIMEOUT_MS = '2500';
  process.env.BOTTOM_INFO_BAR_CODEX_AUTH = path.join(tmpRoot, 'auth.json');
  process.env.BOTTOM_INFO_BAR_DATA_DIR = path.join(tmpRoot, 'data');
  ok('隔离：OAuth 端口为临时端口（非 1455）', port !== 1455, String(port));
  plugin = (await import(pathToFileURL(path.join(__dirname, '..', 'plugin', 'lib', 'index.js')).href)).default;

  // ================= ① PKCE =================
  const pair = createPkcePair();
  ok('PKCE：verifier 为 43 字符 base64url', /^[A-Za-z0-9_-]{43}$/.test(pair.verifier), pair.verifier);
  ok('PKCE：challenge 为 43 字符 base64url', /^[A-Za-z0-9_-]{43}$/.test(pair.challenge), pair.challenge);
  check('PKCE：verifier 为 32 字节', Buffer.from(pair.verifier, 'base64url').length, 32);
  check('PKCE：challenge = base64url(sha256(verifier))', pair.challenge, createHash('sha256').update(pair.verifier).digest('base64url'));
  ok('PKCE：两次生成不同', createPkcePair().verifier !== pair.verifier, '相同');
  check('oauthCallbackPort：env 覆盖生效', oauthCallbackPort(), port);
  const savedPort = process.env.BOTTOM_INFO_BAR_OAUTH_PORT;
  delete process.env.BOTTOM_INFO_BAR_OAUTH_PORT;
  check('oauthCallbackPort：无 env → 默认 1455', oauthCallbackPort(), 1455);
  process.env.BOTTOM_INFO_BAR_OAUTH_PORT = savedPort;

  // ================= ② buildAuthorizeUrl 参数完整 =================
  const authUrl = new URL(buildAuthorizeUrl('st-123', 'ch-abc'));
  check('authorize：protocol https', authUrl.protocol, 'https:');
  check('authorize：host', authUrl.host, 'auth.openai.com');
  check('authorize：path', authUrl.pathname, '/oauth/authorize');
  check('authorize：client_id', authUrl.searchParams.get('client_id'), CODEX_OAUTH_CLIENT_ID);
  check('authorize：response_type', authUrl.searchParams.get('response_type'), 'code');
  check('authorize：redirect_uri', authUrl.searchParams.get('redirect_uri'), 'http://localhost:' + port + OAUTH_CALLBACK_PATH);
  check('authorize：code_challenge', authUrl.searchParams.get('code_challenge'), 'ch-abc');
  check('authorize：code_challenge_method', authUrl.searchParams.get('code_challenge_method'), 'S256');
  check('authorize：state', authUrl.searchParams.get('state'), 'st-123');
  check('authorize：scope', authUrl.searchParams.get('scope'), OAUTH_SCOPE);
  check('authorize：仅 7 个参数（无多余泄漏）', [...authUrl.searchParams.keys()].sort().join(','), 'client_id,code_challenge,code_challenge_method,redirect_uri,response_type,scope,state');

  // ================= ③ parseCallbackUrl（query/hash/缺参） =================
  check('callback：query 完整', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH + '?code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  check('callback：hash 携带', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH + '#code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  check('callback：query+hash 混合', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH + '?code=abc#state=xyz'), { code: 'abc', state: 'xyz' });
  check('callback：缺 code', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH + '?state=xyz'), { code: null, state: 'xyz' });
  check('callback：缺 state', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH + '?code=abc'), { code: 'abc', state: null });
  check('callback：缺参', parseCallbackUrl('http://localhost:' + port + OAUTH_CALLBACK_PATH), { code: null, state: null });
  check('callback：空串', parseCallbackUrl(''), { code: null, state: null });
  check('callback：非字符串', parseCallbackUrl(null), { code: null, state: null });
  check('callback：裸 code', parseCallbackUrl('abc123'), { code: 'abc123', state: null });
  check('callback：手贴 code#state', parseCallbackUrl('abc123#xyz'), { code: 'abc123', state: 'xyz' });
  check('callback：查询串形式', parseCallbackUrl('code=abc&state=xyz'), { code: 'abc', state: 'xyz' });

  // ================= ④ codexAccountIdFromJwt =================
  const acctJwt = (id) => makeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: id } });
  check('account：正常提取', codexAccountIdFromJwt(acctJwt('acct_1')), 'acct_1');
  check('account：缺 claim → null', codexAccountIdFromJwt(makeJwt({ sub: 'x' })), null);
  check('account：claim 非对象 → null', codexAccountIdFromJwt(makeJwt({ 'https://api.openai.com/auth': 'x' })), null);
  check('account：非 JWT → null', codexAccountIdFromJwt('not-a-jwt'), null);
  check('account：空串 → null', codexAccountIdFromJwt(''), null);

  // ================= ⑤ buildOAuthAuthObject（结构完整/保留既有） =================
  const atOauth = acctJwt('acct_oauth_1');
  const iso = '2026-08-17T00:00:00.000Z';
  const exFull = { access_token: atOauth, refresh_token: 'rt-new', id_token: 'id-new' };
  check('authObj：全新文件结构完整', JSON.stringify(buildOAuthAuthObject(null, exFull, iso)),
    JSON.stringify({ auth_mode: 'oauth', OPENAI_API_KEY: null, tokens: { access_token: atOauth, refresh_token: 'rt-new', id_token: 'id-new', account_id: 'acct_oauth_1' }, last_refresh: iso }));
  const existing = { auth_mode: 'oauth', OPENAI_API_KEY: 'sk-user', tokens: { id_token: 'old-id', access_token: 'old-at', refresh_token: 'old-rt', account_id: 'old-acct' }, last_refresh: '2026-01-01T00:00:00.000Z' };
  const merged = buildOAuthAuthObject(existing, { access_token: 'plain-at', refresh_token: 'rt-new' }, iso);
  ok('authObj：保留 OPENAI_API_KEY 与 auth_mode', merged.auth_mode === 'oauth' && merged.OPENAI_API_KEY === 'sk-user', JSON.stringify(merged));
  ok('authObj：JWT 无 account claim → 保留旧 account_id', merged.tokens.account_id === 'old-acct', JSON.stringify(merged.tokens));
  ok('authObj：旧 id_token 保留 + 新令牌写入', merged.tokens.id_token === 'old-id' && merged.tokens.access_token === 'plain-at' && merged.tokens.refresh_token === 'rt-new', JSON.stringify(merged.tokens));
  check('authObj：last_refresh 更新', merged.last_refresh, iso);

  // ================= ⑥ clearCodexAuthTokens（解绑清令牌保结构） =================
  const unbindPath = path.join(tmpRoot, 'unbind.json');
  writeFileSync(unbindPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  clearCodexAuthTokens(unbindPath, existing);
  const onDisk = JSON.parse(fs.readFileSync(unbindPath, 'utf8'));
  ok('unbind：令牌字段已清', onDisk.tokens.access_token === undefined && onDisk.tokens.refresh_token === undefined && onDisk.tokens.id_token === undefined, JSON.stringify(onDisk.tokens));
  ok('unbind：结构保留', onDisk.auth_mode === 'oauth' && onDisk.OPENAI_API_KEY === 'sk-user' && onDisk.tokens.account_id === 'old-acct', JSON.stringify(onDisk));
  check('unbind：last_refresh 置空', onDisk.last_refresh, null);
  ok('unbind：0600 且无 tmp 残留', (fs.statSync(unbindPath).mode & 0o777) === 0o600 && !fs.existsSync(unbindPath + '.tmp'), '权限/tmp 异常');

  // ================= ⑦ exchangeAuthorizationCode（桩 fetch：请求体/成功/失败） =================
  {
    const fetchCalls = [];
    stubFetch(async (url, opts) => {
      fetchCalls.push({ url: String(url), body: String((opts && opts.body) || '') });
      return jsonResponse(200, { access_token: 'at-x', refresh_token: 'rt-x', id_token: 'idt-x' });
    });
    const r = await exchangeAuthorizationCode('auth-code', 'verifier-123');
    check('exchange：成功返回令牌', JSON.stringify(r), JSON.stringify({ ok: true, access_token: 'at-x', refresh_token: 'rt-x', id_token: 'idt-x' }));
    check('exchange：请求 URL', fetchCalls[0].url, 'https://auth.openai.com/oauth/token');
    ok('exchange：body 含 grant_type=authorization_code', fetchCalls[0].body.includes('grant_type=authorization_code'), fetchCalls[0].body);
    ok('exchange：body 含 code', fetchCalls[0].body.includes('code=auth-code'), fetchCalls[0].body);
    ok('exchange：body 含 code_verifier', fetchCalls[0].body.includes('code_verifier=verifier-123'), fetchCalls[0].body);
    ok('exchange：body 含 redirect_uri', fetchCalls[0].body.includes('redirect_uri=' + encodeURIComponent('http://localhost:' + port + OAUTH_CALLBACK_PATH)), fetchCalls[0].body);
    ok('exchange：body 含 client_id', fetchCalls[0].body.includes('client_id=' + CODEX_OAUTH_CLIENT_ID), fetchCalls[0].body);
    stubFetch(async () => jsonResponse(401, { error: 'invalid_grant' }));
    check('exchange：401 → ok:false + status', JSON.stringify(await exchangeAuthorizationCode('c', 'v')), JSON.stringify({ ok: false, status: 401 }));
    stubFetch(async () => jsonResponse(200, { refresh_token: 'x' }));
    check('exchange：缺 access_token → ok:false', (await exchangeAuthorizationCode('c', 'v')).ok, false);
  }

  // ================= ⑧ 集成：授权成功全链路 =================
  {
    fs.rmSync(AUTH_PATH(), { force: true });
    const atJwt = acctJwt('acct_oauth_1');
    const fetchCalls = [];
    stubFetch(async (url, opts) => {
      fetchCalls.push({ url: String(url), body: String((opts && opts.body) || '') });
      if (String(url).includes('/oauth/token')) return jsonResponse(200, { access_token: atJwt, refresh_token: 'rt-oauth-1', id_token: 'id-oauth-1' });
      throw new Error('意外网络请求：' + url);
    });
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const rpc = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    ok('start：ok=true 且返回 authorizeUrl', rpc.payload && rpc.payload.ok === true && typeof rpc.payload.authorizeUrl === 'string'
      && rpc.payload.authorizeUrl.startsWith('https://auth.openai.com/oauth/authorize'), JSON.stringify(rpc.payload));
    check('start：oauthInFlight=true', rpc.payload && rpc.payload.oauthInFlight, true);
    // 进行中：状态 RPC 透出 oauthInFlight
    const st0 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
    check('进行中：状态 oauthInFlight=true', st0.payload && st0.payload.oauthInFlight, true);
    // 非回调路径 → 404
    const nf = await httpGet('http://127.0.0.1:' + port + '/other');
    check('回调：非回调路径 404', nf.status, 404);
    // 用 authorizeUrl 里的 state 发起真实本地回调
    const u = new URL(rpc.payload.authorizeUrl);
    const state = u.searchParams.get('state');
    ok('start：authorizeUrl 含 state', typeof state === 'string' && state.length > 0, state);
    const cbRes = await httpGet('http://127.0.0.1:' + port + OAUTH_CALLBACK_PATH + '?code=the-code&state=' + encodeURIComponent(state));
    check('回调：HTTP 200', cbRes.status, 200);
    ok('回调：返回可关闭页 HTML', cbRes.body.includes('授权完成'), cbRes.body);
    // 等待后台流程完成
    const status = await waitBound(b, 4000);
    ok('绑定：bound=true + oauthInFlight=false', status.bound === true && status.oauthInFlight === false, JSON.stringify(status));
    check('绑定：ok=true', status.ok, true);
    ok('绑定：expiresAt 为未来时刻', typeof status.expiresAt === 'number' && status.expiresAt > Date.now(), JSON.stringify(status.expiresAt));
    check('绑定：浏览器打开尝试恰好一次', b.calls.shellRun.length, 1);
    check('绑定：交换请求恰好一次', fetchCalls.length, 1);
    ok('绑定：交换 body 含 code_verifier（PKCE 校验）', fetchCalls[0] && fetchCalls[0].body.includes('code_verifier='), '无');
    // auth.json 结构完整
    const auth = readAuth();
    check('绑定：auth_mode=oauth', auth.auth_mode, 'oauth');
    check('绑定：OPENAI_API_KEY=null', auth.OPENAI_API_KEY, null);
    check('绑定：tokens.access_token 为新令牌', auth.tokens.access_token, atJwt);
    check('绑定：tokens.refresh_token', auth.tokens.refresh_token, 'rt-oauth-1');
    check('绑定：tokens.id_token', auth.tokens.id_token, 'id-oauth-1');
    check('绑定：tokens.account_id 从 JWT 提取', auth.tokens.account_id, 'acct_oauth_1');
    ok('绑定：last_refresh 为 ISO', typeof auth.last_refresh === 'string' && !isNaN(Date.parse(auth.last_refresh)), auth.last_refresh);
    ok('绑定：auth.json 0600 且无 tmp 残留', (fs.statSync(AUTH_PATH()).mode & 0o777) === 0o600 && !fs.existsSync(AUTH_PATH() + '.tmp'), '权限/tmp 异常');
    check('绑定：credentials.set 注入新令牌', b.calls.credentialsSet.length === 1 && b.calls.credentialsSet[0].name === 'OPENAI_CODEX_API_KEY' && b.calls.credentialsSet[0].value, atJwt);
    // 状态 RPC 绝不返回令牌值
    const st1 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
    ok('安全：状态 RPC 不含任何令牌值', JSON.stringify(st1.payload).indexOf(atJwt) < 0 && JSON.stringify(st1.payload).indexOf('rt-oauth-1') < 0 && JSON.stringify(st1.payload).indexOf('id-oauth-1') < 0, JSON.stringify(st1.payload));
    b.disposer();
  }

  // ================= ⑨ 集成：state 不匹配拒绝 → 正确 state 成功 =================
  {
    fs.rmSync(AUTH_PATH(), { force: true });
    stubFetch(async (url, opts) => jsonResponse(200, { access_token: makeJwt({ exp: Math.floor(Date.now() / 1000) + 86400 }), refresh_token: 'rt' }));
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const rpc = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    const state = new URL(rpc.payload.authorizeUrl).searchParams.get('state');
    const bad = await httpGet('http://127.0.0.1:' + port + OAUTH_CALLBACK_PATH + '?code=evil&state=WRONG');
    check('state 不匹配：HTTP 400', bad.status, 400);
    ok('state 不匹配：错误页提示校验失败', bad.body.includes('状态'), bad.body);
    const mid = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
    check('state 不匹配：流程未被错误回调终结（仍 in-flight）', mid.payload && mid.payload.oauthInFlight, true);
    const good = await httpGet('http://127.0.0.1:' + port + OAUTH_CALLBACK_PATH + '?code=ok-code&state=' + encodeURIComponent(state));
    check('state 正确：HTTP 200', good.status, 200);
    const status = await waitBound(b, 4000);
    check('state 正确：绑定成功', status.bound, true);
    b.disposer();
  }

  // ================= ⑩ 集成：超时清理 =================
  {
    fs.rmSync(AUTH_PATH(), { force: true });
    stubFetch(() => { throw new Error('超时不应发起令牌交换'); });
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const rpc = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    ok('超时：流程已启动', rpc.payload && rpc.payload.ok === true, JSON.stringify(rpc.payload));
    const status = await waitBound(b, 4000);
    check('超时：oauthInFlight=false', status.oauthInFlight, false);
    check('超时：error.kind=timeout', status.error && status.error.kind, 'timeout');
    check('超时：未写 auth.json（文件仍缺失）', !fs.existsSync(AUTH_PATH()), true);
    check('超时：未注入凭据', b.calls.credentialsSet.length, 0);
    let refused = false;
    try { await httpGet('http://127.0.0.1:' + port + OAUTH_CALLBACK_PATH + '?code=x&state=y'); } catch (e) { refused = true; }
    check('超时：回调 server 已关闭（连接拒绝）', refused, true);
    b.disposer();
  }

  // ================= ⑪ 集成：端口占用返回明确错误 =================
  {
    const busy = net.createServer();
    await new Promise((r) => busy.listen(port, '127.0.0.1', r));
    fs.rmSync(AUTH_PATH(), { force: true });
    stubFetch(() => { throw new Error('端口占用不应发起任何请求'); });
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const rpc = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    check('端口占用：ok=false', rpc.payload && rpc.payload.ok, false);
    check('端口占用：error.kind=port-busy', rpc.payload && rpc.payload.error && rpc.payload.error.kind, 'port-busy');
    check('端口占用：oauthInFlight=false（未进入后台流程）', rpc.payload && rpc.payload.oauthInFlight, false);
    check('端口占用：未注入凭据', b.calls.credentialsSet.length, 0);
    b.disposer();
    await new Promise((r) => busy.close(r));
  }

  // ================= ⑫ 集成：并发保护 =================
  {
    fs.rmSync(AUTH_PATH(), { force: true });
    stubFetch(async (url, opts) => jsonResponse(200, { access_token: makeJwt({ exp: Math.floor(Date.now() / 1000) + 86400 }), refresh_token: 'rt' }));
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const r1 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    const r2 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/startCodexOAuth', 'GET', null, sameOrigin);
    check('并发：第二次返回 in-flight 错误', r2.payload && r2.payload.ok === false && r2.payload.error && r2.payload.error.kind, 'in-flight');
    // 完成首次流程以清理
    const state = new URL(r1.payload.authorizeUrl).searchParams.get('state');
    await httpGet('http://127.0.0.1:' + port + OAUTH_CALLBACK_PATH + '?code=c&state=' + encodeURIComponent(state));
    await waitBound(b, 4000);
    b.disposer();
  }

  // ================= ⑬ 集成：解绑 =================
  {
    writeAuth(makeAuth());
    stubFetch(() => { throw new Error('解绑不应发起网络请求'); });
    const b = await boot();
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    // 跨源解绑 → 403（MUTATING 防护）
    const evil = await invoke(b.calls.route, '/_dsh/bottom-info-bar/unbindCodex', 'GET', null, { origin: 'https://evil.example' });
    check('解绑：跨源请求被拒绝（403）', evil.status, 403);
    const r = await invoke(b.calls.route, '/_dsh/bottom-info-bar/unbindCodex', 'GET', null, sameOrigin);
    ok('解绑：ok=true + bound=false', r.payload && r.payload.ok === true && r.payload.bound === false, JSON.stringify(r.payload));
    const after = readAuth();
    ok('解绑：令牌字段已清（access/refresh/id 均无）', after.tokens.access_token === undefined && after.tokens.refresh_token === undefined && after.tokens.id_token === undefined, JSON.stringify(after.tokens));
    ok('解绑：结构保留（auth_mode/OPENAI_API_KEY/account_id）', after.auth_mode === 'oauth' && after.OPENAI_API_KEY === 'sk-user-demo' && after.tokens.account_id === 'acct_demo_001', JSON.stringify(after));
    ok('解绑：0600 且无 tmp 残留', (fs.statSync(AUTH_PATH()).mode & 0o777) === 0o600 && !fs.existsSync(AUTH_PATH() + '.tmp'), '权限/tmp 异常');
    check('解绑：credentials.unset 已调用', b.calls.credentialsUnset.length === 1 && b.calls.credentialsUnset[0], 'OPENAI_CODEX_API_KEY');
    const st = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET', null, sameOrigin);
    check('解绑：状态 bound=false + ok=false', st.payload.bound === false && st.payload.ok === false, true);
    check('解绑：状态 error.kind=unbound', st.payload.error && st.payload.error.kind, 'unbound');
    b.disposer();
  }

  // ================= ⑭ 静态安全断言 =================
  ok('安全：源码无 JWT 字面量（eyJ）', !hostSrc.includes('eyJ'), '出现 eyJ');
  ok('安全：无 console 调用直接传 token 变量', !/console\.\w+\([^)]*\btoken\b/.test(hostSrc), 'console 传 token 变量');
  ok('安全：无 console 模板插值（${}）', !/console\.\w+\([^)]*\$\{/.test(hostSrc), 'console 插值');
  ok('安全：无个人路径（songsong）', !hostSrc.includes('songsong'), '含个人路径');
  ok('安全：回调 server 仅监听 127.0.0.1', /listen\([^)]*'127\.0\.0\.1'/.test(hostSrc), '监听地址非本机');
  ok('安全：startCodexOAuth/unbindCodex 在 MUTATING（跨源拒绝）', /MUTATING = \{[\s\S]*startCodexOAuth: true[\s\S]*unbindCodex: true/.test(hostSrc), 'MUTATING 缺失');
  ok('安全：getCodexBridgeStatus 不在 MUTATING（只读）', hostSrc.includes('getCodexBridgeStatus: true') === false, '误入 MUTATING');
  ok('安全：令牌交换走 HTTPS fetch；shell 仅用于开浏览器（命令不含令牌）', hostSrc.includes("fetch('https://auth.openai.com/oauth/token'") && !/\bshell\.run\([^)]*\btoken\b/.test(hostSrc), '令牌经 shell 传递');
  ok('隔离：auth 路径指向临时目录（绝不读真实 ~/.codex/auth.json）', AUTH_PATH() === path.join(tmpRoot, 'auth.json') && AUTH_PATH() !== path.join(os.homedir(), '.codex', 'auth.json'), AUTH_PATH());

  globalThis.fetch = origFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(2);
});
