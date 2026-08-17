# U8 Technical Design

## Authority split

```text
Run Event/Projection + Checkpoint + Effect Receipts (existing U4/U3/U14 truth)
  -> RunInterruption Head + immutable Reply/Operation Receipt (10666)
  -> exact Resume command (existing request_run_control)

Parent Conversation/Run/Checkpoint + Effective Config revalidation
  -> immutable SessionBranch
  -> child conversation identity; parent history remains referenced/read-only
```

## Contracts

`runs/interruption.ts` owns strict, content-addressed `RunInterruption`, `InterruptionReplyCommand`,
`InterruptionReplyReceipt`, `SessionBranchCommand` and `SessionBranchReceipt`. Hashes exclude only their own hash field.
The public DTO contains question/options/status and identifiers needed for UI actions, never private model context.

`run.suspended` adds exact `interruption_id + interruption_version`; the reducer requires the interruption snapshot and
Checkpoint to identify the same current fence. Resume does not accept a client boolean saying clarification was answered;
PostgreSQL proves the interruption terminal before invoking the existing control transition.

## PostgreSQL 10666

- `run_interruptions`: mutable state/version head with immutable identity/question hash and exact Run/Checkpoint/Fence.
- `run_interruption_replies`: append-only answer, actor, input hash and resulting version.
- `session_branches`: append-only parent boundary and child identity; no copied message/event/blob columns.
- `session_recovery_operation_receipts`: principal-scoped idempotency for create/reply commands.
- NOLOGIN owner, FORCE RLS, full Workspace/Run/Checkpoint/Effective Config foreign-key closure, immutable triggers and
  security-definer RPCs.

Lock order remains Run -> Projection -> Checkpoint/Interruption -> Operation Receipt. Reply+Resume uses one transaction:
verify OPEN/version/fence -> append reply -> advance interruption -> call/refactor existing control transition -> append
public event/outbox/audit. Any failure rolls back all rows.

## Platform and Web

`createPostgresSessionRecovery` is a narrow adapter that verifies command/result hashes and scope correlation.
Routes authorize the workspace, derive operation IDs from server principal + idempotency key, and never accept scope/actor.
The client reloads durable trajectory after Reply; local state only controls dialog visibility and draft text.

## Compatibility and rollback

Existing Cancel/Resume payload remains accepted. Historical `run.suspended` events stay readable through a versioned event
variant; only new interruption-aware suspension is replyable. Rollback disables the new routes/RPC grants while preserving
append-only branch/reply audit rows and all parent Run facts.
