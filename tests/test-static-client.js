// 静态 client（plugin/src/client-bundle.js）显示逻辑审计：
// ① 本对话花费始终显示——不再以 currentSession.tokens > 0 为门槛（新会话/对话刚开始显示 ¥0.000，
//    hover 仍可查看持久化的 今天/近一月/全部）；
// ② 原生统计行不再以 steps > 0 为门槛——完整模式下对话刚开始即显示 "0 轮 · 0 步"；
// ③ 密度切换仍为严格两态（props.density === 'full'）+ toggling 防抖（回归保护）。
// 用法：node tests/test-static-client.js
const fs = require('fs');

const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// 1) 本对话始终显示：无 tokens > 0 门槛
check('本对话块不再依赖 tokens > 0 门槛', !clientSrc.includes('usg.currentSession.tokens > 0'), true);
check('本对话块在 usg 存在时始终渲染', clientSrc.includes('const usg = state.usage;\n        if (usg) {'), true);
check('无记账时显示 ¥0.000 回退', clientSrc.includes("(bal && bal.currency === 'USD' ? '$' : '¥') + (0).toFixed(3)"), true);
check('hover 仍含 今天/近一月/全部', clientSrc.includes("'今天 ' + symbol + fmt(usg.todaySpend, 3)"), true);
check('hover 仍含 全部', clientSrc.includes("'全部 ' + symbol + fmt(usg.totalSpend, 3)"), true);

// 2) 原生统计行不再以 steps > 0 为门槛
check('原生统计行门槛改为 full && statsProj', clientSrc.includes('if (full && statsProj) {'), true);
check('原生统计行不含 steps > 0 门槛', !clientSrc.includes('statsProj.steps > 0'), true);

// 3) 密度两态 + 防抖回归保护
check('client 源码含 toggling 防抖', clientSrc.includes('toggling'), true);
check('client 源码含严格判定 === \'full\'', clientSrc.includes("props.density === 'full'"), true);
check('client 源码不含 !== \'compact\' 宽松判定', !clientSrc.includes("props.density !== 'compact'"), true);
check('client 源码 root onClick 绑定 onToggleDensity', clientSrc.includes('onClick: function () { props.onToggleDensity(); }'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
