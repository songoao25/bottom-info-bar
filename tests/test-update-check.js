// 版本检查与极简红色提醒静态回归
const fs = require('fs')
const host = fs.readFileSync('plugin/src/host.js', 'utf8')
const client = fs.readFileSync('plugin/src/client-bundle.js', 'utf8')
let pass = 0
let fail = 0
function check(name, actual, expected = true) {
  if (actual === expected) { pass++; console.log('PASS ', name) }
  else { fail++; console.log('FAIL ', name, '—', actual, '!==', expected) }
}

check('host 使用固定 NPM registry 地址', host.includes("https://registry.npmjs.org/dsh-bottom-info-bar/latest"))
check('host 从 package.json 动态读取当前版本', host.includes("new URL('../package.json', import.meta.url)") && host.includes('packageVersion()'))
check('host 版本检查有 5 秒超时', host.includes('UPDATE_CHECK_TIMEOUT_MS = 5000') && host.includes('controller.abort()'))
check('host 只启动一次版本检查 Promise', host.includes('const updateInfoPromise = checkLatestVersion()'))
check('host 暴露 getUpdateInfo RPC', host.includes('getUpdateInfo: function ()') && host.includes('return updateInfoPromise'))
check('client 只调用一次 getUpdateInfo', (client.match(/rpc\('getUpdateInfo'/g) || []).length === 1)
check('client 只在有更新时显示箭头和版本号', client.includes("'↑ ' + updateInfo.latest") && client.includes('updateInfo.available === true'))
check('更新标签使用红色语义色', client.includes('.bi-update{ color: var(--dsw-alias-state-error-primary'))
check('更新标签不是链接或按钮', !client.includes('window.open') && !client.includes("<a") && !client.includes("'a'"))
check('不包含自动更新命令执行逻辑', !client.includes('child_process') && !host.includes('exec(') && !host.includes('spawn('))

console.log(`结果：${pass} PASS / ${fail} FAIL`)
process.exit(fail > 0 ? 1 : 0)
