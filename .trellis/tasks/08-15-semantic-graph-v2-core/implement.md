# Graph v2 核心执行计划

1. 预检当前 contracts、semantic compiler、release schema 和 migration 编号；记录并绕开并行改动。
2. 新增 Graph v2 artifacts、fixtures、strict parsing、canonical digest 和 public errors。
3. 新增 projection migration、RLS/privilege/RPC 与 repository/service 端口。
4. 实现 intrinsic-only/registry/Formula/cycle/fanout gates。
5. 实现 Graph v2 → Graph v1 runtime projection 和原生 graph projection。
6. 增加 determinism、negative gate、old release compatibility、RLS 和 migration tests。
7. 运行 package-local、migration-order、cross-layer 验证，scoped commit 后归档 child。

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/contracts test:contract
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm test:tenancy
```

Go/No-Go：Graph v2 正例未能确定性编译、旧 release digest 变化、RLS 可绕过或 Formula slot 可悬空
时停止，不启动 Agent runtime 子任务。
