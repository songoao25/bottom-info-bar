// Bottom Info Bar（底部信息栏插件）— client half（静态 bundle 形态）
// - host.call(method, args) → fetch POST /_dsh/dsh-bottom-info-bar/<method>（JSON）
// - ctx.interval / ctx.timeout → window.setInterval / window.setTimeout
// - styles.insert(css) → document 注入 <style>（installStyles）
// - React 由 bundle 的 require('react') 提供（seed 模块）
// 样式策略：① 只把数字加粗（.bi-num 700）② 服务商名加粗 ③ 高峰价琥珀色+加粗、空闲价绿色+加粗
// 显示行为：① 本对话花费始终显示——新会话/对话刚开始（尚无记账）时显示"本对话 ¥0.000"，
//   hover 仍可查看持久化的 今天/近一月/全部；
//   ② 完整模式下原生统计行无 steps 门槛，对话刚开始即显示"0 轮 · 0 步"。
'use strict';

const React = require('react');

const RPC_BASE = '/_dsh/dsh-bottom-info-bar';

// 排版优化（正式版）：完整模式下隐藏"首 token 平均 / tok/s"两个低优先级原生字段，
// 让原生统计行在 748px 对话宽度下单行放得下；hover 信息浮窗（title）仍显示全部原生信息。
const HIDE_SPEED_FIELDS = true;
// 订阅窗口预警阈值：任一窗口已用百分比 ≥ 该值 → 红色 ⚠（与 host 常量保持一致）
const WINDOW_ALERT_PERCENT = 90;

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
  const id = 'dsh-bottom-info-bar';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
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

// 信息概览页独立样式块（.bi-ov-* 前缀，与信息栏 .bi-* 互不干扰；全部主题 token + fallback）
function installOverviewStyles() {
  const id = 'dsh-bottom-info-bar-overview';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
      .bi-ov-root { max-width: var(--dsh-chat-content-width); margin: 0 auto; padding: 16px calc(var(--dsh-composer-side-clearance) + 16px) 32px; box-sizing: border-box; color: var(--dsw-alias-label-primary, #1f2329); font-size: 13px; line-height: 1.6; overflow-y: auto; }
      .bi-ov-title { font-size: 17px; font-weight: 700; margin: 0 0 16px; }
      .bi-ov-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
      .bi-ov-kpi { flex: 1 1 140px; min-width: 120px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06)); border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18)); border-radius: 10px; padding: 12px 14px; box-sizing: border-box; }
      .bi-ov-kpi-label { font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); }
      .bi-ov-kpi-value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 4px; }
      .bi-ov-section { font-size: 15px; font-weight: 600; margin: 24px 0 10px; }
      .bi-ov-chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding: 8px 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18)); box-sizing: border-box; }
      .bi-ov-col { flex: 1 1 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; min-width: 0; }
      .bi-ov-bar { width: 100%; max-width: 26px; background: var(--dsw-alias-brand-primary, #4d6bfe); border-radius: 3px 3px 0 0; min-height: 2px; transition: opacity 0.15s; }
      .bi-ov-col:hover .bi-ov-bar { opacity: 0.75; }
      .bi-ov-axis { font-size: 10px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); margin-top: 4px; white-space: nowrap; transform: scale(0.9); transform-origin: top center; }
      /* 分段控件（macOS HIG）：容器圆角 + 选中段语义色背景 + 主文字色，任何主题都有对比度。
         关键：brand-primary/brand-primary-invert 在同一主题下同值，绝不能用作选中态底/字；
         必须用 interactive-bg-active（浅色浅灰蓝底/深色浅灰底）配 label-primary。 */
      .bi-ov-toolbar { display: inline-flex; gap: 0; margin-bottom: 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)); }
      .bi-ov-btn { font-size: 13px; padding: 4px 14px; min-height: 28px; border: none; background: transparent; color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); cursor: pointer; transition: background 0.12s, color 0.12s; }
      .bi-ov-toolbar .bi-ov-btn + .bi-ov-btn { border-left: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); }
      .bi-ov-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.06)); }
      .bi-ov-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; }
      .bi-ov-btn.active { background: var(--dsw-alias-interactive-bg-active, rgba(38,49,72,0.1)); color: var(--dsw-alias-label-primary, #1f2329); font-weight: 600; }
      .bi-ov-btn.active:hover { background: var(--dsw-alias-interactive-bg-active, rgba(38,49,72,0.1)); }
      .bi-ov-toolbar-total { align-self: center; margin-left: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); font-variant-numeric: tabular-nums; }
      .bi-ov-model { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.1)); }
      .bi-ov-model:nth-child(odd) { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.03)); }
      .bi-ov-model-name { flex: 0 0 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .bi-ov-model-meta { flex: 1; min-width: 0; }
      .bi-ov-model-bar { height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12)); overflow: hidden; margin: 3px 0; }
      .bi-ov-model-fill { height: 100%; background: var(--dsw-alias-brand-primary, #4d6bfe); border-radius: 4px; }
      .bi-ov-model-cost { flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
      .bi-ov-record { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 7px 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.1)); align-items: baseline; }
      .bi-ov-record:nth-child(odd) { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.03)); }
      .bi-ov-record-time { flex: 0 0 92px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); font-variant-numeric: tabular-nums; }
      .bi-ov-record-model { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bi-ov-record-provider { color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.75)); font-size: 12px; }
      .bi-ov-record-tokens { color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); font-variant-numeric: tabular-nums; }
      .bi-ov-record-cost { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
      .bi-ov-loadmore { margin: 14px auto 0; display: block; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); border-radius: 8px; padding: 6px 18px; min-height: 32px; font-size: 13px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)); color: var(--dsw-alias-label-primary, #1f2329); cursor: pointer; }
      .bi-ov-loadmore:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.08)); }
      .bi-ov-err { color: var(--dsw-alias-state-error-primary, #dc2626); padding: 12px; text-align: center; }
      .bi-ov-empty { color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); padding: 24px; text-align: center; }
      .bi-ov-loading { color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9)); padding: 24px; text-align: center; }
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
      console.warn('[dsh-bottom-info-bar] slots 服务 18s 内未就绪，信息栏未注册');
      return;
    }

    ctx.effect(function () {
      const disposeStyles = installStyles();
      const disposeOverviewStyles = installOverviewStyles();
      return function () { disposeStyles(); disposeOverviewStyles(); };
    }, 'dsh-bottom-info-bar: styles');

    // ---------- 信息概览页双入口（设置页 + 对话页顶部标签栏，渲染同一组件） ----------
    // 注册失败只告警、绝不影响信息栏本体；disposer 纳入 effect 清理，卸载自动移除
    ctx.effect(function () {
      const disposers = [];
      try {
        disposers.push(slots.register(
          { name: 'settings.section', id: 'info-overview', order: 30, label: '信息概览' },
          function (slotProps) { return React.createElement(InfoOverviewPage, slotProps); }
        ));
      } catch (err) { console.warn('[dsh-bottom-info-bar] 信息概览设置页入口注册失败', err); }
      try {
        disposers.push(slots.register(
          { name: 'conversation.view', id: 'info-overview', order: 30, label: '信息概览' },
          function (slotProps) { return React.createElement(InfoOverviewPage, slotProps); }
        ));
      } catch (err) { console.warn('[dsh-bottom-info-bar] 信息概览标签栏入口注册失败', err); }
      return function () {
        for (let i = 0; i < disposers.length; i++) {
          try { disposers[i](); } catch (err) { /* 清理失败静默 */ }
        }
      };
    }, 'dsh-bottom-info-bar: info-overview entries');

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
        loading: true, balance: null, pricing: null, usage: null, billingMode: null, sub: null, fatal: null,
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
          rpc('getBillingMode'),
          rpc('getSubscriptionSnapshot'),
        ]).then(function (results) {
          setState({ loading: false, balance: results[0], pricing: results[1], usage: results[2], billingMode: results[3], sub: results[4], fatal: null });
        }).catch(function (err) {
          setState(function (s) {
            return { loading: false, balance: s.balance, pricing: s.pricing, usage: s.usage, billingMode: s.billingMode, sub: s.sub, fatal: String((err && err.message) || err) };
          });
        });
      }, [resolveSessionId]);

      React.useEffect(function () {
        load();
        const id = window.setInterval(load, 30000);
        return function () { window.clearInterval(id); };
      }, [load]);

      // 模型/服务商切换秒级同步：getBillingMode 为 host 端纯本地计算（零网络开销），每 2 秒轮询一次；
      // mode/provider/model 任一变化（即切换了模型/服务商）→ 立即完整 load()，不等 30s 主轮询。
      // 注意：本轮询不触碰订阅接口——getSubscriptionSnapshot 仍仅由 load 调用（惰性门控 + 60s 周期不变）
      React.useEffect(function () {
        let lastKey = null;
        const id = window.setInterval(function () {
          rpc('getBillingMode').then(function (bm) {
            if (!bm || typeof bm.mode !== 'string') return;
            const key = bm.mode + ':' + (bm.provider || '') + ':' + (bm.model || '');
            if (lastKey !== null && lastKey !== key) load();
            lastKey = key;
          }).catch(function () { /* 轮询失败静默：30s 主轮询兜底 */ });
        }, 2000);
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
      // 订阅窗口重置时刻（本地时区，hover 浮窗用）
      function formatDateTime(ms) {
        const d = new Date(ms);
        const p = function (x) { return String(x).padStart(2, '0'); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      }
      // 订阅窗口重置倒计时（天级格式）：≥1 天 → '1d 21h'；≥1 小时 → '3h 12m'；<1 小时 → '12:34'
      function fmtResetCountdown(ms) {
        if (ms == null || ms <= 0) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        return String(m).padStart(2, '0') + ':' + String(totalSec % 60).padStart(2, '0');
      }

      // 订阅窗口剩余百分比（剩余 = 100 - 已用；钳制 ≥0 防接口异常值）
      function remainingPercent(w) {
        return Math.max(0, 100 - w.usedPercent);
      }
      // 订阅窗口紧凑行标签（5小时 → '5h'，周 → '周'，月 → '月'）；hover 明细仍用完整标签
      function compactWindowLabel(key) {
        if (key === 'five_hour') return '5h';
        if (key === 'seven_day') return '周';
        if (key === 'monthly') return '月';
        return '窗口';
      }

      // 数字统一加粗（仅数字本身）
      function num(t) {
        return React.createElement('b', { className: 'bi-num' }, String(t));
      }

      // 服务商 + 具体模型（两种模式共用；纯显示，不拦截点击——点击冒泡到整条信息栏触发密度切换；hover 展示定价模式）
      // M5：模型名/服务商名均取 DSH 目录名（与模型切换器完全一致）；当服务商名已是模型名前缀
      // （如 "DeepSeek" + "DeepSeek-V4-Flash"）→ 只显示模型名（切换器样式，避免 "DeepSeek · DeepSeek-V4-Flash" 重复）
      function providerGroup() {
        const pr = state.pricing;
        const provLabel = (pr && pr.providerDisplay) ? pr.providerDisplay : '未知';
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : '未知模型');
        const redundant = provLabel.length > 1 && modelLabel.toLowerCase().indexOf(provLabel.toLowerCase()) === 0;
        const provTitle = '服务商：' + provLabel + ' ' + modelLabel + '\n'
          + (pr && pr.mode === 'peak-valley' ? '定价：峰谷价（高峰 9-12、14-18 点）'
            : (pr && pr.mode === 'flat' ? '定价：固定价' : '定价：未收录，按默认计'));
        if (redundant) {
          return React.createElement('span', { key: 'prov', title: provTitle },
            React.createElement('b', null, modelLabel));
        }
        return React.createElement('span', { key: 'prov', title: provTitle },
          React.createElement('b', null, provLabel),
          ' ',
          modelLabel,
        );
      }

      // 订阅服务名（订阅制模式下"服务商"指订阅服务本身，不是模型厂商）
      // Codex 与 ChatGPT 已合并：实际 provider openai-codex / chatgpt 均显示 ChatGPT；codex 保持 Codex
      function subscriptionServiceName(provider) {
        if (provider === 'chatgpt' || provider === 'openai-codex') return 'ChatGPT';
        if (provider === 'codex') return 'Codex';
        if (provider === 'opencode-go' || provider === 'opencode') return 'OpenCode Go';
        return '订阅';
      }

      // 订阅制模型组：订阅服务名 · 具体模型（如 `OpenCode Go · V4 Flash`、`Codex · GPT 5 Codex`）
      function subscriptionProviderGroup() {
        const pr = state.pricing;
        const serviceName = subscriptionServiceName(state.billingMode && state.billingMode.provider);
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : '未知模型');
        const title = '订阅服务：' + serviceName + '\n模型：' + modelLabel;
        return React.createElement('span', { key: 'subprov', title: title },
          React.createElement('b', null, serviceName),
          ' · ',
          modelLabel,
        );
      }

      // ---- 余额制模式（v1.0.0 现状，完全不动）：服务商+模型 → 余额 → 时段 → 倒计时 → 本对话花费 ----
      function pushBalanceGroups(groups) {
        const bal = state.balance;
        const alertActive = !!(bal && bal.alert && bal.alert.active);
        groups.push(providerGroup());

        // 余额（纯金额；hover 仅展示余额，不显示充值/赠金）
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
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'balerr', title: '余额接口暂时不可用，已保留最近一次成功的数据；60 秒后自动重试' }, '⚠ 刷新失败，显示上次快照'));
          }
        } else if (bal && bal.error) {
          groups.push(React.createElement('span', { className: 'bi-err', key: 'berr' }, '余额获取失败：' + bal.error.message));
        }

        // 时段：仅峰谷价服务商显示"高峰价/空闲价"（flat/unknown 服务商不显示；hover 展示具体价格）
        const pr = state.pricing;
        if (pr && pr.mode === 'peak-valley') {
          const peakNow = pr.period === 'peak';
          const p = pr.prices || {};
          const periodTitle = (peakNow ? '高峰价' : '空闲价') + '：输入 ¥' + (p.inputCacheMiss != null ? p.inputCacheMiss : '?')
            + '/M · 缓存 ¥' + (p.inputCacheHit != null ? p.inputCacheHit : '?')
            + '/M · 输出 ¥' + (p.output != null ? p.output : '?') + '/M';
          groups.push(React.createElement('span', { key: 'period', className: peakNow ? 'bi-peak' : 'bi-offpeak', title: periodTitle },
            peakNow ? '高峰价' : '空闲价'));
        }

        // 倒计时：仅峰谷价服务商显示"距高峰/距空闲"（hover 展示下次切换时刻；数字加粗）
        if (pr && pr.mode === 'peak-valley' && pr.nextSwitch) {
          const peakNow = pr.period === 'peak';
          const countdownTitle = '下次切换：' + (peakNow ? '空闲价' : '高峰价') + ' 于 ' + pr.nextSwitch.atLabel;
          groups.push(React.createElement('span', { key: 'countdown', title: countdownTitle },
            '距' + (peakNow ? '空闲' : '高峰') + ' ',
            num(fmtCountdown(pr.nextSwitch.at - now))));
        }

        // 本对话花费（只显示钱；hover 浮窗显示 今天 / 近一月 / 全部；金额数字加粗）
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

      // ---- 订阅制模式（互斥替换余额制版，row2 只三类信息）：
      //      订阅服务+模型 → 三窗口额度 → 距重置倒计时（最紧窗口）；余额/时段/花费/token 均不显示 ----
      function pushSubscriptionGroups(groups) {
        groups.push(subscriptionProviderGroup());
        const sub = state.sub;
        if (!sub) {
          groups.push(React.createElement('span', { key: 'subload' }, '订阅额度加载中…'));
          return;
        }
        const rawWindows = Array.isArray(sub.windows) ? sub.windows : [];
        const windows = rawWindows.filter(function (w) {
          return w && typeof w.usedPercent === 'number';
        });
        const hasData = windows.length > 0;
        // 错误分支：无旧数据时给出明确引导 / 错误文案；有旧数据时走下方渲染并附"刷新失败"标记。
        // no-key（无令牌/缺 access_token）与 auth（令牌失效 401）→ 统一"未绑定/重新绑定"引导——
        // 令牌由独立插件 dsh-chatgpt-subscription 维护，本插件只读令牌显示额度，不自行绑定/续期
        if (sub.error && !hasData) {
          if (sub.error.kind === 'no-key' || sub.error.kind === 'auth') {
            const hint = sub.source === 'opencode-go'
              ? '未配置 OpenCode Go → 设置→模型 填写 OPENCODE_GO_API_KEY'
              : '未绑定 ChatGPT 订阅 → 安装 dsh-chatgpt-subscription 插件授权绑定';
            groups.push(React.createElement('span', { className: 'bi-err', key: 'subnokey' }, hint));
          } else {
            groups.push(React.createElement('span', { className: 'bi-err', key: 'suberr' }, '订阅额度获取失败：' + sub.error.message));
          }
          return;
        }
        // 窗口缺失（如 Codex 无 5 小时窗口）→ 跳过窗口组，不占位、不报错
        if (hasData) {
          // 简洁模式下选择"时间最短且有重置时刻"的窗口（刷新最快，用户最需关注）：
          // 优先级：5小时 > 周 > 月（按窗口时长排序，而非已用百分比）
          const windowPriority = { five_hour: 1, seven_day: 2, monthly: 3 };
          const windowsWithReset = windows.filter(function (w) { return w.resetsAt; });
          const displayWindow = windowsWithReset.length > 0
            ? windowsWithReset.slice().sort(function (a, b) {
                const pa = windowPriority[a.key] || 99;
                const pb = windowPriority[b.key] || 99;
                return pa - pb;
              })[0]
            : null;
          
          // 完整模式显示全部窗口；简洁模式只显示选中的那个窗口
          const visible = full ? windows : (displayWindow ? [displayWindow] : []);
          
          // 预警触发条件：已用 ≥80%（= 剩余 ≤20%）→ 琥珀色；否则绿色
          const LOW_QUOTA_PERCENT = 20;
          const alarmWindows = windows.filter(function (w) { return w.usedPercent >= (100 - LOW_QUOTA_PERCENT); });
          const titleLines = ['订阅源：' + subscriptionServiceName(state.billingMode && state.billingMode.provider) + (sub.plan ? '（' + sub.plan + '）' : '')]
            .concat(windows.map(function (w) {
              return w.label + '窗口：剩余 ' + remainingPercent(w) + '%（已用 ' + w.usedPercent + '%）'
                + (w.resetsAt ? ' · 重置 ' + formatDateTime(w.resetsAt) + ' · 距重置 ' + fmtResetCountdown(w.resetsAt - now) : '');
            }));
          const winNodes = [];
          for (let i = 0; i < visible.length; i++) {
            const w = visible[i];
            if (i > 0) winNodes.push(' · ');
            const remaining = remainingPercent(w);
            const colorClass = remaining <= LOW_QUOTA_PERCENT ? 'bi-peak' : 'bi-offpeak';
            winNodes.push(compactWindowLabel(w.key) + ' ', React.createElement('span', { className: colorClass }, num(remaining + '%')));
          }
          groups.push(React.createElement('span', { key: 'subwin', title: titleLines.join('\n') },
            ...winNodes,
            alarmWindows.length > 0
              ? React.createElement('span', {
                  className: 'bi-err', key: 'subalarm',
                  title: '窗口告急：' + alarmWindows.map(function (w) { return w.label + '窗口剩余 ≤20%'; }).join('、'),
                }, ' ⚠')
              : null,
          ));
          if (sub.error) {
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'substale', title: '订阅接口暂时不可用，已保留最近一次成功的数据；60 秒后自动重试' }, '⚠ 刷新失败，显示上次快照'));
          }
          // 距重置倒计时（与显示的窗口一致，确保额度与倒计时匹配）
          if (displayWindow && displayWindow.resetsAt) {
            const cdTitle = displayWindow.label + '窗口 剩余 ' + remainingPercent(displayWindow)
              + '%（已用 ' + displayWindow.usedPercent + '%） · 重置 ' + formatDateTime(displayWindow.resetsAt);
            groups.push(React.createElement('span', { key: 'subcd', title: cdTitle },
              '距重置 ', num(fmtResetCountdown(displayWindow.resetsAt - now))));
          }
        }
      }

      const groups = [];
      // 两态严格判定：density 只能是 'full' 或 'compact'（host 校验 + 本地防抖保证）
      const full = props.density === 'full';
      // 模式互斥：订阅制渲染订阅版 row2，余额制渲染 v1.0.0 现状，绝不叠加
      const isSub = !!(state.billingMode && state.billingMode.mode === 'subscription');

      if (state.fatal) {
        groups.push(React.createElement('span', { className: 'bi-err', key: 'fatal' }, '加载失败：' + state.fatal));
      } else if (state.loading) {
        groups.push(React.createElement('span', { key: 'loading' }, '加载中…'));
      } else if (isSub) {
        pushSubscriptionGroups(groups);
      } else {
        pushBalanceGroups(groups);
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

    // ---------- 信息概览页（InfoOverviewPage） ----------
    // 四模块：① 花费总览卡（今日/本月/近30天/累计）② 近7/30天花费趋势（纯 CSS 柱状图）
    // ③ 各模型用量统计（占比条）④ 使用记录明细（倒序 + 加载更多）
    // 铁律：组件只依赖 rpc() 与自有 .bi-ov-* 样式，绝不读 slot 注入 props（两种环境 props 不同）；
    // 30s 轮询只刷 summary/trend/modelStats，明细列表仅在用户点"加载更多"时拉取（防列表跳动）
    function InfoOverviewPage() {
      const [summary, setSummary] = React.useState(null);      // getUsageSummary
      const [trend, setTrend] = React.useState(null);          // getSpendTrend
      const [trendDays, setTrendDays] = React.useState(7);     // 7/30 切换
      const [models, setModels] = React.useState(null);        // getModelStats
      const [records, setRecords] = React.useState(null);      // { total, records[] }
      const [loading, setLoading] = React.useState(true);
      const [fatal, setFatal] = React.useState(null);

      // 千分位 + 整数（token 用）
      function fmtInt(n) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toLocaleString('en-US');
      }
      // 金额：千分位 + 2 位小数；<¥0.01 且 >0 显示「＜0.01」（防误导）；null/NaN 显示「—」
      function fmtMoney(n) {
        if (n == null || isNaN(n)) return '—';
        if (n > 0 && n < 0.01) return '＜0.01';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      function symbolFor(currency) {
        return currency === 'CNY' ? '¥' : (currency === 'USD' ? '$' : '');
      }
      // 记录时间（本地时区）：MM-DD HH:mm
      function fmtTime(ts) {
        if (ts == null || isNaN(ts)) return '—';
        const d = new Date(ts);
        const p = function (x) { return String(x).padStart(2, '0'); };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      }

      // 核心加载：summary + trend + modelStats（30s 轮询）；trendDays 变化时也重拉
      const loadCore = React.useCallback(function () {
        Promise.all([
          rpc('getUsageSummary', { sessionId: '' }),
          rpc('getSpendTrend', { days: trendDays }),
          rpc('getModelStats'),
        ]).then(function (results) {
          setSummary(results[0]);
          setTrend(results[1]);
          setModels(results[2]);
          setLoading(false);
          setFatal(null);
        }).catch(function (err) {
          setLoading(false);
          setFatal(String((err && err.message) || err));
        });
      }, [trendDays]);

      // 明细加载（offset=0 重置；>0 追加）——仅用户触发，不参与轮询；
      // 失败进 fatal（错误 + 重试按钮，避免明细 null 时永久卡「加载中」）
      const loadRecords = React.useCallback(function (offset) {
        rpc('getUsageRecords', { offset: offset, limit: 20 }).then(function (res) {
          setRecords(function (prev) {
            const base = (prev && prev.records) || [];
            return {
              total: res.total,
              records: offset === 0 ? (res.records || []) : base.concat(res.records || []),
            };
          });
        }).catch(function (err) {
          setLoading(false);
          setFatal(String((err && err.message) || err));
        });
      }, []);

      React.useEffect(function () {
        loadCore();
        const id = window.setInterval(loadCore, 30000);
        return function () { window.clearInterval(id); };
      }, [loadCore]);

      React.useEffect(function () {
        loadRecords(0);
      }, [loadRecords]);

      // 切换 7/30 天：重拉趋势（loadCore 依赖 trendDays，useCallback 重建 → 首 effect 重跑）
      function onSwitchDays(days) {
        if (days === trendDays) return;
        setTrendDays(days);
      }

      // ---- 组装 ----
      // 整体重试：核心数据 + 明细都重拉（records 可能因首次失败为 null，必须一并恢复）
      function onRetry() {
        setLoading(true);
        setFatal(null);
        loadCore();
        loadRecords(0);
      }
      if (fatal) {
        return React.createElement('div', { className: 'bi-ov-root' },
          React.createElement('div', { className: 'bi-ov-err' }, '加载失败：' + fatal,
            ' ',
            React.createElement('button', { className: 'bi-ov-btn', onClick: onRetry }, '重试'),
          ),
        );
      }
      if (loading || !summary || !trend || !models || !records) {
        return React.createElement('div', { className: 'bi-ov-root' },
          React.createElement('div', { className: 'bi-ov-loading' }, '加载中…'));
      }

      // ① 花费总览卡
      const currency = (summary && summary.currency) || 'CNY';
      const sym = symbolFor(currency) || (currency === 'CNY' ? '¥' : '$');
      const kpis = [
        { label: '今日', value: summary.todaySpend },
        { label: '本月', value: summary.monthSpend },
        { label: '近30天', value: summary.last30dSpend },
        { label: '累计', value: summary.totalSpend },
      ];

      // ② 趋势图（纯 CSS 柱状图）
      const points = (trend && trend.points) || [];
      let maxSpend = 0;
      for (let i = 0; i < points.length; i++) if (points[i].spend > maxSpend) maxSpend = points[i].spend;
      const chartCols = points.map(function (pt, i) {
        const h = maxSpend > 0 ? Math.max(2, Math.round((pt.spend / maxSpend) * 100)) : 2;
        return React.createElement('div', { key: 'col' + i, className: 'bi-ov-col' },
          React.createElement('div', {
            className: 'bi-ov-bar',
            style: { height: h + '%' },
            title: pt.label + ' 花费 ' + sym + fmtMoney(pt.spend),
            role: 'img',
            'aria-label': pt.label + ' 花费 ' + sym + fmtMoney(pt.spend),
          }),
          React.createElement('div', { className: 'bi-ov-axis' }, pt.label),
        );
      });

      // ③ 模型统计（host 已按费用降序；费用按各模型自身币种显示，避免跨币种误读）
      const modelRows = (models.models || []).map(function (m, i) {
        const costTxt = m.cost == null ? '—' : (symbolFor(m.currency) || sym) + fmtMoney(m.cost);
        const share = m.costShare != null ? Math.round(m.costShare * 100) : 0;
        return React.createElement('div', { key: 'm' + i, className: 'bi-ov-model' },
          React.createElement('div', { className: 'bi-ov-model-name', title: (m.modelDisplay || m.model) + (m.provider ? ' · ' + m.provider : '') },
            m.modelDisplay || m.model),
          React.createElement('div', { className: 'bi-ov-model-meta' },
            React.createElement('div', null,
              fmtInt(m.count) + ' 次 · ' + fmtInt(m.input + m.cacheRead + m.cacheWrite + m.output) + ' token'),
            React.createElement('div', { className: 'bi-ov-model-bar' },
              React.createElement('div', { className: 'bi-ov-model-fill', style: { width: share + '%' } }),
            ),
          ),
          React.createElement('div', { className: 'bi-ov-model-cost' }, costTxt),
        );
      });

      // ④ 明细列表（倒序，加载更多）
      const hasMore = records.records.length < records.total;
      const recordRows = records.records.map(function (r, i) {
        const costTxt = r.cost == null ? '—' : symbolFor(r.currency) + fmtMoney(r.cost);
        const tokens = '入 ' + fmtInt(r.input) + ' · 缓存 ' + fmtInt(r.cacheRead + r.cacheWrite) + ' · 出 ' + fmtInt(r.output);
        return React.createElement('div', { key: 'r' + i, className: 'bi-ov-record' },
          React.createElement('span', { className: 'bi-ov-record-time' }, fmtTime(r.ts)),
          React.createElement('span', { className: 'bi-ov-record-model', title: r.model }, r.modelDisplay || r.model),
          React.createElement('span', { className: 'bi-ov-record-provider' }, r.providerDisplay || r.provider || ''),
          React.createElement('span', { className: 'bi-ov-record-tokens' }, tokens),
          React.createElement('span', { className: 'bi-ov-record-cost' }, costTxt),
        );
      });

      return React.createElement('div', { className: 'bi-ov-root' },
        React.createElement('div', { className: 'bi-ov-title' }, '信息概览'),
        // ① 总览卡
        React.createElement('div', { className: 'bi-ov-kpis' },
          kpis.map(function (k, i) {
            return React.createElement('div', { key: 'k' + i, className: 'bi-ov-kpi' },
              React.createElement('div', { className: 'bi-ov-kpi-label' }, k.label),
              React.createElement('div', { className: 'bi-ov-kpi-value' }, sym + fmtMoney(k.value)),
            );
          }),
        ),
        // ② 趋势（HIG：图表前给信息丰富的描述——标题 + 所选区间总计）
        const trendTotal = (trend.points || []).reduce(function (acc, pt) { return acc + (pt.spend || 0); }, 0);
        React.createElement('div', { className: 'bi-ov-section' }, '花费趋势'),
        React.createElement('div', { className: 'bi-ov-toolbar' },
          React.createElement('button', { className: 'bi-ov-btn' + (trendDays === 7 ? ' active' : ''), onClick: function () { onSwitchDays(7); } }, '近7天'),
          React.createElement('button', { className: 'bi-ov-btn' + (trendDays === 30 ? ' active' : ''), onClick: function () { onSwitchDays(30); } }, '近30天'),
          React.createElement('span', { className: 'bi-ov-toolbar-total' }, '合计 ' + sym + fmtMoney(trendTotal)),
        ),
        React.createElement('div', { className: 'bi-ov-chart', role: 'img', 'aria-label': '近' + trendDays + '天每日花费柱状图，合计 ' + sym + fmtMoney(trendTotal) }, ...chartCols),
        // ③ 模型统计
        React.createElement('div', { className: 'bi-ov-section' }, '各模型用量'),
        modelRows.length > 0 ? modelRows : React.createElement('div', { className: 'bi-ov-empty' }, '暂无模型用量数据'),
        // ④ 明细
        React.createElement('div', { className: 'bi-ov-section' }, '使用记录'),
        records.records.length === 0
          ? React.createElement('div', { className: 'bi-ov-empty' }, '暂无使用记录。开始对话后，每一笔 AI 调用的费用与 token 都会自动记录在这里。')
          : recordRows,
        hasMore
          ? React.createElement('button', {
              className: 'bi-ov-btn bi-ov-loadmore',
              onClick: function () { loadRecords(records.records.length); },
            }, '加载更多（' + (records.total - records.records.length) + '）')
          : null,
      );
    }
  },
};
