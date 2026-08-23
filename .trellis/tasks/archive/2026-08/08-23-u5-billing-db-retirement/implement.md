# U5 实施

1. 盘点计费表、mutation function/trigger/grant 和现有 renderer 模式。
2. 先写 SQL static/PG assertion，证明历史 digest、零写权和旧 RPC 不存在。
3. 实现/render `10703`，更新 manifest 与 smoke harness。
4. 运行 migration inventory、static check、filtered PG17 smoke，再运行完整 PG smoke。
5. 将 `workspace-identity-billing` 拆为当前 Workspace Identity/商业归档规范并提交 scoped commit。

## Evidence

- `pnpm typecheck`
- `pnpm exec vitest run tests/commercial-archive-retirement-migration.spec.ts tests/billing-code-retirement.spec.ts tests/model-runtime-noncommercial.spec.ts --exclude '.worktrees/**' --exclude '**/.next/**'`
- `pnpm exec tsx scripts/render-10703-migration.ts --verify`
- `pnpm exec tsx scripts/verify-workspace-migration-inventory.ts`
- `./infra/supabase/test-support/static-check.sh`
- `DATA_AGENT_POSTGRES_ASSERTION_FILTER=19y-commercial-archive-retirement-assertions.sql ./infra/supabase/test-support/run-postgres-smoke.sh`
- `DATA_AGENT_POSTGRES_ASSERTION_FILTER=19zzzzz-operations-admin-assertions.sql ./infra/supabase/test-support/run-postgres-smoke.sh`
