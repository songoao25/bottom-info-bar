window.__ModuleLoader__.load({ id: "bottom-info-bar", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// Bottom Info Bar（底部信息栏插件）— client half（静态 bundle 形态）
// - host.call(method, args) → fetch POST /_dsh/bottom-info-bar/<method>（JSON）
// - ctx.interval / ctx.timeout → window.setInterval / window.setTimeout
// - styles.insert(css) → document 注入 <style>（installStyles）
// - React 由 bundle 的 require('react') 提供（seed 模块）
// 样式策略：① 只把数字加粗（.bi-num 700）② 服务商名加粗 ③ 高峰价琥珀色+加粗、空闲价绿色+加粗
// 显示行为：① 本对话花费始终显示——新会话/对话刚开始（尚无记账）时显示"本对话 ¥0.000"，
//   hover 仍可查看持久化的 今天/近一月/全部；
//   ② 完整模式下原生统计行无 steps 门槛，对话刚开始即显示"0 轮 · 0 步"。
'use strict';

const React = require('react');

const RPC_BASE = '/_dsh/bottom-info-bar';

// 排版优化（正式版）：完整模式下隐藏"首 token 平均 / tok/s"两个低优先级原生字段，
// 让原生统计行在 748px 对话宽度下单行放得下；hover 信息浮窗（title）仍显示全部原生信息。
const HIDE_SPEED_FIELDS = true;

function rpc(method, args) {
  return fetch(RPC_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (raw) {
        let body = null;
        try { body = JSON.parse(raw); } catch (e) { /* 非 JSON 错误体 */ }
        throw new Error((body && body.error) || ('HTTP ' + res.status));
      });
    }
    return res.text().then(function (raw) {
      try { return JSON.parse(raw); } catch (e) { throw new Error('响应解析失败'); }
    });
  });
}

function installStyles() {
  const id = 'bottom-info-bar';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
      .bi-root { text-align: center; max-width: var(--dsh-chat-content-width); box-sizing: border-box; width: 100%; padding: 4px calc(var(--dsh-composer-side-clearance) + 16px) 0px; margin: 0 auto; display: block; overflow: hidden; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-variant-numeric: tabular-nums; cursor: pointer; }
      .bi-native-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      .bi-row2 { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      .bi-native-row > span, .bi-row2 > span { white-space: nowrap; }
      .bi-sep { color: var(--dsw-alias-separator-primary, rgba(128,128,128,0.5)); margin: 0 8px; }
      /* 服务商名等一般强调：加粗 600 */
      .bi-root b { color: var(--dsw-alias-label-primary, #333); font-weight: 600; }
      /* 数字：加粗 700（余额/倒计时/本对话花费/原生统计数字） */
      .bi-root b.bi-num { font-weight: 700; }
      /* 高峰价：琥珀色 + 加粗；空闲价：绿色 + 加粗 */
      .bi-peak    { color: var(--dsw-alias-state-warn-primary, #d97706); font-weight: 700; }
      .bi-offpeak { color: var(--dsw-alias-state-success-primary, #16a34a); font-weight: 700; }
      .bi-err  { color: var(--dsw-alias-state-error-primary, #dc2626); }
      .bi-stale{ color: var(--dsw-alias-state-warn-primary, #d97706); }
    `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

module.exports = {
  inject: ['slots'],
  async apply(ctx) {
    // slots 服务可能晚于 apply 就绪：优先 ctx.slots（inject 注入属性），回退 ctx.get('slots')；
    // 仍不可用则轮询等待（最多 60×300ms ≈ 18s），绝不提前退出导致注册丢失
    let slots = ctx.slots || ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      slots = ctx.slots || ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[bottom-info-bar] slots 服务 18s 内未就绪，信息栏未注册');
      return;
    }

    ctx.effect(function () {
      const disposeStyles = installStyles();
      return function () { disposeStyles(); };
    }, 'bottom-info-bar: styles');

    // ---------- 注册：一体替换（同 id 'stats'） ----------
    let density = 'full';
    let toggling = false; // 防抖：rpc 异步期间禁止重复切换（只允许 full/compact 两态）
    let injectReady = false;
    let occupantDispose = null;

    function applyMode() {
      if (occupantDispose) { occupantDispose(); occupantDispose = null; }
      occupantDispose = slots.register(
        // 静态注册无动态沙箱的优先级自动分配：显式给低 priority（最低者渲染）以遮蔽原生 stats 栏（priority 0）
        { name: 'conversation.composer.dock', id: 'stats', priority: -1000 },
        function (slotProps) {
          return React.createElement(BottomInfoBar, Object.assign({}, slotProps, { density: density, onToggleDensity: onToggleDensity }));
        }
      );
    }

    function onToggleDensity() {
      if (toggling) return; // 切换进行中，忽略连点
      toggling = true;
      const next = density === 'full' ? 'compact' : 'full';
      rpc('setInfoDensity', { density: next }).then(function () {
        density = next;
        toggling = false;
        applyMode();
      }).catch(function (err) {
        toggling = false;
        console.error('Bottom Info Bar 切换信息密度失败', err);
      });
    }

    slots.inject('conversation.composer.dock', function () {
      injectReady = true;
      applyMode();
      return function () { if (occupantDispose) occupantDispose(); };
    });

    try {
      const cfg = await rpc('getConfig');
      if (cfg && (cfg.infoDensity === 'full' || cfg.infoDensity === 'compact') && cfg.infoDensity !== density) {
        density = cfg.infoDensity;
        if (injectReady) applyMode();
      }
    } catch (err) { /* 默认完整 */ }

    // ---------- 组件 ----------
    function BottomInfoBar(props) {
      // 原生/会话投影（hooks 无条件调用）
      const statsProj = props.useProjection ? props.useProjection('sessionStats') : undefined;
      const usageProj = props.useProjection ? props.useProjection('tokenUsage') : undefined;

      const [state, setState] = React.useState({
        loading: true, balance: null, pricing: null, usage: null, fatal: null,
      });
      const [now, setNow] = React.useState(Date.now());

      // 当前会话 ID 多路获取：slotProps 标准 kit → session 快照 → 运行时 sessions 服务
      // （DSH 各版本注入方式不同，任一路可用即拿到真实会话 ID，避免回退到上一会话的账）
      const propsRef = React.useRef(props);
      propsRef.current = props;
      const resolveSessionId = React.useCallback(function () {
        const p = propsRef.current;
        try {
          if (p.sessionId) return p.sessionId;
          if (p.session && p.session.sessionId) return p.session.sessionId;
          const sessions = ctx.get ? ctx.get('sessions') : null;
          const cur = sessions && sessions.list && sessions.list.getSnapshot().current;
          if (cur) return cur;
        } catch (e) { /* 拿不到则返回空串，host 端对空串返回 null（显示 ¥0.000） */ }
        return '';
      }, []);

      const load = React.useCallback(function () {
        const sessionId = resolveSessionId();
        Promise.all([
          rpc('getBalanceSnapshot'),
          rpc('getPricing'),
          rpc('getUsageSummary', { sessionId: sessionId }),
        ]).then(function (results) {
          setState({ loading: false, balance: results[0], pricing: results[1], usage: results[2], fatal: null });
        }).catch(function (err) {
          setState(function (s) {
            return { loading: false, balance: s.balance, pricing: s.pricing, usage: s.usage, fatal: String((err && err.message) || err) };
          });
        });
      }, [resolveSessionId]);

      React.useEffect(function () {
        load();
        const id = window.setInterval(load, 30000);
        return function () { window.clearInterval(id); };
      }, [load]);

      // 会话统计变化（回复中 turns/steps/tokens 增长，回复完成时停止）→ 防抖后即时刷新花费，
      // 不等下一个 30s 轮询：用户回复一结束即可看到真实金额
      React.useEffect(function () {
        if (!statsProj) return undefined;
        const timer = window.setTimeout(load, 800);
        return function () { window.clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [load,
        statsProj && statsProj.turns,
        statsProj && statsProj.steps,
        statsProj && statsProj.decodeTokens,
      ]);

      React.useEffect(function () {
        const id = window.setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { window.clearInterval(id); };
      }, []);

      // ---- 与原生一致格式工具 ----
      function formatTokens(n) {
        const scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
        if (n < 1e3) return String(n);
        if (n < 1e6) return scaled(n / 1e3) + 'K';
        return scaled(n / 1e6) + 'M';
      }
      function formatDuration(ms) {
        const s = ms / 1e3;
        if (s < 60) return Math.round(s * 10) / 10 + 's';
        const whole = Math.round(s);
        const sec = whole % 60;
        return Math.floor(whole / 60) + 'm' + String(sec).padStart(2, '0') + 's';
      }
      function formatTps(tps) {
        const clamped = Math.max(0, tps);
        return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
      }
      function billedInput(usage) {
        return (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
      }
      function fmt(n, digits) {
        if (n == null || isNaN(n)) return '—';
        return n.toFixed(digits == null ? 2 : digits);
      }
      function fmtCountdown(ms) {
        if (ms == null || ms <= 0) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const p = function (x) { return String(x).padStart(2, '0'); };
        return h > 0 ? h + 'h' + p(m) + 'm' : p(m) + ':' + p(s);
      }

      // 数字统一加粗（仅数字本身）
      function num(t) {
        return React.createElement('b', { className: 'bi-num' }, String(t));
      }

      const groups = [];
      const bal = state.balance;
      const alertActive = !!(bal && bal.alert && bal.alert.active);
      // 两态严格判定：density 只能是 'full' 或 'compact'（host 校验 + 本地防抖保证）
      const full = props.density === 'full';

      // ---- 统一顺序：服务商+模型 → 余额 → 高峰价/空闲价 → 距高峰/空闲 → 本对话(hover 今天/近一月/全部) ----
      if (state.fatal) {
        groups.push(React.createElement('span', { className: 'bi-err', key: 'fatal' }, '加载失败：' + state.fatal));
      } else if (state.loading) {
        groups.push(React.createElement('span', { key: 'loading' }, '加载中…'));
      } else {
        // 1) 服务商 + 具体模型（最左侧；纯显示，不拦截点击——点击冒泡到整条信息栏触发密度切换；hover 展示定价模式）
        const pr = state.pricing;
        const provLabel = (pr && pr.providerDisplay) ? pr.providerDisplay : '未知';
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : '未知模型');
        const provTitle = '服务商：' + provLabel + ' ' + modelLabel + '\n'
          + (pr && pr.mode === 'peak-valley' ? '定价：峰谷价（高峰 9-12、14-18 点）'
            : (pr && pr.mode === 'flat' ? '定价：固定价' : '定价：未收录，按默认计'));
        groups.push(React.createElement('span', {
          key: 'prov',
          title: provTitle,
        },
          React.createElement('b', null, provLabel),
          ' ',
          modelLabel,
        ));

        // 2) 余额（纯金额；hover 仅展示余额，不显示充值/赠金）
        if (bal && bal.error && bal.error.kind === 'no-key') {
          groups.push(React.createElement('span', { className: 'bi-err', key: 'nokey' },
            '未配置 DEEPSEEK_API_KEY → 设置→模型 填写'));
        } else if (bal && bal.data) {
          const symbol = bal.currency === 'USD' ? '$' : '¥';
          const balTitle = bal.estimate
            ? '余额为估算值（起始充值额减累计花费）：' + symbol + fmt(bal.data.total)
            : '余额：' + symbol + fmt(bal.data.total);
          groups.push(React.createElement('span', { key: 'bal', title: balTitle },
            '余额 ',
            num(symbol + fmt(bal.data.total)),
            bal.estimate ? React.createElement('span', { className: 'bi-stale' }, '（估算）') : null,
            alertActive ? React.createElement('span', { className: 'bi-err', title: '余额低于阈值' }, ' ⚠') : null,
          ));
          if (bal.error) {
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'balerr' }, '⚠ 刷新失败，显示上次快照'));
          }
        } else if (bal && bal.error) {
          groups.push(React.createElement('span', { className: 'bi-err', key: 'berr' }, '余额获取失败：' + bal.error.message));
        }

        // 2) 时段：仅峰谷价服务商显示"高峰价/空闲价"（flat/unknown 服务商不显示；hover 展示具体价格）
        if (pr && pr.mode === 'peak-valley') {
          const peakNow = pr.period === 'peak';
          const p = pr.prices || {};
          const periodTitle = (peakNow ? '高峰价' : '空闲价') + '：输入 ¥' + (p.inputCacheMiss != null ? p.inputCacheMiss : '?')
            + '/M · 缓存 ¥' + (p.inputCacheHit != null ? p.inputCacheHit : '?')
            + '/M · 输出 ¥' + (p.output != null ? p.output : '?') + '/M';
          groups.push(React.createElement('span', { key: 'period', className: peakNow ? 'bi-peak' : 'bi-offpeak', title: periodTitle },
            peakNow ? '高峰价' : '空闲价'));
        }

        // 3) 倒计时：仅峰谷价服务商显示"距高峰/距空闲"（hover 展示下次切换时刻；数字加粗）
        if (pr && pr.mode === 'peak-valley' && pr.nextSwitch) {
          const peakNow = pr.period === 'peak';
          const countdownTitle = '下次切换：' + (peakNow ? '空闲价' : '高峰价') + ' 于 ' + pr.nextSwitch.atLabel;
          groups.push(React.createElement('span', { key: 'countdown', title: countdownTitle },
            '距' + (peakNow ? '空闲' : '高峰') + ' ',
            num(fmtCountdown(pr.nextSwitch.at - now))));
        }

        // 6) 本对话花费（只显示钱；hover 浮窗显示 今天 / 近一月 / 全部；金额数字加粗）
        // 始终显示：新会话/对话刚开始尚无记账时显示 ¥0.000，hover 仍可查看持久化的 今天/近一月/全部
        const usg = state.usage;
        if (usg) {
          const cs = usg.currentSession;
          const costCNY = cs && cs.costs && cs.costs.CNY != null ? cs.costs.CNY : null;
          const costUSD = cs && cs.costs && cs.costs.USD != null ? cs.costs.USD : null;
          const zeroTxt = (bal && bal.currency === 'USD' ? '$' : '¥') + (0).toFixed(3);
          const costTxt = costCNY != null ? '¥' + costCNY.toFixed(3)
            : (costUSD != null ? '$' + costUSD.toFixed(3) : zeroTxt);
          const symbol = bal && bal.currency === 'USD' ? '$' : '¥';
          const today = usg.todaySpend != null ? '今天 ' + symbol + fmt(usg.todaySpend, 3) : '';
          const month = usg.monthSpend != null ? '近一月 ' + symbol + fmt(usg.monthSpend, 3) : '';
          const total = usg.totalSpend != null ? '全部 ' + symbol + fmt(usg.totalSpend, 3) : '';
          const detail = [today, month, total].filter(function (s) { return s.length > 0; }).join(' · ');
          groups.push(React.createElement('span', { key: 'convo', title: detail || '本对话花费' },
            '本对话 ',
            num(costTxt)));
        }
      }

      // ---- 组装 ----
      const sepNodes = [];
      const nodes = [];
      for (let i = 0; i < groups.length; i++) {
        if (i > 0) nodes.push(React.createElement('span', { key: 'sep' + i, className: 'bi-sep' }, '|'));
        nodes.push(React.createElement('span', { key: 'g' + i }, groups[i]));
      }
      const row2 = React.createElement('div', { className: 'bi-row2' }, ...nodes);

      let row1 = null;
      if (full && statsProj) {
        // 每组：{ nodes: React 节点数组（数字用 num 加粗）, text: 纯文本（title 用） }
        const ng = [];
        function group(parts, hidden) {
          const nodesArr = [];
          const texts = [];
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (typeof p === 'string') { nodesArr.push(p); texts.push(p); }
            else { nodesArr.push(p); texts.push(p.props.children); }
          }
          ng.push({ nodes: nodesArr, text: texts.join(''), hidden: !!hidden });
        }

        group([num(statsProj.turns), ' 轮 · ', num(statsProj.steps), ' 步']);

        const durations = [];
        if (statsProj.llmMs > 0) durations.push('LLM ', num(formatDuration(statsProj.llmMs)));
        if (statsProj.toolMs > 0) durations.push(' · 工具调用 ', num(formatDuration(statsProj.toolMs)));
        if (durations.length > 0) group(durations);

        const speeds = [];
        if (statsProj.ttftSteps > 0) speeds.push('首 token 平均 ', num(formatDuration(statsProj.ttftMs / statsProj.ttftSteps)));
        if (statsProj.decodeMs > 0) speeds.push(' · ', num(formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3))), ' tok/s');
        if (speeds.length > 0) group(speeds, HIDE_SPEED_FIELDS); // 不占可见版式，title 浮窗保留

        if (usageProj && (billedInput(usageProj) > 0 || (usageProj.outputTokens || 0) > 0)) {
          const denom = billedInput(usageProj);
          const hit = denom > 0 ? Math.round(((usageProj.cacheReadTokens || 0) / denom) * 100) : null;
          if (hit != null) group(['缓存命中 ', num(hit), '%']);
          group(['输入 ', num(formatTokens(billedInput(usageProj))), ' tok · 输出 ', num(formatTokens(usageProj.outputTokens || 0)), ' tok']);
        }

        const nativeLine = ng.map(function (g) { return g.text; }).join(' | ');
        const ngNodes = [];
        let visCount = 0;
        for (let i = 0; i < ng.length; i++) {
          if (ng[i].hidden) continue; // 隐藏分组不占版式（title 仍含其文本）
          if (visCount > 0) ngNodes.push(React.createElement('span', { key: 'nsep' + i, className: 'bi-sep' }, '|'));
          visCount++;
          ngNodes.push(React.createElement('span', { key: 'ng' + i }, ng[i].nodes));
        }
        row1 = React.createElement('div', { className: 'bi-native-row', title: nativeLine }, ...ngNodes);
      }

      const rootCls = 'bi-root';
      return React.createElement('div', {
        className: rootCls,
        onClick: function () { props.onToggleDensity(); },
        title: '单击切换 完整/简洁',
      }, row1, row2);
    }
  },
};

return module.exports;
} });
