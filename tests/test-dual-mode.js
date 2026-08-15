// 双模式（余额制 / 订阅制）逻辑审计：
// ① 模式检测（provider 映射 + 手动覆盖）② Codex wham 响应解析（含窗口缺失边界）
// ③ OpenCode Go 响应解析（含 status 非 ok）④ 快照失败回退（失败保留旧快照 + error 标记）
// ⑤ 窗口时长映射边界 ⑥ client 订阅制渲染分支的静态检查
// 用法：node tests/test-dual-mode.js
const fs = require('fs');

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');

// 提取纯函数（与 test-spend-accounting.js 同法：括号计数提取 + eval）
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\n    \\(([\\s\\S]*?)\\n    \\}', 'm');
  const re2 = new RegExp('function ' + name + '\\(([\\s\\S]*?)\\n    \\}', 'm');
  let m = hostSrc.match(re) || hostSrc.match(re2);
  if (!m) throw new Error('未找到 function ' + name);
  const start = hostSrc.indexOf('function ' + name);
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
// 提取单行 const 字面量（数组/对象/标量，允许行尾 // 注释；host.js 常量行尾无分号）
function extractConst(name) {
  const re = new RegExp('const ' + name + ' = (\\[[^\\n]*?\\]|\\{[^\\n]*?\\}|[^\\n]+?)(?:\\s*//[^\\n]*)?\\n');
  const m = hostSrc.match(re);
  if (!m) throw new Error('未找到 const ' + name);
  return eval('(' + m[1] + ')');
}

// 依赖常量（与 host.js 同源提取，测试与实现共用同一份配置）
const SUBSCRIPTION_PROVIDERS = extractConst('SUBSCRIPTION_PROVIDERS');
const WINDOW_SECONDS = extractConst('WINDOW_SECONDS');
const WINDOW_LABELS = extractConst('WINDOW_LABELS');
const CODEX_PLAN_NAMES = extractConst('CODEX_PLAN_NAMES');

// 提取纯函数（eval 出的函数闭包指向本模块作用域，能解析到上面的常量与函数）
const detectBillingMode = extractFn('detectBillingMode');
const codexWindowKey = extractFn('codexWindowKey');
const planDisplayName = extractFn('planDisplayName'); // parseCodexUsage 的依赖
const openCodeGoWindowKey = extractFn('openCodeGoWindowKey'); // parseOpenCodeGoUsage 的依赖
const normalizeResetAt = extractFn('normalizeResetAt'); // parseOpenCodeGoUsage 的依赖
const parseCodexUsage = extractFn('parseCodexUsage');
const parseOpenCodeGoUsage = extractFn('parseOpenCodeGoUsage');
const mergeSubscriptionResult = extractFn('mergeSubscriptionResult');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- 1) 模式检测 ----
check('provider=codex → subscription', detectBillingMode('codex', 'auto').mode, 'subscription');
check('provider=chatgpt → subscription', detectBillingMode('chatgpt', 'auto').mode, 'subscription');
check('provider=opencode-go → subscription', detectBillingMode('opencode-go', 'auto').mode, 'subscription');
check('provider=opencode → subscription', detectBillingMode('opencode', 'auto').mode, 'subscription');
check('provider=deepseek → balance', detectBillingMode('deepseek', 'auto').mode, 'balance');
check('provider=openai → balance', detectBillingMode('openai', 'auto').mode, 'balance');
check('provider=openrouter → balance', detectBillingMode('openrouter', 'auto').mode, 'balance');
check('未知 provider → balance（兜底）', detectBillingMode('some-new-provider', 'auto').mode, 'balance');
check('空 provider → balance（兜底）', detectBillingMode('', 'auto').mode, 'balance');
check('手动覆盖 balance：codex + billingMode=balance → balance', detectBillingMode('codex', 'balance').mode, 'balance');
check('手动覆盖 subscription：deepseek + billingMode=subscription → subscription', detectBillingMode('deepseek', 'subscription').mode, 'subscription');
check('手动覆盖理由 = manual-override', detectBillingMode('codex', 'balance').reason, 'manual-override');
check('auto 理由含 provider 标识', detectBillingMode('codex', 'auto').reason, 'provider:codex');
check('订阅 provider 集合配置正确', JSON.stringify(SUBSCRIPTION_PROVIDERS), JSON.stringify(['codex', 'chatgpt', 'opencode-go', 'opencode']));

// ---- 2) 窗口时长映射边界 ----
check('18000 → five_hour', codexWindowKey(18000), 'five_hour');
check('604800 → seven_day', codexWindowKey(604800), 'seven_day');
check('2592000 → monthly', codexWindowKey(2592000), 'monthly');
check('18001（≈5h）→ five_hour', codexWindowKey(18001), 'five_hour');
check('604799（≈7d）→ seven_day', codexWindowKey(604799), 'seven_day');
check('2592001（≈30d）→ monthly', codexWindowKey(2592001), 'monthly');
check('17100（18000×0.95，容差下限）→ five_hour', codexWindowKey(17100), 'five_hour');
check('18900（18000×1.05，容差上限）→ five_hour', codexWindowKey(18900), 'five_hour');
check('2721600（2592000×1.05，容差上限）→ monthly', codexWindowKey(2721600), 'monthly');
check('20000（超出 5% 容差）→ null', codexWindowKey(20000), null);
check('3600（1h，不在映射）→ null', codexWindowKey(3600), null);
check('非数字 → null', codexWindowKey(undefined), null);
check('null → null', codexWindowKey(null), null);
check('窗口时长表配置正确', JSON.stringify(WINDOW_SECONDS), JSON.stringify({ five_hour: 18000, seven_day: 604800, monthly: 2592000 }));
check('窗口标签表配置正确', JSON.stringify(WINDOW_LABELS), JSON.stringify({ five_hour: '5小时', seven_day: '周', monthly: '月' }));

// ---- 3) Codex 响应解析（真实响应形态：rate_limit 在顶层，无 usage 包装层） ----
// 完整双窗口（5 小时 + 7 天）
const codexFull = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 9, limit_window_seconds: 18000, reset_at: 1784000000 },
    secondary_window: { used_percent: 62, limit_window_seconds: 604800, reset_at: 1785000000 },
  },
};
const parsedFull = parseCodexUsage(codexFull);
check('Codex 完整双窗口：窗口数 = 2', parsedFull.windows.length, 2);
check('Codex 完整双窗口：5小时窗口', parsedFull.windows[0], { key: 'five_hour', label: '5小时', usedPercent: 9, resetsAt: 1784000000000 });
check('Codex 完整双窗口：周窗口', parsedFull.windows[1], { key: 'seven_day', label: '周', usedPercent: 62, resetsAt: 1785000000000 });
check('Codex plan_type=plus → ChatGPT Plus', parsedFull.plan, 'ChatGPT Plus');
check('Codex plan_type=pro → ChatGPT Pro', parseCodexUsage({ plan_type: 'pro', rate_limit: {} }).plan, 'ChatGPT Pro');

// 只含周窗口（5 小时缺失——2026-08-17 本机真实响应形态：primary_window 即 7 天窗口）
const codexWeeklyOnly = {
  plan_type: 'plus',
  rate_limit: { primary_window: { used_percent: 43, limit_window_seconds: 604800, reset_at: 1787200342 } },
};
const parsedWeekly = parseCodexUsage(codexWeeklyOnly);
check('Codex 仅周窗口（5h 缺失）：窗口数 = 1', parsedWeekly.windows.length, 1);
check('Codex 仅周窗口：key = seven_day', parsedWeekly.windows[0].key, 'seven_day');
check('Codex 仅周窗口：usedPercent = 43', parsedWeekly.windows[0].usedPercent, 43);
check('Codex 仅周窗口：reset_at 秒 → 毫秒', parsedWeekly.windows[0].resetsAt, 1787200342000);

// 未知窗口时长 / 缺百分比 → 跳过
const codexUnknown = { rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 123456, reset_at: 100 } } };
check('未知窗口时长（123456s）→ 跳过', parseCodexUsage(codexUnknown).windows.length, 0);
const codexNoPercent = { rate_limit: { primary_window: { limit_window_seconds: 604800 } } };
check('缺 used_percent → 跳过', parseCodexUsage(codexNoPercent).windows.length, 0);

// 结构异常 → null（防御性解析）
check('Codex 无 rate_limit → null', parseCodexUsage({ foo: 1 }), null);
check('Codex null → null', parseCodexUsage(null), null);
check('Codex 空对象 → null', parseCodexUsage({}), null);

// ---- 4) OpenCode Go 响应解析 ----
const ogFull = { usage: {
  rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
  weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
  monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
} };
const ogParsed = parseOpenCodeGoUsage(ogFull);
check('OpenCode Go 完整三窗口：数量 = 3', ogParsed.windows.length, 3);
check('OpenCode Go rolling → five_hour', ogParsed.windows[0].key, 'five_hour');
check('OpenCode Go weekly → seven_day', ogParsed.windows[1].key, 'seven_day');
check('OpenCode Go monthly → monthly', ogParsed.windows[2].key, 'monthly');
check('OpenCode Go 百分比取整', ogParsed.windows[0].usedPercent, 9);
check('OpenCode Go resetsAt ISO → 毫秒', ogParsed.windows[0].resetsAt, Date.parse('2026-08-14T07:20:04.810Z'));
check('OpenCode Go 固定套餐名', ogParsed.plan, 'OpenCode Go');

// status 非 ok 的处理：非 ok 窗口跳过，ok 窗口保留
const ogPartial = { usage: {
  rolling: { status: 'error', percent: 9, resetsAt: null },
  weekly: { status: 'ok', percent: 12, resetsAt: 1785000000000 },
  monthly: { status: 'limit', percent: 6, resetsAt: null },
} };
const ogParsedPartial = parseOpenCodeGoUsage(ogPartial);
check('status 非 ok 窗口跳过（rolling/monthly 剔除）', ogParsedPartial.windows.length, 1);
check('仅保留 ok 窗口（weekly）', ogParsedPartial.windows[0].key, 'seven_day');
check('毫秒级数值 resetsAt 原样保留', ogParsedPartial.windows[0].resetsAt, 1785000000000);

// 数值型 resetsAt：秒级 ×1000
const ogSec = { usage: { weekly: { status: 'ok', percent: 50, resetsAt: 1785000000 } } };
check('秒级数值 resetsAt → ×1000', parseOpenCodeGoUsage(ogSec).windows[0].resetsAt, 1785000000000);

// 结构异常 → null
check('OpenCode Go 空对象 → null', parseOpenCodeGoUsage({}), null);
check('OpenCode Go 无 usage → null', parseOpenCodeGoUsage({ foo: 1 }), null);
check('OpenCode Go null → null', parseOpenCodeGoUsage(null), null);

// ---- 5) 快照失败回退（mergeSubscriptionResult：失败保留旧 data/fetchedAt，仅换 error） ----
const prevSnap = {
  data: { provider: 'codex', plan: 'ChatGPT Plus', windows: [{ key: 'seven_day', label: '周', usedPercent: 43, resetsAt: 1787200342000 }] },
  fetchedAt: 12345,
  error: null,
};
const failedSnap = mergeSubscriptionResult(prevSnap, { error: { kind: 'http', message: '请求失败（HTTP 500）' } });
check('失败后旧 data 保留', failedSnap.data, prevSnap.data);
check('失败后旧 fetchedAt 保留', failedSnap.fetchedAt, 12345);
check('失败后 error 标记更新', failedSnap.error, { kind: 'http', message: '请求失败（HTTP 500）' });
const okSnap = mergeSubscriptionResult(prevSnap, { data: { provider: 'codex', plan: 'ChatGPT Pro', windows: [] } });
check('成功后 data 替换', okSnap.data.plan, 'ChatGPT Pro');
check('成功后 error 清除', okSnap.error, null);
check('成功后 fetchedAt 更新为当前时间', typeof okSnap.fetchedAt === 'number' && okSnap.fetchedAt > 0, true);
const noPrevFailed = mergeSubscriptionResult(undefined, { error: { kind: 'no-key', message: '未配置' } });
check('无旧快照时失败 → data=null fetchedAt=null', noPrevFailed.data === null && noPrevFailed.fetchedAt === null, true);

// ---- 6) client 订阅制渲染分支静态检查 ----
// 提取 client 订阅制渲染函数体，验证 row2 只含三类信息（模型/额度/距重置），不含余额制专属信息
function extractClientFnBody(name) {
  const start = clientSrc.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 client function ' + name);
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
  return clientSrc.slice(start, i + 1);
}
const subFn = extractClientFnBody('pushSubscriptionGroups');

check('client 按 billingMode 分支互斥渲染', clientSrc.includes("const isSub = !!(state.billingMode && state.billingMode.mode === 'subscription')"), true);
check('client 余额制渲染函数独立保留', clientSrc.includes('function pushBalanceGroups(groups)'), true);
check('client 订阅制渲染函数存在', clientSrc.includes('function pushSubscriptionGroups(groups)'), true);
check('client 三窗口标签渲染（短标签+加粗百分比）', clientSrc.includes("winNodes.push(w.label + ' ', num(w.usedPercent + '%'))"), true);
check('client compact 密度精简为最紧窗口', clientSrc.includes('const visible = full ? windows : [tight];'), true);
check('client 无快照时显示加载中（RPC 未返回分支）', subFn.includes("'订阅额度加载中…'"), true);
check('client 窗口渲染由 hasData 门控（空窗口跳过不占位）', subFn.includes('if (hasData) {'), true);
check('client 未配置 OpenCode Go 引导文案', clientSrc.includes('未配置 OpenCode Go → 设置→模型 填写 OPENCODE_GO_API_KEY'), true);
check('client 预警阈值常量与 host 一致 = 90', clientSrc.includes('const WINDOW_ALERT_PERCENT = 90'), true);
check('client 任一窗口 ≥90% 显示红色 ⚠', clientSrc.includes('w.usedPercent >= WINDOW_ALERT_PERCENT'), true);
check('client 距重置倒计时（天级格式 fmtResetCountdown）', clientSrc.includes("'距重置 ', num(fmtResetCountdown(tightForCountdown.resetsAt - now))"), true);
check('client fmtResetCountdown 天级格式（1d 21h）', clientSrc.includes("d + 'd ' + h + 'h'"), true);
check('client hover 明细含重置时刻（formatDateTime）', clientSrc.includes("' · 重置 ' + formatDateTime(w.resetsAt)"), true);
check('client hover 剩余用天级格式', clientSrc.includes("' · 剩余 ' + fmtResetCountdown(w.resetsAt - now)"), true);
check('client 订阅制模型组显示订阅服务名（subscriptionProviderGroup）', clientSrc.includes('groups.push(subscriptionProviderGroup())'), true);
check('client 订阅服务名映射含 OpenCode Go / Codex / ChatGPT', clientSrc.includes("return 'OpenCode Go'") && clientSrc.includes("return 'Codex'") && clientSrc.includes("return 'ChatGPT'"), true);
check('client 订阅制不显示余额', subFn.includes('余额 '), false);
check('client 订阅制不显示时段（高峰价/空闲价）', subFn.includes('高峰价'), false);
check('client 订阅制不显示距高峰倒计时', subFn.includes('距高峰'), false);
check('client 订阅制不显示本对话花费', subFn.includes('本对话 '), false);
check('client 订阅制不显示本对话 token 用量（subtok 已移除）', subFn.includes('subtok'), false);
check('client 刷新失败保留上次快照提示', clientSrc.includes('⚠ 刷新失败，显示上次快照'), true);

// ---- 7) host RPC 完整性静态检查 ----
check('host 含 getBillingMode RPC', hostSrc.includes('getBillingMode: function'), true);
check('host 含 getSubscriptionSnapshot RPC', hostSrc.includes('getSubscriptionSnapshot: function'), true);
check('host getConfig 含 billingMode', hostSrc.includes('billingMode: config.billingMode'), true);
check('host 双模式纯函数可提取（模块级）', typeof codexWindowKey === 'function' && typeof parseCodexUsage === 'function' && typeof parseOpenCodeGoUsage === 'function' && typeof detectBillingMode === 'function' && typeof mergeSubscriptionResult === 'function', true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
