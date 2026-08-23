# U6 System Record Lifecycle 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-system-record-lifecycle@1.2.0`
> 本文仍是待实现设计合同，不是 Tombstone 或密码擦除已经交付的证明。

本文是 `u6-research-resource-invocation-contract.md` 中 System Record 与 deployment
Audit Purge 的唯一生命周期分册。Primitive、StrictCommandBase、InvocationBinding、Permit/Result/Termination Payload
与 Ref、Base64Url、`PortResult` 和错误类型均直接导入，不得重声明宽类型。
Result 加密、解密与字段编码只取 `u6-invocation-result-crypto-contract.md`；RPC
GRANT/denylist 只取 Database Surface；物理表/nullable CHECK/逐行锁序只取 Execution
Storage，Terminal candidate key/FK 只取 Terminal Reference Graph。
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

type InvocationResultRef =
  | ModelInvocationResultRef
  | SqlInvocationResultRef
  | ToolInvocationResultRef;
type TombstoneInvocationResultInput = StrictCommandBase & {
  transition_id: ImmutableId; result_ref: InvocationResultRef;
  expected_blob_state: "AVAILABLE";
  reason_code: "RETENTION_PERIOD_ELAPSED";
};
type EraseSubjectInvocationResultInput = StrictCommandBase & {
  transition_id: ImmutableId; result_ref: InvocationResultRef;
  expected_blob_state: "AVAILABLE";
  reason_code: "SUBJECT_ERASURE_CONFIRMED";
  erasure_request_id: ImmutableId;
  erasure_request_hash: Sha256;
};
type ResultBlobLifecycleCommon = {
  blob_id: ImmutableId; store: "research_invocation_result_blobs";
  encryption_protocol_version: "research-result-encryption@1.0.0";
  algorithm: "AES-256-GCM"; key_derivation: "HKDF-SHA256";
  ciphertext_hash: Sha256; aad_hash: Sha256;
  encryption_key_version: Version;
};
type ResultBlobLifecycle =
  | (ResultBlobLifecycleCommon & {
      state: "AVAILABLE"; ciphertext_present: true;
      nonce_present: true; auth_tag_present: true;
      tombstoned_at: null })
  | (ResultBlobLifecycleCommon & {
      state: "TOMBSTONED"; ciphertext_present: false;
      nonce_present: false; auth_tag_present: false;
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
type AuditRetentionPolicyRef = {
  policy_version: Version; policy_hash: Sha256;
};
type AuditPurgeInput =
  | { protocol_version: "u6-audit-purge-retention@1.0.0";
      operation_id: ImmutableId; scope: AppScope; purpose: "RETENTION";
      expected_current_policy_ref: AuditRetentionPolicyRef;
      request_hash: Sha256 }
  | { protocol_version: "u6-audit-purge-subject-erasure@1.0.0";
      operation_id: ImmutableId; scope: AppScope; purpose: "SUBJECT_ERASURE";
      principal_id: PrincipalId; erasure_request_id: ImmutableId;
      erasure_request_hash: Sha256; source_transition_id: ImmutableId;
      expected_current_policy_ref: AuditRetentionPolicyRef;
      request_hash: Sha256 };
type StoredAuditPurgeResult = {
  protocol_version: "u6-audit-purge-result@1.0.0";
  operation_id: ImmutableId; request_hash: Sha256; scope: AppScope;
  purpose: AuditPurgeInput["purpose"];
  current_policy_ref: AuditRetentionPolicyRef;
  cutoff_at: Timestamp; deleted_count: NonNegativeInt;
  committed_at: Timestamp;
};
type AuditPurgeResult = StoredAuditPurgeResult & { created: boolean };

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
  eraseSubjectResult(capabilityInput: unknown,
    input: EraseSubjectInvocationResultInput):
    Promise<PortResult<TombstonedInvocationResult>>;
}
```

该 Port 只从 `@data-agent/research/server` 导出。Resolver 仍使用 Resource Wire 分册的
strict Ref；它们是只读 RPC，不属于本状态迁移 Port。

## 2. 唯一方法 Capability

| 方法 / 迁移 | 唯一 Owner |
| --- | --- |
| `commitAdapterTermination` | 与 `resource_kind` 匹配的 MODEL/SQL/TOOL Invocation Authority |
| `issueToolPermit` | `TOOL_POLICY_AUTHORITY` |
| `revokeToolPermit` | `TOOL_POLICY_AUTHORITY` |
| `expireToolPermit` | `TOOL_POLICY_EXPIRY_AUTHORITY` |
| `tombstoneResult` | `RESULT_RETENTION_AUTHORITY` |
| `eraseSubjectResult` | `RESULT_ERASURE_AUTHORITY` |

Expiry/Retention Worker 只持有各自窄 Capability，不能 Issue/Revoke Permit、调用 Tool、
读取解密正文或提交 Invocation Terminal。Capability 在事务内匹配 Scope、Principal、
Role、Epoch 与 expiry；应用自报 Owner 无效。

`RESULT_ERASURE_AUTHORITY` 只允许当前 subject Principal 自身的受信 privacy service
入口使用；`command.principal_id`、Result/Run 的 retained Principal 与 locked
Capability Principal 必须完全相同，Owner/支持人员不能跨 Principal 擦除。外部删除请求
的真实性由 server-only privacy controller 验证；数据库只把
`erasure_request_id/hash`、当前 Authority 与实际 Tombstone 结果提交为不可变 Operation。
在外部请求 verifier、backup expiry 与恢复 Oracle 尚未交付前，Release 仍保持 HOLD，
不得把该数据库动作宣称为完整法规合规。

## 3. 状态机

```text
AdapterTerminationReceipt
  ABSENT -- matching Kind Invocation Authority --> COMMITTED
  COMMITTED // absorbing

ToolInvocationPermit
  ABSENT -- TOOL_POLICY_AUTHORITY --> ACTIVE
  ACTIVE -- TOOL_POLICY_AUTHORITY --> REVOKED
  ACTIVE -- TOOL_POLICY_EXPIRY_AUTHORITY + db_now >= expires_at --> EXPIRED
  REVOKED | EXPIRED // absorbing

Result Blob
  ABSENT -- commit_invocation_terminal in same transaction --> AVAILABLE
  AVAILABLE -- RESULT_RETENTION_AUTHORITY
             + current Result Retention Policy legal_hold=NONE
             + db_now >= deletion_due_at --> TOMBSTONED
  AVAILABLE -- RESULT_ERASURE_AUTHORITY
             + same subject Principal
             + current Result Retention Policy legal_hold=NONE
             + SUBJECT_ERASURE_CONFIRMED exact request ref --> TOMBSTONED
  TOMBSTONED // absorbing
```

U6 v1 `server_max_ttl=300_000ms`；`policy_max_ttl` 从 Execution Storage 的 locked
exact Tool Permit Policy Limit 读取（`1..300_000`）。Issue 在数据库按
`min(requested_ttl_ms,policy_max_ttl,300_000)` 计算
`expires_at=db_now+effective_ttl`；调用方不能提交绝对时间或状态。Resolver 在
`db_now>=expires_at` 时即使异步 Expiry Job 尚未提交，也必须返回
`RESEARCH_SYSTEM_RECORD_NOT_ACTIVE`，不得依赖调度及时性维持安全。Expiry Job 只负责把
持久状态最终推进为 EXPIRED。

Result metadata/ciphertext Resolver 在 `db_now>=deletion_due_at` 时，即使异步
Retention Job 未提交，也
固定返回 `REPLAY_SNAPSHOT_UNAVAILABLE`，不能因调度延迟继续解密。Job 先用 immutable
Result Ref 无锁定位 Run/key/preparation identity，随后唯一使用 Execution Storage §5
的 Run-first `Result Tombstone` profile；本分册不得另写 Key-first 顺序。单一事务锁
current Head/exact Policy 与 row-bound historical Policy：后者只验证已固化
duration/hash/deletion_due_at，当前 hold 唯一取前者；再重验 Scope、状态/DB time，并按
Execution Storage §3 的
Tombstone 物理写序清除
ciphertext/nonce/tag、Result/Preparation 的 structured AAD/seed 与
`terminal_input_commitment`，再闭合状态与 System Transition；这些字段从一开始不含裸
plaintext digest。Tombstone 后只保留 digestless Result metadata、ciphertext/AAD hash、
算法与两类历史 Key Version/FK；version metadata 不含 key material，也不阻止 Key
retirement。这些字段不能用于低熵正文离线字典恢复。TOMBSTONED 不返回空
正文。Lifecycle Port 永不返回密文/nonce/tag，Retention Capability 也没有解密或读取
正文的能力。加密算法、AAD、claim 与 replay-before-encrypt 只取 Crypto 分册，本文不
另造密码协议。

Subject Erasure 使用同一 Run-first 锁序、同一清除序列与同一吸收态，但不要求
`db_now>=deletion_due_at`。它必须在全部锁后重验 exact request id/hash、同 subject
Principal 与 current Result Retention Head exact Policy 的 `legal_hold=NONE`；
row-bound 历史 ACTIVE 在 Head CAS 到 NONE 后不再 veto，stale NONE 也不能绕过
current ACTIVE；current ACTIVE 返回 `RESEARCH_RESULT_GOVERNANCE_REJECTED` 且零写。
Audit retention/subject-erasure
由独立 deployment purge function 管理；Result 擦除既不伪造 Audit 删除，也
不把保留的非敏感 hash/key-version metadata当成可恢复正文。

Audit Purge 的 strict input/result 只取本分册；`request_hash` 逐字取 Migration Safety
的 deployment-command codec。部署 caller 先走 Database Surface PROVISION prefix
（含 lifecycle shared），再取 operation advisory/row；
exact committed replay 直接返回 stored result，不重做 current-policy/eligibility
判断且不产生 DELETE。只有新 operation 才锁 current Audit Retention Head/exact
Policy，要求 expected Ref 相等且 current hold=NONE；row-bound historical Policy 只
提供 immutable `delete_after/hash`。RETENTION 的 `cutoff_at=db_now`，只删
`delete_after<=db_now`。SUBJECT_ERASURE 以 `source_transition_id` 精确锁定同
S/principal/request id/hash 的已提交 `SUBJECT_ERASURE_CONFIRMED` Transition，
`cutoff_at=source.committed_at`，只删同 Principal 且 `observed_at<=cutoff_at` 的 Audit；
没有该 Result-erasure authority 时不支持 audit-only erasure。Purge Operation 的
`result_json` exact 保存 `StoredAuditPurgeResult`，不保存 subject/request/capability/
Result identity；首次响应附 `created=true`，同 operation/hash replay 取原 result 并附
false，异 hash、换 branch/source 均冲突。

AdapterTermination Receipt 的 `terminated_at`、Permit 的 issued/expired/revoked time、
Blob 的 tombstoned time 全由数据库时钟产生。Commit input 不接收这些时间、Ref Hash、
Owner、Producer 或状态字段。

## 4. 幂等与数据库

`research_system_record_transition_operations`：

- 该 non-Terminal operation 的 PK/UQ/FK 与 nullable CHECK 只取 Execution Storage §2；
  其中 idempotency UQ 不含 Transition Kind；
- 保存 exact Input Hash、old/new State、Owner Capability ID/Epoch、Outcome 与 DB time；
- 同键同输入返回原结果；跨阶段复用 Key或同键异输入返回
  `RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT`。

Tombstone/Subject Erasure 先重验当前 caller Capability，再取 transition
operation 的 non-locking exact probe。命中则返回原非正文结果，不重做当前 Policy/
TTL/state mutation；miss 不持有 operation/advisory，按 Run-first profile 到正常 System
Transition slot 才 advisory+重读，仍 absent 才 mutate+insert。因此首次在 current
hold=NONE 完成的 Tombstone/Erasure，即使后来 Head=ACTIVE，也可重放结果但不会再删
任何行；新 operation 仍被 current ACTIVE 拒绝。其余四类 mutation 保持 Storage
各自 Run-first profile，在 System Transition slot 判定 replay。

六类 mutation 的逐行锁序唯一取 Execution Storage §5，不在本分册复制。Permit
absent-key advisory key 固定为
`sha256(UTF8("u6-tool-permit@1.0.0\0") ||
UTF8(JCS([app_id,tenant_id,environment,record_id])))`；不得把 `S` 编成 nested array。
对 app=`11111111-1111-4111-8111-111111111111`、tenant=
`22222222-2222-4222-8222-222222222222`、environment=`test`、record=
`33333333-3333-4333-8333-333333333333`，结果固定为
`sha256:433cc13c228f18e7d26f2c8767f7effad597fc58327963a219e59deb4ac224c2`。取得后仍须锁
真实 Permit 行。Terminal Commit 与 Tombstone 的完整锁序分别只取 Execution Storage
§5；本分册不得用“共享后缀”省略 SQL Receipt、OutcomeUsage、Invocation Transition 或
Tombstone System Transition。

AdapterTermination commit 以 `(S,record_id,record_version)` 和
`(S,commit_id)` 唯一；同一 Invocation/Lease 只允许一张 exact Termination Receipt。
Permit 和 Blob 迁移都使用状态行锁 + operation 行锁；CAS loser 重读后只在 exact
同输入时重放，否则冲突。

本 Port 的六个 mutation RPC、read Resolver 与内部 helper 的完整 exposure/GRANT
只取 Database Surface 分册，本文不维护第二份 allowlist。内部 insert/update 不
GRANT。Resource 分册中的
`resolve_committed_adapter_termination_receipt`、
`resolve_committed_invocation_outcome_usage`、
`resolve_current_tool_invocation_permit`、
`resolve_committed_model_invocation_result`、
`resolve_committed_sql_invocation_result`、
`resolve_committed_secure_sql_execution_receipt` 与
`resolve_committed_tool_invocation_result` 只返回事实/metadata；密文只经 Crypto
分册的 `resolve_invocation_result_ciphertext`，且只接受
`RESULT_DECRYPTION_AUTHORITY`。

## 5. Crash 与 Conformance

1. Permit Issue/Revoke/Expire 每条迁移覆盖同键重放、跨阶段 Key、CAS loser 与 DB TTL
   精确边界。
2. ACTIVE 已过期但 Job 未运行时，Resolver 仍拒绝 Tool I/O；Job 重放最终得到同一
   EXPIRED。
3. REVOKED/EXPIRED Permit 不能复活、互转或签发新 Lease。
4. Retention Tombstone 到期前拒绝；到期后 ciphertext/nonce/tag 清空与状态/System
   Transition Operation 原子，崩溃
   重放不泄漏正文也不丢 metadata/hash/key version。
5. 到期但 Job 未运行及 TOMBSTONED Resolver 都报 `REPLAY_SNAPSHOT_UNAVAILABLE`；
   跨 `S` Blob 不可见。
6. Expiry/Retention Capability 不能 Issue/Revoke/Invoke/Terminalize，Tool Policy
   Capability 不能 Tombstone。
7. Termination Receipt 换 Kind/Reservation/Lease/Attempt/Fence/Request/Digest 或非
   matching Kind Invocation Authority 全部拒绝。
8. 调用方夹带时间、状态、Owner、Hash 或 Producer 字段均 strict parse 失败。
9. AVAILABLE 的 nonce/tag/AAD/ciphertext hash 任一篡改都不能解密；DB、Audit、日志、
   Checkpoint 对 sentinel 明文检索为空，Tombstone 后重放也不能恢复正文。
10. Subject Erasure 可在 retention 到期前由 matching
    `RESULT_ERASURE_AUTHORITY` 清除同 Principal Result；跨 Principal/S、伪造或换绑
    request hash、普通 Result Retention Authority、ACTIVE legal hold 全部零写失败。
    同 request/transition/input 重放返回同一 TOMBSTONED 结果，异输入冲突。
11. 同 Run 的 Tombstone 与 Permit/Termination 故意复用 transition id 时，前者无锁
    probe miss 后不持有 operation lock；两连接无 `40P01`，在各自正常 slot 线性化为
    一个 winner 与一个 cross-stage conflict。
