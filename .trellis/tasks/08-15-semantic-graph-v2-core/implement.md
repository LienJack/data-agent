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

## 实施结果

- 新增 `SemanticGraphSource@2`、六类独立 Node、类型化 Edge registry、Formula slot AST 与 CAS patch 合同。
- 新增确定性 canonical digest、严格验证器、append-only patch reducer、现有 runtime bundle 与原生图投影 compiler。
- 新增 PostgreSQL Authority 投影表、scope-safe RPC、强制 RLS、服务端 adapter 与 10638 live SQL assertions。
- Graph v1 合同与现有测试保持不变；Graph v2 超出 U5 可执行子集时失败关闭。

## 验证结果

- contracts build；43 个测试文件、607 个单测与 7 个 port contract 全部通过。
- semantic build；11 个测试文件、116 个测试全部通过。
- platform build；Graph v2 adapter/migration 2 个测试文件、6 个测试全部通过。
- 10638 migration renderer checksum 验证通过；PostgreSQL 17 中 10638 migration 与 Graph v2 authority assertions 已实际执行成功并回滚测试事务。
- 仓库级 migration smoke 在后续、非本任务的 pricing assertion 因并行 username fixture 缺失而停止；与 10638 无关。
