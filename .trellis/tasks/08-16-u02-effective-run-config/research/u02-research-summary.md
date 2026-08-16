# U2 Repository Research Summary

## Existing Gap

当前通用 Run Route 在 Web 先读 Datasource/Conversation，再调用 Repository 接受 Run；QA Route 虽在事务内解析
Model/Datasource，但没有冻结 Semantic Release、Schema Snapshot、Context/Egress/Safety Policy。两条路径都没有
Effective Config Receipt，Worker 只解析 lease payload 中的 raw QA binding，存在 TOCTOU 与 payload override 旁路。

## Chosen Direction

- 生产解析/冻结/Run 接受必须是单个 PostgreSQL 窄 RPC；TypeScript Resolver 只是 Adapter。
- `WorkspaceDefaultsRevision -> RunConfigRequest -> ConfigResolutionReceipt -> EffectiveRunConfigRef ->
  ContextReceiptBinding`。
- 客户端只提交 stable Resource ID/expected revision；Mention display name 不参与解析。
- `QUESTION_RUN` 必须有 Published Release + Snapshot；null release 只进入独立 Bootstrap Job。
- Worker 从 PostgreSQL Receipt 重取并重验，不信 payload 展开字段。
- U2 使用 Ledger `10653`；只建空 Authority Schema，无数据导入/Backfill。

## Existing Patterns

- Common hash/identity: `packages/contracts/src/common/primitives.ts`、`canonical-json.ts`。
- Workspace Authority: `packages/platform/src/tenancy/postgres-workspace-authority.ts`。
- Transaction revalidation: `packages/platform/src/persistence/transaction.ts`。
- Current QA resource wire: `packages/contracts/src/workspaces/qa-resources.ts`。
- Current Run routes: generic `/runs` and QA conversation `/runs`。
- Worker boundary: `apps/worker/src/runs/run-execution-context.ts` and `research-workflow-executor.ts`。

## Shared-worktree Risks

Platform root barrel、runtime/queue、Worker runner/index、SQL static-check 已有非 U2 修改。实现应优先新建模块；必须
修改时只 stage U2 hunk，并在 commit 前以 `git diff --cached --name-status/stat/check` 审计。
