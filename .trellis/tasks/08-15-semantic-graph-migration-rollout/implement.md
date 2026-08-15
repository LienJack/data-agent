# Graph v1 迁移与上线执行计划

1. 将已交付 Studio 的局部图/全图切换为 AntV G6 v5，按 GraphRAG 风格完成 cluster-first、
   semantic zoom、Minimap、可访问 fallback 和大图预算验证。
2. 补齐真实 Worker 对 semantic authoring run 的 claim/recovery/Agent tool loop，禁止 Web 执行工具。
3. 建立 v1 representative fixtures、expected Graph v2 snapshots 和 unresolved taxonomy。
4. 实现 converter/report，保证 deterministic identity 和 no-guessing。
5. 运行 dual compile/query compare，证明旧 release/query run digest 不变。
6. 接入 exact validation/review/publish/rollback receipts 和 stale/concurrent gates。
7. 完成三个正例与歧义/cycle/unit/grain/fanout/RLS 负例 E2E。
8. 建立 feature flags、metrics/alerts、projection rebuild 和 rollback runbook。
9. 运行全仓 typecheck/test/build、migration-order、cross-layer、浏览器和 10k benchmark。
10. 执行环境级 Go/No-Go 与 rollback 演练，scoped commit 并归档 child。

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:tenancy
pnpm test:security
pnpm build
```

Go/No-Go：任何 compile mismatch、旧 digest 改写、candidate 泄漏到 active runtime、RLS 绕过、不可恢复
回滚或正/负验收失败时不开放 Graph v2 publish。
# 后置完成门禁

本任务完成只表示语义层可以进入 Falcon 验收，不表示父需求完成。语义层 rollout 全绿后，必须按
`08-15-falcon-demo-eval/implement.md` 继续完成固定 28 库导入、db24 主 Demo、db14 smoke、DEV 309、
TEST 191 submission 和全部 Falcon 回归；Falcon 未全绿时父任务保持进行中。
