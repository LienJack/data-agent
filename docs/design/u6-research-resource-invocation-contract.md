# U6 Resource Reservation 与 Invocation 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-research-resource-invocation@1.1.0`
> 以下边界待实现，不是交付证据。

本文只定义 Resource/Invocation Wire/Result；Invocation/System Record 状态取
State/Lifecycle，Candidate/Preparation/密文/解密取 Crypto，数据库调用面取 Database
Surface 分册。
Primitive 沿用主合同：`ImmutableId`/`PrincipalId`=UUID，`IdempotencyKey`=1..256 字符，
`Sha256`=`sha256:`+64 lowercase hex，`HmacSha256` 同理，`Timestamp`=带 offset ISO-8601，
`PositiveInt`/`NonNegativeInt`=safe integer，`NonEmptyText`=1..2,000 字符，
`S=(app_id,tenant_id,environment)`。其余 Scope/Reference/Profile/Policy/Error 精确复用
Planning/Wire/Core，不得另造宽类型。

```ts
type SystemRecordRefCommon<T> = {
  record_kind: T; record_id: ImmutableId; scope: AppScope; run_id: ImmutableId;
  record_version: 1; content_hash: Sha256; commit_id: ImmutableId;
};
type AdapterAuthorityBinding =
  | { adapter_kind: "MODEL"; owner_kind: "MODEL_ADAPTER_AUTHORITY";
      commit_capability: "MODEL_INVOCATION_AUTHORITY"; producer: "MODEL_ADAPTER" }
  | { adapter_kind: "SQL"; owner_kind: "SQL_ADAPTER_AUTHORITY";
      commit_capability: "SQL_INVOCATION_AUTHORITY"; producer: "SQL_ADAPTER" }
  | { adapter_kind: "TOOL"; owner_kind: "TOOL_ADAPTER_AUTHORITY";
      commit_capability: "TOOL_INVOCATION_AUTHORITY"; producer: "TOOL_ADAPTER" };
type AdapterTerminationReceiptRef =
  SystemRecordRefCommon<"ADAPTER_TERMINATION_RECEIPT"> & AdapterAuthorityBinding & {
    store: "research_adapter_termination_receipts";
    resolver_capability: "RESOURCE_AUTHORITY";
    commit: "commit_adapter_termination_receipt@1.0.0";
    resolver: "resolve_committed_adapter_termination_receipt@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type InvocationOutcomeUsageRef =
  SystemRecordRefCommon<"INVOCATION_OUTCOME_USAGE"> & AdapterAuthorityBinding & {
    store: "research_invocation_outcome_usage";
    resolver_capability: "RESOURCE_AUTHORITY";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_invocation_outcome_usage@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type ToolInvocationPermitRef =
  SystemRecordRefCommon<"TOOL_INVOCATION_PERMIT"> & {
    owner_kind: "TOOL_POLICY_AUTHORITY";
    commit_capability: "TOOL_POLICY_AUTHORITY";
    resolver_capabilities:
      readonly ["RESOURCE_AUTHORITY", "TOOL_INVOCATION_AUTHORITY"];
    producer: "TOOL_POLICY_SERVICE";
    store: "research_tool_invocation_permits";
    commit: "issue_tool_invocation_permit@1.0.0";
    resolver: "resolve_current_tool_invocation_permit@1.0.0";
    status: "ACTIVE"; authority_epoch: NonNegativeInt;
    expires_at: Timestamp; revocation_seq: NonNegativeInt;
  };
type ModelInvocationResultRef =
  SystemRecordRefCommon<"MODEL_INVOCATION_RESULT"> & {
    record_version: 1;
    owner_kind: "MODEL_ADAPTER_AUTHORITY";
    commit_capability: "MODEL_INVOCATION_AUTHORITY"; producer: "MODEL_ADAPTER";
    resolver_capability: "MODEL_INVOCATION_AUTHORITY";
    store: "research_invocation_results";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_model_invocation_result@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type SqlInvocationResultRef =
  SystemRecordRefCommon<"SQL_INVOCATION_RESULT"> & {
    record_version: 1;
    owner_kind: "SQL_ADAPTER_AUTHORITY";
    commit_capability: "SQL_INVOCATION_AUTHORITY"; producer: "SQL_ADAPTER";
    resolver_capability: "SQL_INVOCATION_AUTHORITY";
    store: "research_invocation_results";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_sql_invocation_result@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type SecureSqlExecutionReceiptRef =
  SystemRecordRefCommon<"SECURE_SQL_EXECUTION_RECEIPT"> & {
    record_version: 1;
    owner_kind: "SQL_ADAPTER_AUTHORITY";
    commit_capability: "SQL_INVOCATION_AUTHORITY"; producer: "SQL_ADAPTER";
    resolver_capability: "SQL_INVOCATION_AUTHORITY";
    store: "research_secure_sql_execution_receipts";
    commit: "commit_invocation_terminal@1.0.0";
    resolver: "resolve_committed_secure_sql_execution_receipt@1.0.0";
    status: "COMMITTED"; authority_epoch: NonNegativeInt;
    expires_at: null; revocation_seq: 0;
  };
type ToolInvocationResultRef =
  SystemRecordRefCommon<"TOOL_INVOCATION_RESULT"> & {
    record_version: 1;
    owner_kind: "TOOL_ADAPTER_AUTHORITY";
    commit_capability: "TOOL_INVOCATION_AUTHORITY"; producer: "TOOL_ADAPTER";
    resolver_capability: "TOOL_INVOCATION_AUTHORITY";
    store: "research_invocation_results";
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
const sqlOutputBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 8_388_608, max_chars: 11_184_811,
});
const toolOutputBase64UrlSchema = canonicalBase64UrlSchema({
  min_decoded_bytes: 1, max_decoded_bytes: 1_048_576, max_chars: 1_398_102,
});
type ModelCanonicalRequestBase64Url =
  z.infer<typeof modelCanonicalRequestBase64UrlSchema>;
type ToolArgumentsBase64Url = z.infer<typeof toolArgumentsBase64UrlSchema>;
type ModelOutputBase64Url = z.infer<typeof modelOutputBase64UrlSchema>;
type SqlOutputBase64Url = z.infer<typeof sqlOutputBase64UrlSchema>;
type ToolOutputBase64Url = z.infer<typeof toolOutputBase64UrlSchema>;

type StrictCommandBase = {
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; idempotency_key: IdempotencyKey;
};
type StrictReadBase = Omit<StrictCommandBase, "idempotency_key">;
type StrictRefReadInput<R> = StrictReadBase & { ref: R };
type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: U6PlatformError };
```

`commit_capability` 只描述事实签发 Owner，`resolver_capability|resolver_capabilities` 只描述
metadata 解析者；两者不可互换。Ciphertext 读取另由 Crypto 分册的
`RESULT_DECRYPTION_AUTHORITY` 控制，不因 Result Ref 的 resolver 能力而开放。

每个 leaf Port 均以 unknown capability + strict input 解析；外层 Invoke 使用下文
双能力 bundle。Reserve/Projection
解析对应 Resource/Projection Authority；Invoke/事实 commit 解析对应 MODEL/SQL/TOOL
Authority；Permit Issue/Revoke 解析 `TOOL_POLICY_AUTHORITY`，Expire 解析
`TOOL_POLICY_EXPIRY_AUTHORITY`，metadata Resolver 只接受其 Ref 声明的 resolver
capability；Result Retention/Subject Erasure 与 App Cleanup 只取 Lifecycle/Cleanup
分册。事务内匹配 id/scope/principal/role/epoch/expiry；调用方声明不产生 Authority。

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
      "MODEL_PROVIDER_RATE_LIMITED" | "MODEL_TIMEOUT" | "MODEL_CANCELLED" |
      "MODEL_RESULT_INVALID" | "MODEL_RESULT_GOVERNANCE_REJECTED"
    : K extends "SQL"
      ? "SQL_EXECUTION_FAILED" | "SQL_TIMEOUT" | "SQL_CANCELLED" |
        "SQL_RESULT_INVALID" | "SQL_RESULT_GOVERNANCE_REJECTED"
      : "TOOL_EXECUTION_FAILED" | "TOOL_TIMEOUT" | "TOOL_CANCELLED" |
        "TOOL_RESULT_INVALID" | "TOOL_RESULT_GOVERNANCE_REJECTED";

type ReserveResourceInput = StrictCommandBase & {
  reservation_id: ImmutableId;
  research_brief_ref: ArtifactReferenceFor<"ResearchBrief">;
  requested: ResourceDemand;
};
type BeginResourceCommon = StrictCommandBase & {
  transition_id: ImmutableId; reservation_id: ImmutableId;
  invocation_id: ImmutableId; request_id: ImmutableId;
  attempt_id: ImmutableId; worker_fence: PositiveInt;
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
  attempt_id: ImmutableId; worker_fence: PositiveInt;
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

Reserve/Begin/Settle/Cancel/Expire/Abandon 的 exact RunAttempt/Outbox/Fence/TTL 与锁序
只取 Execution Storage 分册；只有已提交 IN_USE 才可 I/O。
Active Cancel 在 Reservation 锁内解析 server-owned Termination/Outcome，exact 匹配
S/Run/Principal/Reservation/Invocation/Lease/Adapter 并重算 actual。优先级固定：
超额=`SETTLED_OVER_LIMIT`，COMPLETED=`SETTLED`，只有 FAILED+matching Termination+
未超额=`CANCELLED`；证据不全报 `RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED` 且不释放。
未知转 ABANDONED，迟到 Usage 入账；进程退出不证明终止。

Settle/Cancel 不接收 caller actual/outcome Hash。Adapter 的 committed OutcomeUsage
exact 绑定全部 Invocation 字段、Kind、Outcome、Usage、Result/Secure SQL Receipt 或
Error 与
`outcome_hash`；未提交、Ref/Owner/Producer/Kind 换绑分别报
`AUTHORITY_EVIDENCE_NOT_COMMITTED`、`RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE`。
Resolver 重算 actual；COMPLETED 计数必须为 1，零调用只属 FAILED/Cancel，DB 按 Kind
比较 Demand 上限。Settle/Cancel 锁同一行：COMPLETED/超额归相同结算态；FAILED 未超额
由先胜者写 SETTLED 或 CANCELLED，终态吸收。

Reservation 行本身是 Reserve Operation；Begin/Settle/Cancel/Expire/Abandoned 各有
独立 Transition Operation/Input Hash，跨阶段 Key 复用必须失败。表、非 Terminal
约束、nullable CHECK、单次 DB time 与锁序只取 Execution Storage；Terminal candidate
key/FK 及 Result/Blob/SQL deferred 环只取 Terminal Reference Graph。本文不维护第二份
物理清单；RPC/Resolver/GRANT 闭合枚举只取 Database Surface。

## 2. Invocation 与 Projection

```ts
type InvocationBinding = {
  reservation_id: ImmutableId; reservation_seq: PositiveInt;
  resource_lease_id: ImmutableId; invocation_id: ImmutableId;
  request_id: ImmutableId; attempt_id: ImmutableId;
  worker_fence: PositiveInt;
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
  | { resource_kind: "SQL"; result_ref: SqlInvocationResultRef;
      secure_execution_receipt_ref: SecureSqlExecutionReceiptRef }
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
  tool_policy_version: Version; tool_permit_policy_limit_hash: Sha256;
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
type SqlInvocationOutput = {
  protocol_version: "sql-result@1.0.0";
  media_type: "application/json; charset=utf-8";
  body_base64url: SqlOutputBase64Url;
  byte_length: PositiveInt; digest: Sha256;
  row_count: NonNegativeInt; column_count: PositiveInt;
};
type ToolInvocationOutput = {
  protocol_version: "tool-result@1.0.0";
  media_type: "application/json; charset=utf-8";
  body_base64url: ToolOutputBase64Url;
  byte_length: PositiveInt; digest: Sha256;
};
type ModelInvocationOutputBinding = Omit<ModelInvocationOutput, "body_base64url">;
type SqlInvocationOutputBinding = Omit<SqlInvocationOutput, "body_base64url">;
type ToolInvocationOutputBinding = Omit<ToolInvocationOutput, "body_base64url">;
type StoredModelInvocationOutputBinding =
  Omit<ModelInvocationOutputBinding, "digest">;
type StoredSqlInvocationOutputBinding =
  Omit<SqlInvocationOutputBinding, "digest">;
type StoredToolInvocationOutputBinding =
  Omit<ToolInvocationOutputBinding, "digest">;
type ModelInvocationResultPayload = InvocationBinding & {
  protocol_version: "model-invocation-result@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256;
  projection_receipt_ref:
    ArtifactReferenceFor<"AgentDataProjectionReceipt">;
  model_profile: ModelProfileReference;
  output_binding: StoredModelInvocationOutputBinding;
  encrypted_blob: EncryptedResultBlobBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
  egress_policy_version: Version; dlp_scan: "PASS";
  retention_check: "PASS"; deletion_due_at: Timestamp;
};
type SqlInvocationResultPayload = InvocationBinding & {
  protocol_version: "sql-invocation-result@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256;
  sql_artifact_ref: ArtifactReferenceFor<"SqlArtifact">;
  execution_permit_ref: ArtifactReferenceFor<"ExecutionPermit">;
  datasource_id: ImmutableId; data_snapshot_binding_hash: Sha256;
  secure_execution_receipt_ref: SecureSqlExecutionReceiptRef;
  output_binding: StoredSqlInvocationOutputBinding;
  encrypted_blob: EncryptedResultBlobBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
  query_output_policy_version: Version; dlp_scan: "PASS";
  retention_check: "PASS"; deletion_due_at: Timestamp;
};
type SecureSqlExecutionReceiptPayload = InvocationBinding & {
  protocol_version: "secure-sql-execution-receipt@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256;
  sql_artifact_ref: ArtifactReferenceFor<"SqlArtifact">;
  execution_permit_ref: ArtifactReferenceFor<"ExecutionPermit">;
  datasource_id: ImmutableId; data_snapshot_binding_hash: Sha256;
  result_ref: SqlInvocationResultRef;
  output_binding: StoredSqlInvocationOutputBinding;
  executed_at: Timestamp;
};
type ToolInvocationResultPayload = InvocationBinding & {
  protocol_version: "tool-invocation-result@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  canonical_request_digest: Sha256; permit_ref: ToolInvocationPermitRef;
  policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
  output_binding: StoredToolInvocationOutputBinding;
  encrypted_blob: EncryptedResultBlobBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
  tool_output_policy_version: Version; dlp_scan: "PASS";
  retention_check: "PASS"; deletion_due_at: Timestamp;
};
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
      { result_ref: SqlInvocationResultRef;
        secure_execution_receipt_ref: SecureSqlExecutionReceiptRef;
        output: SqlInvocationOutput }>)
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
  invokeModel(capabilityInput: unknown,
    input: ModelInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "MODEL_PROVIDER" }>>>;
  invokeSql(capabilityInput: unknown,
    input: SqlInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "SQL_EXECUTOR" }>>>;
  invokeTool(capabilityInput: unknown,
    input: ToolInvocationInput):
    Promise<PortResult<Extract<CommittedInvocation,
      { adapter_method: "TOOL_ADAPTER" }>>>;
}
```

三个 public invoke 方法只接受 `unknown` capability input。server-only Adapter 以
required、strict exact-two-field Schema 解析同 `S/principal` 的 `invocation` 与
`result_decryption` current Manifest capability；前者须是 matching Kind Invocation
Authority，后者仅供 commit 后密文 Resolver。解析结构不导出、两 token 不得互换或进入
strict input；仅有 Invocation Authority 不足以返回正文。

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
按 Kind 绑定同事务创建的 Model/SQL/Tool Result Ref；SQL 还必须绑定同事务创建的
Secure SQL Execution Receipt；
FAILED 必须令 `completion_binding=null` 并绑定 exact `error_code`。任何 Result、
Secure SQL Receipt、Usage、Kind 或 Error 换绑都必须得到不同 Hash，并由 strict resolver
拒绝。

Result Digest 固定为：

```text
model = sha256(UTF8("model-result@1.0.0\0")
  || UTF8("application/json; charset=utf-8\0") || decoded_body)
sql   = sha256(UTF8("sql-result@1.0.0\0")
  || UTF8("application/json; charset=utf-8\0") || decoded_body)
tool  = sha256(UTF8("tool-result@1.0.0\0")
  || UTF8("application/json; charset=utf-8\0") || decoded_body)
```

裸 Digest 只存在于 Candidate、进程内校验和最终解密值，不进 Result metadata、AAD、
Operation、Audit 或 Redis。持久
`StoredModelInvocationOutputBinding|StoredSqlInvocationOutputBinding|
StoredToolInvocationOutputBinding` 只保留协议、媒体类型与长度；SQL 另保留
`row_count/column_count`。Terminal 幂等使用 keyed `terminal_input_commitment`；
Decryptor 验证 GCM 后重算 Digest，再组装
`ModelInvocationOutput|SqlInvocationOutput|ToolInvocationOutput`。

五种 Base64Url 均须 URL alphabet、无 padding、长度/decoded 上限且 re-encode 相等。
Model Candidate 在 Begin 前纯计算；Projection 在 Begin 后重建 bytes，使
Candidate/Begin/Receipt exact。Adapter 在 I/O 前匹配同一 IN_USE
的 Kind/Seq/Lease/Invocation/Request/Attempt/Fence/digest；SQL 再匹配
Permit/Snapshot/Parameters，Model 再匹配 Projection、HMAC/count/provider/profile/
certification；Model 失败报 `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED`，SQL 失败报
`SQL_INVOCATION_NOT_AUTHORIZED`，且都保持零网络。

Tool Begin 前解析 exact Permit（tool/schema/arguments/policy/S/Principal/expiry/epoch），
且只允许 ALLOWLISTED+READ_ONLY+NON_SOURCE+NO_EXTERNAL_SIDE_EFFECT。非 ACTIVE 报
`RESEARCH_SYSTEM_RECORD_NOT_ACTIVE`，换绑报
`RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH`，其余在 I/O 前拒绝。

U6 production SQL rows 必须进入 Secure SQL Receipt + encrypted Result；U5
`SandboxResult` 只允许 `SYNTHETIC_FIXTURE`，精确物理阻断取 Execution Storage 分册。
三类正文、Candidate/DB Command、Preparation、密码与 replay 只取 Crypto 分册。
I/O 前非法 Result 使用 Platform Error；真实 I/O 后的 invalid/governance failure 必须
以 actual Usage 提交 matching `*_RESULT_*` FAILED Terminal，不能遗留 STARTED 或伪称
OUTCOME_UNKNOWN。

`authorizeAgentDataProjection` 只调用
`authorize_agent_data_projection(envelope_json jsonb)`；验证
`AGENT_DATA_PROJECTION_AUTHORITY` 后同事务调用
`commit_research_system_artifact`。这是 Execution profile 内的专用 System Artifact
Writer，只写 `research_system_artifacts`；Receipt 行即 Projection Operation。内部
Writer 不 GRANT，Terminal RPC/底层 DML 不得成为公开明文入口。Invocation/CHECK 取
State；Resolved OutcomeUsage 必须与 Terminal 完全相等。

## 3. Conformance

双 PG 验证 Seq/Key/Lease、未知与迟到 Outcome、Settle/Cancel 双序、旧 Fence、三类
I/O 零旁路、Tool policy、Result/Usage/Secure SQL Receipt/Base64/governance/跨 `S`。
Projection 外层 RPC 成功且内部直调拒绝。Terminal claim、密文、解密、Tombstone 与
Hosted/Docker
向量只取 Crypto/Lifecycle 分册；Database GRANT/DML 只取 Database Surface 分册。
