# 语义图读取与聚类执行计划

1. 冻结 list/detail/neighborhood/path/impact/diff/cluster contracts 和 consistency token。
2. 实现 release + candidate overlay projection resolver 与统一 authorization hydration。
3. 扩展 relationship index 到 Graph v2 local/path read，加入 250/500 budget/continuation。
4. 实现 domain-first + seeded Louvain dendrogram community hierarchy、family weight receipt、digest、
   rebuild/compare/health。
5. 实现 full graph level expansion 与 500 glyph budget。
6. 增加 10k benchmark、scope leakage、projection consistency、index failure degradation 测试。
7. 运行验证、scoped commit 并归档 child。

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
```

Go/No-Go：identity/status 不一致、聚合泄漏不可见对象、预算可绕过或 projection 无法重建时不开放
前端 Full Graph。
