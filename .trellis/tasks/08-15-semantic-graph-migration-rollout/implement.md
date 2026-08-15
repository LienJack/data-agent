# Graph v1 迁移与上线执行计划

1. 建立 v1 representative fixtures、expected Graph v2 snapshots 和 unresolved taxonomy。
2. 实现 converter/report，保证 deterministic identity 和 no-guessing。
3. 运行 dual compile/query compare，证明旧 release/query run digest 不变。
4. 接入 exact validation/review/publish/rollback receipts 和 stale/concurrent gates。
5. 完成三个正例与歧义/cycle/unit/grain/fanout/RLS 负例 E2E。
6. 建立 feature flags、metrics/alerts、projection rebuild 和 rollback runbook。
7. 运行全仓 typecheck/test/build、migration-order、cross-layer、浏览器和 10k benchmark。
8. 执行环境级 Go/No-Go 与 rollback 演练，scoped commit 并归档 child。

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
