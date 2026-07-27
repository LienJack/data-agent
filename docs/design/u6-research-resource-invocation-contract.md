# U6 Resource Reservation 与 Invocation 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-research-resource-invocation@1.0.0`

本文只定义 Resource/Invocation Wire/Result；Invocation 与 System Record 状态分别以
`u6-invocation-state-contract.md`、`u6-system-record-lifecycle-contract.md` 为唯一来源。
Primitive 沿用主合同：`ImmutableId`=UUID，`PrincipalId`/`IdempotencyKey`=1..256 字符，
`Sha256`=`sha256:`+64 lowercase hex，`HmacSha256` 同理，`Timestamp`=带 offset ISO-8601，
`PositiveInt`/`NonNegativeInt`=safe integer，`NonEmptyText`=1..2,000 字符，
`S=(app_id,tenant_id,environment)`。`AppScope`、`ArtifactReferenceFor<T>`、
`AgentProjectionInputRef`、`ModelProfileReference`、`U6PlatformErrorCode` 精确复用主
Planning/Wire/Core，不得另造宽类型。

```ts
type SystemRecordRefCommon<T> = {
  record_kind: T; record_id: ImmutableId; scope: AppScope; run_id: ImmutableId;
  record_version: PositiveInt; content_hash: Sha256; commit_id: ImmutableId;
};
type AdapterAuthorityBinding =
  | { adapter_kind: "MODEL"; owner_kind: "MODEL_ADAPTER_AUTHORITY";
      required_capability: "MODEL_INVOCATION_AUTHORITY"; producer: "MODEL_ADAPTER" }
  | { adapter_kind: "SQL"; owner_kind: "SQL_ADAPTER_AUTHORITY";
      required_capability: "SQL_INVOCATION_AUTHORITY"; producer: "SQL_ADAPTER" }
  | { adapter_kind: "TOOL"; owner_kind: "TOOL_ADAPTER_AUTHORITY";
      required_capability: "TOOL_INVOCATION_AUTHORITY"; producer: "TOOL_ADAPTER" };
type AdapterTerminationReceiptRef =
  SystemRecordRefCommon<"ADAPTER_TERMINATION_RECEIPT"> & AdapterAuthorityBinding & {
    store: "research_adapter_termination_receipts";
    commit: "commit_adapter_termination_receipt@1.0.0";
    resolver: "resolve_committed_adapter_termination_receipt@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type InvocationOutcomeUsageRef =
  SystemRecordRefCommon<"INVOCATION_OUTCOME_USAGE"> & AdapterAuthorityBinding & {
    store: "research_invocation_outcome_usage";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_invocation_outcome_usage@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type ToolInvocationPermitRef =
  SystemRecordRefCommon<"TOOL_INVOCATION_PERMIT"> & {
    owner_kind: "TOOL_POLICY_AUTHORITY";
    required_capability: "TOOL_POLICY_AUTHORITY";
    producer: "TOOL_POLICY_SERVICE";
    store: "research_tool_invocation_permits";
    commit: "issue_tool_invocation_permit@1.0.0";
    resolver: "resolve_current_tool_invocation_permit@1.0.0";
    status: "ACTIVE"; authority_epoch: NonNegativeInt;
    expires_at: Timestamp; revocation_seq: NonNegativeInt;
  };
type ModelInvocationResultRef =
  SystemRecordRefCommon<"MODEL_INVOCATION_RESULT"> & {
    owner_kind: "MODEL_ADAPTER_AUTHORITY";
    required_capability: "MODEL_INVOCATION_AUTHORITY"; producer: "MODEL_ADAPTER";
    store: "research_model_invocation_results";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_model_invocation_result@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type ToolInvocationResultRef =
  SystemRecordRefCommon<"TOOL_INVOCATION_RESULT"> & {
    owner_kind: "TOOL_ADAPTER_AUTHORITY";
    required_capability: "TOOL_INVOCATION_AUTHORITY"; producer: "TOOL_ADAPTER";
    store: "research_tool_invocation_results";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_tool_invocation_result@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
const modelCanonicalRequestBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 1_048_576, max_chars: 1_398_102,
});
const toolArgumentsBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 65_536, max_chars: 87_382,
});
const modelOutputBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 1_048_576, max_chars: 1_398_102,
});
const toolOutputBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 1_048_576, max_chars: 1_398_102,
});
type ModelCanonicalRequestBase64Url =
  z.infer<typeof modelCanonicalRequestBase64UrlSchema>;
type ToolArgumentsBase64Url = z.infer<typeof toolArgumentsBase64UrlSchema>;
type ModelOutputBase64Url = z.infer<typeof modelOutputBase64UrlSchema>;
type ToolOutputBase64Url = z.infer<typeof toolOutputBase64UrlSchema>;

type StrictCommandBase = {
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; idempotency_key: IdempotencyKey;
};
type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: U6PlatformError };
```

每个 Port 均为 `(capabilityInput:unknown, strictInput:StrictObject)`。Reserve/Projection
解析对应 Resource/Projection Authority；Invoke/事实 commit 解析对应 MODEL/SQL/TOOL
Authority；Permit 解析 Tool Policy Authority。事务内匹配 capability
id/scope/principal/role/epoch/expiry；调用方声明不产生 Authority。

## 1. Reservation Wire 与状态

```ts
type ResourceDemand =
  | { resource_kind: "MODEL"; input_tokens: NonNegativeInt;
      output_tokens: NonNegativeInt; cost_microusd: NonNegativeInt;
      concurrent_slots: 1 }
  | { resource_kind: "SQL"; executions: 1; timeout_ms: PositiveInt;
      max_rows: NonNegativeInt; max_bytes: NonNegativeInt; concurrent_slots: 1 }
  | { resource_kind: "TOOL"; tool_calls: 1; timeout_ms: PositiveInt;
      concurrent_slots: 1 };
type ResourceUsage =
  | { resource_kind: "MODEL"; invocations: 0 | 1;
      input_tokens: NonNegativeInt; output_tokens: NonNegativeInt;
      cost_microusd: NonNegativeInt }
  | { resource_kind: "SQL"; executions: 0 | 1;
      elapsed_ms: NonNegativeInt; rows: NonNegativeInt; bytes: NonNegativeInt }
  | { resource_kind: "TOOL"; tool_calls: 0 | 1;
      elapsed_ms: NonNegativeInt };
type CompletedResourceUsage =
  | (Extract<ResourceUsage, { resource_kind: "MODEL" }> & { invocations: 1 })
  | (Extract<ResourceUsage, { resource_kind: "SQL" }> & { executions: 1 })
  | (Extract<ResourceUsage, { resource_kind: "TOOL" }> & { tool_calls: 1 });
type InvocationFailureCode<K extends ResourceUsage["resource_kind"]> =
  K extends "MODEL"
    ? "MODEL_PROVIDER_REJECTED" | "MODEL_PROVIDER_ERROR" |
      "MODEL_PROVIDER_RATE_LIMITED" | "MODEL_TIMEOUT" | "MODEL_CANCELLED"
    : K extends "SQL"
      ? "SQL_EXECUTION_FAILED" | "SQL_TIMEOUT" | "SQL_CANCELLED"
      : "TOOL_EXECUTION_FAILED" | "TOOL_TIMEOUT" | "TOOL_CANCELLED";

type ReserveResourceInput = StrictCommandBase & {
  reservation_id: ImmutableId;
  research_brief_ref: ArtifactReferenceFor<"ResearchBrief">;
  requested: ResourceDemand;
};
type BeginResourceCommon = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  invocation_id: ImmutableId; request_id: ImmutableId;
  attempt_id: ImmutableId; worker_fence: NonNegativeInt;
};
type BeginResourceInput =
  | (BeginResourceCommon & {
      resource_kind: "MODEL"; canonical_request_digest: Sha256 })
  | (BeginResourceCommon & {
      resource_kind: "SQL"; canonical_request_digest: Sha256 })
  | (BeginResourceCommon & {
      resource_kind: "TOOL"; canonical_request_digest: Sha256;
      tool_invocation_permit_ref: ToolInvocationPermitRef });
type SettleResourceInput = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  invocation_id: ImmutableId; resource_lease_id: ImmutableId;
  invocation_outcome_usage_ref: InvocationOutcomeUsageRef;
};

type ResourceCancelReasonCode =
  | "CALLER_CANCELLED" | "RUN_TERMINATED" | "POLICY_REJECTED";
type ResourceEndReasonCode =
  | ResourceCancelReasonCode | "RESERVATION_TTL_EXPIRED";
type ReservedCancelInput = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  transition: "CANCEL"; source_state: "RESERVED";
  reason_code: ResourceCancelReasonCode;
};
type ActiveCancelInput = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  transition: "CANCEL"; source_state: "IN_USE" | "ABANDONED";
  reason_code: ResourceCancelReasonCode;
  invocation_id: ImmutableId; resource_lease_id: ImmutableId;
  adapter_termination_receipt_ref: AdapterTerminationReceiptRef;
  invocation_outcome_usage_ref: InvocationOutcomeUsageRef;
};
type ExpireResourceInput = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  transition: "EXPIRE"; source_state: "RESERVED";
  reason_code: Extract<ResourceEndReasonCode, "RESERVATION_TTL_EXPIRED">;
};
type AbandonResourceInput = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  transition: "ABANDONED"; source_state: "IN_USE";
  invocation_id: ImmutableId; resource_lease_id: ImmutableId;
  attempt_id: ImmutableId; worker_fence: NonNegativeInt;
  outcome_unknown_hash: Sha256;
};
type EndResourceInput =
  | ReservedCancelInput | ActiveCancelInput
  | ExpireResourceInput | AbandonResourceInput;

type ReservedResource = {
  reservation_id: ImmutableId; reservation_seq: PositiveInt; state: "RESERVED";
  requested: ResourceDemand; reserved: ResourceDemand; expires_at: Timestamp;
};
type BegunResourceCommon = {
  reservation_id: ImmutableId; reservation_seq: PositiveInt; state: "IN_USE";
  invocation_id: ImmutableId; resource_lease_id: ImmutableId;
  request_id: ImmutableId; lease_expires_at: Timestamp;
};
type BegunResource =
  | (BegunResourceCommon & {
      resource_kind: "MODEL"; canonical_request_digest: Sha256 })
  | (BegunResourceCommon & {
      resource_kind: "SQL"; canonical_request_digest: Sha256 })
  | (BegunResourceCommon & {
      resource_kind: "TOOL"; canonical_request_digest: Sha256;
      tool_invocation_permit_ref: ToolInvocationPermitRef });
type SettledResource = {
  reservation_id: ImmutableId; state: "SETTLED" | "SETTLED_OVER_LIMIT";
  reserved: ResourceDemand; actual: ResourceUsage;
  invocation_outcome_usage_ref: InvocationOutcomeUsageRef;
  settled_at: Timestamp;
};
type EndedResource =
  | { reservation_id: ImmutableId; previous_state: "RESERVED";
      state: "CANCELLED"; reason_code: ResourceCancelReasonCode;
      actual: null; ended_at: Timestamp }
  | { reservation_id: ImmutableId; previous_state: "IN_USE" | "ABANDONED";
      state: "CANCELLED"; reason_code: ResourceCancelReasonCode;
      actual: ResourceUsage;
      adapter_termination_receipt_ref: AdapterTerminationReceiptRef;
      invocation_outcome_usage_ref: InvocationOutcomeUsageRef;
      ended_at: Timestamp }
  | { reservation_id: ImmutableId; previous_state: "RESERVED";
      state: "EXPIRED"; reason_code: "RESERVATION_TTL_EXPIRED";
      actual: null; ended_at: Timestamp }
  | { reservation_id: ImmutableId; previous_state: "IN_USE";
      state: "ABANDONED"; outcome_unknown_hash: Sha256; ended_at: Timestamp };

interface ResearchResourceReservationPort {
  reserve(capabilityInput: unknown, input: ReserveResourceInput):
    Promise<PortResult<ReservedResource>>;
  begin(capabilityInput: unknown, input: BeginResourceInput):
    Promise<PortResult<BegunResource>>;
  settle(capabilityInput: unknown, input: SettleResourceInput):
    Promise<PortResult<SettledResource>>;
  cancel(capabilityInput: unknown,
    input: ReservedCancelInput | ActiveCancelInput):
    Promise<PortResult<
      Extract<EndedResource, { state: "CANCELLED" }> | SettledResource>>;
  expire(capabilityInput: unknown, input: ExpireResourceInput):
    Promise<PortResult<Extract<EndedResource, { state: "EXPIRED" }>>>;
  markAbandoned(capabilityInput: unknown, input: AbandonResourceInput):
    Promise<PortResult<Extract<EndedResource, { state: "ABANDONED" }>>>;
}
```

状态机固定：

```text
ABSENT -> RESERVED -> IN_USE
RESERVED -> CANCELLED | EXPIRED
IN_USE -> SETTLED | SETTLED_OVER_LIMIT | ABANDONED
IN_USE | ABANDONED -> CANCELLED  // FAILED + exact termination + within limit
ABANDONED -> SETTLED | SETTLED_OVER_LIMIT  // terminal/late usage
```

Reserve 事务锁 `research_resource_run_heads(S,run_id)` 并单调分配
`reservation_seq`。Begin 由 DB 签发 Lease/expiry，绑定 Invocation/Attempt/Fence；仅
IN_USE 可 I/O；TOOL Begin 先在同事务 resolve exact current Permit，再签 Lease。Active
Cancel 在 Reservation 行锁内解析 server-owned Termination/Outcome Ref，匹配
全部 Scope/Run/Principal/Reservation/Invocation/Lease/Adapter 绑定并重算 actual。
固定优先级：任一维度超额写 `SETTLED_OVER_LIMIT` 并返回
`RESEARCH_RESOURCE_LIMIT_EXCEEDED`；COMPLETED 写 `SETTLED`；只有 FAILED、匹配
Termination 且未超额才写 `CANCELLED`。证据不全返回
`RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED` 且不释放；Abort、Promise rejection、
Worker 消失不证明终止。未知 Outcome 转 ABANDONED 并保留
占位；迟到 Usage 必须入账。

Settle/Active Cancel 请求不接收 caller actual/outcome Hash。
`InvocationOutcomeUsage` 由 Adapter Authority 提交，内容 exact 绑定
Scope/Run/Principal、Reservation/Seq/Invocation/Lease/Request/Attempt/Fence、Kind、
Outcome、Usage、COMPLETED Result/Sandbox Receipt 或 FAILED Error，以及规范化
`outcome_hash`；未 COMMITTED 返回 `AUTHORITY_EVIDENCE_NOT_COMMITTED`。事实
Record 不做 current/TTL 检查。任何 Ref、
Owner、Producer、Kind 或 Invocation 换绑返回
`RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE`；resolver 重算 `actual` 后才可结算。
`ResourceDemand` 只描述预留上限，`ResourceUsage` 描述实际发生量并允许零调用；
零调用只用于 FAILED/Cancel；COMPLETED 的对应计数严格为 1。Committer 与 DB CHECK
必须按 Kind 强制该约束并比较 Reserved 上限，禁止用 Demand 假装 actual。

Settle/Cancel 均锁同一 Reservation。COMPLETED 或超额时，两者竞争也落同一结算态；
FAILED 且未超额时，Settle 先胜为 SETTLED，matching Cancel 先胜为 CANCELLED，终态吸收。

每个 Reserve/Begin/Settle/Cancel/Expire/Abandoned 有独立 Operation/Input Hash。DB：

| 表 | Key / 必需约束 |
| --- | --- |
| `research_adapter_termination_receipts` | PK `(S,record_id,record_version)`；UQ `(S,commit_id)`；strict Termination Payload/Owner/Producer/Hash；append-only `COMMITTED`、expiry=null、revocation=0 |
| `research_invocation_outcome_usage` | 同上；strict OutcomeUsage Payload；COMPLETED 强制 Result/Sandbox Receipt 且 Error=null，FAILED 反之；append-only `COMMITTED`、永不过期/撤销 |
| `research_tool_invocation_permits` | PK `(S,record_id,record_version)`；UQ `(S,commit_id)`；strict Permit Payload/Tool Policy Owner/Hash；`ACTIVE|REVOKED|EXPIRED` strict CHECK、Epoch/Expiry/单调 Revocation Seq |
| `research_model_invocation_results` | 同事实表 Key；immutable Model Binding/Governance/Retention/Deletion/Blob Hash metadata；append-only `COMMITTED`，不存正文 |
| `research_tool_invocation_results` | 同事实表 Key；immutable Tool Binding/Policy/Retention/Deletion/Blob Hash metadata；append-only `COMMITTED`，不存正文 |
| `research_invocation_result_blobs` | PK `(S,blob_id)`；FK exact Result；encrypted bytes/KMS Version/Ciphertext Hash；`AVAILABLE|TOMBSTONED`，到期删 ciphertext 后只留 Tombstone/Hash/`tombstoned_at` |
| `research_resource_run_heads` | PK `(S,run_id)`；单调 `next_reservation_seq` |
| `research_resource_reservations` | PK `(S,reservation_id)`；UQ `(S,run_id,reservation_seq)`、`(S,run_id,principal_id,reserve_idempotency_key)`；Kind/Demand 在 Input Hash；Policy/Brief/State/Invocation/Request/Digest/Lease/Actual/time strict CHECK |
| `research_resource_transition_operations` | PK `(S,transition_id)`；UQ **`(S,reservation_id,principal_id,idempotency_key)`**；Transition Kind、Input Hash、old/new State、Outcome、DB time；UQ 不含 Kind，故跨阶段 Key 复用失败 |

所有 Key/FK/Index/RLS 展开 `S`；共享 Supabase 不得跨 App 解析 Ref/正文。
Resource/Invocation DB RPC：
`commit_invocation_terminal`、`start_research_invocation`、
`mark_research_invocation_outcome_unknown`、
`reserve_research_resource`、`begin_research_resource`、
`settle_research_resource`、`cancel_research_resource`、
`expire_research_resource`、`mark_research_resource_abandoned`。
System Record 的 mutation/resolver RPC、Owner 与可达状态只取 Lifecycle 分册。

## 2. Invocation 与 Projection

```ts
type InvocationBinding = {
  reservation_id: ImmutableId; reservation_seq: PositiveInt;
  resource_lease_id: ImmutableId; invocation_id: ImmutableId;
  request_id: ImmutableId; attempt_id: ImmutableId;
  worker_fence: NonNegativeInt;
};
type AdapterTerminationReceiptPayload = InvocationBinding & {
  protocol_version: "adapter-termination@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  resource_kind: "MODEL" | "SQL" | "TOOL";
  canonical_request_digest: Sha256;
  termination: "TERMINATED"; termination_digest: Sha256;
  terminated_at: Timestamp;
};
type InvocationOutcomeUsageCommon = InvocationBinding & {
  protocol_version: "invocation-outcome-usage@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256;
  observed_at: Timestamp; outcome_hash: Sha256;
};
type InvocationCompletionBinding =
  | { resource_kind: "MODEL"; result_ref: ModelInvocationResultRef }
  | { resource_kind: "SQL"; sandbox_receipt_ref:
        ArtifactReferenceFor<"SandboxExecutionReceipt"> }
  | { resource_kind: "TOOL"; result_ref: ToolInvocationResultRef };
type InvocationFailureBinding =
  | { actual: Extract<ResourceUsage, { resource_kind: "MODEL" }>;
      error_code: InvocationFailureCode<"MODEL"> }
  | { actual: Extract<ResourceUsage, { resource_kind: "SQL" }>;
      error_code: InvocationFailureCode<"SQL"> }
  | { actual: Extract<ResourceUsage, { resource_kind: "TOOL" }>;
      error_code: InvocationFailureCode<"TOOL"> };
type InvocationOutcomeUsagePayload =
  | (InvocationOutcomeUsageCommon & {
      outcome: "COMPLETED";
      actual: Extract<CompletedResourceUsage, { resource_kind: "MODEL" }>;
      completion_binding:
        Extract<InvocationCompletionBinding, { resource_kind: "MODEL" }>;
      error_code: null;
    })
  | (InvocationOutcomeUsageCommon & {
      outcome: "COMPLETED";
      actual: Extract<CompletedResourceUsage, { resource_kind: "SQL" }>;
      completion_binding:
        Extract<InvocationCompletionBinding, { resource_kind: "SQL" }>;
      error_code: null;
    })
  | (InvocationOutcomeUsageCommon & {
      outcome: "COMPLETED";
      actual: Extract<CompletedResourceUsage, { resource_kind: "TOOL" }>;
      completion_binding:
        Extract<InvocationCompletionBinding, { resource_kind: "TOOL" }>;
      error_code: null;
    })
  | (InvocationOutcomeUsageCommon & {
      outcome: "FAILED"; completion_binding: null;
    } & InvocationFailureBinding);
type ToolInvocationPermitPayload = {
  protocol_version: "tool-invocation-permit@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  tool_name: NonEmptyText; tool_version: Version;
  arguments_schema_hash: Sha256; arguments_hash: Sha256;
  policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
  registry: "ALLOWLISTED"; effect: "READ_ONLY"; source_role: "NON_SOURCE";
  external_side_effect: "NO_EXTERNAL_SIDE_EFFECT"; authority_epoch: NonNegativeInt;
  expires_at: Timestamp;
};
type ToolInvocationPermitLifecycle =
  | { status: "ACTIVE"; revoked_at: null; expired_at: null }
  | { status: "REVOKED"; revoked_at: Timestamp; expired_at: null }
  | { status: "EXPIRED"; revoked_at: null; expired_at: Timestamp };
type ModelInvocationOutput = {
  protocol_version: "model-result@1.0.0";
  media_type: "application/json; charset=utf-8";
  body_base64url: ModelOutputBase64Url;
  byte_length: PositiveInt; digest: Sha256;
};
type ToolInvocationOutput = {
  protocol_version: "tool-result@1.0.0";
  media_type: "application/json; charset=utf-8";
  body_base64url: ToolOutputBase64Url;
  byte_length: PositiveInt; digest: Sha256;
};
type ModelInvocationOutputBinding = Omit<ModelInvocationOutput, "body_base64url">;
type ToolInvocationOutputBinding = Omit<ToolInvocationOutput, "body_base64url">;
type EncryptedResultBlobBinding = {
  blob_id: ImmutableId; store: "research_invocation_result_blobs";
  ciphertext_hash: Sha256; encryption_key_version: Version;
};
type ModelInvocationResultPayload = InvocationBinding & {
  protocol_version: "model-invocation-result@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256;
  projection_receipt_ref:
    ArtifactReferenceFor<"AgentDataProjectionReceipt">;
  model_profile: ModelProfileReference;
  output_binding: ModelInvocationOutputBinding;
  encrypted_blob: EncryptedResultBlobBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
  egress_policy_version: Version; dlp_scan: "PASS";
  retention_check: "PASS"; deletion_due_at: Timestamp;
};
type ToolInvocationResultPayload = InvocationBinding & {
  protocol_version: "tool-invocation-result@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256; permit_ref: ToolInvocationPermitRef;
  policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
  output_binding: ToolInvocationOutputBinding;
  encrypted_blob: EncryptedResultBlobBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
  tool_output_policy_version: Version; dlp_scan: "PASS";
  retention_check: "PASS"; deletion_due_at: Timestamp;
};
type CommitInvocationTerminalCommon = StrictCommandBase & {
  transition_id: ImmutableId; invocation_id: ImmutableId;
  outcome_usage_record_id: ImmutableId;
};
type CommitInvocationTerminalInput =
  | (CommitInvocationTerminalCommon & {
      resource_kind: "MODEL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      result_record_id: ImmutableId; body_base64url: ModelOutputBase64Url;
      actual: Extract<CompletedResourceUsage, { resource_kind: "MODEL" }>;
    })
  | (CommitInvocationTerminalCommon & {
      resource_kind: "SQL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      sandbox_receipt_ref:
        ArtifactReferenceFor<"SandboxExecutionReceipt">;
      actual: Extract<CompletedResourceUsage, { resource_kind: "SQL" }>;
    })
  | (CommitInvocationTerminalCommon & {
      resource_kind: "TOOL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      result_record_id: ImmutableId; body_base64url: ToolOutputBase64Url;
      actual: Extract<CompletedResourceUsage, { resource_kind: "TOOL" }>;
    })
  | (CommitInvocationTerminalCommon & {
      resource_kind: "MODEL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "MODEL" }>;
      error_code: InvocationFailureCode<"MODEL">;
    })
  | (CommitInvocationTerminalCommon & {
      resource_kind: "SQL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "SQL" }>;
      error_code: InvocationFailureCode<"SQL">;
    })
  | (CommitInvocationTerminalCommon & {
      resource_kind: "TOOL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "TOOL" }>;
      error_code: InvocationFailureCode<"TOOL">;
    });
type AuthorizeAgentDataProjectionInput = StrictCommandBase & InvocationBinding & {
  role: "research-supervisor" | "semantic-sql" | "evidence" | "report-projector";
  model_profile: ModelProfileReference;
  input_refs: AgentProjectionInputRef[]; // 1..32，exact Ref identity 唯一
  requested_fields: NonEmptyText[]; // 1..128，唯一
  canonical_request_base64url: ModelCanonicalRequestBase64Url;
  canonical_request_digest: Sha256;
};
type AuthorizedAgentDataProjection = InvocationBinding & {
  receipt_ref: ArtifactReferenceFor<"AgentDataProjectionReceipt">;
  canonical_request_base64url: ModelCanonicalRequestBase64Url;
  canonical_request_digest: Sha256;
  egress_payload_digest: HmacSha256; canonical_byte_count: NonNegativeInt;
  input_token_count: NonNegativeInt;
};
type ModelInvocationInput = StrictCommandBase & InvocationBinding & {
  resource_kind: "MODEL";
  projection_receipt_ref: ArtifactReferenceFor<"AgentDataProjectionReceipt">;
  model_profile: ModelProfileReference;
  request_protocol_version: "model-provider-request@1.0.0";
  canonical_request_base64url: ModelCanonicalRequestBase64Url;
  canonical_request_digest: Sha256;
};
type SqlInvocationInput = StrictCommandBase & InvocationBinding & {
  resource_kind: "SQL";
  sql_artifact_ref: ArtifactReferenceFor<"SqlArtifact">;
  execution_permit_ref: ArtifactReferenceFor<"ExecutionPermit">;
  datasource_id: ImmutableId; data_snapshot_binding_hash: Sha256;
  parameters_hash: Sha256; canonical_request_digest: Sha256;
};
type ToolInvocationInput = StrictCommandBase & InvocationBinding & {
  resource_kind: "TOOL";
  tool_invocation_permit_ref: ToolInvocationPermitRef;
  tool_name: NonEmptyText; tool_version: Version;
  arguments_schema_hash: Sha256; arguments_hash: Sha256;
  policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
  canonical_arguments_base64url: ToolArgumentsBase64Url;
  canonical_request_digest: Sha256;
};
type InvocationOutcome<K extends ResourceUsage["resource_kind"], R> =
  | { state: "COMPLETED"; result: R;
      usage: Extract<CompletedResourceUsage, { resource_kind: K }>;
      outcome_hash: Sha256; outcome_usage_ref: InvocationOutcomeUsageRef }
  | { state: "FAILED"; result: null; error_code: InvocationFailureCode<K>;
      usage: Extract<ResourceUsage, { resource_kind: K }>; outcome_hash: Sha256;
      outcome_usage_ref: InvocationOutcomeUsageRef }
  | { state: "OUTCOME_UNKNOWN"; result: null;
      outcome_unknown_hash: Sha256; usage: null; outcome_usage_ref: null };
type InvocationCommitCommon = InvocationBinding & {
  canonical_request_digest: Sha256; committed_at: Timestamp;
};
type CommittedInvocation =
  | (InvocationCommitCommon & {
      adapter_method: "MODEL_PROVIDER"; reservation_resource_kind: "MODEL";
      projection_receipt_ref:
        ArtifactReferenceFor<"AgentDataProjectionReceipt">;
    } & InvocationOutcome<
      "MODEL",
      { result_ref: ModelInvocationResultRef; output: ModelInvocationOutput }>)
  | (InvocationCommitCommon & {
      adapter_method: "SQL_EXECUTOR"; reservation_resource_kind: "SQL";
      execution_permit_ref: ArtifactReferenceFor<"ExecutionPermit">;
    } & InvocationOutcome<
      "SQL",
      { sandbox_receipt_ref:
          ArtifactReferenceFor<"SandboxExecutionReceipt"> }>)
  | (InvocationCommitCommon & {
      adapter_method: "TOOL_ADAPTER"; reservation_resource_kind: "TOOL";
      tool_invocation_permit_ref: ToolInvocationPermitRef;
    } & InvocationOutcome<
      "TOOL",
      { result_ref: ToolInvocationResultRef; output: ToolInvocationOutput }>);

interface ResearchInvocationPort {
  authorizeAgentDataProjection(capabilityInput: unknown,
    input: AuthorizeAgentDataProjectionInput):
    Promise<PortResult<AuthorizedAgentDataProjection>>;
  invokeModel(capabilityInput: unknown, input: ModelInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "MODEL_PROVIDER" }>>>;
  invokeSql(capabilityInput: unknown, input: SqlInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "SQL_EXECUTOR" }>>>;
  invokeTool(capabilityInput: unknown, input: ToolInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "TOOL_ADAPTER" }>>>;
}
```

`outcome_hash` 只能由 `commit_invocation_terminal` 以数据库时间和 server-resolved Ref
计算，调用方不得提交。公式固定为：

```text
outcome_hash = sha256(
  UTF8("invocation-outcome-usage@1.0.0\0")
  || UTF8(JCS(InvocationOutcomeUsagePayload without outcome_hash))
)
```

JCS 对象包含 `protocol_version`、完整 `S/run/principal`、全部
`InvocationBinding`、`canonical_request_digest`、`outcome`、`actual`、
`completion_binding`、`error_code` 与 DB `observed_at`，不得省略 null。COMPLETED 必须
按 Kind 绑定同事务创建的 Model/Tool Result Ref 或已提交成功的 Sandbox Receipt；
FAILED 必须令 `completion_binding=null` 并绑定 exact `error_code`。任何 Result、
Sandbox Receipt、Usage、Kind 或 Error 换绑都必须得到不同 Hash，并由 strict resolver
拒绝。

Result Digest 固定为：

```text
model = sha256(UTF8("model-result@1.0.0\0")
  || UTF8("application/json; charset=utf-8\0") || decoded_body)
tool  = sha256(UTF8("tool-result@1.0.0\0")
  || UTF8("application/json; charset=utf-8\0") || decoded_body)
```

四种 Base64Url 类型只接受 URL alphabet、无 `=` padding、长度上限、decoded byte 上限
且 decode→re-encode 逐字相等。Model 的 canonical Request Candidate 在 Begin 前由纯
函数生成并计算 Digest；它不携带 Authority。Projection Authority 在 Begin 后解析
Candidate、重建 canonical bytes，并要求 Candidate/Begin/Receipt 三者 Digest 与 bytes
完全相等。三个 Adapter 在 I/O 前解析同一 IN_USE
Reservation，并逐字匹配 Begin 回显的 Kind/Seq/Lease/Invocation/Request/Attempt/Fence/
canonical Request Digest。SQL 再匹配 Permit/
Snapshot/Parameters。Model 用 server-owned Projection Receipt，逐字节匹配最终 Provider
request、HMAC/count、request/provider/profile/model/certification；任一不同均在网络前
返回 `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED`。

Tool 必须在 begin 前解析 server-owned `ToolInvocationPermit`；其内容 exact 绑定
tool name/version、arguments schema hash、arguments hash、policy ref、Scope/Run/Principal、
expiry、authority epoch，并要求 Registry=`ALLOWLISTED`、READ_ONLY、NON_SOURCE、
NO_EXTERNAL_SIDE_EFFECT。Mutating、source tool 或外部副作用在 Tool I/O 前固定拒绝。
Permit 非 ACTIVE/过期/撤销返回 `RESEARCH_SYSTEM_RECORD_NOT_ACTIVE`，Ref 换绑返回
`RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH`。

`commit_invocation_terminal` 是 COMPLETED/FAILED 的唯一公开写入口，不暴露独立
Result/Usage/Invocation commit。它在一个事务内锁定 Reservation、Invocation 与 exact
Projection/Permit，MODEL/TOOL COMPLETED 先创建不含 Usage Ref 的 immutable Result，
再以该 Result Ref 创建 OutcomeUsage，最后创建同时绑定二者的 Invocation Commit；
SQL COMPLETED 必须解析已提交成功的 Sandbox Receipt；FAILED 不创建 Result。
MODEL/TOOL 分支不接收 caller length/digest/request/profile/Projection/Permit/Policy/
治理声明；DB 从 locked 事实重建 Payload，decode/recompute length/digest，正文落库前
执行 size/DLP/retention PASS；
三类失败分别为 `RESEARCH_RESULT_SIZE_EXCEEDED`、
`RESEARCH_RESULT_DIGEST_MISMATCH`、`RESEARCH_RESULT_GOVERNANCE_REJECTED`。
成功返回前重新解析 Result Record；只返回 exact Ref+canonical Output，Checkpoint 只存
Ref。System Record 生命周期只取 Lifecycle 分册；其 Ref 不进入 L2 Artifact union。
`research_system_artifacts` 只接收 AgentDataProjection Receipt，行与进程品牌共同绑定
Reservation 和 exact request。Invocation 的完整状态图、Owner、transition 幂等、Crash
Recovery 与 DB CHECK 只取 `u6-invocation-state-contract.md`。Resolved OutcomeUsage
的 completion/error/hash 必须与 Terminal Commit
完全相等。`authorizeAgentDataProjection` 在同一事务内部调用
`commit_research_system_artifact` 持久化 Receipt；该内部函数不 GRANT。Terminal 的公开
窄入口只有 `commit_invocation_terminal`，底层 insert/update 不授予应用角色。

## 3. Conformance

PostgreSQL 双连接至少验证：Seq 单调、跨 Transition Key 冲突、双 Begin 单 Lease；
IN_USE 无 Termination 不释放，Active Cancel 换绑/未知拒绝，ABANDONED 迟到入账，
COMPLETED/FAILED/超额分流及 Settle/Cancel 双顺序；旧 Lease/Attempt/Fence 拒绝；
三种 I/O 任换 Reservation/Request/bytes/Profile/Permit/Arguments 时零 I/O；
Tool mutating/source/side-effect 拒绝且合法 Tool 可完成；Result/Usage/Outcome/Sandbox
换绑、COMPLETED 零调用、Base64/size/digest/governance 拒绝；跨 `S` Ref/Blob 不可见。
