// 服务商/模型显示名自动识别回归（兼容任意服务商），提取 plugin/src/host.js 中的逻辑验证
// 用法：node tests/test-host-v7.js
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

// 提取 PROVIDER_DISPLAY / MODEL_VENDOR_PREFIXES 与两个函数，在桩环境执行
function extractConst(name) {
  const re = new RegExp('const ' + name + ' = ([\\s\\S]*?);\\n', 'm');
  const m = src.match(re);
  if (!m) throw new Error('未找到 ' + name);
  return eval('(' + m[1] + ')');
}
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\(([\\s\\S]*?)\\n    }', 'm');
  const m = src.match(re);
  if (!m) throw new Error('未找到 function ' + name);
  const body = m[0].replace(/^function /, 'function ');
  return eval('(' + body + ')');
}

const PROVIDER_DISPLAY = extractConst('PROVIDER_DISPLAY');
const MODEL_VENDOR_PREFIXES = extractConst('MODEL_VENDOR_PREFIXES');
const providerDisplayName = extractFn('providerDisplayName');
const modelDisplayName = extractFn('modelDisplayName');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- 服务商显示名 ----
check('deepseek → DeepSeek', providerDisplayName('deepseek'), 'DeepSeek');
check('deepseek-official → DeepSeek（不显示 official）', providerDisplayName('deepseek-official'), 'DeepSeek');
check('openrouter → OpenRouter', providerDisplayName('openrouter'), 'OpenRouter');
check('openai → OpenAI', providerDisplayName('openai'), 'OpenAI');
check('kimi → Kimi', providerDisplayName('kimi'), 'Kimi');
check('glm → GLM', providerDisplayName('glm'), 'GLM');
check('moonshot → Moonshot', providerDisplayName('moonshot'), 'Moonshot');
check('未知服务商 zzz → Zzz', providerDisplayName('zzz'), 'Zzz');
check('空服务商 → 未知服务商', providerDisplayName(''), '未知服务商');
check('undefined → 未知服务商', providerDisplayName(undefined), '未知服务商');

// ---- 模型显示名 ----
check('deepseek-v4-flash → V4 Flash（去厂商前缀）', modelDisplayName('deepseek-v4-flash'), 'V4 Flash');
check('deepseek-chat → Chat（去厂商前缀）', modelDisplayName('deepseek-chat'), 'Chat');
check('gpt-4o → 4O（去厂商前缀）', modelDisplayName('gpt-4o'), '4O');
check('gpt-4o-mini → 4O Mini（去厂商前缀）', modelDisplayName('gpt-4o-mini'), '4O Mini');
check('glm-4.6 → 4.6（去厂商前缀）', modelDisplayName('glm-4.6'), '4.6');
check('kimi-k2 → K2（去厂商前缀）', modelDisplayName('kimi-k2'), 'K2');
check('moonshot-v1 → V1（去厂商前缀）', modelDisplayName('moonshot-v1'), 'V1');
check('qwen-max → Max（去厂商前缀）', modelDisplayName('qwen-max'), 'Max');
check('claude-3-5-sonnet → 3 5 Sonnet（去厂商前缀）', modelDisplayName('claude-3-5-sonnet'), '3 5 Sonnet');
check('gemini-2.5-pro → 2.5 Pro（去厂商前缀）', modelDisplayName('gemini-2.5-pro'), '2.5 Pro');
check('未知模型 my-model → my-model（原样）', modelDisplayName('my-model'), 'my-model');
check('空模型 → 未知模型', modelDisplayName(''), '未知模型');

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
