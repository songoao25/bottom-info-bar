// 静态一致性核查（护栏）：检查 host 源码中 被调用但未定义 的标识符 + RPC handler 完整性
// 用法：node src/check-host.js src/host-v6.js
const fs = require('fs');
const file = process.argv[2] || __dirname + '/host-v6.js';
const src = fs.readFileSync(file, 'utf8');

// 1) 收集定义：function name(...) 与 const name = ...
const defined = new Set();
const defRe = /function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*function|const\s+([A-Za-z_$][\w$]*)\s*=\s*\(/g;
let m;
while ((m = defRe.exec(src))) {
  for (let i = 1; i <= 3; i++) if (m[i]) defined.add(m[i]);
}

// 2) 收集调用：name( —— lookbehind 排除方法调用（.name(）与紧邻标识符
const calls = new Map();
const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
while ((m = callRe.exec(src))) {
  calls.set(m[1], (calls.get(m[1]) || 0) + 1);
}

// JS 内建 / 全局允许名单（沙箱提供）
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
]);

// 3) 未定义引用 = 被调用但既不在 defined 也不在 builtins
const missing = [];
for (const [name] of calls) {
  if (!defined.has(name) && !builtins.has(name) && name.length > 1) missing.push(name);
}

// 4) RPC handler 清单与预期
const handlers = [];
const hRe = /harness\.handle\(\s*'([^']+)'/g;
while ((m = hRe.exec(src))) handlers.push(m[1]);
const expected = ['getBalanceSnapshot', 'getPricing', 'getEstimate', 'getUsageSummary', 'getProviders', 'setActiveProvider', 'getSpendTrend', 'getConfig', 'setDisplayMode', 'setInfoDensity'];
const missingHandlers = expected.filter((h) => !handlers.includes(h));

let ok = true;
console.log('文件：' + file);
console.log('定义函数数：' + [...defined].filter((n) => n !== 'ctx' && n !== 'apply' && !calls.has(n)).length + '（含内部辅助）');
if (missing.length === 0) console.log('PASS  未发现未定义引用');
else { ok = false; console.log('FAIL  未定义引用：' + missing.join(', ')); }
if (missingHandlers.length === 0) console.log('PASS  10 个 RPC handler 完整：' + handlers.join(', '));
else { ok = false; console.log('FAIL  缺失 handler：' + missingHandlers.join(', ')); }

// 关键函数必须存在（防漏贴类缺陷）
const critical = ['spendSummary', 'todaySpend', 'monthSpend', 'last30dSpend', 'costOf', 'sessionTotals', 'computePricing', 'computeEstimate', 'getUsageSummary', 'refreshAllBalances', 'providerDisplayName', 'modelDisplayName'];
const missCritical = critical.filter((f) => !defined.has(f));
if (missCritical.length === 0) console.log('PASS  关键函数齐备：' + critical.join(', '));
else { ok = false; console.log('FAIL  关键函数缺失：' + missCritical.join(', ')); }

process.exit(ok ? 0 : 1);
