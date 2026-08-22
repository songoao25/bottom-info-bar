// 会话级实时模型同步回归：不能再把进程全局默认模型显示给另一个已激活会话。
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../plugin/src/client-bundle.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../plugin/src/host.js', import.meta.url), 'utf8')
let failed = 0
function check(name, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name)
  if (!ok) failed += 1
}

check('客户端订阅 DSH 的会话级 modelDirectories 服务', client.includes("ctx.get('modelDirectories')")
  && client.includes('directories.directoryFor(sessionId)')
  && client.includes('directory.store.subscribe(publish)'))
check('客户端不再以 2 秒 getBillingMode 轮询检测模型切换', !client.includes("}, 2000);")
  && !client.includes('模型/服务商切换秒级同步'))
check('会话切换时立即清除上一个会话的模型状态', client.includes('setSessionModel(null);'))
check('模型/服务商显示以会话状态优先，慢速 RPC 不阻塞', client.includes('const visiblePricing = activeSessionModel')
  && client.includes('const visibleBillingMode = activeSessionModel'))
check('已访问会话的模型缓存跨 composer remount 保留', client.includes('const sessionModelCache = new Map()')
  && client.includes('const cachedSessionModel = sessionId ? sessionModelCache.get(sessionId) : null'))
check('模型或订阅额度未到时不渲染加载中文字', !client.includes("key: 'loading' }, '加载中…'")
  && !client.includes("key: 'subload' }, '订阅额度加载中…'"))
check('模型切换不注入插件自定义动画，交给宿主默认行为', !client.includes('bi-model-crossfade')
  && !client.includes('@keyframes bi-model-enter')
  && !client.includes('modelTransitionKey'))
check('旧会话的迟到响应不能覆盖新会话', client.includes('requestVersion !== loadVersionRef.current'))
check('会话选择连同所有相关 RPC 发送到 host', client.includes('const selectionArgs = activeSelection')
  && client.includes("rpc('getPricing', selectionArgs")
  && client.includes("rpc('getBillingMode', selectionArgs")
  && client.includes("rpc('getSubscriptionSnapshot', selectionArgs"))
check('host 校验会话选择并在缺失时安全回退', host.includes('function selectionFromArgs(args)')
  && host.includes('return modelSelection();'))
check('host 的定价、模式、订阅和花费汇总均接受会话选择', host.includes('computePricing(Date.now(), sel)')
  && host.includes('getSubscriptionSnapshotRpc(selectionFromArgs(args))')
  && host.includes('getUsageSummary(Date.now(), sessionId, selectionFromArgs(args))'))

console.log(failed === 0 ? '\n结果：全部 PASS' : '\n结果：' + failed + ' 项 FAIL')
process.exit(failed === 0 ? 0 : 1)
