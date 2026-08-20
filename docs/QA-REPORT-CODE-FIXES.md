# 代码审计修复 QA 报告

## 范围

针对 `docs/AUDIT-CODE-REVIEW.md` 中的高/中风险项，验证 v1.3.0 后的修复工作区。

## 已验证修复

| 项目 | 结果 | 验证 |
|---|---|---|
| 客户端单个 RPC 失败不拖垮整栏 | ✅ | `test-client-fault-tolerance.js` 37 条断言 |
| RPC 超时与组件卸载中止 | ✅ | AbortController、20 秒超时、组件卸载清理断言 |
| NaN/Infinity/负数 usage 清洗 | ✅ | `test-usage-sanitize.js` 22 条断言 |
| 余额失败保留旧快照并防慢请求覆盖 | ✅ | `test-host-regressions.mjs` 竞态回归 |
| `llm/stream` 上游错误继续向上传播 | ✅ | `test-host-regressions.mjs` 回归 |
| 活跃服务商与余额/币种/花费对齐 | ✅ | OpenAI USD 与 DeepSeek CNY 隔离回归 |
| 原有信息栏能力未回归 | ✅ | 全量测试通过，12 个 RPC 完整 |

## 测试结果

```text
node plugin/scripts/build.mjs     PASS
node tests/run-all.mjs            PASS
```

全量测试共 10 组通过；新增客户端容错 37 条、usage 清洗 22 条、host 回归 22 条。

## 安全检查

- ✅ 未发现真实密钥；测试中的 `sk-test` 为明确的假凭据
- ✅ 更新代码未引入自动下载、自动执行或隐式远程代码执行
- ✅ RPC 仍保留原有同源校验、body 大小限制与状态码处理
- ⚠ `npm audit` 当前无法执行：项目没有 lockfile；后续发布 NPM 前应建立依赖锁定与 CI 依赖扫描

## 尚未处理的低优先事项

1. 记账只保留最近 3000 条，超出后「全部」实际代表已保留记录范围；需另行设计滚动汇总或明确提示。
2. v1.3.0 后仍有客户端未调用的旧 RPC 与 host 逻辑，建议独立清理，避免和本次修复混在一起。
3. 多次 `load()` 之间仍可存在旧响应覆盖新响应的竞态，当前不会污染数据但可能短暂显示旧快照。

## 结论

本轮审计发现的两项高风险和四项中风险问题均已有修复与回归测试；当前工作区可进入发布评审。低优先事项不阻塞本轮修复发布，但不应被视为永久解决。
