# U2 Technical Design

## Authority Flow

```text
Authenticated Workspace Capability
  -> PostgreSQL Effective Config RPC
  -> lock Defaults + mutable pointers in fixed order
  -> resolve IDs/revisions from server registries
  -> enforce semantic/context/egress/safety policy
  -> canonical_sha256(config jsonb)
  -> immutable Config + Resource Binding Receipts
  -> accept Run/Command/Event/Outbox in the same transaction
  -> Worker reload + revalidation before Tool/Provider/Effect
```

TypeScript Resolver 是窄 RPC Adapter，不在 RPC 外先解析再调用旧 `acceptCommand`，避免 datasource/model/
semantic pointer 在两步之间变化。Schema parse 只产生 Candidate DTO，不授予 Authority brand。

## Public Contracts

### Workspace Defaults

`packages/contracts/src/workspaces/defaults.ts` 定义：

- `WorkspaceDefaultsRevision` / `WorkspaceDefaultsReference` / CAS update command；
- 单值与集合 Requested Selection；集合 canonical sort + duplicate rejection；
- Model、Datasource、Files、Knowledge、MCP、Skills、Semantic/Schema/Context/Egress/Safety refs；
- canonical hash material 与 `computeWorkspaceDefaultsHash`。

### Effective Config

`packages/contracts/src/runs/effective-config.ts` 分离：

1. `RunConfigRequest`：只含 operation、defaults ref、typed overrides、typed mentions、request hash。
2. `RunConfigResolutionReceipt`：`READY/BLOCKED/BOOTSTRAP_REQUIRED`、requested/effective diff、reason、Authz/
   Route Resolution、Defaults 与 Resolver policy binding。
3. `EffectiveRunConfigReceipt`：只为 `READY QUESTION_RUN`，冻结 Model Profile、Datasource、Published Semantic
   Release、Schema Snapshot、Context Capacity、Safety、Classification、Provider/Audience 和全部 resource bindings。
4. `EffectiveRunConfigReference`：`config_id + config_revision + config_hash`，是 Run/Worker/U3/U12 的唯一接缝。
5. `ContextReceiptBinding`：U2 的最小消费证明，不包含 U12 检索内容。

现有 `qaRunBindingSchema@1.0.0` 不加 required 字段；新增 V2 Run Start 合同并把两条新创建路径原子切换，
不做 dual-read。公共合同不导入 Mastra/Next/PostgreSQL SDK。

## PostgreSQL 10653

Greenfield DDL 创建五组空 Authority 表：

- `workspace_run_defaults`：当前 CAS pointer；
- `workspace_run_default_revisions`：append-only revision + idempotency/request hash；
- `effective_run_config_receipts`：每 Run 唯一、完整 canonical config/hash；
- `effective_run_config_resource_bindings`：逐资源 requested/effective/revision/hash/availability/reason；
- `effective_config_context_receipts`：`RUN_ACCEPTANCE | WORKER_START` 消费证明。

所有 PK/UQ/FK/谓词包含 App/Tenant/Environment/Workspace，用户对象再绑定 Principal。所有表启用并 FORCE RLS；
Backend 无直接 DML，只获得专用 `SECURITY DEFINER SET search_path=''` RPC execute。Revision/Receipt 有 immutable
trigger；Hash 只由 `platform.canonical_sha256(jsonb)` 计算。无 Backfill、无旧行转换。

## Web / Worker

- `GET/PATCH /api/workspaces/:workspaceId/defaults` 使用 U1 Action Matrix 的 Workspace read/admin semantics，写入
  必须 expected version + idempotency key。
- 通用 Run Route 与 QA Conversation Run Route 都调用同一 `acceptRunWithEffectiveConfig`；request body 不接受
  effective model/datasource/release/snapshot。
- Worker lease payload 只保留 config ref。`run-execution-context` 提供已重验的 config accessor；现有 Research
  Executor 不再以 raw QA binding 作为 Provider/Tool Authority。
- Route Handlers 使用当前 Next 文档的 `params: Promise<...>` 约定，公共 HTTP endpoint 每次都重验权限。

## Conflict Strategy

共享工作树已有非 U2 修改。以下脏文件如必须接线，仅 stage U2 精确 hunk，绝不整文件纳入：

- `packages/platform/src/index.ts`
- `packages/contracts/src/runs/runtime.ts`
- `apps/worker/src/runs/index.ts`
- `apps/worker/src/run-worker-cli.ts`
- `apps/worker/test/runs/run-worker-runner.spec.ts`
- `infra/supabase/test-support/static-check.sh`

优先通过新模块和专属测试避免触碰上述文件；确需 barrel/export/static-check 时使用可审计的独立 hunk。

## Security and Recovery

- 资源不存在、越权、删除统一失败，不泄漏存在性。
- Runtime revocation 只阻止新 Effect，不修改历史 Receipt。
- Receipt hash mismatch、scope/run mismatch、未知 consumer、stale Worker fence 全部失败关闭。
- Run acceptance 事务失败整体回滚；重复命令由 principal-scoped idempotency + request hash replay。
- U3/U12 只能扩展消费 Receipt，不能更改 U2 Config Authority。
