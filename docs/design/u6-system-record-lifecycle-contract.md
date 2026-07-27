# U6 System Record Lifecycle 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-system-record-lifecycle@1.0.0`

本文是 `u6-research-resource-invocation-contract.md` 中 System Record 的唯一生命周期
分册。Primitive、StrictCommand、InvocationBinding、Permit/Result/Termination Payload
与 Ref、Base64Url、`PortResult` 和错误类型均直接导入，不得重声明宽类型。
`S=(app_id,tenant_id,environment)`。

## 1. Strict Command 与结果

```ts
type CommitAdapterTerminationReceiptInput =
  StrictCommandBase & InvocationBinding & {
    transition_id: ImmutableId; record_id: ImmutableId;
    resource_kind: "MODEL" | "SQL" | "TOOL";
    canonical_request_digest: Sha256;
    termination: "TERMINATED"; termination_digest: Sha256;
  };

type IssueToolInvocationPermitInput = StrictCommandBase & {
  transition_id: ImmutableId; record_id: ImmutableId;
  tool_name: NonEmptyText; tool_version: Version;
  arguments_schema_hash: Sha256; arguments_hash: Sha256;
  policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
  requested_ttl_ms: PositiveInt; // 1..86_400_000
};
type ToolPermitTransitionCommon = StrictCommandBase & {
  transition_id: ImmutableId; permit_ref: ToolInvocationPermitRef;
  expected_status: "ACTIVE";
};
type RevokeToolInvocationPermitInput = ToolPermitTransitionCommon & {
  transition: "REVOKE";
  reason_code: "POLICY_REVOKED" | "RUN_TERMINATED" | "TOOL_REMOVED";
};
type ExpireToolInvocationPermitInput = ToolPermitTransitionCommon & {
  transition: "EXPIRE"; reason_code: "PERMIT_TTL_EXPIRED";
};

type InvocationResultRef = ModelInvocationResultRef | ToolInvocationResultRef;
type TombstoneInvocationResultInput = StrictCommandBase & {
  transition_id: ImmutableId; result_ref: InvocationResultRef;
  expected_blob_state: "AVAILABLE";
  reason_code: "RETENTION_PERIOD_ELAPSED";
};
type ResultBlobLifecycleCommon = {
  blob_id: ImmutableId; store: "research_invocation_result_blobs";
};
type ResultBlobLifecycle =
  | (ResultBlobLifecycleCommon & {
      state: "AVAILABLE"; ciphertext_present: true;
      ciphertext_hash: Sha256; encryption_key_version: Version;
      tombstoned_at: null })
  | (ResultBlobLifecycleCommon & {
      state: "TOMBSTONED"; ciphertext_present: false;
      ciphertext_hash: Sha256; encryption_key_version: Version;
      tombstoned_at: Timestamp });

type ToolInvocationPermitIdentity =
  SystemRecordRefCommon<"TOOL_INVOCATION_PERMIT"> & {
    owner_kind: "TOOL_POLICY_AUTHORITY"; producer: "TOOL_POLICY_SERVICE";
    store: "research_tool_invocation_permits";
  };
type CommittedToolInvocationPermit =
  | { permit_ref: ToolInvocationPermitRef; payload: ToolInvocationPermitPayload;
      status: "ACTIVE"; revoked_at: null; expired_at: null }
  | { permit_identity: ToolInvocationPermitIdentity;
      payload: ToolInvocationPermitPayload;
      status: "REVOKED"; revoked_at: Timestamp; expired_at: null }
  | { permit_identity: ToolInvocationPermitIdentity;
      payload: ToolInvocationPermitPayload;
      status: "EXPIRED"; revoked_at: null; expired_at: Timestamp };
type TombstonedInvocationResult = {
  result_ref: InvocationResultRef;
  blob: Extract<ResultBlobLifecycle, { state: "TOMBSTONED" }>;
};

interface ResearchSystemRecordLifecyclePort {
  commitAdapterTermination(capabilityInput: unknown,
    input: CommitAdapterTerminationReceiptInput):
    Promise<PortResult<AdapterTerminationReceiptRef>>;
  issueToolPermit(capabilityInput: unknown,
    input: IssueToolInvocationPermitInput):
    Promise<PortResult<Extract<CommittedToolInvocationPermit,
      { status: "ACTIVE" }>>>;
  revokeToolPermit(capabilityInput: unknown,
    input: RevokeToolInvocationPermitInput):
    Promise<PortResult<Extract<CommittedToolInvocationPermit,
      { status: "REVOKED" }>>>;
  expireToolPermit(capabilityInput: unknown,
    input: ExpireToolInvocationPermitInput):
    Promise<PortResult<Extract<CommittedToolInvocationPermit,
      { status: "EXPIRED" }>>>;
  tombstoneResult(capabilityInput: unknown,
    input: TombstoneInvocationResultInput):
    Promise<PortResult<TombstonedInvocationResult>>;
}
```

该 Port 只从 `@data-agent/research/server` 导出。Resolver 仍使用 Resource Wire 分册的
strict Ref；它们是只读 RPC，不属于本状态迁移 Port。

## 2. 唯一 Owner

| 方法 / 迁移 | 唯一 Owner |
| --- | --- |
| `commitAdapterTermination` | 与 `resource_kind` 匹配的 MODEL/SQL/TOOL Invocation Authority |
| `issueToolPermit` | `TOOL_POLICY_AUTHORITY` |
| `revokeToolPermit` | `TOOL_POLICY_AUTHORITY` |
| `expireToolPermit` | `TOOL_POLICY_EXPIRY_AUTHORITY` |
| `tombstoneResult` | `RESULT_RETENTION_AUTHORITY` |

Expiry/Retention Worker 只持有各自窄 Capability，不能 Issue/Revoke Permit、调用 Tool、
读取解密正文或提交 Invocation Terminal。Capability 在事务内匹配 Scope、Principal、
Role、Epoch 与 expiry；应用自报 Owner 无效。

## 3. 状态机

```text
AdapterTerminationReceipt
  ABSENT -- matching Adapter Authority --> COMMITTED
  COMMITTED // absorbing

ToolInvocationPermit
  ABSENT -- TOOL_POLICY_AUTHORITY --> ACTIVE
  ACTIVE -- TOOL_POLICY_AUTHORITY --> REVOKED
  ACTIVE -- TOOL_POLICY_EXPIRY_AUTHORITY + db_now >= expires_at --> EXPIRED
  REVOKED | EXPIRED // absorbing

Result Blob
  ABSENT -- commit_invocation_terminal in same transaction --> AVAILABLE
  AVAILABLE -- RESULT_RETENTION_AUTHORITY
             + db_now >= deletion_due_at --> TOMBSTONED
  TOMBSTONED // absorbing
```

Issue 在数据库按 `min(requested_ttl_ms,policy_max_ttl,server_max_ttl)` 计算
`expires_at=db_now+effective_ttl`；调用方不能提交绝对时间或状态。Resolver 在
`db_now>=expires_at` 时即使异步 Expiry Job 尚未提交，也必须返回
`RESEARCH_SYSTEM_RECORD_NOT_ACTIVE`，不得依赖调度及时性维持安全。Expiry Job 只负责把
持久状态最终推进为 EXPIRED。

Result Tombstone 在单一事务锁 exact Result 与 Blob，重验 `deletion_due_at`、Retention
Policy、Scope 与状态，删除 ciphertext 后写 `TOMBSTONED/tombstoned_at`；永久保留
Result metadata、plaintext content hash、ciphertext hash、KMS version 与 Audit。
Resolver 对 TOMBSTONED 固定返回 `REPLAY_SNAPSHOT_UNAVAILABLE`，不得返回空正文。

AdapterTermination Receipt 的 `terminated_at`、Permit 的 issued/expired/revoked time、
Blob 的 tombstoned time 全由数据库时钟产生。Commit input 不接收这些时间、Ref Hash、
Owner、Producer 或状态字段。

## 4. 幂等与数据库

`research_system_record_transition_operations`：

- PK `(S,transition_id)`；
- UQ `(S,record_kind,record_id,principal_id,idempotency_key)`，不含 Transition Kind；
- 保存 exact Input Hash、old/new State、Owner Capability ID/Epoch、Outcome 与 DB time；
- 同键同输入返回原结果；跨阶段复用 Key或同键异输入返回
  `RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT`。

AdapterTermination commit 以 `(S,record_id,record_version)` 和
`(S,commit_id)` 唯一；同一 Invocation/Lease 只允许一张 exact Termination Receipt。
Permit 和 Blob 迁移都使用状态行锁 + operation 行锁；CAS loser 重读后只在 exact
同输入时重放，否则冲突。

Backend/Service 可授权 RPC 的唯一集合：

```text
commit_adapter_termination_receipt(command jsonb)
issue_tool_invocation_permit(command jsonb)
revoke_tool_invocation_permit(command jsonb)
expire_tool_invocation_permit(command jsonb)
tombstone_invocation_result(command jsonb)
```

内部 insert/update 不 GRANT。Resource 分册中的
`resolve_committed_adapter_termination_receipt`、
`resolve_committed_invocation_outcome_usage`、
`resolve_current_tool_invocation_permit`、
`resolve_committed_model_invocation_result` 与
`resolve_committed_tool_invocation_result` 是唯一只读 Resolver 清单。

## 5. Crash 与 Conformance

1. Permit Issue/Revoke/Expire 每条迁移覆盖同键重放、跨阶段 Key、CAS loser 与 DB TTL
   精确边界。
2. ACTIVE 已过期但 Job 未运行时，Resolver 仍拒绝 Tool I/O；Job 重放最终得到同一
   EXPIRED。
3. REVOKED/EXPIRED Permit 不能复活、互转或签发新 Lease。
4. Tombstone 在到期前拒绝；到期后 ciphertext 删除与状态提交原子，崩溃重放不泄漏
   正文也不丢 metadata/hash。
5. TOMBSTONED Resolver 固定 `REPLAY_SNAPSHOT_UNAVAILABLE`；跨 `S` Blob 不可见。
6. Expiry/Retention Capability 不能 Issue/Revoke/Invoke/Terminalize，Tool Policy
   Capability 不能 Tombstone。
7. Termination Receipt 换 Kind/Reservation/Lease/Attempt/Fence/Request/Digest 或非
   matching Adapter Owner 全部拒绝。
8. 调用方夹带时间、状态、Owner、Hash 或 Producer 字段均 strict parse 失败。
