# U6 Invocation 持久化状态机合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-invocation-state@1.0.0`

本文是 `u6-research-resource-invocation-contract.md` 的唯一 Invocation 状态迁移分册。
Primitive、`InvocationBinding`、三类 `*InvocationInput`、`ResourceUsage`、
`CompletedResourceUsage`、`CommitInvocationTerminalInput`、System Record Ref、
`PortResult` 与错误类型均从该分册直接导入，不得复制或放宽。
`S=(app_id,tenant_id,environment)`。

## 1. 状态与 Wire

```ts
type InvocationState =
  | "AUTHORIZED" | "STARTED"
  | "COMPLETED" | "FAILED" | "OUTCOME_UNKNOWN";

type DropOuterIdempotency<T> =
  T extends unknown ? Omit<T, "idempotency_key"> : never;
type OuterInvocationRequestBinding = {
  outer_idempotency_key: IdempotencyKey; outer_input_hash: Sha256;
};
type StartInvocationInput =
  DropOuterIdempotency<
    ModelInvocationInput | SqlInvocationInput | ToolInvocationInput
  > & {
    idempotency_key: IdempotencyKey;
    transition_id: ImmutableId;
    transition: "START"; expected_state: "AUTHORIZED";
    outer_request_binding: OuterInvocationRequestBinding;
  };
type MarkInvocationOutcomeUnknownInput =
  StrictCommandBase & InvocationBinding & {
  transition_id: ImmutableId; resource_kind: "MODEL" | "SQL" | "TOOL";
  canonical_request_digest: Sha256;
  transition: "MARK_OUTCOME_UNKNOWN"; expected_state: "STARTED";
  outcome_unknown_hash: Sha256;
};
type CommittedInvocationStateCommon = InvocationBinding & {
  resource_kind: "MODEL" | "SQL" | "TOOL";
  invocation_version: NonNegativeInt;
  canonical_request_digest: Sha256;
  committed_at: Timestamp;
};
type CommittedInvocationState =
  | (CommittedInvocationStateCommon & {
      state: "AUTHORIZED";
      outcome_hash: null; outcome_unknown_hash: null })
  | (CommittedInvocationStateCommon & {
      state: "STARTED";
      outcome_hash: null; outcome_unknown_hash: null })
  | (CommittedInvocationStateCommon & {
      state: "OUTCOME_UNKNOWN";
      outcome_hash: null; outcome_unknown_hash: Sha256 })
  | (CommittedInvocationStateCommon & {
      state: "COMPLETED" | "FAILED";
      outcome_hash: Sha256; outcome_unknown_hash: null });
type StartedInvocationState =
  Extract<CommittedInvocationState, { state: "STARTED" }> & {
    start_created: boolean; outer_request_replayed: boolean;
  };

interface AdapterInvocationStatePort {
  start(capabilityInput: unknown, input: StartInvocationInput):
    Promise<PortResult<StartedInvocationState>>;
  markOutcomeUnknown(capabilityInput: unknown,
    input: MarkInvocationOutcomeUnknownInput):
    Promise<PortResult<Extract<CommittedInvocationState,
      { state: "OUTCOME_UNKNOWN" }>>>;
  commitTerminal(capabilityInput: unknown,
    input: CommitInvocationTerminalInput):
    Promise<PortResult<CommittedInvocation>>;
}
```

此 Port 只从 `@data-agent/research/server` 导出，不能从公共 package root 或 Agent Tool
注册表导出。`AUTHORIZED` 仅表示 Resource Begin 已原子准入并签发 exact Lease，不表示
Provider/SQL/Tool 已经调用。

外层 `ResearchInvocationPort.invokeModel/invokeSql/invokeTool` 只接收一份调用级
`idempotency_key`，内部阶段 Key 不由调用方提供。Server 对固定 Stage
`START|OUTCOME_UNKNOWN|TERMINAL_INITIAL|TERMINAL_LATE` 计算：

```text
stage_name = JCS([
  app_id, tenant_id, environment, run_id, invocation_id, stage
])
transition_id = uuidv5(U6_INVOCATION_TRANSITION_NAMESPACE, UTF8(stage_name))
stage_idempotency_key =
  "u6-invocation@1:" + base64url(sha256(UTF8(stage_name)))
```

`U6_INVOCATION_TRANSITION_NAMESPACE` 固定为 lowercase UUID
`6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18`；JCS 数组顺序和 UTF-8 bytes 不得改变。
Golden vector：对
`["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222",
"test","33333333-3333-4333-8333-333333333333",
"44444444-4444-4444-8444-444444444444","START"]`，结果必须是
`transition_id=5b4436f2-0879-5d49-9433-73b7c3a21a3c`、
`stage_idempotency_key=u6-invocation@1:F4JWGlMnqKYh3eT-ARMw9wAPZ7F2LQ3ocYTukxmDBHo`。
`StartInvocationInput`、`MarkInvocationOutcomeUnknownInput` 与
`CommitInvocationTerminalInput` 的 transition/key 必须等于对应派生值。普通调用方不能
提交或覆盖内部 Stage Key；`expected_state=OUTCOME_UNKNOWN` 的 Terminal 只能使用
`TERMINAL_LATE`，其他 Terminal 只能使用 `TERMINAL_INITIAL`。
Start 的 `outer_request_binding` 由 server 从完整外层 Invoke strict input（含原调用级
Key）重算；Agent 不能直接调用内部 Start Wire。

## 2. 唯一迁移图

```text
ABSENT
  -- begin_research_resource / RESOURCE_AUTHORITY --> AUTHORIZED

AUTHORIZED
  -- start_research_invocation / matching Adapter Authority --> STARTED
  -- commit_invocation_terminal(FAILED, all actual fields=0)
     / matching Adapter Authority --> FAILED

STARTED
  -- commit_invocation_terminal(COMPLETED, actual count=1)
     / matching Adapter Authority --> COMPLETED
  -- commit_invocation_terminal(FAILED, actual count=0|1)
     / matching Adapter Authority --> FAILED
  -- mark_research_invocation_outcome_unknown
     / matching Adapter Authority --> OUTCOME_UNKNOWN

OUTCOME_UNKNOWN
  -- commit_invocation_terminal(COMPLETED, actual count=1)
     / same Adapter Authority + exact original binding --> COMPLETED
  -- commit_invocation_terminal(FAILED, actual count=0|1)
     / same Adapter Authority + exact original binding --> FAILED

COMPLETED | FAILED  // absorbing；任何后续不同输入均冲突
```

禁止 `AUTHORIZED→COMPLETED`、`OUTCOME_UNKNOWN→STARTED`、Terminal→任意状态，禁止
从 ABSENT 直接创建 Adapter 状态。`CommitInvocationTerminalInput.expected_state` 必须与
当前行相同：COMPLETED 只接受 `STARTED|OUTCOME_UNKNOWN`；FAILED 接受
`AUTHORIZED|STARTED|OUTCOME_UNKNOWN`。COMPLETED 的 MODEL/SQL/TOOL 计数分别严格为
`invocations=1/executions=1/tool_calls=1`；零计数只可进入 FAILED 或取消结算。
`InvocationFailureCode<Kind>` 是持久化 Outcome，不是 `U6PlatformErrorCode`。Provider/
SQL/Tool rejection、error、rate-limit、timeout 或 cancel 只有在 matching Adapter 能
证明结果确定且已终止时才可 FAILED；断线、超时或取消后仍可能执行的情况必须
OUTCOME_UNKNOWN。

## 3. Owner 与真实 I/O 线性化

| 迁移 | 唯一 Owner |
| --- | --- |
| `ABSENT→AUTHORIZED` | `ResearchResourceReservationPort.begin` 的 `RESOURCE_AUTHORITY` |
| `AUTHORIZED→STARTED` | 与 Kind 精确匹配的 MODEL/SQL/TOOL Invocation Authority |
| `AUTHORIZED|STARTED|OUTCOME_UNKNOWN→FAILED` | 同一 matching Adapter Authority |
| `STARTED|OUTCOME_UNKNOWN→COMPLETED` | 同一 matching Adapter Authority |
| `STARTED→OUTCOME_UNKNOWN` | 同一 matching Adapter Authority |
| `IN_USE→ABANDONED` | `RESOURCE_AUTHORITY`，且必须解析已提交的 exact OUTCOME_UNKNOWN |

Adapter 必须先完成 Projection/Permit/Request/Lease/Fence 的全部零 I/O 校验，再提交
`STARTED`；只有 STARTED 事务提交后才能触发真实 Provider、Datasource 或 Tool callback。
调用返回确定结果时必须在响应返回上层前提交 Terminal。网络断开、进程崩溃或响应未知时，
对应 Adapter Authority（含只持有该 Kind 权限的恢复 Worker）提交 OUTCOME_UNKNOWN；
普通 Worker、Resource Authority 或调用方自报 Hash 无权写入。

OUTCOME_UNKNOWN 不释放预算。`mark_research_resource_abandoned` 重新解析 exact Invocation
行后才把 Reservation 置 ABANDONED。若 Adapter 后续取得权威结果，只能以原
Reservation/Seq/Lease/Invocation/Request/Attempt/Fence/Digest 和同一 Adapter Authority
执行一次 late Terminal CAS；随后 Resource Authority 解析新的 OutcomeUsage Ref 并
`settle`。迟到结果不得创建第二个 Invocation、换 Lease，或跳过 Run/Tenant/Principal
用量入账。

## 4. 数据库真值与幂等

`research_invocation_commits` 是当前状态行，必须保存 `invocation_version`、Kind、完整
Binding、Request Digest、State、Result/Usage/Outcome Hash/Unknown Hash 与时间，并以
strict CHECK 实现上图 nullable 真值表。

`research_invocation_transition_operations`：

- PK `(S,transition_id)`；
- UQ `(S,invocation_id,principal_id,idempotency_key)`，UQ 故意不含 Transition Kind；
- 保存 Transition、expected/old/new State、Input Hash、Invocation Version、
  Result/Usage/Outcome Hash、Outcome 与 DB time；
- 同键同规范输入只返回原结果，同键异输入固定
  `RESEARCH_INVOCATION_TRANSITION_CONFLICT`。

`research_invocation_request_operations`：

- PK `(S,invocation_id)`；
- UQ `(S,run_id,principal_id,idempotency_key)`；
- 保存外层 Invoke Kind/Input Hash、Invocation/Request ID 与四个派生 Stage ID/Key；
- 同外层 Key 异输入固定 `RESEARCH_INVOCATION_TRANSITION_CONFLICT`。

锁序固定为：

```text
research_resource_reservations
→ research_invocation_request_operations
→ research_invocation_commits
→ research_invocation_transition_operations
→ MODEL/TOOL Result（需要时）
→ InvocationOutcomeUsage（需要时）
```

`start_research_invocation` 在一个事务中先按上序锁 Reservation，以 absent-key lock
创建/校验 Request Operation，再锁 Invocation/Transition 并执行 START。它重算完整外层
Input Hash；同外层 Key 异输入失败。只有返回
`start_created=true,outer_request_replayed=false` 才能触发真实 I/O；任何重放均为零
callback，再解析当前 Invocation State。不得由 Adapter 拆成两个事务或改序。
`begin_research_resource` 在同一事务执行 `ABSENT→AUTHORIZED`；任何一步失败同时回滚
Lease 与 Invocation。`start_research_invocation` 和
`mark_research_invocation_outcome_unknown` 是窄 security-definer RPC。
`commit_invocation_terminal` 按 Result→OutcomeUsage→Invocation 的顺序原子提交。
内部 insert/update 函数不授予应用角色；所有 resolver 重新解析完整 `S` 与 exact Ref。

COMPLETED/FAILED 是吸收态。相同 Terminal operation 同键重放返回原记录；不同 Key 但
相同 exact Terminal 内容返回同一 Terminal，任何字段不同固定
`RESEARCH_INVOCATION_TERMINAL_CONFLICT`。OUTCOME_UNKNOWN 的 late CAS 使用新
transition/idempotency key，并以 `expected_state=OUTCOME_UNKNOWN` 防止双结算。

外层 Invoke 重放先读取 Request Operation 与 Invocation State：AUTHORIZED 才可继续
START；STARTED 绝不再次触发真实 I/O，只进入 matching Adapter Recovery 并保守提交
OUTCOME_UNKNOWN；COMPLETED/FAILED 从持久 Result/Usage 重放；OUTCOME_UNKNOWN 返回同一
不确定状态并等待 late Terminal。Result 已 Tombstone 时返回
`REPLAY_SNAPSHOT_UNAVAILABLE`，不得为重放再次调用 Provider/SQL/Tool。

## 5. Crash Recovery

- `AUTHORIZED` 且 Lease 未过期：不允许第二次 Begin；恢复 Worker可继续同一
  Invocation，也可提交零用量 FAILED 后走 Active Cancel。
- `STARTED` 且 Worker 消失：不猜测失败或零用量；matching Adapter Recovery 证明结果
  未知后提交 OUTCOME_UNKNOWN，Resource Sweeper 再置 ABANDONED。
- `OUTCOME_UNKNOWN`：保留预算；只接受 exact late Terminal。超过保留期仍不能伪造
  Usage，运维告警并保持不可发布。
- Terminal 已提交但 `settle` 前崩溃：重放 exact OutcomeUsage Ref 完成结算，不重复
  I/O。
- Result/OutcomeUsage 已插入但 Invocation CAS 未提交：因同事务回滚，不得出现孤儿
  System Record。

## 6. 必需 Conformance

1. Begin 原子创建 AUTHORIZED；双 Begin 只产生一份 Lease/Invocation。
2. STARTED Commit 发生在真实 callback 前；START 失败时 callback 计数为 0。
3. 三类 COMPLETED 零计数全部 strict 拒绝，Reservation 不释放。
   三类确定 I/O failure 分别持久化 matching FailureCode；跨 Kind Code 拒绝。
4. AUTHORIZED→COMPLETED、UNKNOWN→STARTED、Terminal→任意状态全部拒绝。
5. STARTED 崩溃保持占位；UNKNOWN→ABANDONED→late Terminal→SETTLED 只入账一次。
6. Late Terminal 换 Reservation/Lease/Attempt/Fence/Request/Digest/Adapter 任一字段失败。
7. 同键同输入重放稳定；跨阶段复用 Key、双 late Terminal、不同 Terminal 内容冲突。
8. Terminal commit 后、Settle 前崩溃不重复真实 I/O；只重放结算。
9. 普通 Agent/Resource/其他 Kind Adapter 无法 start、unknown 或 terminalize Invocation。
10. 外层同键重放在 STARTED/Terminal/UNKNOWN 均为零新增 I/O；Hosted/Docker/In-Memory
    逐字通过同一 Golden Vector，调用方夹带或换 Stage 固定失败。
