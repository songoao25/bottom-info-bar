// 静态 client（plugin/src/client-bundle.js）显示逻辑审计：
// ① 本对话花费始终显示——不再以 currentSession.tokens > 0 为门槛（新会话/对话刚开始显示 ¥0.000，
//    hover 仍可查看持久化的 今天/近一月/全部）；
// ② 原生统计行不再以 steps > 0 为门槛——完整模式下对话刚开始即显示 "0 轮 · 0 步"；
//    简洁模式中该行保留在 DOM 内，以连续收合动画隐藏。
// ③ 密度切换仍为严格两态（displayDensity === 'full'）+ toggling 防抖（回归保护）。
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

// 2) 原生统计行不再以 steps > 0 为门槛；简洁模式下保留 DOM 供动画收合
check('原生统计行由 statsProj 驱动，简洁模式保留 DOM 以支持收合', clientSrc.includes('if (statsProj) {')
  && clientSrc.includes("className: 'bi-density-extra'"), true);
check('原生统计行不含 steps > 0 门槛', !clientSrc.includes('statsProj.steps > 0'), true);

// 3) 密度两态 + 防抖回归保护
check('client 源码含 toggling 防抖', clientSrc.includes('toggling'), true);
check('client 源码含严格判定 === \'full\'', clientSrc.includes("displayDensity === 'full'"), true);
check('client 源码不含 !== \'compact\' 宽松判定', !clientSrc.includes("props.density !== 'compact'"), true);
check('client 源码 root onClick 绑定 onToggleDensity', clientSrc.includes('onClick: function () { props.onToggleDensity(); }'), true);
check('client 切换同时支持键盘，语义为按钮', clientSrc.includes("role: 'button'")
  && clientSrc.includes('onKeyDown: function (event)'), true);
check('可交互信息栏不允许选中文本，避免点击时出现正文选择态', clientSrc.includes('user-select: none')
  && clientSrc.includes('-webkit-user-select: none'), true);

// 4) 当前会话 ID 多路获取（修复：新对话显示上一会话金额）
check('client 优先读 props.sessionId', clientSrc.includes('if (p.sessionId) return p.sessionId;'), true);
check('client 回退读 props.session.sessionId', clientSrc.includes('if (p.session && p.session.sessionId) return p.session.sessionId;'), true);
check('client 回退读 ctx.get(sessions).current', clientSrc.includes("ctx.get ? ctx.get('sessions') : null"), true);
check('client 空值兜底返回空串（host 对空串返回 null）', clientSrc.includes("return '';"), true);

// 5) 回复完成即时刷新（不等 30s 轮询）
check('client 监听会话统计变化触发 load', clientSrc.includes('statsProj && statsProj.turns'), true);
check('client 防抖 800ms 刷新', clientSrc.includes('window.setTimeout(load, 800)'), true);

// 6) UI 语义：颜色不单独表达状态，正常额度和估算值不误用成功/警告色
check('浅色普通信息与估算说明使用高对比深灰，三级文字仅用于分隔符', clientSrc.includes('--bi-label-supporting: #3f444a')
  && clientSrc.includes('color: var(--bi-label-supporting)')
  && clientSrc.includes('.bi-muted{ color: var(--bi-label-supporting); }')
  && clientSrc.includes('--bi-separator: var(--dsw-alias-label-tertiary'), true);
check('估算余额使用中性说明色', clientSrc.includes("className: 'bi-muted'"), true);
check('正常订阅额度不使用绿色成功色', clientSrc.includes("remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : ''"), true);
check('高峰价与低余额共用警示红；状态标签用 600，避免与关键数值争夺层级', clientSrc.includes('.bi-peak    { color: var(--bi-state-alert); font-weight: 600; }'), true);
check('空闲价为浅色与深色主题分别使用高对比绿色', clientSrc.includes('--bi-state-price-low: #087f5b')
  && clientSrc.includes('--bi-state-price-low: #86efac'), true);
check('低余额、低额度、刷新失败和阻断错误为浅色与深色主题分别使用高对比红色', clientSrc.includes('--bi-state-alert: #d92d20')
  && clientSrc.includes('--bi-state-alert: #ff6961')
  && clientSrc.includes('.bi-err, .bi-stale { color: var(--bi-state-alert); font-weight: 600; }')
  && clientSrc.includes('.bi-root b.bi-alert-num, .bi-root b.bi-quota-low { color: var(--bi-state-alert); font-weight: 700; }'), true);
check('主题颜色以 DSH 实际外观属性切换，并在增强对比度下提供独立色阶', clientSrc.includes('body[data-ds-dark-theme] .bi-root')
  && clientSrc.includes('@media (prefers-contrast: more)')
  && clientSrc.includes('--bi-state-price-low: #05603a')
  && clientSrc.includes('--bi-state-alert: #ff7770'), true);
check('低余额和低额度使用无框“低”字，状态不只依赖颜色且不制造额外视觉焦点', !clientSrc.includes('⚠')
  && clientSrc.includes('.bi-low-status { margin-left: 3px; color: var(--bi-state-alert); font-weight: 600; }')
  && !clientSrc.includes('bi-low-badge')
  && clientSrc.includes("alertActive ? React.createElement('span', { className: 'bi-low-status' }, '低')")
  && clientSrc.includes("key: 'low' + i, className: 'bi-low-status' }, '低'"), true);
check('外部分组为 6px、标签与数据为 4px、模型内部圆点为 4px，层级清晰而不过松', clientSrc.includes('.bi-sep { color: var(--bi-separator); margin: 0 6px; }')
  && clientSrc.includes('.bi-metric-data { margin-left: 4px; }')
  && clientSrc.includes('.bi-model-dot { margin: 0 4px; flex: 0 0 auto; }'), true);
check('数值语法统一：数值与紧随单位/货币符号整体加粗，中文数值与量词留白，标签保持常规字重', clientSrc.includes("metric('余额', symbol + fmt(bal.data.total)")
  && clientSrc.includes("num(formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s')")
  && clientSrc.includes("group([num(statsProj.turns + ' 轮'), ' · ', num(statsProj.steps + ' 步')])")
  && clientSrc.includes("group([metric('输入', formatTokens(billedInput(usageProj)) + ' tok')"), true);
check('标签与数据通过 metric 组件统一 4px 边界，不依赖普通字符空格', clientSrc.includes("function metric(label, value, extraClass)")
  && clientSrc.includes("metric('余额', symbol + fmt(bal.data.total)")
  && clientSrc.includes("metric('本对话', costTxt)")
  && clientSrc.includes("metric('缓存命中', hit + '%')"), true);
check('超长模型名不会被根容器裁切：模型详情可整体换行，视觉胶囊保留能力词并省略过长型号', !clientSrc.includes('display: block; overflow: hidden; font-size: 12px')
  && clientSrc.includes('.bi-row2 > .bi-model-group { white-space: normal; }')
  && clientSrc.includes('.bi-model-detail { display: inline-flex;')
  && clientSrc.includes('.bi-vision-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; }')
  && clientSrc.includes("React.createElement('span', { className: 'bi-vision-kind' }, '视觉')"), true);
check('整条信息栏的读屏名称引用当前可见信息，切换操作作为独立说明而不覆盖内容', !clientSrc.includes("'aria-label': full ? '切换为简洁模式'")
  && clientSrc.includes("'aria-labelledby': full && row1 !== null ? 'dsh-bottom-info-bar-native dsh-bottom-info-bar-primary' : 'dsh-bottom-info-bar-primary'")
  && clientSrc.includes("'aria-describedby': 'dsh-bottom-info-bar-action'")
  && clientSrc.includes("id: 'dsh-bottom-info-bar-action'")
  && clientSrc.includes("className: 'bi-sr-only'"), true);
check('报错标签统一延后到居中信息组的末尾', clientSrc.includes('const trailingErrorGroups = []')
  && clientSrc.includes('trailingErrorGroups.push')
  && clientSrc.includes("const row2 = React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2' }, ...nodes);"), true);
check('多个刷新失败合并为一个右侧标签', clientSrc.includes('const seenRefreshFailure = { value: false };')
  && clientSrc.includes("if (text !== '刷新失败') return true;"), true);
check('状态说明维持原生悬浮提示，不额外引入读屏文案', !clientSrc.includes("'aria-label': title")
  && !clientSrc.includes("'aria-label': modelLabel"), true);

// 7) 视觉模型：仅 host 明确识别后展示，复刻参考图的实色靛蓝椭圆
check('视觉标识只接受 host 的显式 true，不通过名称猜测', clientSrc.includes("pr.acceptsImageInput !== true"), true);
check('服务商、圆点与视觉模型使用同一 flex 中心线，窄宽度下可作为完整单元换行', clientSrc.includes('.bi-model-group { display: inline-flex; align-items: center; justify-content: center; flex-wrap: wrap; max-width: 100%; min-width: 0; min-height: 20px; vertical-align: top; }')
  && clientSrc.includes('.bi-model-provider, .bi-model-dot { display: inline-flex; align-items: center; height: 16px; line-height: 14px; }')
  && clientSrc.includes("function modelDetail(pr, modelName)")
  && clientSrc.includes("className: 'bi-model-dot'"), true);
check('视觉模型名采用高对比电光蓝实色椭圆、白字、深色细边且不超过文字字形边界', clientSrc.includes('.bi-vision {')
  && clientSrc.includes('height: 16px')
  && clientSrc.includes('border-radius: 999px')
  && clientSrc.includes('border: 1px solid #0044cc')
  && clientSrc.includes('color: #fff')
  && clientSrc.includes('background: #0057ff'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
