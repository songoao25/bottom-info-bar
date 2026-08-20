// Bottom Info Bar（底部信息栏插件）— client half（静态 bundle 形态）
// - host.call(method, args) → fetch POST /_dsh/dsh-bottom-info-bar/<method>（JSON）
// - ctx.interval / ctx.timeout → window.setInterval / window.setTimeout
// - styles.insert(css) → document 注入 <style>（installStyles）
// - React 由 bundle 的 require('react') 提供（seed 模块）
// 样式策略：① 只把数字加粗（.bi-num 700）② 服务商名加粗 ③ 高峰价琥珀色+加粗、空闲价绿色+加粗
// 显示行为：① 本对话花费始终显示——新会话/对话刚开始（尚无记账）时显示"本对话 ¥0.000"，
//   hover 仍可查看持久化的 今天/近一月/全部；
//   ② 完整模式下原生统计行无 steps 门槛，对话刚开始即显示"0 轮 · 0 步"。
// 失败策略（AUDIT-CODE-REVIEW 缺陷 #1）：逐接口容错——
//   ① rpc 带 20s 超时且可被外部 AbortSignal 中止（组件卸载即取消），杜绝永久"加载中…"；
//   ② load 用 Promise.allSettled 逐端点处理：成功端点写新值，失败端点保留旧值并记入 errors 表；
//   ③ 渲染永不整栏降级：旧数据照常显示，仅失败项打降级标记（分块/全局提示）。
'use strict';

const React = require('react');

const RPC_BASE = '/_dsh/dsh-bottom-info-bar';

// 排版优化（正式版）：完整模式下隐藏"首 token 平均 / tok/s"两个低优先级原生字段，
// 让原生统计行在 748px 对话宽度下单行放得下；hover 信息浮窗（title）仍显示全部原生信息。
const HIDE_SPEED_FIELDS = true;
// 订阅窗口预警阈值：任一窗口已用百分比 ≥ 该值 → 红色 ⚠（与 host 常量保持一致）
const WINDOW_ALERT_PERCENT = 90;

// RPC 超时兜底：host 侧 15s 超时之上再留余量；端点挂起时 20s 内必失败，杜绝永久"加载中…"
const RPC_TIMEOUT_MS = 20000;

// rpc(method, args, externalSignal)：
// - 超时：20s 未响应 → abort 并以"请求超时"失败（fetch 挂起不阻塞界面）
// - 可中止：传入外部 AbortSignal（组件卸载时 abort）→ 立即取消并拒绝"请求已取消"
function rpc(method, args, externalSignal) {
  let abortReason = null;
  const controller = new AbortController();
  const timer = window.setTimeout(function () { abortReason = '请求超时'; controller.abort(); }, RPC_TIMEOUT_MS);
  function onExternalAbort() { abortReason = '请求已取消'; controller.abort(); }
  function cleanup() {
    window.clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      return Promise.reject(new Error('请求已取消'));
    }
    externalSignal.addEventListener('abort', onExternalAbort);
  }
  return fetch(RPC_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    signal: controller.signal,
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
  }).catch(function (err) {
    // 本函数主动 abort（超时/外部取消）→ 统一为可读错误；其余错误原样抛出
    if (abortReason !== null) throw new Error(abortReason);
    if (err && err.name === 'AbortError') throw new Error('请求已取消');
    throw err;
  }).finally(cleanup);
}

// load() 的逐接口容错状态合并（模块级纯函数，供单测提取）：
// 成功端点 → 写新值 + 清除错误；失败端点 → 保留旧值（无旧数据则为 null）+ 记录错误信息。
// results 与端点顺序一一对应：balance / pricing / usage / billingMode / sub。
function mergeLoadResults(prev, results) {
  const keys = ['balance', 'pricing', 'usage', 'billingMode', 'sub'];
  const next = { loading: false, errors: { balance: null, pricing: null, usage: null, billingMode: null, sub: null } };
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const r = results[i];
    if (r && r.status === 'fulfilled') {
      next[key] = r.value;
    } else {
      next[key] = prev[key];
      const reason = r && r.reason;
      next.errors[key] = reason && reason.message ? String(reason.message) : String(reason || 'RPC 失败');
    }
  }
  return next;
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
       .bi-update{ color: var(--dsw-alias-state-error-primary, #dc2626); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
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
      return function () { disposeStyles(); };
    }, 'dsh-bottom-info-bar: styles');

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
        loading: true, balance: null, pricing: null, usage: null, billingMode: null, sub: null,
        errors: { balance: null, pricing: null, usage: null, billingMode: null, sub: null },
      });
      const [updateInfo, setUpdateInfo] = React.useState(null);
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

      // 组件生命周期 AbortSignal：卸载时中止所有在途 RPC（配合 rpc 20s 超时，双保险防旧响应写 state）
      const abortRef = React.useRef(null);
      React.useEffect(function () {
        const controller = new AbortController();
        abortRef.current = controller;
        return function () { controller.abort(); };
      }, []);

      const load = React.useCallback(function () {
        const sessionId = resolveSessionId();
        const signal = abortRef.current ? abortRef.current.signal : null;
        // 逐接口容错：allSettled 等全部 settle（最坏 20s 超时兜底），任一失败只降级该端点，
        // 不拖垮其他成功数据；合并逻辑在 mergeLoadResults（失败端点保留旧值 + 记录错误）
        Promise.allSettled([
          rpc('getBalanceSnapshot', null, signal),
          rpc('getPricing', null, signal),
          rpc('getUsageSummary', { sessionId: sessionId }, signal),
          rpc('getBillingMode', null, signal),
          rpc('getSubscriptionSnapshot', null, signal),
        ]).then(function (results) {
          if (signal && signal.aborted) return; // 组件已卸载：放弃结果，不写 state
          setState(function (s) { return mergeLoadResults(s, results); });
        });
      }, [resolveSessionId]);

      React.useEffect(function () {
        load();
        const id = window.setInterval(load, 30000);
        return function () { window.clearInterval(id); };
      }, [load]);

      // 版本检查由 host 在进程启动时完成；这里仅读取一次缓存，不轮询 NPM。
       React.useEffect(function () {
         let active = true;
         rpc('getUpdateInfo').then(function (info) {
           if (active && info && info.available === true && typeof info.latest === 'string') setUpdateInfo(info);
         }).catch(function () { /* 版本检查失败静默，不影响信息栏 */ });
         return function () { active = false; };
       }, []);

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
        const errors = state.errors || {};
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
          // host 快照失败（bal.error）或本次 RPC 失败（errors.balance）→ 均保留旧数据 + 降级标记
          if (bal.error || errors.balance) {
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'balerr', title: '余额数据暂不可用，已保留最近一次成功的数据；自动重试中' }, '⚠ 刷新失败，显示上次快照'));
          }
        } else if (bal && bal.error) {
          groups.push(React.createElement('span', { className: 'bi-err', key: 'berr' }, '余额获取失败：' + bal.error.message));
        } else if (errors.balance) {
          // 本次 RPC 失败且无旧数据：只降级余额块，其余端点数据照常渲染
          groups.push(React.createElement('span', { className: 'bi-err', key: 'berr' }, '余额获取失败：' + errors.balance));
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
        } else if (errors.usage) {
          // 本次 RPC 失败且无旧数据：只降级花费块，其余端点数据照常渲染
          groups.push(React.createElement('span', { className: 'bi-err', key: 'usageerr' }, '花费获取失败：' + errors.usage));
        }
      }

      // ---- 订阅制模式（互斥替换余额制版，row2 只三类信息）：
      //      订阅服务+模型 → 三窗口额度 → 距重置倒计时（最紧窗口）；余额/时段/花费/token 均不显示 ----
      function subscriptionFailureHint(error, source) {
         const kind = error && error.kind;
         const serviceName = source === 'opencode-go' ? 'OpenCode Go' : 'ChatGPT';
         const message = error && typeof error.message === 'string' ? error.message : '';
         const statusMatch = message.match(/HTTP (\d{3})/);
         const status = statusMatch ? statusMatch[1] : '';
         if (kind === 'no-key') return '原因：未找到 ' + serviceName + ' 订阅登录凭证。解决：请重新授权 ' + serviceName + '。';
         if (kind === 'auth' || status === '401') return '原因：' + serviceName + ' 登录凭证已失效。解决：请重新授权 ' + serviceName + '。';
         if (status === '403') return '原因：' + serviceName + ' 接口拒绝访问。解决：请重新授权，或稍后再试。';
         if (status === '429') return '原因：' + serviceName + ' 接口请求过于频繁。解决：请稍后再试，避免频繁刷新。';
         if (kind === 'timeout' || /timeout|timed out|abort/i.test(message)) return '原因：' + serviceName + ' 额度接口响应超时。解决：请检查网络并稍后再试。';
         if (kind === 'parse') return '原因：' + serviceName + ' 返回的数据格式暂时无法识别。解决：请稍后再试，或更新插件。';
         return '原因：' + serviceName + ' 额度接口暂时不可用。解决：请检查网络并稍后再试。';
       }

       function pushSubscriptionGroups(groups) {
        groups.push(subscriptionProviderGroup());
        const sub = state.sub;
        const errors = state.errors || {};
        if (!sub) {
          if (errors.sub) {
            // 本次 RPC 失败且无旧数据：显示失败信息而非永久"加载中…"
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'suberr', title: subscriptionFailureHint({ kind: 'exception', message: String(errors.sub) }) }, '⚠ 刷新失败'));
          } else {
            groups.push(React.createElement('span', { key: 'subload' }, '订阅额度加载中…'));
          }
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
          groups.push(React.createElement('span', { className: 'bi-stale', key: 'substale', title: subscriptionFailureHint(sub.error, sub.source) }, '⚠ 刷新失败'));
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
          // host 快照失败（sub.error）或本次 RPC 失败（errors.sub）→ 均保留旧数据 + 降级标记
          if (sub.error || errors.sub) {
            groups.push(React.createElement('span', { className: 'bi-stale', key: 'substale', title: subscriptionFailureHint(sub.error || { kind: 'exception', message: String(errors.sub || '') }) }, '⚠ 刷新失败'));
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
      // 逐接口容错渲染：loading 仅"首帧且无任何数据"时占位；此后始终渲染（旧数据 + 失败降级标记），
      // 绝不整栏"加载失败"；rpc 有 20s 超时兜底，也不存在永久"加载中…"
      const hasAnyData = state.balance !== null || state.pricing !== null || state.usage !== null
        || state.billingMode !== null || state.sub !== null;
      if (state.loading && !hasAnyData) {
        groups.push(React.createElement('span', { key: 'loading' }, '加载中…'));
      } else if (isSub) {
        pushSubscriptionGroups(groups);
      } else {
        pushBalanceGroups(groups);
      }

      // 全局降级提示：任一端点失败 → 旧数据照常渲染 + 角落提示（title 列出失败项），仅失败项降级
      const errors = state.errors || {};
      const failedLabels = [];
      if (errors.balance) failedLabels.push('余额');
      if (errors.pricing) failedLabels.push('定价');
      if (errors.usage) failedLabels.push('花费');
      if (errors.billingMode) failedLabels.push('模式');
      if (errors.sub) failedLabels.push('订阅额度');
      if (failedLabels.length > 0) {
        groups.push(React.createElement('span', { className: 'bi-stale', key: 'degraded',
          title: '以下数据暂不可用：' + failedLabels.join('、') + '（已保留上次成功数据，自动重试中）' },
          '⚠ 部分数据刷新失败'));
      }

      if (updateInfo && updateInfo.available === true) {
         groups.push(React.createElement('span', {
           className: 'bi-update', key: 'update', title: '请告知你的 Agent 将本插件更新到“' + updateInfo.latest + '”版本。',
         }, '新版本提醒'));
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
