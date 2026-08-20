// 记账数值清洗回归测试（审计缺陷 #2 纯函数层）：
// ① sanitizeTokens：NaN/Infinity/负数/非数字 → 0，正常值原样通过（recordUsage 写盘前清洗用）
// ② isValidUsageRecord：加载过滤——NaN/Infinity/负数/缺字段记录一律丢弃（loadUsageRecords 用）
// 端到端（异常 usage 流 → 记账 → 落盘）见 tests/test-host-regressions.mjs 第 ⑤ 组。
// 用法：node tests/test-usage-sanitize.js
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

// 与 test-spend-accounting.js / test-dual-mode.js 同法：括号计数提取 + eval
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\n    \\(([\\s\\S]*?)\\n    \\}', 'm');
  const re2 = new RegExp('function ' + name + '\\(([\\s\\S]*?)\\n    \\}', 'm');
  let m = src.match(re) || src.match(re2);
  if (!m) throw new Error('未找到 function ' + name);
  const start = src.indexOf('function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  const body = src.slice(start, i + 1);
  return eval('(' + body + ')');
}

const sanitizeTokens = extractFn('sanitizeTokens');
const isValidUsageRecord = extractFn('isValidUsageRecord');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- ① sanitizeTokens：写盘前清洗（NaN/Infinity/负数/非数字 → 0，正常值直通） ----
check('sanitizeTokens(1234)', sanitizeTokens(1234), 1234);
check('sanitizeTokens(0)', sanitizeTokens(0), 0);
check('sanitizeTokens(0.5)', sanitizeTokens(0.5), 0.5);
check('sanitizeTokens(NaN) → 0', sanitizeTokens(NaN), 0);
check('sanitizeTokens(Infinity) → 0', sanitizeTokens(Infinity), 0);
check('sanitizeTokens(-Infinity) → 0', sanitizeTokens(-Infinity), 0);
check('sanitizeTokens(-100) → 0', sanitizeTokens(-100), 0);
check('sanitizeTokens(字符串 "100") → 0', sanitizeTokens('100'), 0);
check('sanitizeTokens(undefined) → 0', sanitizeTokens(undefined), 0);
check('sanitizeTokens(null) → 0', sanitizeTokens(null), 0);

// ---- ② isValidUsageRecord：加载过滤（损坏记录丢弃，绝不进内存汇总） ----
const valid = { ts: 1784000000000, model: 'deepseek-v4-flash', provider: 'deepseek', input: 100, cacheRead: 10, cacheWrite: 0, output: 200 };
check('有效记录 → true', isValidUsageRecord(valid), true);
check('input 为 NaN → false', isValidUsageRecord(Object.assign({}, valid, { input: NaN })), false);
check('output 为 Infinity → false', isValidUsageRecord(Object.assign({}, valid, { output: Infinity })), false);
check('cacheRead 为负数 → false', isValidUsageRecord(Object.assign({}, valid, { cacheRead: -1 })), false);
check('缺 cacheWrite → false', isValidUsageRecord(Object.assign({}, valid, { cacheWrite: undefined })), false);
check('缺 cacheRead → false', isValidUsageRecord(Object.assign({}, valid, { cacheRead: undefined })), false);
check('ts 非数字 → false', isValidUsageRecord(Object.assign({}, valid, { ts: '2026-08-15' })), false);
check('ts 为负数 → false', isValidUsageRecord(Object.assign({}, valid, { ts: -1 })), false);
check('缺 model → false', isValidUsageRecord(Object.assign({}, valid, { model: undefined })), false);
check('缺 provider → false', isValidUsageRecord(Object.assign({}, valid, { provider: undefined })), false);
check('null 记录 → false', isValidUsageRecord(null), false);
check('非对象 → false', isValidUsageRecord('x'), false);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
