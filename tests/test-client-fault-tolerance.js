// 客户端失败处理原子性回归（docs/AUDIT-CODE-REVIEW.md 缺陷 #1，高）：
// ① rpc 超时 / 中止：20s 超时兜底 + AbortController + 组件卸载取消 → 杜绝永久"加载中…"
// ② load 逐接口容错：Promise.allSettled，单端点 RPC 失败不丢弃其他成功数据
// ③ 失败保留旧数据：mergeLoadResults 纯函数（从正式源码提取）——
//    成功端点写新值+清错误 / 失败端点保留旧值+记错误（无旧数据则为 null）
// ④ 渲染降级：整栏 fatal"加载失败"分支已移除，改为旧数据 + 分块/全局降级提示
// 用法：node tests/test-client-fault-tolerance.js
const fs = require('fs');

const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');

// 提取模块级纯函数（括号计数法，与 test-dual-mode.js 同法）
function extractFn(name) {
  const start = clientSrc.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < clientSrc.length) {
    const c = clientSrc[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  const body = clientSrc.slice(start, i + 1);
  return eval('(' + body + ')');
}

const mergeLoadResults = extractFn('mergeLoadResults');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- ① rpc 超时 / 中止（静态） ----
check('rpc 超时兜底 20s（常量存在）', clientSrc.includes('const RPC_TIMEOUT_MS = 20000'), true);
check('rpc 使用 AbortController', clientSrc.includes('const controller = new AbortController()'), true);
check('fetch 携带 signal（可中止）', clientSrc.includes('signal: controller.signal'), true);
check('超时后清除定时器（finally 清理）', clientSrc.includes('.finally(cleanup)'), true);
check('组件卸载时中止在途请求', clientSrc.includes('return function () { controller.abort(); }'), true);
check('rpc 支持外部 AbortSignal 参数', clientSrc.includes('function rpc(method, args, externalSignal)'), true);

// ---- ② load 逐接口容错（静态） ----
check('load 使用 Promise.allSettled', clientSrc.includes('Promise.allSettled(['), true);
check('load 不再用 Promise.all 聚合（任一失败不再拖垮全部）', !clientSrc.includes('Promise.all(['), true);
check('load 结果经 mergeLoadResults 合并（保留旧数据）', clientSrc.includes('mergeLoadResults(s, results)'), true);
check('5 个端点仍在 load 中完整调用', ['getBalanceSnapshot', 'getPricing', 'getUsageSummary', 'getBillingMode', 'getSubscriptionSnapshot'].every(function (m) { return clientSrc.includes("rpc('" + m + "'"); }), true);

// ---- ③ mergeLoadResults 纯函数（运行时，从正式源码提取） ----
const ERR = function (msg) { return new Error(msg); };
const OLD = {
  loading: false,
  balance: { data: { total: 12.34 }, currency: 'CNY', error: null },
  pricing: { mode: 'peak-valley', period: 'peak', providerDisplay: 'DeepSeek' },
  usage: { currentSession: { costs: { CNY: 1.5 } }, todaySpend: 1.5 },
  billingMode: { mode: 'balance', provider: 'deepseek' },
  sub: null,
};

// 混合：balance 失败（保留旧）、pricing 成功（新值）、usage 成功、billingMode 失败（保留旧）、sub 成功
const mixed = mergeLoadResults(OLD, [
  { status: 'rejected', reason: ERR('请求超时') },
  { status: 'fulfilled', value: { mode: 'flat', period: null, providerDisplay: 'DeepSeek', modelDisplay: 'V4' } },
  { status: 'fulfilled', value: { currentSession: { costs: { CNY: 2.5 } }, todaySpend: 2.5 } },
  { status: 'rejected', reason: ERR('请求已取消') },
  { status: 'fulfilled', value: { mode: 'balance', provider: 'deepseek', plan: null, windows: [] } },
]);
check('失败端点保留旧值（balance）', mixed.balance, OLD.balance);
check('成功端点写入新值（pricing）', mixed.pricing.mode, 'flat');
check('成功端点写入新值（usage）', mixed.usage.todaySpend, 2.5);
check('失败端点保留旧值（billingMode）', mixed.billingMode, OLD.billingMode);
check('成功端点写入新值（sub）', mixed.sub.mode, 'balance');
check('失败端点记录错误信息（balance）', mixed.errors.balance, '请求超时');
check('成功端点错误清除（pricing）', mixed.errors.pricing, null);
check('失败端点记录错误信息（billingMode）', mixed.errors.billingMode, '请求已取消');
check('成功端点错误清除（sub）', mixed.errors.sub, null);
check('settled 后 loading 恒为 false（不再"加载中"）', mixed.loading, false);

// 首帧全失败（无旧数据）：值保持 null、错误表逐项记录、不产生整栏 fatal
const firstFail = mergeLoadResults(
  { loading: true, balance: null, pricing: null, usage: null, billingMode: null, sub: null },
  [{ status: 'rejected', reason: ERR('请求超时') }, { status: 'rejected', reason: ERR('请求超时') }, { status: 'rejected', reason: ERR('请求超时') }, { status: 'rejected', reason: ERR('请求超时') }, { status: 'rejected', reason: ERR('请求超时') }]
);
check('首帧全失败：balance 保持 null', firstFail.balance, null);
check('首帧全失败：pricing 保持 null', firstFail.pricing, null);
check('首帧全失败：全部端点错误表非空', firstFail.errors.balance === '请求超时' && firstFail.errors.pricing === '请求超时' && firstFail.errors.usage === '请求超时' && firstFail.errors.billingMode === '请求超时' && firstFail.errors.sub === '请求超时', true);
check('首帧全失败：loading = false（不永久加载中）', firstFail.loading, false);

// 全部成功：全写新值、错误表清空
const allOk = mergeLoadResults(OLD, [
  { status: 'fulfilled', value: { data: { total: 99 } } },
  { status: 'fulfilled', value: { mode: 'peak-valley' } },
  { status: 'fulfilled', value: { todaySpend: 9 } },
  { status: 'fulfilled', value: { mode: 'subscription' } },
  { status: 'fulfilled', value: { plan: 'ChatGPT Plus', windows: [] } },
]);
check('全部成功：balance 新值', allOk.balance.data.total, 99);
check('全部成功：billingMode 新值', allOk.billingMode.mode, 'subscription');
check('全部成功：sub 新值', allOk.sub.plan, 'ChatGPT Plus');
check('全部成功：错误表全 null', allOk.errors.balance === null && allOk.errors.usage === null && allOk.errors.sub === null, true);

// 无 reason 的失败（如裸 reject）→ 兜底文案
const bareFail = mergeLoadResults(OLD, [
  { status: 'rejected', reason: undefined },
  { status: 'fulfilled', value: OLD.pricing },
  { status: 'fulfilled', value: OLD.usage },
  { status: 'fulfilled', value: OLD.billingMode },
  { status: 'fulfilled', value: OLD.sub },
]);
check('无 reason 的失败兜底为 RPC 失败', bareFail.errors.balance, 'RPC 失败');

// ---- ④ 渲染降级（静态） ----
check('整栏 fatal 分支已移除（不再整栏"加载失败"）', !clientSrc.includes('state.fatal'), true);
check('加载中仅首帧且无数据时显示（渲染守卫）', clientSrc.includes('if (state.loading && !hasAnyData) {'), true);
check('全局降级提示存在（部分数据刷新失败）', clientSrc.includes('部分数据刷新失败'), true);
check('余额块 RPC 失败且无旧数据 → 简短失败信息（只降级余额块）', clientSrc.includes("title: '余额获取失败。请检查网络和 API Key。'"), true);
check('余额块失败保留旧快照提示（host 快照失败 / RPC 失败共用）', clientSrc.includes('bal.error || errors.balance'), true);
check('订阅块 RPC 失败且无旧数据 → 只显示刷新失败并提供悬停说明', clientSrc.includes("'⚠ 刷新失败'") && clientSrc.includes('subscriptionFailureHint'), true);
check('订阅块失败保留旧快照提示（host 快照失败 / RPC 失败共用）', clientSrc.includes('sub.error || errors.sub'), true);
check('花费块 RPC 失败且无旧数据 → 简短降级提示', clientSrc.includes("title: '花费暂不可用；不会影响对话。'"), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
