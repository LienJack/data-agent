# Session Recovery Authority

> U8 的 Run Interruption、Reply+Resume 与引用式 Session Branch 可执行合同。

## 1. Scope / Trigger

- 修改 `run.suspended`、Checkpoint 恢复、Cancel/Resume、澄清回复、Session Branch、分析页刷新恢复或
  `10666` 时适用。
- PostgreSQL Run Event/Projection、Checkpoint、Effective Config 与 Effect Receipt 是恢复事实；Zustand、
  Mastra Snapshot、客户端 version/fence 或复制的消息不是 Authority。
- U8 不改变 Provider/MCP unknown-effect 语义，不实现 U9 Trace 或 U20 Profile 编排。

## 2. Signatures

```ts
buildRunInterruption(input): Promise<RunInterruption>;
buildInterruptionReplyCommand(input): Promise<InterruptionReplyCommand>;
buildSessionBranchCommand(input): Promise<SessionBranchCommand>;
createPostgresSessionRecovery({ pool, authorizer }).reply(capability, command);
```

```sql
open_run_interruption(command jsonb) returns jsonb
reply_run_interruption(command jsonb) returns jsonb
create_session_branch(command jsonb) returns jsonb
load_run_interruption(requested_run_id uuid) returns jsonb
list_session_branches(requested_parent_run_id uuid) returns jsonb
```

```text
GET|POST /api/workspaces/{workspaceId}/runs/{runId}/interruptions
GET|POST /api/workspaces/{workspaceId}/runs/{runId}/branches
```

## 3. Contracts

- `RunInterruption` 固定 scope/run/interruption、CLARIFICATION question/options、exact Checkpoint、worker fence、
  state/version/time 与 canonical hash。`OPEN` 只能是 version 1 + null answered_at；`ANSWERED` 只能是
  version 2 + PostgreSQL answered_at。
- Route 只接受 response + idempotency key；当前 interruption ID/version/fence、scope、actor、operation ID
  都由服务端读取/派生，客户端不能自报。
- Reply RPC 锁定 Run -> Projection -> Interruption，在同一事务内写 Reply、把 Head 推到 ANSWERED，并调用
  U4 `request_run_control` 追加唯一 Resume Command/Event/Outbox/Projection。任一步失败全部回滚。
- U4 控制命令 payload 只额外允许 exact `{kind:"RESUME_RUN"}` 与 `{kind:"CANCEL_RUN"}`；启动命令仍走
  10647 strict validator，不能借兼容修复扩大任意 kind。
- `SessionBranch` 只保存 parent conversation/run/event sequence/Checkpoint、Effective Config revalidation
  receipt、empty child conversation 与 hash。表和 DTO 禁止 message/event/artifact/effect payload 列。
- Branch 创建重验 parent binding、latest Projection、active snapshot、Checkpoint hash、Context Receipt 的
  run/principal/config/time，以及 child conversation 无 Message/Run；不做 latest fallback 或历史复制。
- `run.suspended` 双读 legacy payload 与带 interruption ID/version 的新 payload；历史 Event hash 不改写。

## 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| command/nested/receipt hash 漂移 | `*_INVALID` 或 `SESSION_RECOVERY_DATABASE_CONTRACT_INVALID` |
| scope/actor/run 换绑 | `*_SCOPE_FORBIDDEN` / not-found-or-denied |
| stale interruption version/fence、Run 非 WAITING | `INTERRUPTION_REPLY_VERSION_CONFLICT` |
| option 不在冻结 options | `INTERRUPTION_REPLY_OPTION_INVALID` |
| 同 idempotency key 同 command | `REPLAYED`，不新增 Reply/Resume/Event/Outbox |
| 同 idempotency key 不同 command | `SESSION_RECOVERY_IDEMPOTENCY_CONFLICT` |
| parent Projection/Checkpoint/Config receipt 漂移 | `SESSION_BRANCH_AUTHORITY_STALE` |
| child conversation 已有 Message 或 Run | `SESSION_BRANCH_CHILD_NOT_EMPTY` |
| Viewer mutation | Platform role denial，数据库调用数为 0 |

## 5. Good / Base / Bad Cases

- Good：刷新读取 OPEN interruption；用户提交一个 option；数据库原子 Answer+Resume；重试返回同一 Receipt。
- Base：用户关闭对话框只隐藏本地视图，刷新仍从 PostgreSQL 重新显示 OPEN interruption。
- Bad：客户端把 `expected_version=latest`、先 PATCH interruption 再独立 POST resume、或把父 Messages 复制到
  child conversation。

## 6. Tests Required

- Contracts：Open/Reply/Branch canonical hash、nested hash、option 顺序、actor/version/fence splice、legacy/new
  suspension replay。
- Platform：SQL 前 tamper 拒绝、DB receipt substitution、read/list strict parse。
- Web：Route 服务端注入 current version/fence/actor/scope；Dialog open/submitting/stale/permission/error；焦点陷阱、
  Escape/关闭恢复焦点、桌面与 390px 无溢出。
- PostgreSQL 17：NOLOGIN owner、FORCE RLS、Backend no DML、Open→Reply+Resume→Replay、stale Reply、唯一
  Reply/Resume FK 闭包与 U4 control payload compatibility。

```bash
DATA_AGENT_POSTGRES_ASSERTION_FILTER=44-session-recovery-authority-assertions.sql \
  infra/supabase/test-support/run-postgres-smoke.sh
```

## 7. Wrong vs Correct

### Wrong

```ts
await saveClarification(text);
await commandRun(runId, "resume");
```

### Correct

```ts
const current = await recovery.loadInterruption(capability, runId);
const command = await buildInterruptionReplyCommand(serverBound(current, response));
const receipt = await recovery.reply(capability, command); // Answer + Resume, one DB transaction
```

只有 Reply Receipt 的 Resume identity 和 resulting Projection version 能证明 Run 已恢复。
