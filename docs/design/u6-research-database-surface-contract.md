# U6 Research PostgreSQL Authority、Artifact Committer 与函数面合同

> `FROZEN_DESIGN_CONTRACT / PARTIAL_IMPLEMENTATION` · `u6-research-database-surface@1.0.0`
> `10590`/ACL/RLS/fail-close 已装；正向面、exact Catalog、Receipt/Crypto 未交付。

本文只冻结 Authority/Artifact/RPC/ACL/Inventory/锁；派生 codec/事务取 Derivation
Wire/Receipt，Terminal FK 取 Reference Graph。

## 1. 数据库可验证的 U6 Authority

`AppCapability` 不证明 Frontier/Readiness/Resource/Invocation Authority；U6 另用
数据库 `research_authority_capabilities`：

```ts
type U6AuthorityKind =
  | "SEMANTIC_FRONTIER_AUTHORITY" | "SCHEMA_FRONTIER_AUTHORITY"
  | "DATA_SNAPSHOT_FRONTIER_AUTHORITY" | "POLICY_FRONTIER_AUTHORITY"
  | "IDENTITY_FRONTIER_AUTHORITY" | "RESEARCH_ARTIFACT_AUTHORITY"
  | "RESEARCH_STOP_AUTHORITY" | "CURRENT_READINESS_AUTHORITY"
  | "SERVICE_REVOCATION_AUTHORITY" | "REPORT_READ_AUTHORITY"
  | "REPORT_READ_EXPIRY_AUTHORITY"
  | "RESOURCE_AUTHORITY" | "AGENT_DATA_PROJECTION_AUTHORITY"
  | "MODEL_INVOCATION_AUTHORITY" | "SQL_INVOCATION_AUTHORITY"
  | "TOOL_INVOCATION_AUTHORITY" | "TOOL_POLICY_AUTHORITY"
  | "TOOL_POLICY_EXPIRY_AUTHORITY" | "RESULT_RETENTION_AUTHORITY"
  | "RESULT_ERASURE_AUTHORITY" | "RESULT_DECRYPTION_AUTHORITY"
  | "RELEASE_GO_AUTHORITY";
type ResearchArtifactAuthorityDomain =
  | "BRIEF_SEMANTIC" | "PLANNING" | "OBLIGATION_EXECUTION"
  | "EVIDENCE" | "CLAIM_STRUCTURE" | "RELATION" | "PROOF"
  | "COVERAGE" | "RESEARCH_STOP" | "PROJECTION"
  | "EVIDENCE_GATE" | "READINESS";
type U6AuthorityCapabilityBindingCommon = {
  capability_id: ImmutableId; scope: AppScope; principal_id: PrincipalId;
  deployment_id: ImmutableId; membership_version: PositiveInt;
  app_epoch: PositiveInt;
  membership_role: "OWNER" | "ANALYST" | "VIEWER";
  authority_kind: U6AuthorityKind;
  artifact_authority_domain: ResearchArtifactAuthorityDomain | null;
  frontier_kind: "SEMANTIC" | "SCHEMA" | "DATA" | "POLICY" | "IDENTITY" | null;
  resource_kind: "MODEL" | "SQL" | "TOOL" | null;
  authority_epoch: NonNegativeInt; expires_at: Timestamp;
};
type U6AuthorityCapabilityBinding =
  | (U6AuthorityCapabilityBindingCommon & {
      state: "ACTIVE"; revoked_at: null })
  | (U6AuthorityCapabilityBindingCommon & {
      state: "REVOKED"; revoked_at: Timestamp });
type U6DbCommand<T> = {
  protocol_version: "u6-db-command@1.0.0";
  authority_capability_id: ImmutableId;
  command: T;
};
type U6DbResult<T> =
  | { protocol_version: "u6-db-result@1.0.0"; ok: true; value: T }
  | { protocol_version: "u6-db-result@1.0.0"; ok: false;
      error: U6PlatformError };
```

public Port 的 `capabilityInput=unknown`；server-only Adapter 验证 exact
`app_capability/authority_capability_id`。dual-capability 取 Resource 分册，解析类型
不导出，`U6DbCommand<T>` 只作数据库 envelope。

`research_authority_capabilities`：PK `(S,capability_id)`；partial
`UNIQUE NULLS NOT DISTINCT (S,principal_id,authority_kind,
artifact_authority_domain,frontier_kind,resource_kind) WHERE state='ACTIVE'`。
Audit FK 使用 UQ `(S,capability_id,authority_epoch,principal_id)`。CHECK 令 Artifact/
Frontier/Invocation 仅填 matching discriminator，其他 Kind 三列全 null；
ACTIVE/REVOKED 对应 `revoked_at` null/DB time。失效后只能签发新 id/epoch。
Capability/Head 的 `(S,principal_id)` FK 绑定 Membership；Capability 的
`(app_id,environment,deployment_id)` FK 绑定 Deployment。
两者均 `ON DELETE RESTRICT NOT DEFERRABLE`，active/version/role 仍须锁内重验。

Capability Head 的 PK 为 `(S,assignment_key)`，key 为
`sha256(UTF8("u6-authority-assignment@1.0.0\0") ||
UTF8(JCS({principal_id,authority_kind,artifact_authority_domain,frontier_kind,
resource_kind})))`；五个展开字段用 `UNIQUE NULLS NOT DISTINCT` 一一对应。Provisioner
锁 Head、撤销旧 active、插入 `epoch+1` 并推进；Capability 禁止 DELETE/原地改
identity/epoch/expiry。RPC 重算并逐字段匹配，rotation 后历史 snapshot 失权。

Capability 行保存 matching `assignment_key`，并有 NOT DEFERRABLE UQ
`(S,assignment_key,capability_id)`；Head→Capability 用
`(S,assignment_key,current_capability_id)` `DEFERRABLE INITIALLY DEFERRED` FK。VIEWER
仅可 Report Read，Release GO 仅 OWNER，其他 service/worker 仅 OWNER|ANALYST；Raw
Result Decryption 禁止 Viewer，Result Erasure 只允许 matching subject Principal 的
OWNER|ANALYST privacy-service 入口，不能跨 Principal。
Capability 仅 Owner/Provisioner 可写，Backend/Service/Browser/Agent 无 DML；
Hosted/Docker 使用同一无 secret Manifest。

Adapter 验证 App Capability 后封装 strict `U6DbCommand<T>`；public RPC 均为
`(jsonb)→U6DbResult<T>`，拒绝 null/extra/non-UUID/裸 Command，并在事务内重锁
Capability。预期拒绝可由子事务回滚业务写后保留 FAILED/REJECTED Operation；`55P03`、
超时/死锁/序列化或未知 SQL/约束异常必须重抛并整事务回滚。

```text
platform.current_backend_authority(require_write)（仅 candidate）
→ platform.lock_u6_authority_binding(..., READ|WRITE)
   → lifecycle shared advisory
   → exact active deployment_mapping FOR SHARE NOWAIT
   → exact app_environment_lifecycle FOR SHARE NOWAIT
   → exact active membership FOR SHARE NOWAIT
→ assignment advisory key（仅 Head absent）
→ research_authority_capability_heads
→ research_authority_capabilities

strict command Scope/Principal
= helper 返回的 locked Scope/Principal
AND session/candidate Scope/Principal/Role/Deployment/Version/Epoch
= helper 返回的 locked current binding
AND Capability 的 Scope/Principal/Role/Deployment/Version/Epoch
= helper 返回的 locked current binding
AND state=ACTIVE
AND endpoint 固定的 expected Authority/Domain/Kind exact
```

Command 只声明 `S/principal`，禁止 Authority/Owner/Epoch/Role；Helper Owner 无源表
ACL。`55P03` 映射 lock-contended，Adapter 同 key 最多退避 3 次；全部锁后以单一
`db_now` 校验 TTL。未授权与不存在同错，Resolved type 不公开。

同目录的 `u6-authority-manifest.json`（`u6-authority-manifest@1.0.0`）保存 exact
`S/deployment/hash/Principal/Role/Authority domain/kind/expiry`；Provision 锁内重验
Membership version/app epoch。`u6-execution-policy-manifest.json`
（`u6-execution-policy-manifest@1.0.0`）保存 Tool policy 与 Result/Audit Retention
exact Ref/value/current Head/legal hold。第三份
`u6-derivation-policy-manifest.json` 的 Budget/Enumerator strict schema、子 Hash 与
Head CAS 只取 Derivation Wire §6。三者禁止 secret/password/raw key/KMS URI。

Deployment-only 函数固定为：

```text
provision_u6_authority_manifest
provision_u6_execution_policy_manifest
provision_u6_derivation_policy_manifest
stage_u6_result_key_version
activate_u6_result_key_version
retire_u6_result_key_version
compromise_u6_result_key_version
purge_u6_result_ciphertext_access_audits
```

八函数均为 `app_data_agent.<name>(jsonb) returns jsonb`，归 Provisioner Owner，固定
`VOLATILE CALLED ON NULL INPUT SECURITY DEFINER SET search_path=''`、全限定对象、
strict null 与 `pg_has_role(session_user,'data_agent_u6_provisioner','SET')`；登录先
`SET ROLE`。Manifest 只收 strict protocol/operation/manifest/request hash；Purge 取
System Lifecycle/Execution Storage，Key 取 Key Lifecycle。request hash 取 Migration
Safety codec，stored result 不含 `created`。Authority 按 assignment bytes 排序并走
PROVISION→Head→old→new；Policy
按 kind/Ref/version/hash bytes 排序、append-only/Head CAS。仅 metadata/hash，
Hosted/Docker 同输入；失败整事务回滚。

## 2. current Research Artifact Committer

目标 Registry 有 18 个 current exact tuple；public committer 接受其中 17 个，
Revocation 永久 internal。Coverage/Stop 目标为 v2；C1 已装面仍只认 v1 且 Root
fail-close。C2 migration 原子切到 v2 后禁止新写 v1；遗留 v1 current 只能作新 v2 的
expected parent，不能授权 Root。其余 tuple 版本只取 Authority/Wire。

```ts
type ResearchArtifactCommitInput = Readonly<{
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; commit_id: ImmutableId;
  attempt_id: ImmutableId; worker_fence: PositiveInt;
  idempotency_key: IdempotencyKey;
  candidate: L2ResearchDocumentCandidate;
  expected_parent_ref: ArtifactReference | null;
}>;
type CommittedResearchArtifact = Readonly<{
  reference: ArtifactReference;
  created: boolean;
}>;
interface ResearchArtifactAuthorityPort {
  commitCurrent(capabilityInput: unknown,
    input: ResearchArtifactCommitInput):
    Promise<PortResult<CommittedResearchArtifact>>;
  readHistorical(capabilityInput: unknown,
    reference: ArtifactReference):
    Promise<PortResult<
      HistoricalL2ResearchDocument |
      HistoricalVersionedL2ResearchDocument |
      null
    >>;
}
```

`commitCurrent` 只接受 matching `RESEARCH_ARTIFACT_AUTHORITY` domain：

| current Artifact | domain |
| --- | --- |
| `ResearchBrief` | `BRIEF_SEMANTIC` |
| `HypothesisSet`、`EvidencePlan` | `PLANNING` |
| `ObligationExecutionDecision` | `OBLIGATION_EXECUTION` |
| `QueryEvidence` | `EVIDENCE` |
| `AtomicClaim` | `CLAIM_STRUCTURE` |
| `EvidenceRelation` | `RELATION` |
| `EvidenceCheckReceipt`、`SupportDecision`、`HypothesisAssessment` | `PROOF` |
| `CoverageState` | `COVERAGE` |
| `ResearchStopDecision` | `RESEARCH_STOP` |
| `ReportManifest`、`AnalysisReport`、`ReportProjectionReceipt` | `PROJECTION` |
| `EvidenceGateReceipt` | `EVIDENCE_GATE` |
| `ReportReadyCertificate` | `READINESS` |
| `ReadinessRevocationReceipt` | 只允许 internal Revocation Writer，public committer 永远拒绝 |

Adapter 可在锁前做 JSON/大小/strict 预检；Reference、current tuple、Domain、
parent/hash、Attempt/Fence、active revision 与 Relation identity 必须锁内重验，不得复用
“`validate_document` 后才锁 Run”的通用 helper。

`expected_parent_ref=null` 仅允许无 active Revision；否则逐字段等于 current Ref，且
Candidate revision=parent+1、parent revision/hash exact、Scope/Run/Attempt/Fence 等于
input/lease。每次调用写 `research_artifact_commit_operations`：PK `(S,commit_id)`、UQ
`(S,run_id,principal_id,idempotency_key)`，保存 Input Hash/domain/old-new Ref/
COMMITTED/DB time；同键同输入 replay 原 Ref/`created=false`，异输入或不同 commit id
复用 key 冲突，失败不写伪 operation。
`10600` 增加 `budget_snapshot_receipt_id uuid`/`budget_snapshot_receipt_hash text`：
仅 CoverageState@2/ResearchStopDecision@2 两列全非空且等于 payload Binding，其余
tuple/v1 全空；`num_nonnulls` CHECK + `(S,run_id,id,hash)` immediate FK 到 Budget Receipt。
`readHistorical` 只接受 `REPORT_READ_AUTHORITY`，返回
`HISTORICAL_READ_ONLY/can_authorize_current=false`，不能复用 committer domain 或签发
current brand。

通用 `commitL2Artifact` 对 18 current tuple 固定
`L2_WIRE_VERSION_WRITE_UNSUPPORTED`；Backend 直接 DML 由 restrictive RLS 拒绝。
`commit_current_l2_artifact(jsonb)` 是 17 tuple 唯一入口，普通 Artifact 不变；第 18 个
仅 §6 internal Revocation Writer 复用同一 verifier/append/CAS，无其他可 GRANT 入口。

## 3. 全局锁入口与 EvidenceRelation

所有 current Research Artifact、Frontier、Readiness/Grant/GO 写事务都先完成共同
Authority prefix；其业务锁首行才是 `runs(S,run_id)`。严格语法预检不取得业务锁；
获得任一 U6 子域锁后禁止反向进入 Run。

Artifact Committer 固定顺序：

```text
runs
→ exact outbox lease
→ exact run_attempts（必须匹配 input.attempt_id/fence/DB expiry）
→ research_current_evidence_relation_keys（仅 EvidenceRelation，Pair identity 排序）
→ canonical artifact identity keys（Reference identity 排序）
→ active/exact artifact revisions（Reference identity 排序）
→ exact parent/input artifact rows（规范 Ref identity 排序）
→ exact Budget Snapshot Receipt（仅 Coverage/Stop v2）
→ Resource Run Head absent key → BUDGET_OPENED event key（仅首个 current ResearchBrief@2）
→ 锁内 current Wire/Domain Authority/closure/hash 校验
→ 原子 append revision + CAS；Brief 分支同时创建 ACTIVE Head 与 genesis event
→ optional input event head + append event（C2b）
```

不存在的 Relation Pair 在 Artifact lock 前按规范 Ref identity 数组取 SHA-256
advisory，再插入/锁 Pair；禁止分隔符拼接。Pair Key 为
`(S,run_id,claim_ref_identity,evidence_ref_identity)`；同 Pair 不同 artifact id 返回
`EVIDENCE_RELATION_IDENTITY_CONFLICT`。Readiness 已持 Run，不形成 Pair→Run。
Coverage/Stop v2 必须锁其同一 `S/run` Budget Receipt，重算 receipt hash、验证
`db_now<=valid_until` 且 Ledger 逐字相等，并把 ID/Hash 写入 commit operation；其余 15 个
public tuple 禁止该字段。Brief 分支以 `commit_id` 为 genesis source operation；exact replay
只返回既有 Artifact/Head/Event，缺失或异值报 invariant failure。后续不得回到 Artifact rank。

Frontier Initialize/Advance、Publish、Consume、Stop、Revoke、Grant 与 GO 的共同顺序：

```text
runs
→ exact outbox lease（仅需要 Worker Fence 的入口）
→ exact run_attempts（同上）
→ relation pair keys
→ canonical artifact identity keys
→ active & exact revision rows
→ budget policy head / exact policy（按函数需要）
→ resource run head → reservations → budget events（按函数需要）
→ enumerator head / exact version / attestation（Stop）
→ current_report_readiness
→ research_version_frontiers：
  SEMANTIC → SCHEMA → DATA → POLICY → IDENTITY
→ research_domain_terminal candidate key / existing row
→ report_read_grants（grant_id）
→ research_revocation_operations（operation_id）
→ research_release_decision_commits（decision_id）
→ input event head（C2b 最后一个共享 rank）
→ derivation/watermark receipt semantic/idempotency keys
```

仅有 `attempt_id` 时先锁 exact Run，再按完整 `S` 无锁定位 `outbox_id`（仅 locator，
不产生 Authority/TTL）；随后独立语句锁 Outbox、RunAttempt 并重验
`(S,attempt_id,outbox_id,run_id,active_attempt,fence)`；禁止 join `FOR UPDATE` 让
planner 决定物理锁序。该 Rank 与 U4 Runtime 的 Run→Outbox→Attempt 完全相同。

Current 或 Frontier 行不存在时仍先锁 Run，并用 Run lock 串行 absent-key 创建。Frontier
Advance 必须在 Current 前预锁 deterministic Revocation Receipt artifact key，不得先锁
单个 Frontier 再进入 Current；撤权级联保持同一 Root 事务。Resource、Invocation、
Result、Permit 与 Termination Receipt 的逐函数锁序只取 Execution Storage §5；它们
持锁后都不得调用 Root writer。

## 4. Public mutation RPC

下列是 Backend 唯一可执行的 mutation，均为 `(jsonb) RETURNS jsonb`、
`VOLATILE CALLED ON NULL INPUT SECURITY DEFINER SET search_path=''` 并返回
`U6DbResult<T>`。除兼容 Artifact committer 使用 Derivation Wire 的
`BackendDbCommand<T>` + current App WRITE 外，其余均为 strict `U6DbCommand<T>`；
两种 envelope 不可互换，null/extra key 都是结构化错误。下表本身就是 exact allowlist；
机器 manifest 的 `lock_profile` 只允许
`ROOT_ARTIFACT|ROOT_READINESS|RESOURCE_HEAD|RESOURCE_RESERVATION|INVOCATION|
RESULT_LIFECYCLE`，逐函数冻结如下：

| 函数 | matching Capability | strict Input → Result | lock profile |
| --- | --- | --- | --- |
| `commit_current_l2_artifact` | matching Research Artifact domain | `ResearchArtifactCommitInput → CommittedResearchArtifact` | `ROOT_ARTIFACT` |
| `commit_artifact_revision_run_locked` | current Backend WRITE；Grounding 还需 OWNER | `RunLockedArtifactCommitInput → RunLockedArtifactCommitResult` | `ROOT_ARTIFACT` |
| `begin_research_step` | Resource | `BeginResearchStepInput → BegunResearchStep` | `RESOURCE_HEAD` |
| `issue_research_budget_ledger_snapshot` | Research Stop | `IssueBudgetLedgerSnapshotInput → BudgetLedgerReceipt` | `ROOT_READINESS` |
| `issue_research_candidate_enumerator_attestation` | Research Stop | `IssueCandidateEnumeratorAttestationInput → CandidateEnumeratorAttestation` | `ROOT_READINESS` |
| `initialize_research_version_frontier` | matching Frontier | `FrontierInitializeInput → CommittedFrontier` | `ROOT_READINESS` |
| `advance_research_version_frontier` | matching Frontier | `FrontierAdvanceInput → CommittedFrontier` | `ROOT_READINESS` |
| `commit_research_stop_terminal` | Research Stop | `CommitResearchStopTerminalInput → CommittedResearchStopTerminal` | `ROOT_READINESS` |
| `publish_current_report_readiness` | Current Readiness | `PublishCurrentInput → PublishedCurrentReadiness` | `ROOT_READINESS` |
| `consume_current_ready` | Current Readiness 或 Report Read，按 purpose | `ConsumeCurrentInput → CurrentReadinessConsumeResult` | `ROOT_READINESS` |
| `revoke_current_readiness` | Service Revocation | `RevokeCurrentInput → CommittedCurrentRevocation` | `ROOT_READINESS` |
| `consume_report_read_grant` | Report Read | `ConsumeReportReadGrantInput → ConsumedReportReadGrant` | `ROOT_READINESS` |
| `expire_report_read_grant` | Report Read Expiry | `ExpireReportReadGrantInput → ExpiredReportReadGrant` | `ROOT_READINESS` |
| `commit_report_read_response` | Report Read | `CommitReportReadResponseInput → CommittedReportReadResponse` | `ROOT_READINESS` |
| `commit_current_release_go` | Release GO | `CommitCurrentGoInput → CommittedCurrentGo` | `ROOT_READINESS` |
| `authorize_agent_data_projection` | Agent Data Projection | `AuthorizeAgentDataProjectionInput → AuthorizedAgentDataProjection` | `RESOURCE_RESERVATION` |
| `reserve_research_resource` | Resource | `ReserveResourceInput → ReservedResource` | `RESOURCE_HEAD` |
| `begin_research_resource` | Resource | `BeginResourceInput → BegunResource` | `RESOURCE_RESERVATION` |
| `settle_research_resource` | Resource | `SettleResourceInput → SettledResource` | `RESOURCE_RESERVATION` |
| `cancel_research_resource` | Resource | `ReservedCancelInput\|ActiveCancelInput → Extract<EndedResource,{state:"CANCELLED"}>\|SettledResource` | `RESOURCE_RESERVATION` |
| `expire_research_resource` | Resource | `ExpireResourceInput → Extract<EndedResource,{state:"EXPIRED"}>` | `RESOURCE_RESERVATION` |
| `mark_research_resource_abandoned` | Resource | `AbandonResourceInput → Extract<EndedResource,{state:"ABANDONED"}>` | `RESOURCE_RESERVATION` |
| `start_research_invocation` | matching Invocation kind | `StartInvocationInput → StartedInvocationState` | `INVOCATION` |
| `mark_research_invocation_outcome_unknown` | matching Invocation kind | `MarkInvocationOutcomeUnknownInput → Extract<CommittedInvocationState,{state:"OUTCOME_UNKNOWN"}>` | `INVOCATION` |
| `abort_invocation_terminal_preparation` | matching Invocation kind | `AbortInvocationTerminalPreparationInput → AbortedInvocationTerminalPreparation` | `INVOCATION` |
| `prepare_invocation_terminal` | matching MODEL/SQL/TOOL Invocation | `PrepareInvocationTerminalInput → PrepareInvocationTerminalResult`（replay 也只含 metadata） | `INVOCATION` |
| `commit_invocation_terminal` | matching Invocation kind | `CommitInvocationTerminalDbCommand → CommittedInvocationTerminalDbResult` | `INVOCATION` |
| `commit_adapter_termination_receipt` | matching Invocation kind | `CommitAdapterTerminationReceiptInput → AdapterTerminationReceiptRef` | `RESOURCE_RESERVATION` |
| `issue_tool_invocation_permit` | Tool Policy | `IssueToolInvocationPermitInput → Extract<CommittedToolInvocationPermit,{status:"ACTIVE"}>` | `RESULT_LIFECYCLE` |
| `revoke_tool_invocation_permit` | Tool Policy | `RevokeToolInvocationPermitInput → Extract<CommittedToolInvocationPermit,{status:"REVOKED"}>` | `RESULT_LIFECYCLE` |
| `expire_tool_invocation_permit` | Tool Policy Expiry | `ExpireToolInvocationPermitInput → Extract<CommittedToolInvocationPermit,{status:"EXPIRED"}>` | `RESULT_LIFECYCLE` |
| `tombstone_invocation_result` | Result Retention | `TombstoneInvocationResultInput → TombstonedInvocationResult` | `RESULT_LIFECYCLE` |
| `erase_subject_invocation_result` | Result Erasure | `EraseSubjectInvocationResultInput → TombstonedInvocationResult` | `RESULT_LIFECYCLE` |

`revoke_current_readiness` 的 public command 只允许
`EVIDENCE_REVOKED|CERTIFICATE_TAMPERED`。五类 Frontier reason 只由
`advance_research_version_frontier` 构造内部
`CascadeFrontierRevocationCommand`，绑定 matching Frontier capability 与同一
`operation_id`；不能通过 public Revoke 冒充。

## 5. Public read Resolver 与解密窄面

Backend 只可调用下列 Resolver，仍须 exact Capability/Scope/Principal/Ref；参数是
`U6DbCommand<ReadInput>`。metadata 输入为 `StrictReadBase`+exact selector，Ref 输入为
`StrictRefReadInput<Ref>` 并重验 base/Ref Scope/run；ciphertext 因审计幂等键使用
Crypto `StrictCommandBase`；下表是 exact allowlist：

| Resolver | matching Capability | strict Result | lock profile |
| --- | --- | --- | --- |
| `resolve_invocation_terminal_preparation_recovery_metadata` | matching Invocation kind | `ResolveInvocationTerminalPreparationRecoveryMetadataInput → InvocationTerminalPreparationRecoveryMetadata`（Binding/kind + stage/id/version/state/expiry） | `INVOCATION` |
| `read_historical_l2_research_artifact` | Report Read | `StrictRefReadInput<ArtifactReference> → HistoricalL2ResearchDocument\|HistoricalVersionedL2ResearchDocument\|null` | `ROOT_READINESS` |
| `resolve_committed_adapter_termination_receipt` | Resource | `StrictRefReadInput<AdapterTerminationReceiptRef> → AdapterTerminationReceiptPayload` | `RESOURCE_RESERVATION` |
| `resolve_committed_invocation_outcome_usage` | Resource | `StrictRefReadInput<InvocationOutcomeUsageRef> → InvocationOutcomeUsagePayload` | `RESOURCE_RESERVATION` |
| `resolve_current_tool_invocation_permit` | Resource 或 Tool Invocation | `StrictRefReadInput<ToolInvocationPermitRef> → Extract<CommittedToolInvocationPermit,{status:"ACTIVE"}>` | `RESOURCE_RESERVATION` |
| `resolve_committed_model_invocation_result` | Model Invocation | `StrictRefReadInput<ModelInvocationResultRef> → ModelInvocationResultPayload`（无 ciphertext） | `INVOCATION` |
| `resolve_committed_sql_invocation_result` | SQL Invocation | `StrictRefReadInput<SqlInvocationResultRef> → SqlInvocationResultPayload`（无 ciphertext） | `INVOCATION` |
| `resolve_committed_secure_sql_execution_receipt` | SQL Invocation | `StrictRefReadInput<SecureSqlExecutionReceiptRef> → SecureSqlExecutionReceiptPayload`（无 rows/ciphertext） | `INVOCATION` |
| `resolve_committed_tool_invocation_result` | Tool Invocation | `StrictRefReadInput<ToolInvocationResultRef> → ToolInvocationResultPayload`（无 ciphertext） | `INVOCATION` |
| `resolve_invocation_result_ciphertext` | Result Decryption | `ResolveInvocationResultCiphertextInput → EncryptedInvocationResultEnvelope` | `RESULT_LIFECYCLE` |

十个 Resolver 均为 `VOLATILE CALLED ON NULL INPUT SECURITY DEFINER SET
search_path=''`；前九个只返历史文档/metadata/事实，最后一个仅接受
`RESULT_DECRYPTION_AUTHORITY` 并遵守 Crypto/Lifecycle deletion boundary。Browser
无 RPC/table 权限。

Historical read 只能经上列显式 Resolver 在同一事务验证 Report Read Authority；返回值
固定 `HISTORICAL_READ_ONLY/can_authorize_current=false`，不能产生 current brand。

### 5.1 Job-only App Lifecycle cleanup

`JOB_CLEANUP` 仅有
`cleanup_u6_delete_pending_environment(jsonb) returns jsonb`：caller=既有 Job，
owner=Cleanup Owner，不进入 RPC/`U6DbCommand`/Provisioner/Authority；全部锁、receipt、
rank、Erasure、residual 取 Cleanup Contract。Job 无底表/RPC/Resolver/解密权；Cleanup
Owner 无 Platform 表 ACL，只可执行 Platform Lock Owner 的
`lock_u6_cleanup_platform_evidence(uuid,text,bigint,uuid,text,uuid,text,uuid,text,uuid,text)`。

## 6. Internal-only 函数与直接 DML

`10590` 在 Platform Schema 只新增 Authority/Cleanup lock helper 与 Lifecycle identity
immutable guard。`lock_u6_authority_binding(uuid,uuid,text,uuid,uuid,text,text)` 接受 exact
`app/tenant/environment/deployment/principal/expected_role/mode`（mode 为
`READ|WRITE|PROVISION`），返回 locked current binding，不接受 caller 版本。它归
Platform Lock Owner，固定 security-definer 属性、全限定对象与 strict/null fail-closed；
仅 RPC/Provisioner Owner 可执行。锁序为 lifecycle shared advisory→D→L→M 三条独立
`FOR SHARE NOWAIT`。三个 lock-column UPDATE 仅为 locking privilege：Deployment/
Lifecycle 有 immutable trigger，Membership policy 为 exact S/principal 且
`WITH CHECK(false)`，函数体零 DML。source-writer-first 触发 `55P03` 整体回滚；
lifecycle-exclusive-first 等待后重验新 state/epoch 并零写失败；均不得 `40P01`。

U6 唯一允许出现的命名 internal routine 如下，只能被同一事务中的 public
security-definer 调用，必须从 PUBLIC/Browser/Backend/Service `REVOKE ALL`：

```text
lock_u6_authority_capability
u6_domain_sha256
u6_research_kernel_sha256
u6_uuid_v5
u6_strict_base64url_decode
u6_constant_time_equal
commit_research_revocation_receipt
commit_research_system_artifact
issue_coverage_derivation_receipt_internal
issue_candidate_enumeration_receipt_internal
issue_stop_derivation_receipt_internal
issue_input_event_watermark_receipt_internal
```

五个 `u6_*` primitive 只处理 byte/hash/UUID/canonical decode，不读写业务表：domain
hash 必须使用 `convert_to(prefix,'UTF8') || decode('00','hex') ||
convert_to(runtime_canonical_json(payload),'UTF8')`，禁止在 PostgreSQL text 中拼 NUL；
Research Hash 的收紧值域/codec 只取 Derivation Wire；constant-time compare 不得 early
return。`10590` preflight 要求 `pgcrypto` 在固定 `extensions` schema，claim token 只用
`extensions.gen_random_bytes(32)`。三张 C2a internal Receipt 仅可从 Stop Root 调用；
Watermark 仅可从未来 ReportReady Root 调用，均无 public GRANT。

其余 U6 insert/update、Pair absent-key、claim token、Audit/Event 写入必须内联于对应
public/internal函数或使用 Schema Inventory 明列且 NO-GRANT 的 trigger；不得新增未登记
helper。Capability provision/revoke 只属于部署 Provisioner，不进入 App public/internal
函数面。

内部 `commit_research_revocation_receipt` 接受判别联合：

- `SERVICE_REQUEST`：只来自 public Revoke 与两种 service reason；
- `FRONTIER_ADVANCE`：只来自 matching Frontier Advance 与唯一映射 reason。

两支都重验 source operation、Certificate/Frontier、Epoch、Envelope/Domain Hash；
`ReadinessRevocationReceipt.envelope.attempt_id=source_operation_id` 且
`worker_fence=0`。普通 Artifact Committer 拒绝 service fence 0。
`commit_research_system_artifact` 只由
`authorize_agent_data_projection` 调用并只写 `research_system_artifacts` 中的
AgentDataProjection Receipt；它属于 Execution Storage 的 Projection profile，不调用
Root Artifact Writer，也不写通用 `artifacts`。

所有 U6 表对 Browser/Public 无权；`data_agent_backend|service_role` 不获得直接 DML。
若复用既有
`artifacts` SELECT，仍须完整 `S` RLS，且 current Authority 只能由 exact Resolver/
Committer 返回，不能由裸行 Parse 产生。

SQL role 固定：

- `data_agent_u6_data_owner`：全部 U6 table owner；
- `data_agent_u6_platform_lock_owner`：两个 Platform lock helper 的唯一 owner；
- `data_agent_u6_rpc_owner`：App public/internal function owner 与 exact dependency；
- `data_agent_u6_provisioner_owner`：八个部署函数 owner 与 exact dependency；
- `data_agent_u6_cleanup_owner`：唯一 cleanup owner；权限只取 Cleanup Contract；
- `data_agent_u6_provisioner`：部署 `SET ROLE` executor，仅部署函数 EXECUTE；
- `data_agent_backend`：仅 public allowlist EXECUTE；
- `data_agent_job_authority`：App/U6 仅 cleanup EXECUTE/schema USAGE；
- `PUBLIC|anon|authenticated|service_role`：U6 权限为零。

Migration 显式 ALTER OWNER；public/deployment EXECUTE 仅授 Backend/Provisioner，
禁止 default privilege/owner membership 扩权；Inventory exact 函数属性/owner/null。

RPC owner 仅获三 schema USAGE、所需 helper EXECUTE/U6 DML；Provisioner owner 仅获
manifest/key/policy/head DML，Audit 只经 purge。Platform Lock Owner 除 Authority 源表，
只获 Cleanup 冻结的五表 SELECT/单列锁 UPDATE。Cleanup owner 无 Authority/RPC/
Provisioner/key 权，caller GUC 不授权。

前六个新 U6 owner/executor 均 `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOINHERIT NOBYPASSRLS`；既有 Backend/Job group role 保留 Platform
同等安全属性，Inventory 分别 exact。普通 U6 表 FORCE RLS + owner exact-S policy；
owner=`U6_JOB` 的表另有仅 Cleanup Owner + 四个可信 binding 的 exact-L cleanup policy。
两张 retained table 是唯一 L-scope relation，另限 operation/batch；Backend、
service_role、Job 无 table ACL。Lock Owner Membership policy 还限 principal；
RPC/Provisioner 无 Membership ACL。RLS 不替代 Authority/Head/Epoch。

Core lock ACL 仅为 `runs(run_id)、outbox(outbox_id)、run_attempts(attempt_id)` 各自
`GRANT SELECT,UPDATE(lock_column) TO data_agent_u6_rpc_owner`，并 exact GRANT EXECUTE
`platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean)` 给同一 Owner。令
`B(w)=platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,w)`；每表
PERMISSIVE `<table>_u6_rpc_lock_select` 用 `SELECT USING(B(false))`；
`<table>_u6_rpc_lock_update` 用 `UPDATE USING(B(false))` 仅对 `runs`，另两表用
`B(true)`，全部 `WITH CHECK(false)`。Inventory exact；READ RPC 仅能锁 exact visible
Run，worker 锁另两表，任何 core UPDATE 恒失败且无其他 core DML。

`10600` 撤销 `data_agent_backend|service_role` 对 `artifacts` 的
INSERT/UPDATE/DELETE；它们只保留既有按 Scope 的 SELECT。唯一写者 RPC Owner 仅经
`commit_current_l2_artifact` 或三分支 `commit_artifact_revision_run_locked` 写入，后者
覆盖 Ordinary L2、Grounding Authority 与现有 credential smoke
`ModelCertificationReceipt`，并统一 Run-first/terminal-absent guard。Owner exact-S policy
不得形成裸 DML入口。Inventory 断言 ACL、函数 allowlist/dependency、FORCE RLS 与全部
policy；任一旧 Repository/worker 直写 SQL 仍可达时 C2a 固定 fail closed。

## 7. 一次性 Migration 与 Schema Inventory

U6 PostgreSQL 唯一产物：

```text
infra/supabase/apps/data-agent/migrations/
  20260725010590_app_data_agent_u6_research_authority.sql
  20260725010600_app_data_agent_u6_research_derivation.sql
```

首次提交须完整包含 Platform/Artifact/Capability/Resource/Invocation/Preparation/
Crypto/Lifecycle；`10590` hash 已冻结。Derivation 的 Receipt、Budget/Input Event 与 v2
函数只进 forward-only `10600`，两者进入同一升级版 Inventory；DDL/恢复取 Migration
Safety。

`infra/supabase/apps/data-agent/u6-schema-inventory.json`
（`u6-schema-inventory@1.0.0`）逐字列出 column/default、约束/索引、函数属性/owner、
ACL/RLS/policy、trigger/sequence、PG/extension/migration hash 与 Function Manifest
protocol/null/role/authority/lock profile。必须匹配 canonical `pg_catalog`；同名异 Hash
或 ledger/README 漂移失败。两个 renderer 各只产对应 Migration、Inventory、ledger hash。

## 8. 必需 Oracle

- 17 个 current tuple 仅专用 committer、第 18 个仅 internal Writer；historical/unknown/
  mixed、假/过期 Snapshot 与 raw DML 失败；
- Ordinary/Grounding/ModelCertification 三条 Adapter 保持原语义，三支 fence=0 均失败；
  首 Brief 原子产生唯一 Head/genesis，重放不再初始化；terminal 后失败；
- Attempt/Fence/parent/input/Domain/Pair 换绑失败；两连接 Artifact/Frontier/Readiness/
  Grant/GO 只有一个 winner 且无锁环；
- 非 matching/过期/撤销/旧 Epoch/cross-S Authority 全失败；source-writer-first 为
  `55P03` 零写，U6-first 等待后重验，均无 `40P01`；
- Browser/Job 越权、allowlist 外 EXECUTE、internal 直调、错误 lifecycle/Manifest/
  legal hold 均在业务写前失败；definer 属性/ACL/null/error exact；
- Manifest 逆序仍按 key bytes，同 Manifest duplicate 锁前失败；Inventory 与
  `pg_catalog`、Hosted/Docker exact；Redis/Upstash 不影响数据库真值。
