// 静态一致性核查（护栏）：检查 host 源码中 被调用但未定义 的标识符 + RPC handler 完整性
// 用法：node tests/check-host.js plugin/src/host.js
const fs = require('fs');
const file = process.argv[2] || __dirname + '/../plugin/src/host.js';
const src = fs.readFileSync(file, 'utf8');

// 1) 收集定义：function name(...)、const/let name = ...、函数参数
const defined = new Set();
const defRe = /function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=|let\s+([A-Za-z_$][\w$]*)\s*=/g;
let m;
while ((m = defRe.exec(src))) {
  for (let i = 1; i <= 3; i++) if (m[i]) defined.add(m[i]);
}
// 函数参数（function name(a, b) 与 function (a, b) 匿名）也属定义
const paramRe = /function\s+(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g;
while ((m = paramRe.exec(src))) {
  m[1].split(',').forEach(function (p) {
    const name = p.trim().replace(/^[\s\S]*?([A-Za-z_$][\w$]*)$/, '$1');
    if (name && name.length > 1) defined.add(name);
  });
}

// 2) 收集调用：name( —— lookbehind 排除方法调用（.name(）与紧邻标识符
const calls = new Map();
const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
while ((m = callRe.exec(src))) {
  calls.set(m[1], (calls.get(m[1]) || 0) + 1);
}

// JS 内建 / 全局允许名单（沙箱提供 + Node 标准库导入）
const builtins = new Set([
  'console', 'ctx', 'harness', 'Date', 'Math', 'Set', 'Map', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'parseFloat', 'parseInt', 'isNaN', 'JSON',
  'Promise', 'Error', 'Intl', 'btoa', 'atob', 'TextEncoder', 'TextDecoder',
  'undefined', 'null', 'true', 'false', 'typeof', 'void', 'function', 'return',
  'new', 'async', 'await', 'for', 'while', 'if', 'else', 'catch', 'try', 'throw',
  'const', 'let', 'var', 'switch', 'case', 'default', 'break', 'continue', 'do',
  'in', 'of', 'yield', 'class', 'extends', 'this', 'super', 'delete', 'typeof',
  'apply', // 插件入口（对象形式 apply(ctx)）
  'next',  // waterfall 事件回调参数（llm/stream 的 next()）
  // Node 标准库导入与全局（静态形态）
  'existsSync', 'mkdirSync', 'readFileSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'homedir', 'join', 'dirname',
  'randomBytes', 'createHash', 'createServer',
  'process', 'URL', 'Buffer', 'decodeURIComponent', 'encodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'AbortController', 'fetch', 'require', 'module', 'exports',
  'globalThis', 'webCtx', 'webServer', 'req', 'res', 'dispose',
  'URLSearchParams', 'isFinite',
]);

// 3) 未定义引用 = 被调用但既不在 defined 也不在 builtins
const missing = [];
for (const [name] of calls) {
  if (!defined.has(name) && !builtins.has(name) && name.length > 1) missing.push(name);
}

// 4) RPC handler 清单：静态形态从 ROUTES 对象提取（动态形态为 harness.handle）
const handlers = [];
const routesMatch = src.match(/const ROUTES = \{([\s\S]*?)\n    \};/);
if (routesMatch) {
  const re = /\n\s{6}([A-Za-z_$][\w$]*): (?:async )?function/g;
  let m2;
  while ((m2 = re.exec(routesMatch[1]))) handlers.push(m2[1]);
}
const expected = ['getBalanceSnapshot', 'getPricing', 'getEstimate', 'getUsageSummary', 'getProviders', 'setActiveProvider', 'getSpendTrend', 'getConfig', 'setDisplayMode', 'setInfoDensity', 'getBillingMode', 'getSubscriptionSnapshot', 'getCodexBridgeStatus', 'startCodexOAuth', 'unbindCodex'];
const missingHandlers = expected.filter((h) => !handlers.includes(h));

let ok = true;
console.log('文件：' + file);
console.log('定义函数数：' + [...defined].filter((n) => n !== 'ctx' && n !== 'apply' && !calls.has(n)).length + '（含内部辅助）');
if (missing.length === 0) console.log('PASS  未发现未定义引用');
else { ok = false; console.log('FAIL  未定义引用：' + missing.join(', ')); }
if (missingHandlers.length === 0) console.log('PASS  ' + handlers.length + ' 个 RPC handler 完整：' + handlers.join(', '));
else { ok = false; console.log('FAIL  缺失 handler：' + missingHandlers.join(', ')); }

// 关键函数必须存在（防漏贴类缺陷）
const critical = ['spendSummary', 'todaySpend', 'monthSpend', 'last30dSpend', 'costOf', 'sessionTotals', 'computePricing', 'computeEstimate', 'getUsageSummary', 'refreshAllBalances', 'modelDisplayFromCache', 'providerDisplayFromCache', 'refreshModelCatalog', 'detectBillingMode', 'codexWindowKey', 'parseCodexUsage', 'parseOpenCodeGoUsage', 'mergeSubscriptionResult', 'kickSubscriptionRefresh', 'getSubscriptionSnapshotRpc', 'decodeJwtExp', 'codexExpiresAt', 'codexNeedsRefresh', 'readCodexAuthFile', 'writeAuthJson', 'refreshCodexTokenPair', 'ensureCodexRoute', 'syncCodexToken', 'oauthCallbackPort', 'createPkcePair', 'buildAuthorizeUrl', 'parseCallbackUrl', 'codexAccountIdFromJwt', 'buildOAuthAuthObject', 'readBindFlag', 'writeBindFlag', 'clearBindFlag', 'exchangeAuthorizationCode', 'startOAuthCallbackServer', 'startCodexOAuthRpc', 'unbindCodexRpc'];
const missCritical = critical.filter((f) => !defined.has(f));
if (missCritical.length === 0) console.log('PASS  关键函数齐备：' + critical.join(', '));
else { ok = false; console.log('FAIL  关键函数缺失：' + missCritical.join(', ')); }

process.exit(ok ? 0 : 1);
