// 版本检查与极简信息提醒静态回归
const fs = require('fs')
const host = fs.readFileSync('plugin/src/host.js', 'utf8')
const client = fs.readFileSync('plugin/src/client-bundle.js', 'utf8')
let pass = 0
let fail = 0
function check(name, actual, expected = true) {
  if (actual === expected) { pass++; console.log('PASS ', name) }
  else { fail++; console.log('FAIL ', name, '—', actual, '!==', expected) }
}

const logicStart = host.indexOf('function stableVersion')
const logicEnd = host.indexOf('async function checkLatestVersion')
const { stableVersion, compareVersions } = Function(host.slice(logicStart, logicEnd) + '; return { stableVersion, compareVersions }')()

check('实际识别普通稳定版本号', JSON.stringify(stableVersion('1.4.1')) === JSON.stringify([1, 4, 1]))
check('实际识别 v 前缀版本号', JSON.stringify(stableVersion('v2.0.0')) === JSON.stringify([2, 0, 0]))
check('实际拒绝预发布版本号', stableVersion('1.4.1-rc.1') === null)
check('实际比较新版本大于当前版本', compareVersions('1.4.1', '1.4.0') > 0)
check('实际比较相同版本', compareVersions('1.4.0', '1.4.0') === 0)
check('实际比较旧版本小于当前版本', compareVersions('1.3.9', '1.4.0') < 0)
const registryMatch = host.match(/const UPDATE_REGISTRY_URL = '([^']+)'/)
let registryUrl = null
try { registryUrl = registryMatch ? new URL(registryMatch[1]) : null } catch { /* 静态检查失败 */ }
check('host 使用固定 NPM registry 地址', !!registryUrl
  && registryUrl.protocol === 'https:'
  && registryUrl.hostname === 'registry.npmjs.org'
  && registryUrl.pathname === '/dsh-bottom-info-bar/latest')
check('host 从 package.json 动态读取当前版本', host.includes("new URL('../package.json', import.meta.url)") && host.includes('packageVersion()'))
check('host 版本检查有 5 秒超时', host.includes('UPDATE_CHECK_TIMEOUT_MS = 5000') && host.includes('controller.abort()'))
check('host 只启动一次版本检查 Promise', host.includes('const updateInfoPromise = checkLatestVersion()'))
check('host 暴露 getUpdateInfo RPC', host.includes('getUpdateInfo: function ()') && host.includes('return updateInfoPromise'))
check('client 只调用一次 getUpdateInfo', (client.match(/rpc\('getUpdateInfo'/g) || []).length === 1)
check('client 无论是否有更新都保存当前插件版本', client.includes("typeof info.current === 'string') setUpdateInfo(info)"))
check('余额制服务商/模型 hover 显示当前插件版本', client.includes("'\\n插件版本：' + updateInfo.current"))
check('订阅制服务商/模型 hover 同样显示当前插件版本', (client.match(/'\\n插件版本：' \+ updateInfo\.current/g) || []).length === 2)
check('client 只在有更新时显示新版本提醒文字', client.includes("'新版本提醒'") && client.includes('updateInfo.available === true'))
check('更新标签提示语包含动态最新版本号', client.includes("title: '请告知你的 Agent 将本插件更新到“' + updateInfo.latest + '”版本。'"))
check('更新标签使用鲜红色提醒语义且无下划线', client.includes('.bi-update{ color: var(--bi-state-alert); font-weight: 600; }')
  && client.includes('--bi-state-alert: #d70015') && !client.includes('text-decoration: underline'))
check('更新标签不是链接或按钮', !client.includes('window.open') && !client.includes("<a") && !client.includes("'a'"))
check('不包含自动更新命令执行逻辑', !client.includes('child_process') && !host.includes('exec(') && !host.includes('spawn('))

console.log(`结果：${pass} PASS / ${fail} FAIL`)
process.exit(fail > 0 ? 1 : 0)
