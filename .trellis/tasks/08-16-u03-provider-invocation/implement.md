# U3 Implementation Plan

## Ordered Work

1. Contract red tests：dispatch/intents/outcomes/usage/public projection、pricing-free `AgentDataProjectionReceipt` v2、
   hash tamper、cross-scope、canonical ordering、token unavailable、capability matrix、privacy/no-commercial surface；旧
   projection v1 不得进入 U3 admission。
2. Freeze Profile identity：Catalog config version、`model-profile@<version>`、Certification claims、adapter version、system/
   managed binding kind 与 DeepSeek V4 Flash exact model ID 全链一致。
3. Implement `provider-invocation.ts` and refine ephemeral ModelProvider transport：durable permit required，新增真实网络前
   suspension point、usage-unavailable/throttled/delivery uncertainty，不让 caller 创建 Authority。
4. Allocate/render PostgreSQL `10654`：execution-ready Profile/Conversation selection resolver、Intent/Attempt Permit/
   Outcome/Usage 四张 append-only Authority 表、RLS/owner/grants、begin/dispatch/response-observed/terminal/unknown/
   reconcile/load RPC 与 adversarial assertions。
5. Platform store red tests and adapter：exact RPC arguments/rows/hashes、stable error map、idempotent replay、active lease/
   U2 context correlation、Conversation exact selections、no Billing/Pricing/Credit SQL。
6. Fix QA Run selection：从 PostgreSQL 窄读 current Conversation Model/Datasource revisions，构造 RESOURCE_IDS，U2
   原子 acceptance 继续锁行复验；Default=A/Conversation=B 必须得到 B。
7. Worker audited wrapper red tests：intent-before-network、dispatch marker suspension、raw-free response-observed marker、
   capacity zero-call rejection、completed/failed/throttled/unknown、token unavailable、stream protocol、crash matrix、
   raw-data/log redaction。
8. Worker integration：private transport composition、`RunExecutionContext` opaque dispatch capability、Executor actual model
   call、terminal Receipt before success event、restart/replay/reconcile path；新 run path不导入 Billing composition。
9. Web execution catalog/selector：server-owned certification/context readiness、stale/profile version CAS、全 UI states、
   no `UNBILLABLE` or commercial fields；证明 selection -> U2 config -> Worker receipt correlation。
10. Instrumented integration：两个 fake Profiles 产生不同 receipts；billing table SQL spy无访问；invalid config/context/
    lease/fence 为零 transport calls。
11. Isolated real proof：一次 DeepSeek V4 Flash 调用，使用 redacted env mapping、无其他 Provider；验证 committed
    Invocation + Usage Receipt 和 response/dispatch hashes，不打印 prompt、response 或 secret。
12. Full check：focused/full package tests、typecheck/build、renderer/static/fresh PG17 smoke、scoped Biome/diff/forbidden
    scans、correctness/security/reliability independent review。
13. Stage only U3 owned paths/hunks，创建一个 scoped functional commit，追加 parent Goal checkpoint，进入 U4。

## Owned Paths

### Contracts

- `packages/contracts/src/artifacts/types.ts`（fixed ProviderResponseArtifact system type only）
- `packages/contracts/src/artifacts/index.ts`（U3 response artifact exports only）
- `packages/contracts/src/providers/provider-invocation.ts`
- `packages/contracts/src/providers/index.ts`（U3 exports/certification semantics hunk）
- `packages/contracts/src/ports/model-provider.ts`
- `packages/contracts/src/workspaces/qa-resources.ts`
- `packages/contracts/test/provider-invocation.spec.ts`
- `packages/contracts/test/model-provider-connections.spec.ts`（U3 cases only）
- `packages/contracts/test/qa-resources.spec.ts`（U3 readiness cases only）

### Agent Runtime

- `packages/agent-runtime/src/model-provider-port.ts`
- `packages/agent-runtime/src/mastra/execution-bridge.ts`
- `packages/agent-runtime/src/mastra/mastra-execution-bridge.ts`
- `packages/agent-runtime/src/mastra/model-provider-adapter.ts`
- `packages/agent-runtime/src/mastra/errors.ts`
- `packages/agent-runtime/src/models/certification.ts`
- `packages/agent-runtime/src/models/bindings.ts`
- `packages/agent-runtime/src/models/system-deployments.ts`
- 对应 model-provider/mastra/certification tests（U3 exact cases only）

### Platform

- `packages/platform/src/providers/postgres-provider-invocation-store.ts`
- `packages/platform/src/providers/index.ts`
- `packages/platform/src/index.ts`（U3 exports only）
- `packages/platform/test/providers/postgres-provider-invocation-store.spec.ts`
- `packages/platform/test/contract/platform-surface.spec.ts`（U3 surface hunk only）

### Worker

- `apps/worker/src/providers/audited-model-provider.ts`
- `apps/worker/src/providers/index.ts`
- `apps/worker/src/runs/run-execution-context.ts`
- `apps/worker/src/runs/run-worker-runner.ts`（opaque provider-dispatch capability pass-through only）
- `apps/worker/src/runs/research-workflow-executor.ts`
- `apps/worker/src/run-worker-cli.ts`（U3 composition hunk only）
- `apps/worker/test/providers/audited-model-provider.spec.ts`
- `apps/worker/test/runs/run-model-provider-binding.spec.ts`
- `apps/worker/test/runs/run-execution-context-provenance.spec.ts`（U3 cases only）

### Web

- `apps/web/src/app/api/workspaces/[workspaceId]/qa/resources/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route.ts`（selection hunk only）
- `apps/web/src/components/qa/model-selector.tsx`
- `apps/web/src/lib/qa-resource-catalog.ts`
- `apps/web/src/lib/qa-store.ts`（U3 resource-state hunk only）
- `apps/web/src/lib/model-provider-admin.ts`（execution projection only）
- `apps/web/src/lib/workspace-identity.ts`（U3 resolver factory hunk only）
- `apps/web/test/qa-model-effective-config.spec.ts`
- `apps/web/test/qa-resource-catalog.spec.ts`（U3 readiness cases only）

### PostgreSQL

- `infra/supabase/apps/data-agent/migration-sources/10654/**`
- `infra/supabase/apps/data-agent/migrations/20260725010654_app_data_agent_provider_invocation_authority.sql`
- `scripts/render-10654-migration.ts`
- `infra/supabase/test-support/32-provider-invocation-authority-assertions.sql`
- `infra/supabase/test-support/static-check.sh`（10654 renderer/assertion routing only）

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/provider-invocation.spec.ts test/model-provider-connections.spec.ts test/qa-resources.spec.ts
pnpm --filter @data-agent/agent-runtime exec vitest run test/model-provider-port.spec.ts test/mastra-model-provider-adapter.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/providers/postgres-provider-invocation-store.spec.ts
pnpm --filter @data-agent/worker exec vitest run test/providers/audited-model-provider.spec.ts test/runs/run-model-provider-binding.spec.ts
pnpm --filter @data-agent/web exec vitest run test/qa-model-effective-config.spec.ts test/qa-resource-catalog.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/agent-runtime typecheck && pnpm --filter @data-agent/agent-runtime build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm --filter @data-agent/worker typecheck && pnpm --filter @data-agent/worker build
pnpm --filter @data-agent/web typecheck
pnpm exec tsx scripts/render-10654-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
```

真实 smoke 单独运行，必须满足 DeepSeek V4 Flash 唯一调用、隔离 Workspace/DB、无生产 SecretRef、日志脱敏与
Receipt committed；不得与 unit/fresh SQL tests 混跑。
