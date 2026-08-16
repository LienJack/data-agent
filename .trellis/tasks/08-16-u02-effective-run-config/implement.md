# U2 Implementation Plan

## Ordered Work

1. Contract red tests：Defaults/Overrides/Mentions、stable reasons、semantic null boundary、hash binding、Context Receipt、
   strict rejection 与 no-commercial/no-secret surface。
2. Implement contracts and exports：`defaults.ts`、`effective-config.ts`、QA Run Start v2，保留 v1 wire schema 不变。
3. Platform resolver red tests：Authority Port unavailable、cross-workspace、stale revision、egress widening、replay/hash
   conflict、receipt revalidation。
4. Implement `createPostgresEffectiveConfigResolver`：窄 RPC adapter + exact row parsing；不在 RPC 外授予 Authority。
5. Allocate/render `10653`：空 tables、RLS、immutable triggers、defaults CAS、atomic run acceptance、receipt load/
   revalidate RPC、grants/postconditions/checksum；加入 SQL adversarial assertions。
6. Web integration：Defaults GET/PATCH；通用/QA Run routes 只提交 Candidate request 给 Resolver；Greenfield null
   release 返回 Bootstrap Required，未写 Run。
7. Worker integration：Lease 只消费 config ref；Worker Start 生成 consumption receipt；tampered/missing/revoked config
   在 Tool/Provider/Effect 前失败。
8. Full check：focused tests、package typecheck/build、renderer/static/smoke、scoped Biome、forbidden surface scan、
   fresh correctness/security review。
9. Stage only U2 owned paths/hunks，创建一个 U2 scoped functional commit；追加 parent Goal checkpoint 后进入 U3。

## Owned Paths

### Contracts

- `packages/contracts/src/workspaces/data-isolation.ts`
- `packages/contracts/src/runs/effective-config.ts`
- `packages/contracts/src/workspaces/defaults.ts`
- `packages/contracts/src/workspaces/qa-resources.ts`
- `packages/contracts/src/runs/index.ts`
- `packages/contracts/src/workspaces/index.ts`
- `packages/contracts/test/effective-run-config.spec.ts`
- `packages/contracts/test/workspace-data-isolation.spec.ts`

### Platform

- `packages/platform/src/runs/effective-config-resolver.ts`
- `packages/platform/src/persistence/workspace-data-repository.ts`
- `packages/platform/src/queue/postgres-run-queue.ts`
- `packages/platform/src/events/postgres-run-event-store.ts`
- `packages/platform/src/index.ts`（U2 export hunk only）
- `packages/platform/test/runs/effective-config-resolver.spec.ts`
- `packages/platform/test/persistence/workspace-data-repository.spec.ts`
- `packages/platform/test/queue/postgres-run-queue.spec.ts`
- `packages/platform/test/events/postgres-run-event-store.spec.ts`
- `packages/platform/test/contract/platform-surface.spec.ts`（U2 surface hunk only）

### Web / Worker

- `apps/web/src/app/api/workspaces/[workspaceId]/defaults/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/runs/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route.ts`
- `apps/web/src/app/page.tsx`（active bound Conversation submission hunk only）
- `apps/web/src/components/workbench/query-input-section.tsx`（submission disabled hunk only）
- `apps/web/src/lib/analysis-run-submission.ts`
- `apps/web/src/lib/api-client.ts`（versioned generic Run binding hunk only）
- `apps/web/src/lib/datasource-api.ts`
- `apps/web/src/lib/datasource-types.ts`
- `apps/web/src/lib/run-command-identity.ts`
- `apps/web/src/lib/workspace-identity.ts`（U2 resolver factory hunk only）
- `apps/web/src/lib/workspace-run.ts`
- `apps/web/test/workspace-run-effective-config.spec.ts`
- `apps/web/test/datasource-api-version.spec.ts`
- `apps/worker/src/runs/run-execution-context.ts`
- `apps/worker/src/runs/research-workflow-executor.ts`
- `apps/worker/src/runs/run-worker-runner.ts`
- `apps/worker/src/runs/multi-principal-runner.ts`
- `apps/worker/src/runs/index.ts`（U2 exports only）
- `apps/worker/src/run-worker-cli.ts`（U2 Effective Config 与 runnable-principal hunks only）
- `apps/worker/src/system-model-certification-cli.ts`
- `apps/worker/test/runs/run-effective-config.spec.ts`
- `apps/worker/test/runs/run-execution-context-provenance.spec.ts`
- `apps/worker/test/runs/multi-principal-runner.spec.ts`
- `apps/worker/test/runs/run-worker-runner.spec.ts`（U2 fixture hunks only）
- `apps/worker/test/runs/support/effective-config-fixture.ts`
- `apps/worker/test/integration/run-runtime.spec.ts`（U2 fixture hunk only）

### Shared Runtime Contract

- `packages/contracts/src/runs/runtime.ts`（Lease Principal binding only）
- `packages/contracts/test/run-runtime.spec.ts`（Lease fixture hunk only）

### PostgreSQL

- `infra/supabase/apps/data-agent/migration-sources/10653/**`
- `infra/supabase/apps/data-agent/migrations/20260725010653_app_data_agent_effective_run_config.sql`
- `scripts/render-10653-migration.ts`
- `infra/supabase/test-support/31-effective-run-config-authority-assertions.sql`
- `infra/supabase/test-support/static-check.sh`（10636–10653 generated-renderer routing；修复 generic
  single-checksum 分支对双 checksum rendered migration 的误判）

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/effective-run-config.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/runs/effective-config-resolver.spec.ts test/contract/platform-surface.spec.ts
pnpm --filter @data-agent/web exec vitest run test/workspace-run-effective-config.spec.ts
pnpm --filter @data-agent/worker exec vitest run test/runs/run-effective-config.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/worker typecheck && pnpm --filter @data-agent/worker build
pnpm exec tsx scripts/render-10653-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
sh infra/supabase/test-support/run-postgres-smoke.sh
```

## Review Gates

- Contracts cannot create an `Authoritative` brand from caller JSON.
- Atomic RPC is the only production path that writes a READY receipt and accepts a Run.
- Worker cannot reach Tool/Provider/Effect with a raw/tampered/missing/revoked config.
- No model Provider call, Falcon import, Backfill, dual-read, billing or Mastra public export appears in the U2 diff.

## Implementation Result

- PostgreSQL `10653` 在同一事务内解析 Defaults、Conversation、Model、Datasource、Semantic Release、Schema
  Snapshot 与 Policy，并原子冻结 Effective Config、Resource Bindings、Run acceptance 和 Context Receipt。
- Defaults 公共写入只接受 ID/revision selection intent；完整 resource hash、status、release/snapshot 与 policy
  均由数据库 Authority 解析。Datasource `resource_version` 由数据库单调维护并完整投影到 Web。
- QUESTION RPC 使用严格 `{resolution,effective_config}` envelope：READY 两者 exact 关联；BLOCKED/
  BOOTSTRAP_REQUIRED 的 Effective Config 必须为 null 且零 Run/Receipt 副作用。
- 四类 optional selection 通过 hash-covered `optional_selection_evaluations` 冻结 mode/count/Defaults ref；空
  INHERIT 不伪造 unavailable reason，非空 INHERIT 与 DEFAULT bindings 精确闭合。
- Worker 在 projection、terminal settlement、event、heartbeat、Tool、Provider 与任何 Effect 前重验 PostgreSQL
  Receipt；运行上下文带不可伪造 provenance，多 Principal runner 只轮询可运行角色并保证 round-robin fairness。
- Web 两条 Run 路由使用同一 Resolver、确定性幂等 identity 与 exact Conversation binding；Analysis 页面在没有
  已绑定对话时禁用提交，不回退到客户端猜测 Defaults。
- 最终 migration checksum：
  `sha256:9782a7b7a906e5f2c8bc79419609cabf7911487987c08ba0da926cd0df7dd146`。
- 验证：Contracts `51 files / 674 tests`；Platform relevant `46 files / 371 tests`；Web `63 passed / 1
  skipped files, 242 passed / 1 skipped tests`；Worker `12 passed / 2 skipped files, 75 passed / 9 skipped tests`；
  Contracts/Platform/Worker typecheck+build、focused Biome、renderer verify、完整 SQL static-check、fresh PostgreSQL
  17 migration chain 与 31 assertions 全绿。
- 最终独立对抗审查 PASS，未发现剩余 U2-owned P0/P1。全 Web typecheck 的唯一失败来自非 U2 并行 fixture
  `qa-resource-catalog.spec.ts` 未补 `ResolvedSystemModel.capabilities`；干净 U2 候选提交需单独复验。
