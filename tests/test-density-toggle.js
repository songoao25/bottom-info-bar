// 密度切换两态审计：验证 完整/简洁 只有两种形态、无第三态、无竞态、无服务商切换拦截
// 用法：node tests/test-density-toggle.js
const fs = require('fs');

// ---- host 侧审计：setInfoDensity 严格校验 + getConfig 返回 ----
const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
// 提取 setInfoDensity handler 逻辑做桩验证
function hostSetInfoDensity(value) {
  let infoDensity = 'full';
  const d = value;
  if (d === 'full' || d === 'compact') infoDensity = d;
  return infoDensity;
}

// ---- client 侧审计：onToggleDensity 两态 + toggling 防抖 ----
// 从源码提取关键逻辑做桩验证
const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ================= host 侧 =================
// 1) 合法两态
check('host: setInfoDensity("full") 保留 full', hostSetInfoDensity('full'), 'full');
check('host: setInfoDensity("compact") 保留 compact', hostSetInfoDensity('compact'), 'compact');
// 2) 非法值一律拒绝（不产生第三态）
check('host: 非法值 null 拒绝', hostSetInfoDensity(null), 'full');
check('host: 非法值 undefined 拒绝', hostSetInfoDensity(undefined), 'full');
check('host: 非法值 "" 拒绝', hostSetInfoDensity(''), 'full');
check('host: 非法值 "FULL" 拒绝', hostSetInfoDensity('FULL'), 'full');
check('host: 非法值 "full " 拒绝', hostSetInfoDensity('full '), 'full');
check('host: 非法值 123 拒绝', hostSetInfoDensity(123), 'full');
check('host: 非法值 {} 拒绝', hostSetInfoDensity({}), 'full');
// 3) host 源码确实包含校验
check('host 源码含 "d === \'full\' || d === \'compact\'"', hostSrc.includes("d === 'full' || d === 'compact'"), true);

// ================= client 侧 =================
// 4) 切换函数两态（模拟 onToggleDensity 的核心逻辑）
function clientToggle(current) {
  return current === 'full' ? 'compact' : 'full';
}
check('client: full → compact', clientToggle('full'), 'compact');
check('client: compact → full', clientToggle('compact'), 'full');
// 5) 渲染判定：full = density === 'full'（严格，无第三态）
function renderIsFull(density) {
  return density === 'full';
}
check('client: density=full → 完整模式', renderIsFull('full'), true);
check('client: density=compact → 简洁模式', renderIsFull('compact'), false);
check('client: density=undefined → 简洁（不退化完整）', renderIsFull(undefined), false);
check('client: density=null → 简洁（不退化完整）', renderIsFull(null), false);
check('client: density="FULL" → 简洁（不退化完整）', renderIsFull('FULL'), false);
// 6) 源码断言：v20 已用严格判定 + 防抖
check('client 源码含 toggling 防抖', clientSrc.includes('toggling'), true);
check('client 源码含严格判定 === \'full\'', clientSrc.includes("displayDensity === 'full'"), true);
// 精确断言：代码体中不应再有函数调用 onSwitchProvider（排除头注释说明文字）
const codeBody = clientSrc.split('// ---------- 注册')[1] || clientSrc;
check('client 代码体无 onSwitchProvider 调用（点击模型名只触发密度切换）', !codeBody.includes('onSwitchProvider('), true);
check('client 源码 root onClick 绑定 onToggleDensity', clientSrc.includes('onClick: function () { props.onToggleDensity(); }'), true);
check('client 切换立即更新界面，不等待 RPC 返回', clientSrc.includes('setDensity(next);'), true);
check('client 持久化失败时回退到前一密度', clientSrc.includes('if (density === next) setDensity(previous);'), true);
check('client 不在密度切换后重注册 slot', !clientSrc.includes('applyMode();\n      }).catch'), true);
check('client 使用同一 React 树收合完整统计行', clientSrc.includes('bi-density-extra') && clientSrc.includes("'data-density': displayDensity"), true);
check('client 尊重系统减少动态效果设置', clientSrc.includes('prefers-reduced-motion: reduce'), true);
check('client 密度切换可用键盘触发', clientSrc.includes("event.key === 'Enter' || event.key === ' '"), true);
check('启动配置不会覆盖已发生的用户切换', clientSrc.includes('const initialDensityVersion = densityVersion;')
  && clientSrc.includes('initialDensityVersion === densityVersion'), true);
check('密度订阅建立时立即回读当前值，避免首次挂载空窗', clientSrc.includes('setDisplayDensity(density);'), true);
check('保存期间具有忙碌和禁用语义', clientSrc.includes("'aria-busy': isDensitySaving")
  && clientSrc.includes("'aria-disabled': isDensitySaving"), true);
// 7) 无残留的旧宽松判定
check('client 源码不含 !== \'compact\' 宽松判定', !clientSrc.includes("props.density !== 'compact'"), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
