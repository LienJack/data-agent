# U6 Research Execution PostgreSQL 物理存储合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-research-execution-storage@1.0.0`
> 本文冻结待实现表、非 Terminal 键/FK、nullable CHECK、时间与锁序；Terminal
> candidate key/FK 只取 Reference Graph。不证明 `10590` 已生成或安装。

本文是 Resource/Invocation/System Record/System Artifact/Result/Blob/Key metadata
物理来源；Wire 取 Resource/Invocation/Crypto/Lifecycle，Authority/RPC 取 Database
Surface，Terminal/Key/Cleanup/Migration 分别取 Reference Graph/Key Lifecycle/App
Cleanup/Migration Safety，primitive/Ref/error 取其上游。
`S=(app_id,tenant_id,environment)`；业务 identity/FK/UQ/Index/RLS/锁均展开 `S`。
两张 retained control table 是唯一 `L=(app_id,environment)` relation；普通 U6_JOB
仅 cleanup-owner policy 可按可信 L binding 删除。

## 1. 既有表前置约束

`10590` 必须为既有表增加或证明以下 exact candidate key：

```text
runs:
  UQ (S,run_id,principal_id)
artifacts:
  UQ (S,run_id,artifact_id,artifact_type,revision,content_hash)
run_attempts:
  existing PK (S,attempt_id)
  existing UQ (S,attempt_id,outbox_id,run_id)
  U6 exact UQ (S,attempt_id,outbox_id,run_id,worker_fence)
outbox:
  exact (S,outbox_id,run_id,active_attempt_id,run_fence)
memberships:
  existing PK/UQ (S,principal_id)
```

`principal_id` 一律 `uuid`，FK 只绑定 retained Membership `(S,principal_id)`；
active/role/version 由 Authority prefix 重验，不用 predicate FK。普通 FK 默认为
`RESTRICT NOT DEFERRABLE`；Key predecessor 例外只取 Key Lifecycle，为
`NO ACTION MATCH SIMPLE NOT DEFERRABLE`；Graph §6 的 `T` 内部 FK 为
`NO ACTION DEFERRABLE`（四条 reciprocal INITIALLY DEFERRED，其余 INITIALLY
IMMEDIATE）。TS safe `bigint` CHECK `0..9007199254740991`；PositiveInt 从 1 起。
外部 Worker Fence 必须正数，`0` 只允许 internal Readiness Revocation Writer。

## 2. Execution 表与主键

下表是 Inventory 摘要；Terminal reference candidate UQ、物理 kind 与 reference FK
只取 Terminal Reference Graph，禁止从简称推导 literal FK。

| 表 | PK / UQ / 关键 FK |
| --- | --- |
| `research_tool_permit_policy_limits` | PK `(S,policy_version)`；UQ exact `(S,policy_version,policy_limit_hash)`；`tool_permit_max_ttl_ms`；immutable server-owned |
| `research_result_retention_policies` | PK `(S,policy_id,policy_version)`；UQ exact Ref `(S,policy_id,policy_version,policy_hash)`；`retention_duration_ms`、result legal-hold CHECK；immutable server-owned |
| `research_result_retention_policy_heads` | PK `S`；FK exact current result policy Ref；Provisioner CAS |
| `research_result_access_audit_retention_policies` | PK `(S,policy_version)`；UQ exact `(S,policy_version,policy_hash)`；online/erasure/backup limits 与 legal-hold CHECK；immutable |
| `research_result_access_audit_retention_heads` | PK `S`；FK exact current policy version/hash；Provisioner CAS |
| `research_result_access_audit_purge_operations` | PK `(S,operation_id)`；保存 policy ref/purpose/deleted_count/DB time，不保存 principal/result hash |
| `research_lifecycle_cleanup_operations` | PK `(L,operation_id)`；UQ `(L,app_epoch,component)`；stable op hash、next seq/count；RUNNING→COMMITTED；无 PII |
| `research_lifecycle_cleanup_batch_receipts` | PK `(L,batch_id)`；UQ `(L,operation_id,batch_seq)`；op/request hash/count；append-only retained |
| `research_result_key_versions` | PK、ACTIVE/STAGED partial UQ、state/predecessor 只取 Key Lifecycle |
| `research_result_key_transition_operations` | PK `(S,operation_id)`；append-only request/result replay receipt 只取 Key Lifecycle |
| `research_resource_run_heads` | PK `(S,run_id)`；FK Run；`next_reservation_seq` 单调 |
| `research_resource_reservations` | PK `(S,reservation_id)`；UQ `(S,run_id,reservation_seq)`、`(S,run_id,principal_id,reserve_idempotency_key)`；FK Run/Membership/Brief；该行即 Reserve Operation，保存 strict input hash/outcome |
| `research_resource_transition_operations` | PK `(S,transition_id)`；UQ `(S,reservation_id,principal_id,idempotency_key)`；FK Reservation |
| `research_invocation_request_operations` | PK `(S,invocation_id)`；idempotency UQ；完整 `I` cleanup-only FK 到 Invocation.I |
| `research_invocation_commits` | PK `(S,invocation_id)`；UQ exact `I`/Reservation/Request；FK Reservation/Attempt；nullable RequestOp pointer cleanup-only FK |
| `research_invocation_transition_operations` | PK `(S,transition_id)`；UQ `(S,invocation_id,transition_id)`、`(S,invocation_id,principal_id,idempotency_key)`；cleanup-only FK 到 Invocation |
| `research_invocation_terminal_preparations` | PK `(S,preparation_id)`；UQ P/terminal；完整 I cleanup-only FK；generated 两类 key kind/composite FK；exact Retention、Transition 与 committed refs FK |
| `research_system_artifacts` | PK `(S,run_id,artifact_id,revision)`；UQ exact Ref 与 `(S,run_id,principal_id,idempotency_key)`；仅 AgentDataProjectionReceipt；FK Run/Membership/Reservation/Invocation；该行即 Operation |
| `research_system_record_identities` | PK identity；UQ exact `SR`/commit；FK Run/Principal |
| `research_adapter_termination_receipts` | physical kind CHECK；SR 与完整 I immediate FK；UQ TX |
| `research_invocation_outcome_usage` | physical kind CHECK；SR immediate、完整 I cleanup-only FK；UQ UX |
| `research_tool_invocation_permits` | physical kind CHECK；SR FK；exact Policy/Limit FK；lifecycle CHECK |
| `research_invocation_results` | physical kind/resource CHECK；SR immediate、完整 I cleanup-only FK；UQ RX/RA；exact Retention FK |
| `research_secure_sql_execution_receipts` | physical SQL Receipt kind；SR immediate、完整 I cleanup-only FK；UQ QX |
| `research_invocation_result_blobs` | PK `(S,blob_id)`；UQ BI/BX/BA；完整 I cleanup-only FK；generated ENCRYPTION kind 与 exact Key FK |
| `research_system_record_transition_operations` | PK `(S,transition_id)`；UQ `(S,record_kind,record_id,principal_id,idempotency_key)`；fixed `record_version=1`；FK `(S,record_kind,record_id,record_version)` 到 exact System Identity；Result reason/erasure request nullable CHECK |
| `research_result_ciphertext_access_audits` | PK `(S,audit_id)`；Index `(S,principal_id,observed_at)`、`(S,attempted_result_identity_hash,observed_at)`、resolved Result identity/time；FK exact retention policy + `delete_after`；三阶段 CHECK/FK；retention 内 append-only |

Tool Permit Policy Limit 的 hash 固定为：

```text
sha256(UTF8("u6-tool-permit-policy-limit@1.0.0\0") ||
  UTF8(JCS([app_id,tenant_id,environment,policy_version,
            tool_permit_max_ttl_ms])))
```

System Identity `record_kind` 只允许
`ADAPTER_TERMINATION_RECEIPT|INVOCATION_OUTCOME_USAGE|TOOL_INVOCATION_PERMIT|
MODEL_INVOCATION_RESULT|SQL_INVOCATION_RESULT|TOOL_INVOCATION_RESULT|
SECURE_SQL_EXECUTION_RECEIPT`。所有 `record_version=1`。创建型
`commit_id=transition_id`；Permit Revoke/Expire 只追加 Transition Operation，不改原始
commit ID。

`research_invocation_commits` 保存 Binding/Kind/Request、Result/Receipt/Usage/
Outcome/Unknown Hash、State 与 DB time；nullable CHECK 取 Invocation State。
AUTHORIZED pointer 为空；STARTED/OUTCOME_UNKNOWN/COMPLETED pointer=`invocation_id`。
FAILED 零 I/O 分支 pointer/time 都空，I/O 分支 pointer=`invocation_id` 且 start time
非空。它以
`(S,attempt_id,outbox_id,run_id,worker_fence)` FK 到原始 Attempt。
Begin/Start 要求当前 lease；late Terminal、Termination、
Settle/Cancel 只重验该冻结 Binding，不要求旧 Worker lease 仍 ACTIVE。

`research_system_artifacts` 只保存 AgentDataProjection Receipt 的 exact
Request/Profile/Reservation/Input/Field/Byte/Token/HMAC/Policy binding；append-only，
不镜像进通用 `artifacts`，也不接受其他 artifact family。

Preparation 保存 Crypto 分册的 digestless `StoredTerminalInputCommitmentFacts`。
Ciphertext Resolver 将其与 locked Request/Invocation/Transition/Result/SQL Receipt/
OutcomeUsage 逐字段重验后放入 envelope；Decryptor 只补入解密后重算的 digest。

Result Retention Policy 由 current Head 指向 immutable exact Ref。Policy 固定
`retention_duration_ms=1..31_536_000_000`、`legal_hold=NONE|ACTIVE`；ACTIVE 必须有
非明文 `hold_ref_hash`，NONE 时该列必须为空。Prepare 只使用 locked current Policy 并
把 exact Ref、duration 与 DB 计算的 `deletion_due_at` 固化进 Result/Preparation。
Retention Tombstone 与 Subject Erasure 都锁 current Head 的 exact Policy，再锁 Result
已绑定的 historical Policy。两种操作都只以 current Head 的 exact Policy 作为当前
legal-hold authority：current ACTIVE 时零写；row-bound historical Policy 只证明
immutable duration/hash/deletion time，Head 已 CAS 到 NONE 后，旧 ACTIVE 行不再
veto。Provisioner 只能追加版本并 CAS Head，不能原地改 hold。

Ciphertext Access Audit 的 strict Wire：

```ts
type AccessAuditResolution =
  | { resolution_stage: "CAPABILITY_UNRESOLVED";
      capability_id: null; authority_epoch: null; result_ref: null;
      blob_id: null; encryption_key_version: null }
  | { resolution_stage: "CAPABILITY_RESOLVED";
      capability_id: ImmutableId; authority_epoch: NonNegativeInt; result_ref: null;
      blob_id: null; encryption_key_version: null }
  | { resolution_stage: "RESULT_RESOLVED";
      capability_id: ImmutableId; authority_epoch: NonNegativeInt;
      result_ref: InvocationResultRef; blob_id: ImmutableId;
      encryption_key_version: Version };
type ResultCiphertextAccessAudit = AccessAuditResolution & {
  audit_id: ImmutableId; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; attempted_capability_id_hash: Sha256;
  attempted_result_identity_hash: Sha256;
  access_reason: "INVOCATION_RETURN" | "IDEMPOTENT_REPLAY" |
    "AUTHORIZED_ANALYSIS";
  outcome: "ALLOWED" | "DENIED" | "RATE_LIMITED";
  denial_code: U6PlatformErrorCode | null; observed_at: Timestamp;
};
```

Audit 物理展开 `resolved_record_kind/id/version` 与 nullable
`resolved_encryption_key_kind`。三阶段 CHECK、五组 immediate MATCH SIMPLE FK 与
Result+Blob+Key cross-binding 只取 Terminal Reference Graph §7；禁止 MATCH FULL、
predicate/conditional FK。Capability revoke、Tombstone 与 Key retire 保留 target。

Audit 不是无限期日志。创建时锁 current retention head，绑定 exact policy/hash，并以
`FOR SHARE` 锁 Head、`FOR KEY SHARE` 锁 exact immutable Policy，再以 DB time 计算
`delete_after`；policy 固定 online retention `1..365d`、erasure SLA
`1..7d`、backup window `0..35d` 与 `legal_hold=NONE|ACTIVE`（ACTIVE 必须有非明文
hold ref hash）。在线期内禁止 UPDATE/普通 DELETE；只有 deployment-only
`purge_u6_result_ciphertext_access_audits` 可删除；strict branch、request hash、
current-vs-bound hold、eligible cutoff 与 stored/replay result 只取 System Record
Lifecycle。Hosted/Docker 都必须有 backup-expiry attestation；缺 policy、purge/
restore Oracle 或 backup window 证据时 Release 保持 HOLD。

## 3. 可表达的 Result/Blob/SQL 环

三类 Result 不建三张互斥父表；统一使用 `research_invocation_results` 的
`record_kind` 判别与 kind-specific strict payload CHECK，避免 Blob 指向 polymorphic
table。AVAILABLE Result 保存 digestless metadata/AAD、`blob_id`；TOMBSTONED 原子清
Result/Preparation 的 structured AAD/seed，只保留 `aad_hash`。Blob 保存 exact
Result identity。仅 Result↔Blob、SQL Result↔Receipt 的四条 reciprocal FK 按 Terminal
Reference Graph §6 使用 `NO ACTION DEFERRABLE INITIALLY DEFERRED`；其他 refs immediate。
事务写序固定：

```text
System Identity + Result metadata
→ Secure SQL Receipt identity/metadata（仅 SQL）
→ Blob
→ OutcomeUsage identity/metadata
→ Invocation CAS
→ Transition Operation
→ Preparation COMMITTED
```

提交时四条 FK 必须闭合；失败全部回滚。OutcomeUsage COMPLETED 只接受
同事务 exact Result，SQL 还接受同事务 exact Secure Receipt；旧
`SandboxExecutionReceipt/SandboxResult` 永远不是 U6 production FK target。

其余终态物理写序同样固定，且只在 §5 的全部锁与单一 `db_now` 后执行：

```text
Prepare claim/takeover:
  Preparation INSERT/CAS → CLAIMED
FAILED Terminal:
  OutcomeUsage Identity + OutcomeUsage → Invocation CAS → Transition Operation
Result Tombstone:
  Blob bytes clear + TOMBSTONED
  → Result structured AAD clear + TOMBSTONED
  → Preparation commitment/AAD/seed clear + TOMBSTONED
  → System Transition Operation
```

每条序列任一步失败整事务回滚；Prepare 不创建 Transition，FAILED 不创建
Preparation/Result/Receipt/Blob，Tombstone 保留 Terminal Reference Graph 的 refs/key FK。
Result Transition Operation 的 nullable 真值固定为：Retention reason 时
`erasure_request_id/hash` 全空；`SUBJECT_ERASURE_CONFIRMED` 时两者全非空且逐字保存。
同一 `(S,record,principal,idempotency_key)` 跨 reason 重用仍冲突。

## 4. Preparation nullable 真值

所有状态都保留 immutable Invocation/terminal stage/Retention Policy identity、两类
非秘密历史 Key Version/FK 与正数 `preparation_version`；物理表不存在另一个
`claim_version` 列。AAD/seed 仅在 CLAIMED/COMMITTED 保留，
TOMBSTONED/ABORTED 必须整组清空。

```text
CLAIMED:
  terminal_input_commitment/encryption_key_version/commitment_key_version 非空
  result_blob_aad/encrypted_blob_seed 非空
  committed_transition_id/aborted_transition_id 为空
  claim_token_hash/claim_expires_at 非空
  committed_result/blob/usage/committed_at 全空

COMMITTED:
  committed_transition_id=terminal_transition_id
  aborted_transition_id 为空
  claim_token_hash/claim_expires_at 清空
  preparation_version 保留
  result/blob/usage/committed_at 非空
  terminal_input_commitment/encryption_key_version/commitment_key_version 非空
  result_blob_aad/encrypted_blob_seed 非空

TOMBSTONED（由关联 Result lifecycle 推进）:
  committed_transition_id=terminal_transition_id
  aborted_transition_id 为空
  terminal_input_commitment 清空
  encryption_key_version/commitment_key_version 非空
  result_blob_aad/encrypted_blob_seed 全空
  committed identity/time 保留

ABORTED（仅 expired claim + plaintext Candidate 已丢失）:
  committed_transition_id 为空
  terminal_input_commitment 为空
  encryption_key_version/commitment_key_version 非空
  result_blob_aad/encrypted_blob_seed 全空
  claim_token_hash/claim_expires_at 为空
  aborted_transition_id/aborted_at 非空
  preparation_version 保留
  result/blob/usage/committed_at 全空
```

Preparation 状态只允许 `CLAIMED→COMMITTED→TOMBSTONED` 或
`CLAIMED(expired)→ABORTED`；TOMBSTONED/ABORTED 吸收。ABORTED 的
`aborted_transition_id != terminal_transition_id`：INITIAL 分支指向同事务执行
`STARTED→OUTCOME_UNKNOWN` 的 Abort Transition Operation；LATE 分支指向同事务
`state_changed=false` 的 Abort Recovery Operation，且 Invocation 保持
OUTCOME_UNKNOWN。两类 operation 都是 Invocation Transition 表中的闭合判别值和
immediate FK target。

Token 原文永不落库。Token hash、Base64Url 与 commitment 规则只取 Crypto 分册。

## 5. 唯一业务锁序

所有 App RPC 先取得 Database Surface 的共同 Authority prefix 行锁并完成非时间校验：

```text
current backend authority（candidate）
→ platform.lock_u6_authority_binding
  → lifecycle shared advisory
  → deployment mapping FOR SHARE NOWAIT
  → lifecycle FOR SHARE NOWAIT
  → membership FOR SHARE NOWAIT
→ assignment advisory key（Head absent only）
→ capability Head
→ capability row
```

Authority helper 持锁的 Membership snapshot 直接复用，profile 不再锁 Membership。
随后按函数 profile 取锁；除 identity/UQ advisory 外，短名均展开完整 `S`。Ciphertext
防枚举与 Result replay 只在前缀无锁探测；其余 run mutation 首锁 Run。凡触及共享 Lease，
固定按 U4 全局 Rank `Run → Outbox → RunAttempt` 分开执行 `SELECT ... FOR UPDATE`。
若 input 只有 `attempt_id`，取得 exact Run/domain lock 后才可按完整 `S` 无锁定位
candidate `outbox_id`；该读只产 locator，不产生 Authority/TTL 事实。随后先锁 exact
Outbox、再锁 exact RunAttempt，并逐字段重验 composite binding、active attempt 与
fence；禁止用一次 join lock 把物理锁序交给 planner：

```text
Reserve:
  Run → exact ResearchBrief artifact → Resource Run Head → Reservation

Reserved Cancel / Expire:
  Run → Reservation → Resource Transition

Begin:
  Run → Reservation
  → exact Outbox Lease
  → exact current RunAttempt
  → optional Tool Permit System Identity → optional Tool Permit
  → Invocation identity → Invocation（AUTHORIZED）
  → Resource Transition

Projection:
  Run → Reservation → exact Outbox Lease → exact current RunAttempt
  → Invocation → System Artifact

Start:
  Run → Reservation → exact Outbox Lease → exact current RunAttempt
  → Request Operation
  → optional Tool Permit System Identity → optional Tool Permit
  → Invocation → Invocation Transition

Outcome Unknown:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → optional TERMINAL_INITIAL Key Version（ENCRYPTION → COMMITMENT）
  → Request Operation → Invocation
  → OutcomeUnknown Transition identity → optional TERMINAL_INITIAL Preparation

Abort Terminal Preparation:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → Key Version（ENCRYPTION → COMMITMENT）
  → Request Operation → Invocation
  → Abort Transition/Recovery Operation identity → exact Preparation

Prepare COMPLETED Terminal:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → Result Retention Policy Head（FOR SHARE）→ exact current Result Retention Policy
  → Key Version（ENCRYPTION → COMMITMENT）
  → Request Operation → Invocation
  → Terminal Transition identity advisory / existing row → Preparation

Completed Terminal:
  Run → Reservation
  → exact original Outbox
  → exact original RunAttempt
  → Key Version（ENCRYPTION → COMMITMENT）
  → Request Operation → Invocation
  → Terminal Transition identity advisory / existing row
  → Preparation
  → Result Identity → Result
  → optional Secure SQL Receipt Identity → optional Secure SQL Receipt
  → Blob
  → OutcomeUsage Identity → OutcomeUsage

Failed Terminal from AUTHORIZED（zero I/O）:
  Run → Reservation
  → exact original Outbox
  → exact original RunAttempt
  → Invocation
  → Terminal Transition identity advisory / existing row
  → optional matching Preparation
  → OutcomeUsage Identity → OutcomeUsage

Failed Terminal after Start:
  Run → Reservation
  → exact original Outbox
  → exact original RunAttempt
  → Request Operation → Invocation
  → Terminal Transition identity advisory / existing row
  → optional matching Preparation
  → OutcomeUsage Identity → OutcomeUsage

Adapter Termination:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → optional Request Operation → Invocation
  → Termination Identity → Termination Receipt → System Transition

Settle:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → optional Request Operation → Invocation
  → OutcomeUsage Identity → OutcomeUsage → Resource Transition

Active Cancel:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → optional Request Operation → Invocation
  → Termination Identity → Termination Receipt
  → OutcomeUsage Identity → OutcomeUsage → Resource Transition

Abandon:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → Request Operation → Invocation → Resource Transition

Permit Issue:
  Run → exact PolicyReceipt → matching Tool Permit Policy Limit → Permit identity advisory
  → Permit System Identity → Permit → System Transition

Permit Revoke / Expire:
  Run → Permit System Identity → Permit → System Transition

Result Tombstone/Subject Erasure:
  caller Capability prefix
  → non-locking exact committed operation probe（命中即结束）
  → [miss only] Run → Result Retention Policy Head（FOR SHARE）
  → current/bound Result Retention Policy（exact Ref bytes 升序）
  → Key Version（ENCRYPTION → COMMITMENT）
  → Preparation → Result Identity → Result → Blob
  → System Transition advisory/re-read（exact replay 或 new mutation+receipt）

Ciphertext Resolve:
  current backend authority unresolved → 零 U6 业务/Audit 行；
    Adapter 仅可 best-effort 发 identifier-free
    `u6_auth_rejection_total{stage,code}`；它不是 durable Audit/Release Evidence，结束
  capability unresolved
    → principal rate advisory → Audit Retention Head → exact Policy
    → U6 CAPABILITY_UNRESOLVED Audit，结束
  capability resolved → principal rate advisory → Audit Retention Head → exact Policy
    → attempted Result absence determination
    → absent/cross-S: U6 CAPABILITY_RESOLVED Audit，结束
    → present/current-scope: Run → Key Version（ENCRYPTION → COMMITMENT）
      → Request Operation → Invocation → Terminal Transition → Preparation
      → Result Identity → Result
      → optional Secure SQL Receipt Identity → optional Receipt
      → Blob → OutcomeUsage Identity → OutcomeUsage
      → U6 RESULT_RESOLVED Audit

Audit Purge:
  Database Surface PROVISION prefix（含 lifecycle shared）
  → purge operation advisory / exact committed replay（命中即结束）
  → [new only] Retention Policy Head（FOR SHARE）→ exact Policy
  → exact source_transition_id Operation（仅 subject 分支）
  → eligible Audit（S,audit_id）→ Purge Operation
```

Ciphertext 早退禁止锁调用方声称的 Run；只有 capability 与 current-scope Result/Run
都解析后才 Run-first，避免 existence/lock oracle。Provision/Rotation 保持
Head/Key-first；两连接必须覆盖 rate-advisory-vs-Run。

Execution Policy Provision 先取同 `S` 的 scope-wide policy advisory；Result Retention
与 Audit Retention 各自固定 Head `FOR UPDATE` → current Policy → insert new immutable
Policy → Head CAS。同表需要锁 current/bound 两个 Result Policy Ref 时按完整
`(policy_id,policy_version,policy_hash)` UTF-8 bytes 升序。因此
Prepare/Tombstone/Resolver/Purge 的 Head→Policy 顺序不会与 Provision 形成反向锁。

普通 Terminal/Tombstone/Resolver 的 Key 只读锁按 `ENCRYPTION=0`、
`COMMITMENT=1`，同 kind 再按 version UTF-8 bytes。四个 Key mutation 的 advisory、
operation replay、metadata CAS 与 dependency 锁序只取 Result Key Lifecycle。

Public read profile 固定为：

```text
Terminal Preparation recovery metadata:
  Run → Reservation → exact original Outbox → exact original RunAttempt
  → Request Operation → Invocation → Preparation（FOR KEY SHARE）
Termination metadata:
  Termination System Identity → Termination Receipt（FOR KEY SHARE）
OutcomeUsage metadata:
  OutcomeUsage System Identity → OutcomeUsage（FOR KEY SHARE）
Current Permit metadata:
  Permit System Identity → Permit（FOR SHARE）
MODEL/SQL/TOOL Result metadata:
  Result System Identity → Result → Blob（FOR KEY SHARE）
Secure SQL Receipt metadata:
  Secure SQL Receipt System Identity → Receipt（FOR KEY SHARE）
```

read Resolver 零业务写；查无行时先完成 absence determination。Preparation 只返回
Binding/kind + stage/id/version/state/expiry，不返回 secret；Permit 以单一 `db_now`
校验 ACTIVE/expiry，Result 同时校验 Blob AVAILABLE 与 deletion boundary。Immutable
Resolver 不用 `FOR UPDATE`；Ciphertext 因 Audit/限流使用 mutation profile。

Ciphertext profile 的每条结束分支都在其全部可能等待后捕获单一 `db_now`，再同时判断
Capability expiry、60 秒 Audit window、Result 状态与 deletion boundary。principal
advisory 固定按 current backend authorized `S/principal_id`，不按时间桶。Audit 行物理
`S/principal_id` 也只取 current backend authority；不得写入 attempted/Result 的 Scope。
`attempted_capability_id_hash` 使用 envelope command scope：

```text
sha256(UTF8("u6-result-access-capability@1.0.0\0") ||
  UTF8(JCS([command.scope.app_id,command.scope.tenant_id,command.scope.environment,
            authority_capability_id])))
```

`attempted_result_identity_hash` 使用 `result_ref.scope`：

```text
sha256(UTF8("u6-result-access-identity@1.0.0\0") ||
  UTF8(JCS([result_ref.scope.app_id,result_ref.scope.tenant_id,
            result_ref.scope.environment,
            record_kind,record_id,record_version])))
```

限流计数按 attempted result hash；任何 Audit/错误响应都不泄露目标 Scope 是否存在。

mutation profile 仅对本函数可创建的缺失行，按 identity/全部候选 UQ 的无分隔 JCS
数组取 domain-separated advisory lock，再 `INSERT ... ON CONFLICT DO NOTHING`、
重读并 `FOR UPDATE`；同键异 hash 失败。Read Resolver 不插占位，advisory 不替代行锁。
Permit Issue 从 immutable Policy Receipt/Limit 注入 policy version/hash/max TTL，
调用方不可覆盖。Prepare 从 locked current Result Policy 固化 duration/exact Ref/
`deletion_due_at`；Tombstone/Erasure 只以操作时 locked current Head exact Policy
判断 hold，row-bound Policy 只校验已固化期限/hash。裸 Ref/环境变量不产生 Authority。

Preparation 的 `terminal_transition_id=command.transition_id` 与 AUTHORIZED
Invocation 的 `request_id` 都是 immutable input identity。对应 Transition/Request
Operation 在 COMMIT/Start 事务内创建后才补齐 pointer；两条 nullable pointer 的状态
CHECK、FK 与删序只取 Terminal Reference Graph §3/§4，不能用跨事务 deferred FK 掩盖
缺行。COMPLETED replay 继续锁 Result/optional SQL Receipt/Blob/OutcomeUsage；FAILED
replay 不走 Prepare，只锁既有 terminal operation 与 OutcomeUsage 并返回持久 metadata。

Start、Terminal、Termination、Settle 与 Active Cancel 都先锁 Reservation，故
conditional request pointer 可线性化；pointer 为空只允许 AUTHORIZED 零 I/O FAILED，
且 actual usage 全零，其他终态均要求 pointer 非空。

FAILED 对 optional Preparation 只读不创建；同 identity 的非 ABORTED 行返回
`RESEARCH_INVOCATION_TERMINAL_CONFLICT`。OUTCOME_UNKNOWN 遇 active CLAIMED 返回
BUSY，遇 COMMITTED/TOMBSTONED replay；expired CLAIMED 只能用
`abort_invocation_terminal_preparation`。Abort 必须逐字匹配 resolver 的
id/version/state，在全部锁后以一个 `db_now` 重验，并保留两类 Key Version/FK。若
derived operation 已存在，则 exact replay；同键异输入冲突。新 Abort 仅接受已过期
CLAIMED：INITIAL 原子写 `STARTED→OUTCOME_UNKNOWN`、Abort Transition 与 ABORTED；
LATE 保持 OUTCOME_UNKNOWN，写唯一 `state_changed=false` Recovery Operation 后
ABORTED。两者清 commitment、AAD/seed、claim token/expiry，不创建 Result/Blob/Usage、
不重调外部 I/O。takeover/abort 由 Reservation 锁线性化；ABORTED stage 不可复活，
INITIAL 仍可进入唯一 `TERMINAL_LATE`，LATE 则永久关闭 U6 v1 Terminal path。

Invocation pointer 的数据库 `CHECK` 固定为：

```text
AUTHORIZED: request_operation_invocation_id/start_committed_at 都为空
STARTED|OUTCOME_UNKNOWN|COMPLETED:
  request_operation_invocation_id=invocation_id，start_committed_at 非空
FAILED:
  两者都空（AUTHORIZED 零 I/O 分支）
  或 request_operation_invocation_id=invocation_id 且 start_committed_at 非空
```

Begin/Start 必须重验 Attempt=`ACTIVE`、Fence、Outbox active attempt 与
`db_now < lease_expires_at`；late/recovery paths 允许原 Attempt 已终态，但 frozen
Attempt/Outbox/Reservation/Fence 任一换绑都失败。取得任一 profile 子锁后禁止调用
Root Artifact/Readiness writer。两连接测试必须覆盖 Terminal-vs-Tombstone、
rotation-vs-claim、Start-vs-takeover 与 late-settle-vs-expiry。

上述 optional Permit 仅适用于 TOOL；锁内必须用同一 `db_now` 重验 exact Binding、
`ACTIVE` 且 `db_now < expires_at`。MODEL/SQL 不得产生占位 Permit 行。

Artifact/Readiness 的独立锁序只取 Database Surface §3；本文不复制。

### 5.1 Lifecycle-exclusive cleanup

整环境清理只取 App Lifecycle Cleanup：exclusive lock 排空普通 profile，再按
Inventory rank 处理 tenants；Terminal 只延迟 Reference Graph 闭合集合。retained
control 不含 principal/result identity、不计 residual；所有 U6_JOB relation 必须归零。
普通 RPC、Result Retention/Erasure 与 Job cleanup authorization/receipt 不得互换。

## 6. 单次数据库时间与 TTL

每个函数按 Database Surface §1 在 prefix 行锁及完整 profile 的全部潜在等待后只捕获一次
`db_now=clock_timestamp()`；先重验 Capability expiry，再以同一值完成全部业务判断：
同一事务新写的 observed/created/issued/expired/tombstoned 时间均显式使用该值，禁止列
default/trigger 再读时钟。

```text
active  := db_now < expires_at
expired := db_now >= expires_at
```

U6 v1 固定：

| 边界 | 值 / 来源 |
| --- | --- |
| Report Read Grant | `60_000ms` |
| Resource Reservation | `60_000ms` |
| Resource Lease | `min(db_now+900_000ms,RunAttempt.lease_expires_at)`；剩余 `<5_000ms` 拒绝 |
| Tool Permit server max | `300_000ms` |
| Tool Permit policy max | locked `research_tool_permit_policy_limits.tool_permit_max_ttl_ms`，范围 `1..300_000` |
| Terminal claim | `30_000ms` |
| Result deletion | Prepare 时以 locked current duration 与 DB time 固化 `deletion_due_at`；到期判断取该列，hold 只取操作时 current Head exact Policy |

Retention duration 范围 `1..31_536_000_000ms`；调用方不能提交绝对删除时间。Result、
Audit 两类 policy row 及各自 Head 都由部署 Provisioner 按版本化 Manifest 安装，
App/Service 无 DML；配置变化新增 exact version/hash 行并 CAS Head，不能覆盖旧行或
读取无版本环境变量。

## 7. 必需 Oracle

- catalog 证明全部 PK/UQ/FK/CHECK/deferrability 与本表逐字一致；
- 三类 Result 共用一张物理表，跨 kind Result/Blob/Receipt 换绑失败；
- 四条 reciprocal FK 在单事务成功、任一步 rollback 零孤儿；普通 public RPC 不
  defer，除 Terminal Graph §6 明列的 `T` 内 cleanup-only 集合外其余 FK 均
  NOT DEFERRABLE；
- stale Worker 不能 Begin/Start；无 ABORTED TERMINAL_LATE 时原 Worker 终态后的 exact
  late Terminal/Settle 可完成；LATE abort 后任何 Terminal 固定
  `RESEARCH_INVOCATION_LATE_TERMINAL_CLOSED`；
- CLAIMED/COMMITTED/TOMBSTONED/ABORTED 每个非法 nullable 组合都被 CHECK 拒绝；
- Key kind/state/timestamp 非法组合与 ACTIVE UQ 失败；old 先 demote/new 后 promote 不触发
  `23505`，CLAIMED 阻塞 rotation，双 kind rotation 无锁环；
- bigint 超 TS safe integer、Fence 0、非 UUID Principal、跨 `S` FK 全部失败；
- TTL 左闭右开边界、单一 `db_now`、过期 Job 延迟下 Resolver 仍失败关闭；
- 伪造 PolicyReceipt/Retention Ref、同 identity 异值、跨 `S` policy 与环境变量 fallback
  全部失败，Hosted/Docker Manifest 产出相同 policy rows；
- Result/Audit current Head=`ACTIVE` 时零 Tombstone/Purge；追加 NONE 并 CAS Head
  后，即使 row-bound historical Policy 仍为 ACTIVE，到期与 matching subject erasure
  也成功；stale/noncurrent NONE 不能绕过 current ACTIVE。Audit RETENTION 无 caller
  cutoff，SUBJECT_ERASURE 只删 exact source Transition 的同 Principal/cutoff；同
  request 多 Result 时 source id 固定 cutoff，同输入重放相同，换 source 与旧 operation
  冲突；超过 provider
  backup window 的 restore 不含已清 principal/hash，否则 Release 保持 HOLD；
- production SQL rows 在 PostgreSQL/Audit/Checkpoint/Redis sentinel 检索为零。
