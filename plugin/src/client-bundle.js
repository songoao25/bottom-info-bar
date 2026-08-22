// Bottom Info Bar（底部信息栏插件）— client half（静态 bundle 形态）
// - host.call(method, args) → fetch POST /_dsh/dsh-bottom-info-bar/<method>（JSON）
// - ctx.interval / ctx.timeout → window.setInterval / window.setTimeout
// - styles.insert(css) → document 注入 <style>（installStyles）
// - React 由 bundle 的 require('react') 提供（seed 模块）
// 样式策略：① 整个数据令牌加粗（.bi-num 700）② 服务商名加粗 ③ 高峰价与低余额用警示红、空闲价用绿色
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
      .bi-root { --bi-label-primary: var(--dsw-alias-label-primary, #333); --bi-label-supporting: #3f444a; --bi-separator: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); --bi-state-price-low: #087f5b; --bi-state-alert: #d92d20; text-align: center; max-width: var(--dsh-chat-content-width); box-sizing: border-box; width: 100%; padding: 4px calc(var(--dsh-composer-side-clearance) + 16px) 0px; margin: 0 auto; display: block; font-size: 12px; line-height: 20px; color: var(--bi-label-supporting); font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .bi-root[data-density-saving="true"] { cursor: progress; }
      /* 以 DSH 实际外观属性切换，避免用户在 DSH 内手动选择外观时与系统偏好失配。 */
      body[data-ds-dark-theme] .bi-root { --bi-label-supporting: var(--dsw-alias-label-secondary, #cfd3d6); --bi-state-price-low: #86efac; --bi-state-alert: #ff6961; }
      /* 系统要求增强对比度时，浅色使用更深的同语义色；深色仅提高尚未达到 7:1 的警示红。 */
      @media (prefers-contrast: more) { body:not([data-ds-dark-theme]) .bi-root { --bi-state-price-low: #05603a; --bi-state-alert: #ad1717; } body[data-ds-dark-theme] .bi-root { --bi-state-alert: #ff7770; } }
      .bi-native-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      /* 密度切换只收合完整模式独有的原生统计行：160ms 足以表达层级变化，又不会拖慢连续操作。 */
      .bi-density-extra { display: grid; grid-template-rows: 1fr; opacity: 1; transform: translateY(0); transition: grid-template-rows 160ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms linear, transform 160ms cubic-bezier(0.2, 0, 0, 1); }
      .bi-density-extra-inner { min-height: 0; overflow: hidden; }
      .bi-root[data-density="compact"] .bi-density-extra { grid-template-rows: 0fr; opacity: 0; transform: translateY(-2px); }
      @media (prefers-reduced-motion: reduce) { .bi-density-extra { transition: none; transform: none; } }
      /* 整条信息栏始终作为一个居中的内容组；不会超过上方对话框的内容宽度。 */
      .bi-row2 { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      .bi-native-row > span, .bi-row2 > span { white-space: nowrap; }
      /* 只有模型组可在窄宽度折行；服务商与模型详情仍成组，不会让圆点落在行尾。 */
      .bi-row2 > .bi-model-group { white-space: normal; }
      /* 组间 6px、模型内部圆点 4px：保留分组层级，同时避免 12px 信息栏被过大留白拉散。 */
      .bi-sep { color: var(--bi-separator); margin: 0 6px; }
      /* 服务商名等一般强调：加粗 600 */
      .bi-root b { color: var(--bi-label-primary); font-weight: 600; }
      /* 数字：加粗 700（余额/倒计时/本对话花费/原生统计数字） */
      .bi-root b.bi-num { font-weight: 700; }
      /* 标签与数据不用字符空格拼接：统一由 4px 布局间距控制，避免中英文/数字字宽造成忽松忽紧。 */
      .bi-metric { display: inline-flex; align-items: baseline; white-space: nowrap; }
      .bi-metric-data { margin-left: 4px; }
      /* 状态标签用 600；核心数值才用 700，避免颜色、字重双重过度强调。 */
      .bi-peak    { color: var(--bi-state-alert); font-weight: 600; }
      .bi-offpeak { color: var(--bi-state-price-low); font-weight: 600; }
      .bi-err, .bi-stale { color: var(--bi-state-alert); font-weight: 600; }
      .bi-muted{ color: var(--bi-label-supporting); }
      /* 低余额/低额度是数值的状态修饰，而非独立组件：无框“低”字避免制造第二个视觉焦点。 */
      .bi-low-status { margin-left: 3px; color: var(--bi-state-alert); font-weight: 600; }
      .bi-root b.bi-alert-num, .bi-root b.bi-quota-low { color: var(--bi-state-alert); font-weight: 700; }
      /* 新版本需要用户处理，与其他提醒使用统一鲜红色文字，不伪装成链接。 */
      .bi-update{ color: var(--bi-state-alert); font-weight: 600; }
      /* 视觉能力是模型属性，不是告警：电光蓝实色、白字；高度收紧到字形范围内，避免压过同一行文字。 */
      /* 服务商、圆点、视觉胶囊在同一 20px flex 行内居中，避免混用文字基线造成上下漂移。 */
      .bi-model-group { display: inline-flex; align-items: center; justify-content: center; flex-wrap: wrap; max-width: 100%; min-width: 0; min-height: 20px; vertical-align: top; }
      .bi-model-provider, .bi-model-dot { display: inline-flex; align-items: center; height: 16px; line-height: 14px; }
      .bi-model-detail { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
      .bi-model-dot { margin: 0 4px; flex: 0 0 auto; }
      .bi-model-name { min-width: 0; overflow-wrap: anywhere; }
      .bi-vision { display: inline-flex; align-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; height: 16px; margin: 0; padding: 0 6px; border: 1px solid #0044cc; border-radius: 999px; color: #fff; background: #0057ff; font-size: 12px; font-weight: 600; line-height: 14px; white-space: nowrap; }
      .bi-vision-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .bi-vision-kind { flex: 0 0 auto; margin-left: 4px; }
      /* 会话目录未给出能力时，不先把模型错误画成文本模型；保留宽度，等待本地能力结果。 */
      .bi-model-capability-pending { visibility: hidden; }
      /* 读屏说明不参与视觉排版。 */
      .bi-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
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
    let toggling = false; // 持久化期间禁止重复切换（只允许 full/compact 两态）
    let densityVersion = 0;
    let occupantDispose = null;
    const densityListeners = new Set();
    const densityBusyListeners = new Set();
    // Survives composer remounts, so returning to an already visited session
    // does not require even one paint of an intermediate state.
    const sessionModelCache = new Map();
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

    // 不重新注册 slot：保留同一个 React 树，CSS 才能连续地收合/展开行高。
    function setDensity(next) {
      density = next;
      densityListeners.forEach(function (listener) { listener(next); });
    }

    function setDensitySaving(next) {
      toggling = next;
      densityBusyListeners.forEach(function (listener) { listener(next); });
    }

    function onToggleDensity() {
      if (toggling) return; // 切换进行中，忽略连点
      const requestVersion = ++densityVersion;
      setDensitySaving(true);
      const previous = density;
      const next = density === 'full' ? 'compact' : 'full';
      // 交互反馈不等网络；写入失败才回退，避免慢网络让点击看似没有生效。
      setDensity(next);
      rpc('setInfoDensity', { density: next }).then(function () {
        if (requestVersion === densityVersion) setDensitySaving(false);
      }).catch(function (err) {
        if (requestVersion !== densityVersion) return;
        setDensitySaving(false);
        if (density === next) setDensity(previous);
        console.error('Bottom Info Bar 切换信息密度失败', err);
      });
    }

    slots.inject('conversation.composer.dock', function () {
      applyMode();
      return function () { if (occupantDispose) occupantDispose(); };
    });

    const initialDensityVersion = densityVersion;
    try {
      const cfg = await rpc('getConfig');
      // 用户已经作出新选择时，绝不让启动阶段的旧配置覆盖它。
      if (initialDensityVersion === densityVersion && cfg && (cfg.infoDensity === 'full' || cfg.infoDensity === 'compact') && cfg.infoDensity !== density) {
        setDensity(cfg.infoDensity);
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
      // 版本信息由 host 在启动时从 package.json 读取；无论是否有新版，都用于服务商/模型 hover 展示。
      const [updateInfo, setUpdateInfo] = React.useState(null);
      const [now, setNow] = React.useState(Date.now());
      // This state is owned by DSH's per-session model selector, not by the
      // process-wide default for newly-created Agents.
      const [sessionModel, setSessionModel] = React.useState(null);
      const [modelSource, setModelSource] = React.useState('pending');
      const [displayDensity, setDisplayDensity] = React.useState(props.density);
      const [isDensitySaving, setIsDensitySaving] = React.useState(toggling);

      // 外层持有持久化后的密度；组件只订阅数值变化，避免 slot 卸载重建打断动画。
      React.useEffect(function () {
        densityListeners.add(setDisplayDensity);
        densityBusyListeners.add(setIsDensitySaving);
        // 订阅前后没有异步间隙：立即回读，避免首次 effect 建立前的更新丢失。
        setDisplayDensity(density);
        setIsDensitySaving(toggling);
        return function () {
          densityListeners.delete(setDisplayDensity);
          densityBusyListeners.delete(setIsDensitySaving);
        };
      }, []);

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
      const sessionId = resolveSessionId();

      // Subscribe to the exact store the native model seat uses.  A session
      // activation or a successful model switch publishes here immediately;
      // no polling and no host HTTP request sit on the display path.
      React.useEffect(function () {
        let stop = null;
        let active = true;
        setSessionModel(null);
        setModelSource('pending');
        if (!sessionId) { setModelSource('unavailable'); return function () {}; }
        try {
          const directories = ctx.get ? ctx.get('modelDirectories') : null;
          if (!directories || typeof directories.directoryFor !== 'function') {
            setModelSource('unavailable');
            return function () {};
          }
          setModelSource('available');
          const directory = directories.directoryFor(sessionId);
          const publish = function () {
            if (!active || !directory.store || typeof directory.store.getSnapshot !== 'function') return;
            const snapshot = directory.store.getSnapshot();
            const selected = snapshot && snapshot.current;
            if (!selected || typeof selected.provider !== 'string' || typeof selected.model !== 'string') return;
            const group = Array.isArray(snapshot.groups) ? snapshot.groups.find(function (g) { return g && g.id === selected.provider; }) : null;
            const model = group && Array.isArray(group.models) ? group.models.find(function (m) { return m && m.id === selected.model; }) : null;
            const inputModalities = model && Array.isArray(model.inputModalities) ? model.inputModalities : null;
            const value = {
              sessionId: sessionId,
              provider: selected.provider,
              model: selected.model,
              providerDisplay: group && typeof group.name === 'string' ? group.name : selected.provider,
              modelDisplay: model && typeof model.name === 'string' ? model.name : selected.model,
              // true/false 来自 DSH 的明确目录 metadata；null 表示仍待 host 查询，不能误画成文本模型。
              acceptsImageInput: inputModalities === null ? null : inputModalities.indexOf('image') !== -1,
            };
            sessionModelCache.set(sessionId, value);
            setSessionModel(value);
          };
          publish();
          if (directory.store && typeof directory.store.subscribe === 'function') stop = directory.store.subscribe(publish);
        } catch (err) { setModelSource('unavailable'); /* old DSH: retain the RPC fallback */ }
        return function () { active = false; if (typeof stop === 'function') stop(); };
      }, [sessionId]);

      // 组件生命周期 AbortSignal：卸载时中止所有在途 RPC（配合 rpc 20s 超时，双保险防旧响应写 state）
      const abortRef = React.useRef(null);
      React.useEffect(function () {
        const controller = new AbortController();
        abortRef.current = controller;
        return function () { controller.abort(); };
      }, []);

      const loadVersionRef = React.useRef(0);
      const cachedSessionModel = sessionId ? sessionModelCache.get(sessionId) : null;
      const activeSessionModel = sessionModel && sessionModel.sessionId === sessionId ? sessionModel : (cachedSessionModel || null);
      const load = React.useCallback(function (selection) {
        const requestVersion = ++loadVersionRef.current;
        const activeSelection = selection || activeSessionModel;
        const selectionArgs = activeSelection ? { selection: { provider: activeSelection.provider, model: activeSelection.model } } : {};
        const signal = abortRef.current ? abortRef.current.signal : null;
        // 逐接口容错：allSettled 等全部 settle（最坏 20s 超时兜底），任一失败只降级该端点，
        // 不拖垮其他成功数据；合并逻辑在 mergeLoadResults（失败端点保留旧值 + 记录错误）
        Promise.allSettled([
          rpc('getBalanceSnapshot', activeSelection ? { provider: activeSelection.provider } : null, signal),
          rpc('getPricing', selectionArgs, signal),
          rpc('getUsageSummary', Object.assign({ sessionId: sessionId }, selectionArgs), signal),
          rpc('getBillingMode', selectionArgs, signal),
          rpc('getSubscriptionSnapshot', selectionArgs, signal),
        ]).then(function (results) {
          // Do not allow a late A response to overwrite newly active B.
          if ((signal && signal.aborted) || requestVersion !== loadVersionRef.current) return;
          setState(function (s) { return mergeLoadResults(s, results); });
        });
      }, [resolveSessionId, activeSessionModel, sessionId]);

      React.useEffect(function () {
        load();
        const id = window.setInterval(load, 30000);
        return function () { window.clearInterval(id); };
      }, [load]);

      // 版本检查由 host 在进程启动时完成；这里仅读取一次缓存，不轮询 NPM。
       React.useEffect(function () {
         let active = true;
         rpc('getUpdateInfo').then(function (info) {
           if (active && info && typeof info.current === 'string') setUpdateInfo(info);
         }).catch(function () { /* 版本检查失败静默，不影响信息栏 */ });
         return function () { active = false; };
       }, []);

      // Model text comes from sessionModel synchronously.  The following load
      // only refreshes secondary data in the background.
      React.useEffect(function () {
        if (activeSessionModel) load(activeSessionModel);
      }, [load, activeSessionModel]);

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

      // While background RPCs catch up, render the newly activated session's
      // model and suppress details from the prior session rather than showing
      // a convincing but wrong provider/model combination.
      const waitForSessionModel = !!sessionId && modelSource !== 'unavailable' && !activeSessionModel;
      const visiblePricing = activeSessionModel && (!state.pricing
        || state.pricing.provider !== activeSessionModel.provider || state.pricing.model !== activeSessionModel.model)
        ? { provider: activeSessionModel.provider, model: activeSessionModel.model, providerDisplay: activeSessionModel.providerDisplay, modelDisplay: activeSessionModel.modelDisplay, mode: 'unknown', acceptsImageInput: activeSessionModel.acceptsImageInput }
        : (waitForSessionModel ? null : state.pricing);
      const visibleBillingMode = activeSessionModel && (!state.billingMode
        || state.billingMode.provider !== activeSessionModel.provider || state.billingMode.model !== activeSessionModel.model)
        ? { provider: activeSessionModel.provider, model: activeSessionModel.model, mode: ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex'].indexOf(activeSessionModel.provider) >= 0 ? 'subscription' : 'balance' }
        : (waitForSessionModel ? null : state.billingMode);
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
      function num(t, extraClass) {
        return React.createElement('b', { className: 'bi-num' + (extraClass ? ' ' + extraClass : '') }, String(t));
      }

      // 统一数值语法：标签保持常规，数值与紧随的单位/货币符号作为一个加粗的数据令牌。
      function metric(label, value, extraClass) {
        return React.createElement('span', { className: 'bi-metric', 'data-metric-text': label + ' ' + value },
          React.createElement('span', { className: 'bi-metric-label' }, label),
          React.createElement('span', { className: 'bi-metric-data' }, num(value, extraClass)));
      }

      // 仅在 DSH 模型目录明确声明 inputModalities 包含 image 时，将“完整模型名 视觉”合并为一个椭圆。
      function modelLabelWithCapability(pr, modelLabel) {
        if (pr && pr.acceptsImageInput === null) {
          return React.createElement('span', { className: 'bi-model-capability-pending', 'aria-hidden': 'true' }, modelLabel);
        }
        if (!pr || pr.acceptsImageInput !== true) return React.createElement('span', { className: 'bi-model-name' }, modelLabel);
        return React.createElement('span', { className: 'bi-vision', title: '支持图像输入。' },
          React.createElement('span', { className: 'bi-vision-model' }, modelLabel),
          React.createElement('span', { className: 'bi-vision-kind' }, '视觉'));
      }

      function modelSeparator() {
        return React.createElement('span', { className: 'bi-model-dot', 'aria-hidden': 'true' }, '·');
      }

      function modelDetail(pr, modelName) {
        return React.createElement('span', { className: 'bi-model-detail' },
          modelSeparator(), modelLabelWithCapability(pr, modelName));
      }

      // 参考图的视觉标签将服务商显示在椭圆外；仅移除重复的服务商前缀，不截断真实模型名。
      function modelLabelWithoutProvider(modelLabel, providerLabel) {
        if (modelLabel.toLowerCase().indexOf(providerLabel.toLowerCase()) !== 0) return modelLabel;
        const suffix = modelLabel.slice(providerLabel.length);
        // 只有目录以分隔符明确写成“服务商 + 模型”时才去重；例如 OpenAICode 不是 OpenAI 的重复前缀。
        if (!/^[\s·._/-]+/.test(suffix)) return modelLabel;
        return suffix.replace(/^[\s·._/-]+/, '') || modelLabel;
      }

      // 服务商 + 具体模型（两种模式共用；纯显示，不拦截点击——点击冒泡到整条信息栏触发密度切换；hover 展示定价模式）
      // 模型目录名可能重复服务商前缀（如 DeepSeek V4 Flash）；始终拆分为“DeepSeek · V4 Flash”，
      // 既保留服务商信息，也不让模型名重复前缀。
      function providerGroup() {
        const pr = visiblePricing;
        const provLabel = (pr && pr.providerDisplay) ? pr.providerDisplay : '未知';
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : '未知模型');
        const modelName = modelLabelWithoutProvider(modelLabel, provLabel);
        const versionLine = updateInfo && typeof updateInfo.current === 'string'
          ? '\n插件版本：' + updateInfo.current : '';
        const provTitle = '服务商：' + provLabel + ' ' + modelLabel + '\n'
          + (pr && pr.mode === 'peak-valley' ? '定价：峰谷价（高峰 9-12、14-18 点）'
            : (pr && pr.mode === 'flat' ? '定价：固定价' : '定价：未收录，按默认计'))
          + versionLine;
        return React.createElement('span', { key: 'prov', className: 'bi-model-group', title: provTitle },
          React.createElement('b', { className: 'bi-model-provider' }, provLabel),
          modelDetail(pr, modelName));
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
        const pr = visiblePricing;
        const serviceName = subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider);
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : '未知模型');
        const modelName = modelLabelWithoutProvider(modelLabel, serviceName);
        const versionLine = updateInfo && typeof updateInfo.current === 'string'
          ? '\n插件版本：' + updateInfo.current : '';
        const title = '订阅服务：' + serviceName + '\n模型：' + modelLabel + versionLine;
        return React.createElement('span', { key: 'subprov', className: 'bi-model-group', title: title },
          React.createElement('b', { className: 'bi-model-provider' }, serviceName),
          modelDetail(pr, modelName),
        );
      }

      // ---- 余额制模式（v1.0.0 现状，完全不动）：服务商+模型 → 余额 → 时段 → 倒计时 → 本对话花费 ----
      function pushBalanceGroups(groups, trailingErrorGroups) {
        const bal = state.balance;
        const errors = state.errors || {};
        const alertActive = !!(bal && bal.alert && bal.alert.active);
        groups.push(providerGroup());

        // 余额（纯金额；hover 仅展示余额，不显示充值/赠金）
        if (bal && bal.error && bal.error.kind === 'no-key') {
          trailingErrorGroups.push(React.createElement('span', { className: 'bi-err', key: 'nokey', title: '未配置 DeepSeek API Key。请在“设置 → 模型”中填写。' },
            '未配置 DEEPSEEK_API_KEY → 设置→模型 填写'));
        } else if (bal && bal.data) {
          const symbol = bal.currency === 'USD' ? '$' : '¥';
          const balTitle = bal.estimate
            ? '估算余额：' + symbol + fmt(bal.data.total)
            : '余额：' + symbol + fmt(bal.data.total);
          groups.push(React.createElement('span', { key: 'bal', title: balTitle },
            metric('余额', symbol + fmt(bal.data.total), alertActive ? 'bi-alert-num' : ''),
            alertActive ? React.createElement('span', { className: 'bi-low-status' }, '低') : null,
            bal.estimate ? React.createElement('span', { className: 'bi-muted' }, '（估算）') : null,
          ));
          // host 快照失败（bal.error）或本次 RPC 失败（errors.balance）→ 均保留旧数据 + 降级标记
          if (bal.error || errors.balance) {
            trailingErrorGroups.push(React.createElement('span', { className: 'bi-stale', key: 'balerr', title: '余额暂不可用；正在显示上次数据并自动重试。' }, '刷新失败'));
          }
        } else if (bal && bal.error) {
          trailingErrorGroups.push(React.createElement('span', { className: 'bi-err', key: 'berr', title: '余额获取失败。请检查网络和 API Key。' }, '余额获取失败'));
        } else if (errors.balance) {
          // 本次 RPC 失败且无旧数据：只降级余额块，其余端点数据照常渲染
          trailingErrorGroups.push(React.createElement('span', { className: 'bi-err', key: 'berr', title: '余额获取失败。请检查网络和 API Key。' }, '余额获取失败'));
        }

        // 时段：仅峰谷价服务商显示"高峰价/空闲价"（flat/unknown 服务商不显示；hover 展示具体价格）
        const pr = visiblePricing;
        if (pr && pr.mode === 'peak-valley') {
          const peakNow = pr.period === 'peak';
          const p = pr.prices || {};
          const periodTitle = '北京时间 ' + (peakNow ? '高峰价' : '空闲价') + '：输入 ¥' + (p.inputCacheMiss != null ? p.inputCacheMiss : '?')
            + '/M · 缓存 ¥' + (p.inputCacheHit != null ? p.inputCacheHit : '?')
            + '/M · 输出 ¥' + (p.output != null ? p.output : '?') + '/M';
          groups.push(React.createElement('span', { key: 'period', className: peakNow ? 'bi-peak' : 'bi-offpeak', title: periodTitle },
            peakNow ? '高峰价' : '空闲价'));
        }

        // 倒计时：仅峰谷价服务商显示"距高峰/距空闲"（hover 展示下次切换时刻；数字加粗）
        if (pr && pr.mode === 'peak-valley' && pr.nextSwitch) {
          const peakNow = pr.period === 'peak';
          const countdownTitle = '北京时间 ' + pr.nextSwitch.atLabel + ' 切换为' + (peakNow ? '空闲价' : '高峰价') + '。';
          groups.push(React.createElement('span', { key: 'countdown', title: countdownTitle },
            metric('距' + (peakNow ? '空闲' : '高峰'), fmtCountdown(pr.nextSwitch.at - now))));
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
            metric('本对话', costTxt)));
        } else if (errors.usage) {
          // 本次 RPC 失败且无旧数据：只降级花费块，其余端点数据照常渲染
          trailingErrorGroups.push(React.createElement('span', { className: 'bi-err', key: 'usageerr', title: '花费暂不可用；不会影响对话。' }, '花费获取失败'));
        }
      }

      // ---- 订阅制模式（互斥替换余额制版，row2 只三类信息）：
      //      订阅服务+模型 → 三窗口额度 → 距重置倒计时（最紧窗口）；余额/时段/花费/token 均不显示 ----
       function subscriptionFailureHint(error, source) {
         const kind = error && error.kind;
         const serviceName = subscriptionServiceName(source);
         const message = error && typeof error.message === 'string' ? error.message : '';
         const statusMatch = message.match(/HTTP (\d{3})/);
         const status = statusMatch ? statusMatch[1] : '';
         if (kind === 'no-key') return '未找到 ' + serviceName + ' 登录凭证。请重新授权。';
         if (kind === 'auth' || status === '401') return serviceName + ' 登录凭证已失效。请重新授权。';
         if (status === '403') return serviceName + ' 拒绝访问。请重新授权或稍后再试。';
         if (status === '429') return serviceName + ' 请求过于频繁。请稍后再试。';
         if (kind === 'timeout' || /timeout|timed out|abort/i.test(message)) return serviceName + ' 响应超时。请检查网络后再试。';
         if (kind === 'parse') return serviceName + ' 返回的数据暂时无法识别。请稍后再试。';
         return serviceName + ' 暂不可用。请检查网络后再试。';
       }

       function pushSubscriptionGroups(groups, trailingErrorGroups) {
        groups.push(subscriptionProviderGroup());
        const sub = state.sub;
        const errors = state.errors || {};
        if (!sub) {
          if (errors.sub) {
            // 本次 RPC 失败且无旧数据：显示失败信息而非永久"加载中…"
            trailingErrorGroups.push(React.createElement('span', { className: 'bi-stale', key: 'suberr', title: subscriptionFailureHint({ kind: 'exception', message: String(errors.sub) }, visibleBillingMode && visibleBillingMode.provider) }, '刷新失败'));
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
          trailingErrorGroups.push(React.createElement('span', { className: 'bi-stale', key: 'substale', title: subscriptionFailureHint(sub.error, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, '刷新失败'));
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
          
          // 预警触发条件：已用 ≥80%（= 剩余 ≤20%）→ 鲜红色文字；正常额度使用中性文字。
          const LOW_QUOTA_PERCENT = 20;
          const titleLines = ['订阅源：' + subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider) + (sub.plan ? '（' + sub.plan + '）' : '')]
            .concat(windows.map(function (w) {
              return w.label + '窗口：剩余 ' + remainingPercent(w) + '%（已用 ' + w.usedPercent + '%）'
                + (w.resetsAt ? ' · 重置 ' + formatDateTime(w.resetsAt) + ' · 距重置 ' + fmtResetCountdown(w.resetsAt - now) : '');
            }));
          const winNodes = [];
          for (let i = 0; i < visible.length; i++) {
            const w = visible[i];
            if (i > 0) winNodes.push(' · ');
            const remaining = remainingPercent(w);
            const numberClass = remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : '';
            winNodes.push(metric(compactWindowLabel(w.key), remaining + '%', numberClass));
            if (remaining <= LOW_QUOTA_PERCENT) winNodes.push(React.createElement('span', { key: 'low' + i, className: 'bi-low-status' }, '低'));
          }
          groups.push(React.createElement('span', { key: 'subwin', title: titleLines.join('\n') }, ...winNodes));
          // host 快照失败（sub.error）或本次 RPC 失败（errors.sub）→ 均保留旧数据 + 降级标记
          if (sub.error || errors.sub) {
            trailingErrorGroups.push(React.createElement('span', { className: 'bi-stale', key: 'substale', title: subscriptionFailureHint(sub.error || { kind: 'exception', message: String(errors.sub || '') }, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, '刷新失败'));
          }
          // 距重置倒计时（与显示的窗口一致，确保额度与倒计时匹配）
          if (displayWindow && displayWindow.resetsAt) {
            const cdTitle = displayWindow.label + '窗口 剩余 ' + remainingPercent(displayWindow)
              + '%（已用 ' + displayWindow.usedPercent + '%） · 重置 ' + formatDateTime(displayWindow.resetsAt);
            groups.push(React.createElement('span', { key: 'subcd', title: cdTitle },
              metric('距重置', fmtResetCountdown(displayWindow.resetsAt - now))));
          }
        }
      }

      const groups = [];
      // 报错不打断主要信息的阅读顺序：统一延后到整行最右侧。
      const trailingErrorGroups = [];
      // 两态严格判定：density 只能是 'full' 或 'compact'（host 校验 + 本地防抖保证）
      const full = displayDensity === 'full';
      // 模式互斥：订阅制渲染订阅版 row2，余额制渲染 v1.0.0 现状，绝不叠加
      const isSub = !!(visibleBillingMode && visibleBillingMode.mode === 'subscription');
      // Never paint a loading placeholder.  Before the active session's model
      // is available, leave this compact row empty rather than briefly showing
      // either a generic loading label or data from the previous session.
      if (waitForSessionModel) {
        // Intentionally empty: session model publish fills the row immediately.
      } else if (isSub) {
        pushSubscriptionGroups(groups, trailingErrorGroups);
      } else {
        pushBalanceGroups(groups, trailingErrorGroups);
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
        trailingErrorGroups.push(React.createElement('span', { className: 'bi-stale', key: 'degraded',
          title: failedLabels.join('、') + '暂不可用；正在保留上次数据并自动重试。' }, '刷新失败'));
      }
      const persistence = state.usage && state.usage.persistence;
      if (persistence && persistence.state && persistence.state !== 'ok') {
        const snapshotOnly = persistence.state === 'snapshot-stale';
        trailingErrorGroups.push(React.createElement('span', {
          className: snapshotOnly ? 'bi-stale' : 'bi-err', key: 'ledger-save',
          title: snapshotOnly
            ? '账单流水已保存，但可直接查看的账单文件暂未更新：' + (persistence.message || '未知原因')
            : '本次账单未保存，不会计入金额：' + (persistence.message || '未知原因'),
        }, snapshotOnly ? '账单待整理' : '账单未保存'));
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
      const seenRefreshFailure = { value: false };
      const visibleErrors = trailingErrorGroups.filter(function (node) {
        const text = node && node.props ? node.props.children : '';
        if (text !== '刷新失败') return true;
        if (seenRefreshFailure.value) return false;
        seenRefreshFailure.value = true;
        return true;
      });
      for (let i = 0; i < visibleErrors.length; i++) {
        if (groups.length > 0 || i > 0) nodes.push(React.createElement('span', { key: 'errsep' + i, className: 'bi-sep' }, '|'));
        nodes.push(React.createElement('span', { key: 'err' + i }, visibleErrors[i]));
      }
      const row2 = React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2' }, ...nodes);

      let row1 = null;
      if (statsProj) {
        // 每组：{ nodes: React 节点数组（数字用 num 加粗）, text: 纯文本（title 用） }
        const ng = [];
        function group(parts, hidden) {
          const nodesArr = [];
          const texts = [];
          function textOf(part) {
            if (part == null) return '';
            if (typeof part === 'string' || typeof part === 'number') return String(part);
            if (Array.isArray(part)) return part.map(textOf).join('');
            if (part.props && part.props['data-metric-text']) return part.props['data-metric-text'];
            return part.props ? textOf(part.props.children) : '';
          }
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (typeof p === 'string') { nodesArr.push(p); texts.push(p); }
            else if (Array.isArray(p)) { for (let j = 0; j < p.length; j++) nodesArr.push(p[j]); texts.push(textOf(p)); }
            else { nodesArr.push(p); texts.push(textOf(p)); }
          }
          ng.push({ nodes: nodesArr, text: texts.join(''), hidden: !!hidden });
        }

        // 中文界面遵循数字与汉字混排留白：数值与量词视觉上分开，便于快速扫读。
        group([num(statsProj.turns + ' 轮'), ' · ', num(statsProj.steps + ' 步')]);

        const durations = [];
        if (statsProj.llmMs > 0) durations.push(metric('LLM', formatDuration(statsProj.llmMs)));
        if (statsProj.toolMs > 0) durations.push(' · ', metric('工具调用', formatDuration(statsProj.toolMs)));
        if (durations.length > 0) group(durations);

        const speeds = [];
        if (statsProj.ttftSteps > 0) speeds.push(metric('首 token 平均', formatDuration(statsProj.ttftMs / statsProj.ttftSteps)));
        if (statsProj.decodeMs > 0) speeds.push(' · ', num(formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s'));
        if (speeds.length > 0) group(speeds, HIDE_SPEED_FIELDS); // 不占可见版式，title 浮窗保留

        if (usageProj && (billedInput(usageProj) > 0 || (usageProj.outputTokens || 0) > 0)) {
          const denom = billedInput(usageProj);
          const hit = denom > 0 ? Math.round(((usageProj.cacheReadTokens || 0) / denom) * 100) : null;
          if (hit != null) group([metric('缓存命中', hit + '%')]);
          group([metric('输入', formatTokens(billedInput(usageProj)) + ' tok'), ' · ', metric('输出', formatTokens(usageProj.outputTokens || 0) + ' tok')]);
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
        row1 = React.createElement('div', { id: 'dsh-bottom-info-bar-native', className: 'bi-native-row', title: nativeLine }, ...ngNodes);
      }

      const animatedRow1 = row1 === null ? null : React.createElement('div', { className: 'bi-density-extra' },
        React.createElement('div', { className: 'bi-density-extra-inner' }, row1));
      const rootCls = 'bi-root';
      return React.createElement('div', {
        className: rootCls,
        onClick: function () { props.onToggleDensity(); },
        onKeyDown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onToggleDensity();
          }
        },
        role: 'button',
        tabIndex: 0,
        'aria-labelledby': full && row1 !== null ? 'dsh-bottom-info-bar-native dsh-bottom-info-bar-primary' : 'dsh-bottom-info-bar-primary',
        'aria-describedby': 'dsh-bottom-info-bar-action',
        'aria-pressed': full,
        'aria-busy': isDensitySaving,
        'aria-disabled': isDensitySaving,
        'data-density': displayDensity,
        'data-density-saving': isDensitySaving,
        title: isDensitySaving ? '正在保存切换…' : '单击切换 完整/简洁',
      }, animatedRow1, row2,
      React.createElement('span', { id: 'dsh-bottom-info-bar-action', className: 'bi-sr-only' },
        full ? '按 Enter 或空格切换为简洁模式。' : '按 Enter 或空格切换为完整模式。'));
    }
  },
};
