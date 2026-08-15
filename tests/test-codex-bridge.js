// Codex 订阅桥接（v1.2.0）逻辑审计：
// ① decodeJwtExp（合法/非 JWT/损坏/缺 exp）② 过期判定边界（>45min 不续 / <45min 续 / 已过期续 / last_refresh 兜底）
// ③ 写回安全（结构保留 / 缺令牌不写 / 原子写 rename 崩溃）④ 续期失败降级（401 重读→重试→保留旧凭据）
// ⑤ 未登录态（auth.json 缺失/损坏 → 状态 error 不抛异常）⑥ ensureCodexRoute 幂等（已配置不重复写/不覆盖用户配置）
// ⑦ 注入式集成（伪造 auth.json + 桩 fetch 全流程：续期写回/同值跳过/401 轮换）⑧ 静态安全断言（无 eyJ / console 不打 token / 无个人路径）
// 隔离铁律：BOTTOM_INFO_BAR_CODEX_AUTH 指向临时目录（绝不读真实 ~/.codex/auth.json）；fetch 全量桩（绝不发网络请求）
// 用法：node tests/test-codex-bridge.js（由 run-all.mjs 统一驱动，先 build 再测）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

// 测试隔离：auth 文件与数据目录全部指向临时目录（必须在 import lib 之前设置）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bib-codex-bridge-'));
process.env.BOTTOM_INFO_BAR_CODEX_AUTH = path.join(tmpRoot, 'auth.json');
process.env.BOTTOM_INFO_BAR_DATA_DIR = path.join(tmpRoot, 'data');

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

// 提取纯函数（与 test-dual-mode.js 同法：括号计数提取 + eval）
function extractFn(name) {
  const start = hostSrc.indexOf('function ' + name);
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

// 供提取出的 writeAuthJson / readCodexAuthFile 闭包解析的 fs 绑定（用 let 以便原子写测试注入 renameSync 崩溃）
let writeFileSync = fs.writeFileSync;
let renameSync = fs.renameSync;
let readFileSync = fs.readFileSync;

// 提取单行 const 字面量（与 test-dual-mode.js 同法；host.js 常量行尾无分号）
function extractConst(name) {
  const re = new RegExp('const ' + name + ' = (\\[[^\\n]*?\\]|\\{[^\\n]*?\\}|[^\\n]+?)(?:\\s*//[^\\n]*)?\\n');
  const m = hostSrc.match(re);
  if (!m) throw new Error('未找到 const ' + name);
  return eval('(' + m[1] + ')');
}
const CODEX_TOKEN_FALLBACK_LIFETIME_SEC = extractConst('CODEX_TOKEN_FALLBACK_LIFETIME_SEC');
const CODEX_REFRESH_AHEAD_SEC = extractConst('CODEX_REFRESH_AHEAD_SEC');

// 提取模块级纯函数（eval 闭包指向本模块作用域，能解析到上面的 fs 绑定与常量）
const decodeBase64Url = extractFn('decodeBase64Url'); // decodeJwtExp 的依赖
const decodeJwtExp = extractFn('decodeJwtExp');
const codexExpiresAt = extractFn('codexExpiresAt');
const codexNeedsRefresh = extractFn('codexNeedsRefresh');
const readCodexAuthFile = extractFn('readCodexAuthFile');
const writeAuthJson = extractFn('writeAuthJson');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + (typeof actual === 'object' ? '' : ' → ' + JSON.stringify(actual))); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}
// 布尔断言（cond + 可选 detail 说明）
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

// ---------- 桩环境（apply 级集成；settings/credentials/fetch/interval 全桩，零网络） ----------
function applyOps(store, ops) {
  for (const op of ops || []) {
    if (op.op !== 'set' || !Array.isArray(op.path) || op.path.length === 0) continue;
    let node = store;
    for (let i = 0; i < op.path.length - 1; i++) {
      const key = op.path[i];
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    node[op.path[op.path.length - 1]] = op.value;
  }
}

function makeStubCtx(opts) {
  const settingsStore = (opts && opts.settingsStore) || { providers: {} };
  const calls = { settingsMutate: [], credentialsSet: [], fetch: [], interval: [], route: null };
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'codex', model: 'gpt-5.3-codex-spark', reasoningEffort: 'high' }) };
      }
      return undefined;
    },
    settings: {
      get() { return settingsStore; },
      async mutate(ns, ops) { calls.settingsMutate.push({ ns: ns, ops: ops }); applyOps(settingsStore, ops); },
    },
    credentials: {
      resolve: async () => undefined,
      async set(name, value) { calls.credentialsSet.push({ name: name, value: value }); },
    },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
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
  return { ctx: ctx, calls: calls, settingsStore: settingsStore };
}

function stubFetch(handler) { globalThis.fetch = async (url, opts) => handler(url, opts); }
function jsonResponse(status, body) { return { ok: status >= 200 && status < 300, status: status, json: async () => body }; }

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
let plugin = null; // main() 内动态 import（CJS 无顶层 await），boot 需在模块作用域引用
const settle = () => new Promise((r) => setTimeout(r, 60));

async function boot(opts) {
  const { ctx, calls, settingsStore } = makeStubCtx(opts);
  const disposer = plugin.apply(ctx);
  await settle();
  const rpc = await invoke(calls.route, '/_dsh/bottom-info-bar/getCodexBridgeStatus', 'GET');
  return { ctx: ctx, calls: calls, settingsStore: settingsStore, disposer: disposer, rpc: rpc.payload };
}

(async function main() {
  const origFetch = globalThis.fetch;
  plugin = (await import(pathToFileURL(path.join(__dirname, '..', 'plugin', 'lib', 'index.js')).href)).default;

  // ================= ① decodeJwtExp =================
  const exp = 1784000000;
  check('decodeJwtExp：合法 JWT → exp（秒）', decodeJwtExp(makeJwt({ exp: exp, sub: 'u' })), exp);
  check('decodeJwtExp：exp 为字符串 → null', decodeJwtExp(makeJwt({ exp: String(exp) })), null);
  check('decodeJwtExp：缺 exp → null', decodeJwtExp(makeJwt({ sub: 'u' })), null);
  check('decodeJwtExp：exp ≤ 0 → null', decodeJwtExp(makeJwt({ exp: 0 })), null);
  check('decodeJwtExp：非 JWT（无点）→ null', decodeJwtExp('not-a-jwt'), null);
  check('decodeJwtExp：两段 → null', decodeJwtExp('a.b'), null);
  check('decodeJwtExp：四段 → null', decodeJwtExp('a.b.c.d'), null);
  check('decodeJwtExp：payload 非 JSON → null', decodeJwtExp('aaa.' + Buffer.from('not json').toString('base64url') + '.bbb'), null);
  check('decodeJwtExp：损坏 base64 payload → null', decodeJwtExp('aaa.!!!.bbb'), null);
  check('decodeJwtExp：空串 → null', decodeJwtExp(''), null);
  check('decodeJwtExp：null → null', decodeJwtExp(null), null);
  check('decodeJwtExp：数字 → null', decodeJwtExp(123), null);

  // ================= ② 过期时刻归一化与续期决策边界 =================
  const lrMs = Date.parse('2026-08-14T00:00:00.000Z');
  check('codexExpiresAt：exp 优先', codexExpiresAt(exp, lrMs), exp);
  check('codexExpiresAt：exp 无效 + last_refresh 兜底（+10 天）', codexExpiresAt(null, lrMs), Math.floor(lrMs / 1000) + 864000);
  check('codexExpiresAt：exp 非数字 + 兜底', codexExpiresAt('bad', lrMs), Math.floor(lrMs / 1000) + 864000);
  check('codexExpiresAt：exp=0 + 兜底', codexExpiresAt(0, lrMs), Math.floor(lrMs / 1000) + 864000);
  check('codexExpiresAt：两者皆无 → null', codexExpiresAt(null, NaN), null);
  check('codexExpiresAt：last_refresh=0 → null', codexExpiresAt(null, 0), null);

  const now = 1784000000;
  check('codexNeedsRefresh：剩余 46min → 不续期', codexNeedsRefresh(now + 46 * 60, now), false);
  check('codexNeedsRefresh：剩余 45min（边界）→ 不续期', codexNeedsRefresh(now + 45 * 60, now), false);
  check('codexNeedsRefresh：剩余 44min → 续期', codexNeedsRefresh(now + 44 * 60, now), true);
  check('codexNeedsRefresh：已过期 → 续期', codexNeedsRefresh(now - 60, now), true);
  check('codexNeedsRefresh：无法判定（null）→ 续期（保守）', codexNeedsRefresh(null, now), true);

  // ================= ③ 读/写 auth.json（含原子写） =================
  check('readCodexAuthFile：缺失 → {ok:false, missing}', JSON.stringify(readCodexAuthFile(AUTH_PATH() + '.nope')), JSON.stringify({ ok: false, reason: 'missing' }));
  fs.writeFileSync(AUTH_PATH(), 'not json {{{');
  check('readCodexAuthFile：损坏 → {ok:false, corrupt}', JSON.stringify(readCodexAuthFile(AUTH_PATH())), JSON.stringify({ ok: false, reason: 'corrupt' }));
  fs.writeFileSync(AUTH_PATH(), JSON.stringify({ a: 1 }));
  check('readCodexAuthFile：合法 → {ok:true, auth}', JSON.stringify(readCodexAuthFile(AUTH_PATH())), JSON.stringify({ ok: true, auth: { a: 1 } }));

  const wAuthPath = path.join(tmpRoot, 'w-auth.json');
  const wAuth = { auth_mode: 'oauth', OPENAI_API_KEY: 'k', tokens: { id_token: 'i', access_token: 'old-at', refresh_token: 'old-rt', account_id: 'acct' }, last_refresh: '2026-08-01T00:00:00.000Z' };
  writeFileSync(wAuthPath, JSON.stringify(wAuth, null, 2), { mode: 0o600 });
  const updated = writeAuthJson(wAuthPath, wAuth, 'new-at', 'new-rt', '2026-08-17T00:00:00.000Z');
  check('写回：返回对象结构完整（仅换令牌 + last_refresh）', JSON.stringify(updated), JSON.stringify({ auth_mode: 'oauth', OPENAI_API_KEY: 'k', tokens: { id_token: 'i', access_token: 'new-at', refresh_token: 'new-rt', account_id: 'acct' }, last_refresh: '2026-08-17T00:00:00.000Z' }));
  const onDisk = JSON.parse(readFileSync(wAuthPath, 'utf8'));
  ok('写回：落盘内容 = 返回内容', JSON.stringify(onDisk) === JSON.stringify(updated), JSON.stringify(onDisk));
  ok('写回：文件权限 0600', (fs.statSync(wAuthPath).mode & 0o777) === 0o600, (fs.statSync(wAuthPath).mode & 0o777).toString(8));
  ok('写回：无残留 tmp 文件', !fs.existsSync(wAuthPath + '.tmp'), 'tmp 残留');

  // 原子写：模拟 rename 前崩溃（写一半场景）→ 目标文件仍是旧内容且始终合法 JSON
  const origRename = renameSync;
  renameSync = function () { throw new Error('simulated crash before rename'); };
  let crashed = false;
  try { writeAuthJson(wAuthPath, updated, 'crash-at', 'crash-rt', '2026-08-18T00:00:00.000Z'); } catch (e) { crashed = true; }
  renameSync = origRename;
  check('原子写：rename 崩溃时抛异常', crashed, true);
  const afterCrash = JSON.parse(readFileSync(wAuthPath, 'utf8'));
  ok('原子写：目标文件未被破坏（仍是旧令牌、合法 JSON）', afterCrash.tokens.access_token === 'new-at' && JSON.stringify(afterCrash) === JSON.stringify(updated), JSON.stringify(afterCrash));
  check('原子写：写一半的 tmp 也是合法 JSON（含新令牌）', (function () { try { return JSON.parse(readFileSync(wAuthPath + '.tmp', 'utf8')).tokens.access_token === 'crash-at'; } catch (e) { return false; } })(), true);
  const retried = writeAuthJson(wAuthPath, updated, 'retry-at', 'retry-rt', '2026-08-19T00:00:00.000Z');
  ok('原子写：恢复后可重试成功且无 tmp 残留', JSON.parse(readFileSync(wAuthPath, 'utf8')).tokens.access_token === 'retry-at' && !fs.existsSync(wAuthPath + '.tmp'), JSON.stringify(retried));

  // ================= ④ 未登录态（缺失 / 损坏，不崩溃） =================
  fs.rmSync(AUTH_PATH(), { force: true });
  stubFetch(() => { throw new Error('未登录态不应发起网络请求'); });
  {
    const b = await boot({ settingsStore: { providers: {} } });
    check('未登录态（缺失）：状态 ok=false', b.rpc.ok, false);
    check('未登录态（缺失）：error.kind = no-login', b.rpc.error && b.rpc.error.kind, 'no-login');
    check('未登录态（缺失）：无凭据写入', b.calls.credentialsSet.length, 0);
    check('未登录态（缺失）：无网络请求', b.calls.fetch.length, 0);
    b.disposer();
  }
  fs.writeFileSync(AUTH_PATH(), '{corrupt json');
  {
    const b = await boot({ settingsStore: { providers: {} } });
    check('未登录态（损坏）：状态 ok=false + no-login', b.rpc.ok === false && b.rpc.error && b.rpc.error.kind, 'no-login');
    b.disposer();
  }

  // ================= ⑤ 路由注册（ensureCodexRoute 幂等） =================
  fs.rmSync(AUTH_PATH(), { force: true });
  writeAuth(makeAuth());
  stubFetch(() => { throw new Error('无需续期不应发请求'); });
  {
    // 已配置（用户自定义）→ 绝不覆盖
    const b = await boot({ settingsStore: { providers: { 'openai-codex': { apiKeyEnv: 'USER_OWN_ENV', displayName: 'My Codex' } } } });
    check('幂等：用户已配置 → mutate 未被调用', b.calls.settingsMutate.length, 0);
    check('幂等：routeConfigured=true', b.rpc.routeConfigured, true);
    check('幂等：令牌仍注入（凭据可用）', b.calls.credentialsSet.length, 1);
    b.disposer();
  }
  {
    // 自我升级：桥接自有的旧默认配置（apiKeyEnv=OPENAI_CODEX_API_KEY + displayName=Codex + 无 transport，v1.2.0 试用期注册的旧路由）
    // → 一次 mutate 补齐：显示名→ChatGPT + transport→'sse'（强制 HTTP SSE 绕开不稳定的 WebSocket），保留其余字段
    const b = await boot({ settingsStore: { providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'Codex', baseURL: 'keep-me' } } } });
    check('自我升级：旧桥接配置触发 mutate 恰好一次', b.calls.settingsMutate.length, 1);
    ok('自我升级：显示名→ChatGPT + transport→sse 且保留其余字段', b.settingsStore.providers['openai-codex']
      && b.settingsStore.providers['openai-codex'].displayName === 'ChatGPT'
      && b.settingsStore.providers['openai-codex'].transport === 'sse'
      && b.settingsStore.providers['openai-codex'].apiKeyEnv === 'OPENAI_CODEX_API_KEY'
      && b.settingsStore.providers['openai-codex'].baseURL === 'keep-me',
      JSON.stringify(b.settingsStore.providers['openai-codex']));
    check('自我升级：routeConfigured=true + 令牌仍注入', b.rpc.routeConfigured === true && b.calls.credentialsSet.length, 1);
    b.disposer();
  }
  {
    // 已完全升级（displayName=ChatGPT + transport=sse）→ guard 不再命中，零 mutate（幂等）
    const b2 = await boot({ settingsStore: { providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'ChatGPT', transport: 'sse' } } } });
    check('升级完成 → 幂等：不再 mutate', b2.calls.settingsMutate.length, 0);
    b2.disposer();
  }
  {
    // 只缺 transport（displayName 已是 ChatGPT）→ 仅补 transport:'sse'，displayName/apiKeyEnv 保留
    const b3 = await boot({ settingsStore: { providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'ChatGPT' } } } });
    check('补 transport：mutate 恰好一次', b3.calls.settingsMutate.length, 1);
    ok('补 transport：transport=sse 且 displayName/apiKeyEnv 保留', b3.settingsStore.providers['openai-codex']
      && b3.settingsStore.providers['openai-codex'].transport === 'sse'
      && b3.settingsStore.providers['openai-codex'].displayName === 'ChatGPT'
      && b3.settingsStore.providers['openai-codex'].apiKeyEnv === 'OPENAI_CODEX_API_KEY',
      JSON.stringify(b3.settingsStore.providers['openai-codex']));
    b3.disposer();
  }
  {
    // 缺失 → mutate 恰好一次，ops 形状正确（含 transport:'sse'）
    const b = await boot({ settingsStore: { providers: {} } });
    check('路由注册：缺失时 mutate 恰好一次', b.calls.settingsMutate.length, 1);
    ok('路由注册：ns=llm-pi-ai + ops 形状正确', b.calls.settingsMutate[0] && b.calls.settingsMutate[0].ns === 'llm-pi-ai'
      && JSON.stringify(b.calls.settingsMutate[0].ops) === JSON.stringify([{ op: 'set', path: ['providers', 'openai-codex'], value: { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'ChatGPT', transport: 'sse' } }]),
      JSON.stringify(b.calls.settingsMutate[0]));
    check('路由注册：设置已生效（store 含配置）', b.settingsStore.providers['openai-codex'] && b.settingsStore.providers['openai-codex'].apiKeyEnv, 'OPENAI_CODEX_API_KEY');
    b.disposer();
  }

  // ================= ⑥ 集成：无需续期（exp 充足） =================
  {
    const access = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3 * 86400 });
    writeAuth(makeAuth({ access: access }));
    stubFetch(() => { throw new Error('无需续期不应发请求'); });
    const b = await boot({ settingsStore: { providers: {} } });
    check('无需续期：无网络请求', b.calls.fetch.length, 0);
    check('无需续期：注入现有令牌', b.calls.credentialsSet.length === 1 && b.calls.credentialsSet[0].value, access);
    ok('无需续期：状态 ok + expiresAt 正确', b.rpc.ok === true && typeof b.rpc.expiresAt === 'number'
      && Math.abs(b.rpc.expiresAt - (Math.floor(Date.now() / 1000) + 3 * 86400) * 1000) < 5000, JSON.stringify(b.rpc));
    b.disposer();
  }

  // ================= ⑦ 集成：续期成功（exp 剩余 <45min）→ 写回 + 注入 + 同值跳过 =================
  {
    const oldAuth = makeAuth({ access: makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }), refresh: 'old-refresh' });
    writeAuth(oldAuth);
    const newAccess = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3 * 86400, sub: 'new' });
    const fetchCalls = [];
    stubFetch(async (url, opts) => {
      fetchCalls.push({ url: String(url), body: String((opts && opts.body) || '') });
      return jsonResponse(200, { access_token: newAccess, refresh_token: 'new-refresh' });
    });
    const b = await boot({ settingsStore: { providers: {} } });
    check('续期：发起一次 OAuth 刷新请求', fetchCalls.length === 1 && fetchCalls[0].url, 'https://auth.openai.com/oauth/token');
    ok('续期：请求体含 grant_type=refresh_token', fetchCalls[0] && fetchCalls[0].body.includes('grant_type=refresh_token'), fetchCalls[0] && fetchCalls[0].body);
    ok('续期：请求体含旧 refresh_token', fetchCalls[0] && fetchCalls[0].body.includes('old-refresh'), '缺少');
    const after = readAuth();
    check('写回：auth_mode / OPENAI_API_KEY 保留', after.auth_mode === 'oauth' && after.OPENAI_API_KEY, 'sk-user-demo');
    check('写回：account_id / id_token 保留', after.tokens.account_id === 'acct_demo_001' && after.tokens.id_token, 'demo-id-token');
    check('写回：access_token 已更新', after.tokens.access_token, newAccess);
    check('写回：refresh_token 已更新', after.tokens.refresh_token, 'new-refresh');
    ok('写回：last_refresh 为 ISO 且晚于旧值', typeof after.last_refresh === 'string' && Date.parse(after.last_refresh) > Date.parse(oldAuth.last_refresh), after.last_refresh);
    ok('写回：无残留 tmp 文件', !fs.existsSync(AUTH_PATH() + '.tmp'), 'tmp 残留');
    check('注入：credentials.set 收到新令牌', b.calls.credentialsSet.length === 1 && b.calls.credentialsSet[0].name === 'OPENAI_CODEX_API_KEY' && b.calls.credentialsSet[0].value, newAccess);
    check('状态：ok=true + routeConfigured=true', b.rpc.ok === true && b.rpc.routeConfigured, true);
    ok('状态：expiresAt ≈ 新令牌过期时刻', typeof b.rpc.expiresAt === 'number'
      && Math.abs(b.rpc.expiresAt - (Math.floor(Date.now() / 1000) + 3 * 86400) * 1000) < 5000, JSON.stringify(b.rpc.expiresAt));
    // 同值跳过 + 路由不重复写：手动触发第二个 interval tick
    const syncFn = b.calls.interval.find((f) => f.name === 'syncCodexToken');
    check('周期注册：syncCodexToken 已挂 interval', typeof syncFn, 'function');
    if (syncFn) await syncFn();
    check('第二 tick：路由已配置 → 不再 mutate', b.calls.settingsMutate.length, 1);
    check('第二 tick：同值跳过 → credentials.set 仍只 1 次', b.calls.credentialsSet.length, 1);
    check('第二 tick：无需续期 → 无新网络请求', fetchCalls.length, 1);
    b.disposer();
  }

  // ================= ⑧ 集成：已过期（exp < now）→ 续期 =================
  {
    writeAuth(makeAuth({ access: makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }) }));
    let called = 0;
    stubFetch(async () => { called++; return jsonResponse(200, { access_token: makeJwt({ exp: Math.floor(Date.now() / 1000) + 86400 }) }); });
    const b = await boot({ settingsStore: { providers: {} } });
    check('已过期 → 触发续期', called, 1);
    check('已过期续期 → 状态 ok', b.rpc.ok, true);
    b.disposer();
  }

  // ================= ⑨ 集成：续期响应缺 access_token → 不写回、不注入 =================
  {
    const oldAuth = makeAuth({ access: makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }), refresh: 'old-refresh' });
    writeAuth(oldAuth);
    const before = JSON.stringify(readAuth());
    stubFetch(async () => jsonResponse(200, { refresh_token: 'x' })); // 响应缺 access_token
    const b = await boot({ settingsStore: { providers: {} } });
    ok('缺令牌：文件未被写回（内容不变）', JSON.stringify(readAuth()) === before, '文件被改写');
    check('缺令牌：无凭据注入', b.calls.credentialsSet.length, 0);
    check('缺令牌：状态 ok=false + auth 错误', b.rpc.ok === false && b.rpc.error && b.rpc.error.kind, 'auth');
    b.disposer();
  }

  // ================= ⑩ 集成：401 → 重读文件（CLI 已轮换）→ 采用新令牌 =================
  {
    const t0 = new Date(Date.now() - 7200 * 1000).toISOString();
    writeAuth(makeAuth({ access: makeJwt({ exp: Math.floor(Date.now() / 1000) + 300 }), refresh: 'dead-refresh', lastRefresh: t0 }));
    const rotated = makeJwt({ exp: Math.floor(Date.now() / 1000) + 5 * 86400, sub: 'rotated' });
    const t1 = new Date(Date.now() - 600 * 1000).toISOString();
    stubFetch(async () => {
      // 模拟 CLI 在刷新期间轮换了文件（新 last_refresh + 新令牌）
      writeAuth(makeAuth({ access: rotated, refresh: 'rotated-refresh', lastRefresh: t1 }));
      return jsonResponse(401, { error: 'invalid_grant' });
    });
    const b = await boot({ settingsStore: { providers: {} } });
    check('401降级：采用 CLI 轮换后的新令牌', b.calls.credentialsSet.length === 1 && b.calls.credentialsSet[0].value, rotated);
    ok('401降级：文件未被桥接改写（保留 CLI 轮换内容）', readAuth().tokens.access_token === rotated && readAuth().last_refresh === t1, JSON.stringify(readAuth()));
    check('401降级：状态 ok=true', b.rpc.ok, true);
    b.disposer();
  }

  // ================= ⑪ 集成：401 → 重读无更新 → 保留旧凭据 + 错误状态 =================
  {
    const oldAuth = makeAuth({ access: makeJwt({ exp: Math.floor(Date.now() / 1000) + 300 }), refresh: 'dead-refresh' });
    writeAuth(oldAuth);
    const before = JSON.stringify(readAuth());
    stubFetch(async () => jsonResponse(401, { error: 'invalid_grant' }));
    const b = await boot({ settingsStore: { providers: {} } });
    check('401无轮换：不注入（保留旧凭据）', b.calls.credentialsSet.length, 0);
    ok('401无轮换：文件不变', JSON.stringify(readAuth()) === before, '文件被改写');
    check('401无轮换：状态 ok=false + auth 错误', b.rpc.ok === false && b.rpc.error && b.rpc.error.kind, 'auth');
    b.disposer();
  }

  // ================= ⑬ 订阅额度快照失败退避（wham 偶发失败 → 60s 退避期内不重试） =================
  {
    const realNow = Date.now();
    writeAuth(makeAuth({ access: makeJwt({ exp: Math.floor(realNow / 1000) + 3 * 86400 }) }));
    const whamCalls = [];
    let whamOk = false;
    stubFetch(async (url, opts) => {
      const u = String(url);
      if (u.includes('/wham/usage')) {
        whamCalls.push({ at: Date.now() });
        if (!whamOk) return { ok: false, status: 429, text: async () => 'rate limited' };
        return { ok: true, status: 200, text: async () => JSON.stringify({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 43, limit_window_seconds: 604800, reset_at: 1787200342 } } }) };
      }
      throw new Error('退避测试出现非 wham 请求：' + u);
    });
    const b = await boot({ settingsStore: { providers: {} } });
    // 首次：无快照 → 立即请求 → wham 失败 → 错误写入（保留无数据）
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const r1 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, sameOrigin);
    check('退避：首次失败 → error.kind=http + 无窗口数据', r1.payload && r1.payload.error && r1.payload.error.kind === 'http' && r1.payload.windows.length === 0, true);
    check('退避：首次失败 → 恰好一次 wham 请求', whamCalls.length, 1);

    // 退避期内（+10s）：stale 判定被退避挡住 → 不重试、直接返回缓存快照（error 仍在）
    const origNow = Date.now;
    Date.now = () => realNow + 10 * 1000;
    const r2 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, sameOrigin);
    Date.now = origNow;
    check('退避：失败后 10s 内不重试（无新请求、仍带 error）', whamCalls.length === 1 && r2.payload && r2.payload.error && r2.payload.error.kind === 'http', true);

    // 退避期满（+61s）：重试 → 成功 → 窗口数据出现、error 清除
    whamOk = true;
    Date.now = () => realNow + 61 * 1000;
    const r3 = await invoke(b.calls.route, '/_dsh/bottom-info-bar/getSubscriptionSnapshot', 'GET', null, sameOrigin);
    Date.now = origNow;
    ok('退避：期满重试成功 → 窗口数据出现（usedPercent=43）', r3.payload && Array.isArray(r3.payload.windows) && r3.payload.windows.length === 1 && r3.payload.windows[0].usedPercent === 43, JSON.stringify(r3.payload && r3.payload.windows));
    check('退避：期满重试成功 → error 清除', r3.payload && r3.payload.error, null);
    check('退避：期满后共 2 次 wham 请求', whamCalls.length, 2);
    b.disposer();
  }

  // ================= ⑫ 静态安全断言 =================
  ok('安全：源码无 JWT 字面量（eyJ）', !hostSrc.includes('eyJ'), '出现 eyJ');
  ok('安全：无 console 调用直接传 token 变量', !/console\.\w+\([^)]*\btoken\b/.test(hostSrc), 'console 传 token 变量');
  ok('安全：无 console 模板插值（${}）', !/console\.\w+\([^)]*\$\{/.test(hostSrc), 'console 插值');
  ok('安全：无个人路径（songsong）', !hostSrc.includes('songsong'), '含个人路径');
  ok('安全：令牌交换走 HTTPS fetch；shell 仅用于开浏览器（命令不含令牌）', hostSrc.includes("fetch('https://auth.openai.com/oauth/token'") && !/\bshell\.run\([^)]*\btoken\b/.test(hostSrc), '令牌经 shell 传递');
  ok('安全：inject 含 settings（路由注册依赖）', hostSrc.includes("inject: ['credentials', 'shell', 'timer', 'settings']"), 'inject 缺 settings');
  ok('安全：RPC 含 getCodexBridgeStatus（只读）', hostSrc.includes('getCodexBridgeStatus: function') && hostSrc.includes('getCodexBridgeStatus: true') === false, 'RPC 缺失或误入 MUTATING');
  ok('隔离：auth 路径指向临时目录（绝不读真实 ~/.codex/auth.json）', AUTH_PATH() === path.join(tmpRoot, 'auth.json') && AUTH_PATH() !== path.join(os.homedir(), '.codex', 'auth.json'), AUTH_PATH());

  globalThis.fetch = origFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试执行异常：', e);
  try { globalThis.fetch = globalThis.fetch; } catch { /* 忽略 */ }
  process.exit(2);
});
