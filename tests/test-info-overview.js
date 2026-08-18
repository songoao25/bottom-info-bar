// 信息概览页（v1.2.0）独立验收测试：
// ① host 新 RPC（getUsageRecords / getModelStats / getUsageSummary.currency）纯函数提取验证
//    —— 从 plugin/src/host.js 提取真实函数文本 + 桩闭包 eval，验证倒序/分页边界/聚合/占比；
// ② client（plugin/src/client-bundle.js）InfoOverviewPage 静态断言
//    —— 双入口注册 / 组件不读 slot props / 30s 轮询只刷 core 不刷 records / 各 FR 渲染要素。
// 用法：node tests/test-info-overview.js
const fs = require('fs');

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}
function checkApprox(label, actual, expected, eps) {
  const e = eps == null ? 1e-6 : eps;
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= e;
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + actual); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望≈' + expected + '（±' + e + '），实际 ' + actual); }
}

// ---------- 提取工具（括号计数法，参考 test-spend-accounting.js） ----------
function extractFunctionText(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到 function ' + name);
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
  return src.slice(start, i + 1);
}
function extractConstObject(src, name) {
  const start = src.indexOf('const ' + name + ' = {');
  if (start < 0) throw new Error('未找到 const ' + name);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart, inStr = null;
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
  return src.slice(start, i + 1);
}

// ---------- 用桩闭包重建 host 端新 RPC（真实源码函数，验证语义） ----------
function buildHostFns(stubRecords) {
  const defaultModel = (hostSrc.match(/const DEFAULT_MODEL = '([^']+)'/) || [])[1] || 'deepseek-v4-flash';
  const lines = [];
  lines.push('var usageRecords = ' + JSON.stringify(stubRecords) + ';');
  lines.push('var balances = {};');                                          // 无余额快照 → activeCurrency 走回退
  lines.push("var config = { activeProvider: 'deepseek' };");
  lines.push('var modelNameCache = {};');                                    // 目录名缓存空 → 回退原始 id
  lines.push('var providerNameCache = {};');                                 // 回退静态映射
  lines.push("var DEFAULT_MODEL = '" + defaultModel + "';");
  lines.push(extractConstObject(hostSrc, 'PROVIDER_DISPLAY') + ';');
  lines.push(extractConstObject(hostSrc, 'PRICING') + ';');
  lines.push(extractFunctionText(hostSrc, 'modelCurrency'));
  lines.push(extractFunctionText(hostSrc, 'beijingMinutes'));
  lines.push(extractFunctionText(hostSrc, 'currentPeriod'));
  lines.push(extractFunctionText(hostSrc, 'costOf'));
  lines.push(extractFunctionText(hostSrc, 'modelDisplayFromCache'));
  lines.push(extractFunctionText(hostSrc, 'providerDisplayFromCache'));
  lines.push(extractFunctionText(hostSrc, 'activeCurrency'));
  lines.push(extractFunctionText(hostSrc, 'getUsageRecords'));
  lines.push(extractFunctionText(hostSrc, 'getModelStats'));
  lines.push('return { getUsageRecords: getUsageRecords, getModelStats: getModelStats, costOf: costOf, modelCurrency: modelCurrency, activeCurrency: activeCurrency };');
  return eval('(function () {\n' + lines.join('\n') + '\n})()');
}

// ---------- 桩记录（乱序写入，含：同模型同服务商多条 / 同模型不同服务商 / 未知模型 / 跨币种） ----------
const stubRecords = [
  { ts: 5000, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's1', input: 100, cacheRead: 50, cacheWrite: 0, output: 200 },
  { ts: 1000, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's1', input: 300, cacheRead: 100, cacheWrite: 0, output: 400 },
  { ts: 3000, model: 'gpt-4o', provider: 'openai', sessionId: 's2', input: 1000, cacheRead: 0, cacheWrite: 0, output: 500 },
  { ts: 2000, model: 'unknown-model-xyz', provider: 'some-provider', sessionId: 's3', input: 10, cacheRead: 0, cacheWrite: 0, output: 20 },
  { ts: 4000, model: 'deepseek-v4-flash', provider: 'deepseek-official', sessionId: 's4', input: 50, cacheRead: 0, cacheWrite: 0, output: 100 },
  { ts: 6000, model: 'deepseek-chat', provider: 'deepseek', sessionId: 's5', input: 5, cacheRead: 5, cacheWrite: 5, output: 5 },
];
const fns = buildHostFns(stubRecords);

console.log('---- getUsageRecords：倒序 / 分页边界 / 字段 / 未知模型 ----');
const all = fns.getUsageRecords(undefined, undefined);
check('FR-3 默认 limit=20、offset=0', [all.offset, all.limit, all.total], [0, 20, 6]);
check('FR-3 默认返回全部 6 条（<20）', all.records.length, 6);
{
  const tsList = all.records.map(function (r) { return r.ts; });
  const sortedDesc = tsList.slice().sort(function (a, b) { return b - a; });
  check('FR-3 按 ts 倒序（最新在前，与数组写入顺序无关）', tsList, sortedDesc);
}
check('FR-3 倒序首位为最新记录 ts=6000', all.records[0].ts, 6000);
const p1 = fns.getUsageRecords(0, 2);
check('FR-3 limit=2 返回 2 条', p1.records.length, 2);
check('FR-3 limit=2 从最新开始', [p1.records[0].ts, p1.records[1].ts], [6000, 5000]);
const p2 = fns.getUsageRecords(2, 2);
check('FR-3 offset=2 跳过前 2 条', [p2.records[0].ts, p2.records[1].ts], [4000, 3000]);
const pOff = fns.getUsageRecords(999, 20);
check('FR-3 offset 越界 → 空数组且不抛错', [pOff.records.length, pOff.total], [0, 6]);
const pNeg = fns.getUsageRecords(-3, 20);
check('FR-3 offset 负数归零', [pNeg.offset, pNeg.records.length], [0, 6]);
const pLNeg = fns.getUsageRecords(0, -5);
check('FR-3 limit 负数 → 0 条', [pLNeg.limit, pLNeg.records.length], [0, 0]);
const pNan = fns.getUsageRecords('abc', 'xyz');
check('FR-3 非数字 offset/limit 回退默认（0/20）', [pNan.offset, pNan.limit, pNan.records.length], [0, 20, 6]);

// limit 上限 100（构造 120 条）
const many = [];
for (let i = 0; i < 120; i++) many.push({ ts: 2000000 + i, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 's' + i, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
const fnsMany = buildHostFns(many);
const p100 = fnsMany.getUsageRecords(0, 1000);
check('FR-3 limit 上限截断为 100', [p100.limit, p100.records.length, p100.total], [100, 100, 120]);
const p20 = fnsMany.getUsageRecords(0);
check('FR-3 记录 >20 时默认只取 20 条', [p20.limit, p20.records.length], [20, 20]);

// 字段完整性 + 与源记录逐条一致 + 费用复用 costOf
const sample = fns.getUsageRecords(0, 1).records[0]; // ts=6000 deepseek-chat
const requiredKeys = ['ts', 'model', 'provider', 'modelDisplay', 'providerDisplay', 'input', 'cacheRead', 'cacheWrite', 'output', 'cost', 'currency'];
check('FR-3 每条记录字段完整（11 字段）', requiredKeys.every(function (k) { return Object.prototype.hasOwnProperty.call(sample, k); }), true);
check('FR-3 记录与源一致（ts/model/tokens）', [sample.ts, sample.model, sample.input, sample.cacheRead, sample.cacheWrite, sample.output], [6000, 'deepseek-chat', 5, 5, 5, 5]);
check('FR-3 modelDisplay 回退原始 id（目录缓存空）', sample.modelDisplay, 'deepseek-chat');
check('FR-3 providerDisplay 静态映射 DeepSeek', sample.providerDisplay, 'DeepSeek');
const recChat = { ts: 6000, model: 'deepseek-chat', provider: 'deepseek', sessionId: 's5', input: 5, cacheRead: 5, cacheWrite: 5, output: 5 };
checkApprox('FR-3 费用复用 costOf（与信息栏同一算法）', sample.cost, fns.costOf(recChat), 1e-9);
check('FR-3 deepseek-chat 币种 CNY', sample.currency, 'CNY');
const gpt = all.records.filter(function (r) { return r.model === 'gpt-4o'; })[0];
check('FR-3 gpt-4o 币种 USD（各自币种）', gpt.currency, 'USD');
const unk = all.records.filter(function (r) { return r.model === 'unknown-model-xyz'; })[0];
check('FR-3 未知模型 cost=null（前端显示「—」）', unk.cost, null);
check('FR-3 未知模型仍返回 tokens', [unk.input, unk.output], [10, 20]);

console.log('---- getModelStats：聚合 / 排序 / 占比 / 空记录 ----');
const stats = fns.getModelStats();
check('FR-4 按 model+provider 聚合为 5 组', stats.models.length, 5);
const flashDs = stats.models.filter(function (m) { return m.model === 'deepseek-v4-flash' && m.provider === 'deepseek'; })[0];
check('FR-4 count 聚合（2 条）', flashDs.count, 2);
check('FR-4 tokens 聚合', [flashDs.input, flashDs.cacheRead, flashDs.cacheWrite, flashDs.output], [400, 150, 0, 600]);
const expectFlashCost = fns.costOf({ ts: 5000, model: 'deepseek-v4-flash', provider: 'deepseek', input: 100, cacheRead: 50, cacheWrite: 0, output: 200 })
  + fns.costOf({ ts: 1000, model: 'deepseek-v4-flash', provider: 'deepseek', input: 300, cacheRead: 100, cacheWrite: 0, output: 400 });
checkApprox('FR-4 cost 聚合（逐笔复用 costOf）', flashDs.cost, Math.round(expectFlashCost * 10000) / 10000, 1e-9);
const costs = stats.models.map(function (m) { return m.cost; });
check('FR-4 按 cost 降序排列', costs.every(function (c, i) { return i === 0 || costs[i - 1] >= c; }), true);
check('FR-4 未知模型排最后', costs[costs.length - 1], null);
const unkStat = stats.models[stats.models.length - 1];
check('FR-4 未知模型 costShare=null', unkStat.costShare, null);
check('FR-4 未知模型 tokens 仍聚合', [unkStat.count, unkStat.input, unkStat.output], [1, 10, 20]);
const shareSum = stats.models.reduce(function (acc, m) { return acc + (m.costShare == null ? 0 : m.costShare); }, 0);
checkApprox('FR-4 占比和 = 1（±0.001 舍入容差）', shareSum, 1, 0.001);
const billableSum = stats.models.reduce(function (acc, m) { return acc + (m.cost == null ? 0 : m.cost); }, 0);
checkApprox('FR-4 totalCost = 可计费模型之和', stats.totalCost, Math.round(billableSum * 10000) / 10000, 0.0002);
check('FR-4 totalCurrency = 活动币种（CNY）', stats.totalCurrency, 'CNY');
const flashOfficial = stats.models.filter(function (m) { return m.model === 'deepseek-v4-flash' && m.provider === 'deepseek-official'; })[0];
check('FR-4 同模型不同服务商分组聚合', [flashOfficial.count, flashOfficial.cost != null], [1, true]);
const emptyStats = buildHostFns([]).getModelStats();
check('FR-4 空记录容错', JSON.stringify(emptyStats), JSON.stringify({ models: [], totalCost: 0, totalCurrency: 'CNY' }));

console.log('---- getUsageSummary / activeCurrency ----');
check('FR-2 host getUsageSummary 返回 currency 字段（activeCurrency）', hostSrc.includes('currency: activeCurrency(),'), true);
check('FR-2 活动币种回退 DEFAULT_MODEL（CNY）', fns.activeCurrency(), 'CNY');

console.log('---- host 静态：FR-6 只读 RPC 不入 MUTATING ----');
const mutating = (hostSrc.match(/const MUTATING = \{([\s\S]*?)\};/) || [])[1] || '';
check('FR-6 getUsageRecords 不在 MUTATING（只读）', mutating.includes('getUsageRecords'), false);
check('FR-6 getModelStats 不在 MUTATING（只读）', mutating.includes('getModelStats'), false);
check('FR-6 getUsageSummary 不在 MUTATING（只读）', mutating.includes('getUsageSummary'), false);
check('FR-6 getSpendTrend 不在 MUTATING（只读）', mutating.includes('getSpendTrend'), false);
check('FR-6 新增 RPC 已注册路由', hostSrc.includes('getUsageRecords: function (args) {') && hostSrc.includes('getModelStats: function () {'), true);

console.log('---- client 静态：InfoOverviewPage + 双入口 + 渲染要素 ----');
function extractClientFn(name) {
  const start = clientSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('client 未找到 function ' + name);
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
const ov = extractClientFn('InfoOverviewPage');
check('FR-1 InfoOverviewPage 组件存在', clientSrc.includes('function InfoOverviewPage() {'), true);
check('FR-1 设置页入口（settings.section + id=info-overview + label=信息概览）', clientSrc.includes("name: 'settings.section', id: 'info-overview', order: 30, label: '信息概览'"), true);
check('FR-1 标签栏入口（conversation.view + id=info-overview + label=信息概览）', clientSrc.includes("name: 'conversation.view', id: 'info-overview', order: 30, label: '信息概览'"), true);
check('FR-1 slots.register 共 3 处（2 页面入口 + 1 信息栏 dock）', (clientSrc.match(/slots\.register\(/g) || []).length, 3);
check('FR-1 两入口渲染同一组件 InfoOverviewPage', (clientSrc.match(/React\.createElement\(InfoOverviewPage/g) || []).length, 2);
check('FR-1 注册 try/catch 隔离（设置页失败不影响标签栏）', clientSrc.includes('信息概览设置页入口注册失败'), true);
check('FR-1 注册 try/catch 隔离（标签栏失败不影响设置页）', clientSrc.includes('信息概览标签栏入口注册失败'), true);
check('FR-1 双入口注册纳入 ctx.effect（disposer 清理）', clientSrc.includes("'dsh-bottom-info-bar: info-overview entries'") && clientSrc.includes('disposers[i]();'), true);
check('FR-6 组件不读 slot props（无 props. 引用）', ov.includes('props.'), false);
check('FR-6 组件不读 slot props（无 slotProps 引用）', ov.includes('slotProps'), false);
check('FR-2 30s 轮询刷新（summary/trend/modelStats）', ov.includes('window.setInterval(loadCore, 30000)'), true);
check('FR-3 records 不参与轮询（setInterval 仅 1 处）', (ov.match(/window\.setInterval\(/g) || []).length, 1);
check('FR-3 records 仅首次加载 + 加载更多触发', ov.includes('loadRecords(0)') && ov.includes('loadRecords(records.records.length)'), true);
check('FR-2 总览卡四张（今日/本月/近30天/累计）', ['今日', '本月', '近30天', '累计'].every(function (s) { return ov.includes("'" + s + "'"); }), true);
check('FR-2 总览卡数据来自 getUsageSummary 四字段', ov.includes('summary.todaySpend') && ov.includes('summary.monthSpend') && ov.includes('summary.last30dSpend') && ov.includes('summary.totalSpend'), true);
check('FR-2 币种符号从 summary.currency 字段', ov.includes("(summary && summary.currency) || 'CNY'"), true);
check('FR-3 空态文案「暂无使用记录」+ 下一步说明', ov.includes("'暂无使用记录。开始对话后"), true);
check('FR-3 加载更多按钮（含剩余数）', ov.includes("'加载更多（'"), true);
check('FR-3 每批 limit=20', ov.includes('{ offset: offset, limit: 20 }'), true);
check('FR-3 未知模型费用显示「—」', ov.includes("r.cost == null ? '—'"), true);
check('FR-3 明细费用按各自币种符号', ov.includes('symbolFor(r.currency)'), true);
check('FR-4 占比条 width=costShare*100%', ov.includes('Math.round(m.costShare * 100)') && ov.includes("width: share + '%'"), true);
check('FR-5 7/30 天切换按钮', ov.includes("'近7天'") && ov.includes("'近30天'"), true);
check('FR-5 切换后重拉 getSpendTrend({days})', ov.includes("rpc('getSpendTrend', { days: trendDays })"), true);
check('FR-5 柱高按 spend/maxSpend 归一化', ov.includes('Math.round((pt.spend / maxSpend) * 100)'), true);
check('FR-5 每柱 title + aria-label', ov.includes("title: pt.label + ' 花费 '") && ov.includes("'aria-label': pt.label + ' 花费 '"), true);
check('FR-6 页面数据全部来自 rpc（组件内无直接 fetch）', ov.includes('fetch('), false);
check('FR-6 页面走本地 RPC_BASE 同源通道', clientSrc.includes("const RPC_BASE = '/_dsh/dsh-bottom-info-bar'"), true);

// ---- 缺陷回归锁定（D-2 / D-3 修复防回归） ----
check('D-2 新增 onRetry（整体重试）', ov.includes('function onRetry() {'), true);
check('D-2 重试按钮绑定 onRetry（不再只刷 core）', ov.includes('onClick: onRetry'), true);
check('D-2 onRetry 同时重拉 core 与 records（records=null 可恢复）', ov.includes('loadCore();\n        loadRecords(0);'), true);
check('D-2 loadRecords 失败进 fatal（不再永久「加载中」）', ov.includes('setLoading(false);\n          setFatal(String((err && err.message) || err));'), true);
check('D-3 模型行费用按各自币种符号（symbolFor(m.currency) 优先）', ov.includes('(symbolFor(m.currency) || sym)'), true);

// ---- UI 主题回归锁定（v1.2.2 修复：brand-primary/invert 同主题同值，选中态必须用语义色） ----
// 样式块位于 installOverviewStyles（顶层），用完整源码 clientSrc 检查
check('UI 选中态用系统交互语义色（interactive-bg-active 背景 + label-primary 文字）', clientSrc.includes('.bi-ov-btn.active { background: var(--dsw-alias-interactive-bg-active') && clientSrc.includes('color: var(--dsw-alias-label-primary, #1f2329); font-weight: 600;'), true);
check('UI 选中态不再用品牌色做底/字（brand-primary 与 invert 同主题同值会同色）', !clientSrc.includes('.bi-ov-btn.active { background: var(--dsw-alias-brand-primary'), true);
check('UI 选中态不再硬编码 color: #fff', !clientSrc.includes('.bi-ov-btn.active { background: var(--dsw-alias-brand-primary, #4d6bfe); color: #fff;'), true);
check('UI 分段控件容器（HIG：7/30 天切换为相关选项组）', clientSrc.includes('.bi-ov-toolbar { display: inline-flex') && clientSrc.includes('border-radius: 8px; overflow: hidden;'), true);
check('UI 分段控件段间分隔线', clientSrc.includes('.bi-ov-toolbar .bi-ov-btn + .bi-ov-btn { border-left:'), true);
check('UI 按钮最小触控高度 28px（macOS HIG 最小控制尺寸）', clientSrc.includes('min-height: 28px'), true);
check('UI 按钮补 hover 反馈（系统交互 hover 色）', clientSrc.includes('.bi-ov-btn:hover { background: var(--dsw-alias-interactive-bg-hover'), true);
check('UI 按钮补焦点态（无障碍）', clientSrc.includes('.bi-ov-btn:focus-visible'), true);
check('UI 可见版面不含区间合计文字（用户反馈多余，已移除）', !clientSrc.includes("'合计 ' + sym + fmtMoney(trendTotal)") && !clientSrc.includes('.bi-ov-toolbar-total'), true);
check('UI 图表容器保留 aria-label 无障碍描述（读屏用，不占版面）', clientSrc.includes("'aria-label': '近' + trendDays + '天每日花费柱状图'"), true);
check('UI 空态给下一步说明（HIG 写作规范）', clientSrc.includes('开始对话后，每一笔 AI 调用的费用与 token 都会自动记录在这里'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
