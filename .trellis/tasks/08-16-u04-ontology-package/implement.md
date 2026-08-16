# U4 Implementation Plan

## Ordered Work

1. Contract red tests：Namespace、stable ID、source allowlist、package canonical hash、dependency/import、Constraint、Mapping、
   Metric/Formula、Mandatory Manifest、Provenance 与 hostile/duplicate inputs。
2. 新增 `ontology-package.ts`，扩展 Graph v2 roles/typed edges，并导出 canonical builders/verifiers。
3. Semantic red tests：相同 Candidate 重排稳定、依赖循环、Domain/Range、Constraint、Snapshot、Join proof、AST digest、
   optional unresolved 与 mandatory admission。
4. 实现 package canonicalizer/compiler/validator；复用现有 Graph v2 kernel，不创建第二个 Graph 模型。
5. PostgreSQL 10655 red assertion + renderer，随后实现三表、窄 RPC、RLS/owner/grants/immutability/replay。
6. Platform bootstrap integration：固定 Greenfield Candidate commit validation/preview，空 Registry 下 exact hash；不发布。
7. 全量 focused/typecheck/build、renderer/static/fresh PG17、Biome/diff/forbidden scan。
8. 独立 Trellis check；修复 P0/P1 后只 stage U4 owned paths，创建 scoped commit并进入 U5。

## Owned Paths

- `.trellis/tasks/08-16-u04-ontology-package/**`
- `packages/contracts/src/artifacts/ontology-package.ts`
- `packages/contracts/src/artifacts/semantic-graph-v2.ts`（U4 roles/edge semantics only）
- `packages/contracts/src/artifacts/semantic-governance.ts`（source/provenance closure only）
- `packages/contracts/src/artifacts/semantic-control-plane.ts`（package refs only）
- `packages/contracts/src/artifacts/index.ts`（U4 export hunk only）
- `packages/contracts/test/ontology-package.spec.ts`
- `packages/contracts/test/semantic-graph-v2.spec.ts`（U4 cases only）
- `packages/semantic/src/graph-v2/canonicalize.ts`
- `packages/semantic/src/graph-v2/compiler.ts`
- `packages/semantic/src/graph-v2/validator.ts`
- `packages/semantic/src/graph-v2/errors.ts`（U4 codes only）
- `packages/semantic/src/graph-v2/ontology-package.ts`
- `packages/semantic/test/fixtures/ontology-package.ts`
- `packages/semantic/test/semantic-graph-v2.spec.ts`（U4 cases only）
- `packages/platform/src/semantic/postgres-ontology-package.ts`
- `packages/platform/test/semantic/semantic-graph-bootstrap.spec.ts`
- `infra/supabase/apps/data-agent/migration-sources/10655/**`
- `infra/supabase/apps/data-agent/migrations/20260725010655_app_data_agent_ontology_package_authority.sql`
- `infra/supabase/test-support/33-ontology-package-authority-assertions.sql`
- `scripts/render-10655-migration.ts`
- `infra/supabase/test-support/static-check.sh`（10655 routing only）

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/ontology-package.spec.ts test/semantic-graph-v2.spec.ts
pnpm --filter @data-agent/semantic exec vitest run test/semantic-graph-v2.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/semantic/semantic-graph-bootstrap.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/semantic typecheck && pnpm --filter @data-agent/semantic build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm exec tsx scripts/render-10655-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
```

Fresh PostgreSQL 使用所有数据导入 hook=`/dev/null`，只安装 migration 并运行 33 assertions。不得运行 Falcon、Provider、
数据导入或发布 RPC。
