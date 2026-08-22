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

// 4) 当前会话 ID 多路获取（修复：新对话显示上一会话金额）
check('client 优先读 props.sessionId', clientSrc.includes('if (p.sessionId) return p.sessionId;'), true);
check('client 回退读 props.session.sessionId', clientSrc.includes('if (p.session && p.session.sessionId) return p.session.sessionId;'), true);
check('client 回退读 ctx.get(sessions).current', clientSrc.includes("ctx.get ? ctx.get('sessions') : null"), true);
check('client 空值兜底返回空串（host 对空串返回 null）', clientSrc.includes("return '';"), true);

// 5) 回复完成即时刷新（不等 30s 轮询）
check('client 监听会话统计变化触发 load', clientSrc.includes('statsProj && statsProj.turns'), true);
check('client 防抖 800ms 刷新', clientSrc.includes('window.setTimeout(load, 800)'), true);

// 6) UI 语义：颜色不单独表达状态，正常额度和估算值不误用成功/警告色
check('估算余额使用中性说明色', clientSrc.includes("className: 'bi-muted'"), true);
check('正常订阅额度不使用绿色成功色', clientSrc.includes("remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : ''"), true);
check('高峰价使用主文字保证小字号可读', clientSrc.includes('.bi-peak    { color: var(--bi-label-primary); font-weight: 700; }'), true);
check('错误与警告保留语义色和字重', clientSrc.includes('.bi-err  { color: var(--bi-state-error); font-weight: 600; }')
  && clientSrc.includes('.bi-stale{ color: var(--bi-state-warning); font-weight: 600; }'), true);
check('报错标签统一延后到整行最右侧', clientSrc.includes('const trailingErrorGroups = []')
  && clientSrc.includes('trailingErrorGroups.push')
  && clientSrc.includes('groups.push(...trailingErrorGroups);'), true);

// 7) 视觉模型：仅 host 明确识别后展示，复刻参考图的实色靛蓝椭圆
check('视觉标识只接受 host 的显式 true，不通过名称猜测', clientSrc.includes("pr.acceptsImageInput !== true"), true);
check('服务商、圆点与视觉模型使用同一 flex 中心线，避免基线漂移', clientSrc.includes('.bi-model-group { display: inline-flex; align-items: center; height: 20px; vertical-align: top; }')
  && clientSrc.includes('.bi-model-provider, .bi-model-dot { display: inline-flex; align-items: center; height: 16px; line-height: 14px; }')
  && clientSrc.includes("className: 'bi-model-dot'"), true);
check('视觉模型名采用指定靛蓝紫实色椭圆、白字、深色细边且不超过文字字形边界', clientSrc.includes('.bi-vision {')
  && clientSrc.includes('height: 16px')
  && clientSrc.includes('border-radius: 999px')
  && clientSrc.includes('border: 1px solid #3730a3')
  && clientSrc.includes('color: #fff')
  && clientSrc.includes('background: #4f46e5'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
