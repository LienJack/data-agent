# U6 L2 Research Platform、事务与 Port 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` · `u6-research-platform@1.0.0`
>
> 上游 Wire：`u6-research-planning-payload-contract.md`、
> `u6-research-wire-payload-contract.md`；Data Agent 绿地迁移，非旧系统在线升级。

Request/Record/迁移/锁序/错误在本文闭合。实现用 strict object、判别联合、DB 约束和
双连接 Oracle；Parse/Agent/Snapshot/Redis/类型断言均非 Authority。

## 1. 共同 primitive 与调用边界

```ts
type ImmutableId = string; // UUID
type PrincipalId = string; // 1..256；不要求 UUID
type IdempotencyKey = string; // 1..256
type Version = string; // 1..128
type Sha256 = `sha256:${string}`; // 64 个小写 hex
type HmacSha256 = `hmac-sha256:${string}`;
type Timestamp = string; // ISO-8601 with offset
type NonNegativeInt = number; // safe integer >=0
type PositiveInt = number; // safe integer >0
type ModelProvider = "openai" | "anthropic" | "deepseek" | "glm" |
  "kimi" | "grok" | "gemini";
type AppScope = { app_id: ImmutableId; tenant_id: ImmutableId; environment: string };

type ArtifactReferenceFor<T extends KnownArtifactType> = {
  artifact_id: ImmutableId; artifact_type: T; app_id: ImmutableId;
  tenant_id: ImmutableId; environment: string; run_id: ImmutableId;
  revision: PositiveInt; content_hash: Sha256;
};
type ArtifactReference = ArtifactReferenceFor<KnownArtifactType>;

type StrictCommandBase = {
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; idempotency_key: IdempotencyKey;
};

type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: U6PlatformError };

type CapabilityCommon = {
  capability_id: ImmutableId; scope: AppScope; principal_id: PrincipalId;
  role: string; authority_epoch: NonNegativeInt; expires_at: Timestamp;
};
type ResolvedU6Capability = CapabilityCommon & (
  | { authority_kind: "SEMANTIC_FRONTIER_AUTHORITY"; frontier_kind: "SEMANTIC" }
  | { authority_kind: "SCHEMA_FRONTIER_AUTHORITY"; frontier_kind: "SCHEMA" }
  | { authority_kind: "DATA_SNAPSHOT_FRONTIER_AUTHORITY"; frontier_kind: "DATA" }
  | { authority_kind: "POLICY_FRONTIER_AUTHORITY"; frontier_kind: "POLICY" }
  | { authority_kind: "IDENTITY_FRONTIER_AUTHORITY"; frontier_kind: "IDENTITY" }
  | { authority_kind: "RESEARCH_STOP_AUTHORITY"; terminal_authority: "RESEARCH_STOP" }
  | { authority_kind: "CURRENT_READINESS_AUTHORITY" |
    "SERVICE_REVOCATION_AUTHORITY" | "REPORT_READ_AUTHORITY" |
    "RESOURCE_AUTHORITY" | "AGENT_DATA_PROJECTION_AUTHORITY" |
    "MODEL_INVOCATION_AUTHORITY" | "SQL_INVOCATION_AUTHORITY" |
    "TOOL_INVOCATION_AUTHORITY" | "TOOL_POLICY_AUTHORITY" |
    "TOOL_POLICY_EXPIRY_AUTHORITY" | "RESULT_RETENTION_AUTHORITY" |
    "RELEASE_GO_AUTHORITY" }
);
```

```ts
declare function method<T>(
  capabilityInput: unknown, strictInput: StrictObject): Promise<PortResult<T>>;
```

Adapter 在事务内解析唯一 capability 分支并比较 strict input；Header/Payload/Agent/
缓存/自报 Principal 只是声明，未授权与不存在同错。Hash 用 `canonicalizeJson`，禁止
分隔符身份。`S=(app_id,tenant_id,environment)`，所有 Key/Index/Lock/RLS 均展开 `S`。

## 2. Version Frontier Authority

### 2.1 strict value

```ts
type IdentityBinding = {
  principal_id: PrincipalId; delegation_chain_hash: Sha256;
  authority_epoch: NonNegativeInt;
};

type DataSnapshotBinding = {
  protocol_version: "data-snapshot-binding@1.0.0";
  datasource_id: ImmutableId; strategy: "CONTROLLED_REVISION" | "NONE";
  snapshot_token: Version | null; schema_manifest_hash: Sha256 | null;
  data_manifest_hash: Sha256 | null; fixture_manifest_hash: Sha256 | null;
  replay_state: "REPLAYABLE" | "REPLAY_UNAVAILABLE"; binding_hash: Sha256;
};

type FrontierValue =
  | { frontier_kind: "SEMANTIC"; reference: ArtifactReferenceFor<"SemanticRelease"> }
  | { frontier_kind: "SCHEMA"; reference: ArtifactReferenceFor<"SchemaSnapshot"> }
  | { frontier_kind: "DATA"; data_snapshot: DataSnapshotBinding }
  | { frontier_kind: "POLICY"; reference: ArtifactReferenceFor<"PolicyReceipt"> }
  | { frontier_kind: "IDENTITY"; identity_binding: IdentityBinding };
```

`DataSnapshotBinding` 从 U5 `SnapshotDescriptor` 排除
`execution_id/observed_at/descriptor_hash` 后规范派生。`CONTROLLED_REVISION` 要求
Token、Schema/Data/Fixture Manifest 全非空且 `REPLAYABLE`；`NONE` 要求四个字段
全空且 `REPLAY_UNAVAILABLE`。`binding_hash` 覆盖其余字段；Q1/Q2 可有不同 Execution
Receipt，但映射 Hash 必须相同。

### 2.2 五类唯一 Owner

| Kind | 唯一 Owner Capability |
| --- | --- |
| `SEMANTIC` | `SEMANTIC_FRONTIER_AUTHORITY` |
| `SCHEMA` | `SCHEMA_FRONTIER_AUTHORITY` |
| `DATA` | `DATA_SNAPSHOT_FRONTIER_AUTHORITY` |
| `POLICY` | `POLICY_FRONTIER_AUTHORITY` |
| `IDENTITY` | `IDENTITY_FRONTIER_AUTHORITY` |

Certificate/Publisher/Writer/GO、单次 Receipt、Session/JWT 均不能自封 Frontier。

### 2.3 Port Wire

```ts
type FrontierInitializeInput = StrictCommandBase & {
  operation_id: ImmutableId; value: FrontierValue;
  expected_frontier_version: null; expected_frontier_hash: null;
};

type FrontierAdvanceInput = StrictCommandBase & {
  operation_id: ImmutableId; value: FrontierValue;
  expected_frontier_version: NonNegativeInt; expected_frontier_hash: Sha256;
};

type CommittedFrontier = {
  operation_id: ImmutableId; frontier_kind: FrontierValue["frontier_kind"];
  frontier_version: NonNegativeInt; frontier_value_hash: Sha256; event_seq: PositiveInt;
  cascaded_revocation_operation_id: ImmutableId | null;
  committed_at: Timestamp;
};

interface ResearchVersionFrontierPort {
  initialize(capabilityInput: unknown, input: FrontierInitializeInput):
    Promise<PortResult<CommittedFrontier>>;
  advance(capabilityInput: unknown, input: FrontierAdvanceInput):
    Promise<PortResult<CommittedFrontier>>;
}
```

`initialize` 仅无行时写 Version 0；`advance` 锁行匹配 expected Version/Hash 后写
`version+1`。两者匹配 capability Owner/Kind 与 Value Kind，校验 Ref Scope/Run、Epoch、
Canonical Hash，按 `S/run/principal/kind/idempotency_key` 幂等；同键异输入冲突。

成功 advance 同事务检查 Current；漂移则由同一个 security-definer 事务以
`trigger=FRONTIER_ADVANCE/source_operation_id=Frontier operation_id` 内部创建幂等
Revocation Operation/Receipt、推进 Head、置 REVOKED、撤销未响应 Grant并写
Event/Audit，任一步失败全回滚。该固定级联不是向调用方授予
`SERVICE_REVOCATION_AUTHORITY`，内部 Receipt Writer 不可由应用角色直接执行。无
Current 时 cascade id=null；Redis Observer 非正确性边界。

### 2.4 表

| 表 | PK / Unique / 必需字段 |
| --- | --- |
| `research_version_frontiers` | PK `(S,run_id,frontier_kind)`；strict Value、Hash/Version/Epoch/time |
| `research_frontier_operations` | PK `(S,operation_id)`；UQ `(S,run_id,principal_id,frontier_kind,idempotency_key)`；Input/expected Hash/Version、Outcome/committed Version/Event Seq/Cascade Op/time/error |
| `research_frontier_events` | PK `(S,run_id,event_seq)`；UQ `(S,operation_id)`；append-only Owner、old/new Version/Hash、`INITIALIZED|ADVANCED`、DB time |

成功/失败 Operation 均 Audit；Event 仅已提交转换。删除/降级/跳号/非 Owner/CAS loser/
同键异 Hash 均失败关闭。

## 3. PostgreSQL 权威表

除第 2.4 节外，U6 App Schema 必须具有：

| 表 | PK / Unique / 状态与必需字段 |
| --- | --- |
| `research_current_evidence_relation_keys` | PK `(S,run_id,claim_ref_identity,evidence_ref_identity)`；UQ `(S,run_id,relation_artifact_id)`；exact Relation Ref/值/current Revision/Hash；同 Pair 仅原 ID 做 expected-revision CAS |
| `current_report_readiness` | PK `(S,run_id)`；`CURRENT|REVOKED`；exact Certificate/Report/Semantic Hash、五维 Version/Hash、Epoch、readiness Version、revocation Seq/Receipt、时间；Seq+Receipt 即 Head |
| `research_readiness_publications` | PK `(S,publication_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；Input Hash、Certificate/Report、expected/committed Version、Frontier Hash、`CURRENT_PUBLISHED`、时间 |
| `research_readiness_consumptions` | PK `(S,consumption_id)`；UQ `(S,run_id,principal_id,purpose,idempotency_key)`；Input Hash、Certificate/Report、Readiness/Revocation/Frontier/Epoch、`READY_COMMITTED|STALE_COMMITTED|GRANT_ISSUED`、Terminal/Grant、时间 |
| `research_domain_terminals` | PK `(S,run_id)`；UQ `(S,terminal_id)`；append-only；Terminal=`READY|STALE|PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE`；Authority=`CURRENT_READINESS|REVOCATION_CONSUMPTION|RESEARCH_STOP`；Reason、Domain Reasons、exact Refs、nullable Certificate、Input Hash、时间 |
| `research_stop_terminal_commits` | PK `(S,commit_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；exact Stop/Coverage、Input Hash、Terminal ID、`COMMITTED|REJECTED`、时间 |
| `research_revocation_operations` | PK `(S,operation_id)`；UQ `(S,run_id,owner_principal_id,idempotency_key)`；strict Trigger/Source Operation/Owner/Reason CHECK、Certificate/Frontier/Epoch、`REQUESTED|COMMITTED|FAILED`、Receipt/Error/time |
| `report_read_grants` | PK `(S,grant_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；exact Certificate/Report、server immutable Response Wire、Issue Readiness/Revocation/Frontier/Epoch、五态、`terminal_from_status`、阶段 Key/Hash/时间三元组 |
| `research_resource_run_heads` | PK `(S,run_id)`；Reserve 事务单调 `next_reservation_seq` |
| `research_resource_reservations` | PK `(S,reservation_id)`；UQ `(S,run_id,reservation_seq)`、`(S,run_id,principal_id,reserve_idempotency_key)`；Kind/Demand 在 Input Hash；见 §7 |
| `research_resource_transition_operations` | PK `(S,transition_id)`；UQ `(S,reservation_id,principal_id,idempotency_key)`；Transition Kind、独立 Input Hash、old/new State、Outcome、时间 |
| `research_invocation_commits` | PK `(S,invocation_id)`；UQ `(S,reservation_id)`、`(S,request_id)`；Kind/Reservation/Lease/Attempt/Fence/Request Hash、`AUTHORIZED|STARTED|COMPLETED|FAILED|OUTCOME_UNKNOWN`、Result/Usage/时间 |
| `research_invocation_request_operations` | PK `(S,invocation_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；Invoke Kind/Input Hash/Request 与派生 Stage IDs/Keys |
| `research_invocation_transition_operations` | PK `(S,transition_id)`；UQ `(S,invocation_id,principal_id,idempotency_key)`；Transition/expected-old-new State/Input Hash/Version/Outcome/time |
| `research_system_record_transition_operations` | PK `(S,transition_id)`；UQ `(S,record_kind,record_id,principal_id,idempotency_key)`；Transition/old-new State/Input Hash/Owner/Outcome/time |
| `research_system_artifacts` | PK `(S,run_id,artifact_id,revision)`；UQ 加 Content Hash；仅 AgentDataProjection Receipt；exact Request/Profile/Reservation/Input/Field/Byte/Token/HMAC/Policy |
| `research_release_decision_commits` | PK `(S,decision_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；Candidate/Input/Decision Hash、immutable GO、Certificate、Readiness/Revocation/Frontier/Epoch、时间 |

以下是上表 Record 的 nullable strict 分支，并与全部必需列求交；数据库 `CHECK`
施加同一约束：

```ts
type CurrentReadinessNullable =
  | { state: "CURRENT"; revocation_receipt_ref: null; revoked_at: null }
  | { state: "REVOKED";
      revocation_receipt_ref: ArtifactReferenceFor<"ReadinessRevocationReceipt">;
      revoked_at: Timestamp };

type GrantConsumeNone = {
  consume_idempotency_key: null; consume_input_hash: null; consumed_at: null;
};
type GrantConsumeDone = {
  consume_idempotency_key: IdempotencyKey; consume_input_hash: Sha256;
  consumed_at: Timestamp;
};
type GrantResponseNone = {
  response_idempotency_key: null; response_input_hash: null; responded_at: null;
};
type GrantTerminalSource =
  | ({ terminal_from_status: "ISSUED" } & GrantConsumeNone)
  | ({ terminal_from_status: "CONSUMED" } & GrantConsumeDone);
type ReportReadGrantNullable =
  | ({ state: "ISSUED"; terminal_from_status: null;
      expired_at: null; revoked_at: null } & GrantConsumeNone & GrantResponseNone)
  | ({ state: "CONSUMED"; terminal_from_status: null;
      expired_at: null; revoked_at: null } & GrantConsumeDone & GrantResponseNone)
  | ({ state: "RESPONDED"; terminal_from_status: null;
      expired_at: null; revoked_at: null } & GrantConsumeDone & {
      response_idempotency_key: IdempotencyKey; response_input_hash: Sha256;
      responded_at: Timestamp })
  | ({ state: "EXPIRED"; expired_at: Timestamp; revoked_at: null }
      & GrantTerminalSource & GrantResponseNone)
  | ({ state: "REVOKED"; expired_at: null; revoked_at: Timestamp }
      & GrantTerminalSource & GrantResponseNone);

type RevocationOperationNullable =
  | { state: "REQUESTED"; receipt_ref: null; error_code: null; completed_at: null }
  | { state: "COMMITTED";
      receipt_ref: ArtifactReferenceFor<"ReadinessRevocationReceipt">;
      error_code: null; completed_at: Timestamp }
  | { state: "FAILED"; receipt_ref: null; error_code: string;
      completed_at: Timestamp };
```

`REVOKED→CURRENT` 重发布写新 Certificate、递增 `readiness_version`，清空**当前代**
Receipt/`revoked_at`，但保持 `revocation_seq` 全 Run 单调；历史由 Operation/Receipt/
Audit 保留。

EvidenceRelation Committer 先锁 `(exact claim_ref_identity,exact evidence_ref_identity)`。
同 Pair 的不同 `relation_artifact_id` 返回 `EVIDENCE_RELATION_IDENTITY_CONFLICT`，不得借
SUPPORTS/REFUTES/CONFLICTS 的不同 ID 隐藏冲突。Artifact 保持 append-only，仅 Key 指向
的 exact Revision 可进入 current Support/Coverage。

## 4. 唯一锁序与状态传播

所有 Publish、Current Consume、Research Stop Commit、Frontier 传播撤权、显式
Revoke、Grant Consume/Response 和 GO Commit 统一使用：

```text
runs（无 Current 时也先锁此 Run）
→ current_report_readiness（Revocation Head 在本行内）
→ research_version_frontiers：
  SEMANTIC → SCHEMA → DATA → POLICY → IDENTITY
→ research_domain_terminals
→ report_read_grants（按 grant_id）
→ research_revocation_operations（按 operation_id，需要时）
→ research_release_decision_commits（按 decision_id，需要时）
```

不得另建/先锁 Head 表；Advisory 只补 Key Lock，不能替代 `runs` Row Lock。
Relation、Resource、Invocation 用各自 Key 顺序，持有后不得反向进入此锁序。

状态顺序固定为：

```text
五维 Frontier 已由五类 Owner initialize
→ ReportReadyCertificate@2 COMMITTED
→ publishCurrent: ABSENT/CURRENT/REVOKED -> CURRENT（expected-version CAS）
→ consumeCurrent(DOMAIN_TERMINAL): append READY/RUN_READY
→ consumeCurrent(REPORT_READ): 仅在 exact READY 已存在时 Issue Grant
→ consumeGrant
→ commitResponse

或：无任何 CurrentReadiness/Domain Terminal
→ commitResearchStopTerminal: append PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE
→ 本 Run 禁止后续 publish
```

Publish 验证 Certificate 的 Stop、Report、Projection、四 Gate、material Support 与五维
Frontier；已撤 Certificate 不得复活，有 Domain Terminal 时不得 Publish。REPORT_READ
锁定同 Certificate 的 immutable READY；CURRENT/STOP_READY/Certificate 均不能替代。
Publish 同键重放仍先按唯一锁序重验 Certificate/Current/Frontier/Head；若已撤权返回
`CURRENT_READINESS_REVOKED`，历史 Publication 仅供审计。

Standalone Revoke 只推进 Current/Head/Receipt、未响应 Grant、Audit，**不创建 STALE**。
仅 `DOMAIN_TERMINAL` Consume 与 Revoke/Advance 竞争且后者先胜时，loser 原子追加唯一
`STALE/RUN_STALE`，不提交 READY/Grant。READY 后撤权保留历史 READY，不更新/追加 STALE
或 Durable Runtime lifecycle Event。

## 5. Current Readiness 与 Research Stop Port

```ts
type PublishCurrentInput = StrictCommandBase & {
  publication_id: ImmutableId; certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  expected_readiness_version: NonNegativeInt | null;
};

type ConsumeCurrentInput =
  | (StrictCommandBase & {
      consumption_id: ImmutableId;
      purpose: "DOMAIN_TERMINAL";
      certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
      terminal_id: ImmutableId;
    })
  | (StrictCommandBase & {
      consumption_id: ImmutableId;
      purpose: "REPORT_READ";
      certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
      grant_id: ImmutableId;
    });

type RevokeCurrentInput = StrictCommandBase & {
  operation_id: ImmutableId; certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  observed_frontier_hash: Sha256;
  reason:
    | "SEMANTIC_REVISION_CHANGED"
    | "SCHEMA_REVISION_CHANGED"
    | "DATA_SNAPSHOT_STALE"
    | "POLICY_CHANGED"
    | "IDENTITY_AUTHORITY_CHANGED"
    | "EVIDENCE_REVOKED"
    | "CERTIFICATE_TAMPERED";
};

type CommitResearchStopTerminalInput = StrictCommandBase & {
  commit_id: ImmutableId; terminal_id: ImmutableId;
  stop_decision_ref: ArtifactReferenceFor<"ResearchStopDecision">;
  coverage_ref: ArtifactReferenceFor<"CoverageState">;
};
type ResearchStopTerminalCommon = {
  commit_id: ImmutableId; terminal_id: ImmutableId;
  domain_reason_codes: U6ResearchReasonCode[]; // 1..32，规范身份唯一
  authority_kind: "RESEARCH_STOP"; certificate_ref: null;
  revocation_receipt_ref: null;
  stop_decision_ref: ArtifactReferenceFor<"ResearchStopDecision">;
  committed_at: Timestamp;
};
type CommittedResearchStopTerminal =
  | (ResearchStopTerminalCommon & {
      terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" })
  | (ResearchStopTerminalCommon & {
      terminal: "NEEDS_MORE_RESEARCH";
      reason_code: "EVIDENCE_COVERAGE_INSUFFICIENT" })
  | (ResearchStopTerminalCommon & {
      terminal: "INCONCLUSIVE"; reason_code: "ANALYSIS_INCONCLUSIVE" });

type PublishedCurrentReadiness = {
  state: "CURRENT"; certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  report_ref: ArtifactReferenceFor<"AnalysisReport">; readiness_version: NonNegativeInt;
  revocation_seq: NonNegativeInt; frontier_hash: Sha256;
};
type CommittedReadyResearchTerminal = {
  terminal_id: ImmutableId; terminal: "READY"; reason_code: "RUN_READY";
  domain_reason_codes: U6ResearchReasonCode[]; // 0..32，规范身份唯一
  authority_kind: "CURRENT_READINESS";
  certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  revocation_receipt_ref: null; stop_decision_ref: null;
  committed_at: Timestamp;
};
type CommittedStaleResearchTerminal = {
  terminal_id: ImmutableId; terminal: "STALE"; reason_code: "RUN_STALE";
  domain_reason_codes: U6ResearchReasonCode[]; // 1..32，规范身份唯一
  authority_kind: "REVOCATION_CONSUMPTION"; certificate_ref: null;
  revocation_receipt_ref:
    ArtifactReferenceFor<"ReadinessRevocationReceipt">;
  stop_decision_ref: null; committed_at: Timestamp;
};
type CurrentReadinessConsumeResult =
  | { purpose: "DOMAIN_TERMINAL"; outcome: "READY_COMMITTED";
      consumption_id: ImmutableId; current_state: "CURRENT";
      terminal: CommittedReadyResearchTerminal }
  | { purpose: "DOMAIN_TERMINAL"; outcome: "STALE_COMMITTED";
      consumption_id: ImmutableId; current_state: "REVOKED";
      terminal: CommittedStaleResearchTerminal }
  | { purpose: "REPORT_READ"; outcome: "GRANT_ISSUED";
      consumption_id: ImmutableId; current_state: "CURRENT";
      grant_id: ImmutableId; state: "ISSUED"; response: CanonicalResponseBinding };
type CommittedCurrentRevocation = {
  operation_id: ImmutableId; state: "REVOKED"; revocation_seq: PositiveInt;
  receipt_ref: ArtifactReferenceFor<"ReadinessRevocationReceipt">;
};
type ConsumedReportReadGrant = {
  grant_id: ImmutableId; state: "CONSUMED";
  report_ref: ArtifactReferenceFor<"AnalysisReport">;
  response: CanonicalResponseBinding; consumed_at: Timestamp;
};
type CommittedCurrentGo = {
  decision_id: ImmutableId; decision: "GO";
  certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  readiness_version: NonNegativeInt; revocation_seq: NonNegativeInt;
  frontier_hash: Sha256; committed_at: Timestamp;
};

interface CurrentReadinessPort {
  publish(capabilityInput: unknown, input: PublishCurrentInput):
    Promise<PortResult<PublishedCurrentReadiness>>;
  consume(capabilityInput: unknown, input: ConsumeCurrentInput):
    Promise<PortResult<CurrentReadinessConsumeResult>>;
  revoke(capabilityInput: unknown, input: RevokeCurrentInput):
    Promise<PortResult<CommittedCurrentRevocation>>;
  consumeGrant(capabilityInput: unknown, input: ConsumeReportReadGrantInput):
    Promise<PortResult<ConsumedReportReadGrant>>;
  commitResponse(capabilityInput: unknown, input: CommitReportReadResponseInput):
    Promise<PortResult<CommittedReportReadResponse>>;
  commitGo(capabilityInput: unknown, input: CommitCurrentGoInput):
    Promise<PortResult<CommittedCurrentGo>>;
}

interface ResearchStopTerminalPort {
  commit(capabilityInput: unknown, input: CommitResearchStopTerminalInput):
    Promise<PortResult<CommittedResearchStopTerminal>>;
}
```

方法级 Capability Owner 固定如下；同一 Port 只是接口分组，不表示权限可互换：

| 方法 | 唯一 Capability |
| --- | --- |
| `ResearchVersionFrontierPort.initialize/advance` | 与 `value.frontier_kind` 相同的五类 Frontier Authority |
| `CurrentReadinessPort.publish` | `CURRENT_READINESS_AUTHORITY` |
| `CurrentReadinessPort.consume(DOMAIN_TERMINAL)` | `CURRENT_READINESS_AUTHORITY` |
| `CurrentReadinessPort.consume(REPORT_READ)` | `REPORT_READ_AUTHORITY` |
| `CurrentReadinessPort.revoke` | `SERVICE_REVOCATION_AUTHORITY` |
| `CurrentReadinessPort.consumeGrant/commitResponse` | `REPORT_READ_AUTHORITY` |
| `CurrentReadinessPort.commitGo` | `RELEASE_GO_AUTHORITY` |
| `ResearchStopTerminalPort.commit` | `RESEARCH_STOP_AUTHORITY` |

Adapter 必须在进入锁序前按方法解析 exact 分支；不得因对象实现了同一 Port 就复用另一
方法的 Capability。Frontier advance 的数据库内级联只接受当前已验证的 matching
Frontier Authority 和同一 `operation_id`，不能调用 public `revoke` 分支。

Research Stop Authority 只接受 exact、current Stop/Coverage，并固定映射：

| Stop Decision | Public Terminal / Reason |
| --- | --- |
| `STOP_PARTIAL` | `PARTIAL / EVIDENCE_PARTIAL` |
| `STOP_NEEDS_MORE_RESEARCH` | `NEEDS_MORE_RESEARCH / EVIDENCE_COVERAGE_INSUFFICIENT` |
| `STOP_INCONCLUSIVE` | `INCONCLUSIVE / ANALYSIS_INCONCLUSIVE` |

此 Port 仅接受 `RESEARCH_STOP_AUTHORITY` capability 分支；`domain_reason_codes` 精确等于
Stop 的有界唯一 Reason 集。`commit_research_stop_terminal` 必须使用 §4 Root 锁序，
在锁内重验 CurrentReadiness 不存在、Domain Terminal 不存在、五维 Frontier 与
Coverage exact current 且无 STALE；与 Publish/Frontier Advance 竞争只能一方提交。
它是三个终态唯一写入口；重放仍重验 exact Revision，同键异 Hash 冲突。通用
`authorizeRunTerminal` 对 READY/STALE
统一返回 `CURRENT_READY_CONSUMPTION_REQUIRED`，对 PARTIAL/NEEDS_MORE_RESEARCH/
INCONCLUSIVE 返回 `RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED`，无兼容分支。

## 6. Grant 的可序列化 Wire

```ts
type CanonicalResponseBinding = {
  protocol_version: "canonical-response@1.0.0";
  media_type: "application/json; charset=utf-8";
  content_disposition: "inline"; byte_length: NonNegativeInt;
  response_digest: Sha256;
};

type CanonicalResponseWire = CanonicalResponseBinding & {
  body_base64url: string; // RFC 4648 URL alphabet，无 "=" padding
};

type ConsumeReportReadGrantInput = StrictCommandBase & {
  grant_id: ImmutableId;
};

type CommitReportReadResponseInput = StrictCommandBase & {
  grant_id: ImmutableId;
};

type CommittedReportReadResponse = {
  grant_id: ImmutableId; state: "RESPONDED";
  response: CanonicalResponseWire; responded_at: Timestamp;
};
```

`response_digest` 固定为：

```text
sha256(
  UTF8("canonical-response@1.0.0\0")
  || UTF8(media_type + "\0" + content_disposition + "\0")
  || base64url_decode(body_base64url)
)
```

Issue/Response 不接收 caller Digest/bytes/Media Type/长度。Issue 用固定
`ZH_L2_RESEARCH_V1` 从 exact Report 投影并存 immutable Wire；decoded body ≤1,048,576
bytes，unpadded base64url ≤1,398,102 字符，拒绝非法 alphabet、非最短编码或 re-encode
不等。Consume 仅 `ISSUED→CONSUMED`。Response 重投影并逐字节匹配 Wire/body/Digest，
重验 Current、五维 Frontier、READY、Head、TTL、Principal 后 CAS 为 RESPONDED，再返回
server Wire；CAS 前零字节。Revoke 先胜则未响应 Grant 为 REVOKED。

## 7. Resource Reservation 与 Invocation

完整 strict Wire、Port、表、状态机、Active Cancel 证明、Tool Permit、Projection 与
Oracle 只定义于 `docs/design/u6-research-resource-invocation-contract.md`。本核心保留
三条跨域不变量：Reservation Seq 每 Run 单调；真实 I/O 前必须持有 exact IN_USE Lease；
未知 Outcome 不释放预算，late Usage 必须入账。迁移中的 Resource/Invocation 表和窄函数
必须实现该分册；Invocation 迁移还必须实现唯一
`docs/design/u6-invocation-state-contract.md`，不能在此处另造兼容状态机。

## 8. Revocation Receipt 与 Release GO

Public 服务撤权只接受 `SERVICE_REVOCATION_AUTHORITY`；Frontier advance 级联只接受
其 matching Frontier Authority。两者共享不可公开调用的 Receipt Writer，并分别固定
`trigger=SERVICE_REQUEST|FRONTIER_ADVANCE`。每次 Operation 必须满足：

```text
ReadinessRevocationReceipt.envelope.attempt_id = source_operation_id
artifacts.worker_fence = 0  // SERVICE_OPERATION_FENCE
```

`commit_research_revocation_receipt` 仅为数据库内部函数：SERVICE_REQUEST 重验服务
Capability/operation 且 Reason 只可 `EVIDENCE_REVOKED|CERTIFICATE_TAMPERED`；
FRONTIER_ADVANCE 重验当前外层 Frontier capability/value/event/operation，Reason 按
`SEMANTIC|SCHEMA|DATA|POLICY|IDENTITY` 唯一映射同名前缀变化。两分支 CHECK 强制
Owner/Source/Trigger 互斥且 `source_operation_id` exact。两者都重验 Epoch、
Certificate/Frontier、Envelope Hash 与 Domain Semantic Hash。普通 Research Committer
拒绝 Fence 0；两种路径都不能获得 Worker Lease、执行 SQL 或提交其他 Artifact。

```ts
type CommitCurrentGoInput = StrictCommandBase & {
  decision_id: ImmutableId; decision: "GO";
  certificate_ref: ArtifactReferenceFor<"ReportReadyCertificate">;
  release_manifest_ref: ArtifactReferenceFor<"ReleaseManifest">;
  scorecard_refs: ArtifactReferenceFor<"ScoreCard">[];
  benchmark_receipt_refs: ArtifactReferenceFor<"BenchmarkAdapterReceipt">[];
  sandbox_receipt_refs: ArtifactReferenceFor<"SandboxExecutionReceipt">[];
  model_certification_receipt_refs:
    ArtifactReferenceFor<"ModelCertificationReceipt">[];
  signed_outcome_refs: ArtifactReference[];
  release_policy_version: Version; candidate_input_hash: Sha256;
};
```

`commit_current_release_go` 按 §4 在单一 PG 事务验证 exact V2 Certificate、同证书
READY/RUN_READY、CURRENT、五维 Frontier/Schema、Head/Epoch、material Claim、Release
Evidence/签名 Outcome，调用 server-only Authorizer，并在解锁前品牌化、持久化 immutable
GO/Audit。缺 READY 固定 `RESEARCH_READY_TERMINAL_REQUIRED`。同键重放也先重走锁与全部
校验；若后来撤权返回 `CURRENT_READINESS_REVOKED`，不得返回历史 GO。禁止事务外
Readiness Snapshot；旧 `authorizeReleaseDecision(GO)` 返回
`CURRENT_RELEASE_COMMIT_REQUIRED`；缺 U7–U9 证据保持 HOLD。

## 9. 窄函数、错误与 V1

U6 App Migration 只授权 Backend/Service 调用：

```text
initialize_research_version_frontier(command jsonb)
advance_research_version_frontier(command jsonb)
commit_current_l2_artifact(command jsonb)
commit_research_stop_terminal(command jsonb)
publish_current_report_readiness(command jsonb)
consume_current_ready(command jsonb)
revoke_current_readiness(command jsonb)
consume_report_read_grant(command jsonb)
commit_report_read_response(command jsonb)
commit_current_release_go(command jsonb)
start_research_invocation(command jsonb)
mark_research_invocation_outcome_unknown(command jsonb)
commit_invocation_terminal(command jsonb)
```

Resource、Invocation State 与 System Record Lifecycle 分册列出的窄 RPC 同属此唯一
Allowlist。
`commit_research_revocation_receipt` 只可由 `advance_research_version_frontier` 或
`revoke_current_readiness` 的同事务内部调用，绝不 GRANT 给 Backend/Service 角色。

```ts
const U6_ERROR_RETRYABLE = {
  RESEARCH_CAPABILITY_SCOPE_MISMATCH: false,
  RESEARCH_FRONTIER_OWNER_MISMATCH: false,
  RESEARCH_FRONTIER_CAS_CONFLICT: true,
  READINESS_REVOCATION_PROPAGATION_FAILED: true,
  L2_WIRE_VERSION_WRITE_UNSUPPORTED: false,
  READINESS_PROTOCOL_VERSION_UNSUPPORTED: false,
  AUTHORITY_EVIDENCE_NOT_CURRENT: false,
  AUTHORITY_EVIDENCE_NOT_COMMITTED: false,
  CURRENT_READY_CONSUMPTION_REQUIRED: false,
  RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED: false,
  READINESS_FRONTIER_INCOMPLETE: false,
  READINESS_FRONTIER_STALE: false,
  READINESS_CAS_CONFLICT: true,
  READINESS_IDEMPOTENCY_CONFLICT: false,
  REPORT_READY_CERTIFICATE_TAMPERED: false,
  REPORT_READ_READY_TERMINAL_REQUIRED: false,
  REPORT_READ_GRANT_NOT_CONSUMABLE: false,
  REPORT_READ_RESPONSE_DIGEST_MISMATCH: false,
  REPORT_READ_GRANT_REVOKED: false,
  EVIDENCE_RELATION_IDENTITY_CONFLICT: false,
  RESEARCH_RESOURCE_RESERVATION_CONFLICT: false,
  RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED: true,
  RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE: false,
  RESEARCH_RESOURCE_LIMIT_EXCEEDED: false,
  RESEARCH_INVOCATION_TRANSITION_CONFLICT: false,
  RESEARCH_INVOCATION_TERMINAL_CONFLICT: false,
  RESEARCH_SYSTEM_RECORD_NOT_ACTIVE: false,
  RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH: false,
  RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT: false,
  RESEARCH_RESULT_SIZE_EXCEEDED: false,
  RESEARCH_RESULT_DIGEST_MISMATCH: false,
  RESEARCH_RESULT_GOVERNANCE_REJECTED: false,
  REPLAY_SNAPSHOT_UNAVAILABLE: false,
  MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED: false,
  SQL_INVOCATION_NOT_AUTHORIZED: false,
  TOOL_INVOCATION_NOT_AUTHORIZED: false,
  CURRENT_READINESS_REVOKED: false,
  RESEARCH_READY_TERMINAL_REQUIRED: false,
  CURRENT_RELEASE_COMMIT_REQUIRED: false,
  RESEARCH_AUTHORITY_FENCE_MISMATCH: false,
  RESEARCH_STOP_INPUT_INCONSISTENT: false,
  RESEARCH_STOP_INPUT_STALE: false,
} as const;
type U6PlatformErrorCode = keyof typeof U6_ERROR_RETRYABLE;
type U6PlatformError = {
  [K in U6PlatformErrorCode]: {
    code: K; retryable: (typeof U6_ERROR_RETRYABLE)[K]
  }
}[U6PlatformErrorCode];
```

映射固定：Frontier 非 Owner/缺行/CAS loser 分别是
`RESEARCH_FRONTIER_OWNER_MISMATCH`/`READINESS_FRONTIER_INCOMPLETE`/
`RESEARCH_FRONTIER_CAS_CONFLICT`；Relation active Pair 冲突使用
`EVIDENCE_RELATION_IDENTITY_CONFLICT`；GO 缺 READY 使用
`RESEARCH_READY_TERMINAL_REQUIRED`。其他条件按错误名逐一映射，不得用斜杠候选或自由
字符串；Resource/Invocation 细项由 §7 分册冻结。

V1 仅能由显式 `readHistorical*` 返回
`{authority:"HISTORICAL_READ_ONLY",can_authorize_current:false}`；V1 Parser 成功不得取得
Writer、Relation Key、Frontier、Stop Terminal、Readiness、Grant、Revocation 或 GO
Authority。

## 10. 必需 Oracle

两个独立 PG 连接必须覆盖：Advance 与 Publish/READY/Grant/GO 的同步 cascade（含 Fixture
Manifest tamper）；Publish CAS/重放与 Revoke；standalone Revoke 不建 STALE、losing
DOMAIN consume 仅建一个 STALE、READY 后撤权保留历史；Grant 三阶段各自竞态且 Response
CAS 前零字节；GO 与 Revoke/撤权后同键重放；五 Owner/CAS/Event/Audit；Relation Pair
冲突；Stop-vs-Publish 与 Stop-vs-Frontier Advance 两种锁顺序，恰有一个合法提交且绝不
出现 Current+非 Ready Terminal；canonical Base64url/length/digest/media 换绑；全部
V1/旧终态入口。Resource/Invocation/System Lifecycle 分册覆盖各自 Oracle。Hosted、
Docker 与 PG 共用 Case；In-Memory PASS 不替代事务 Oracle。

## 11. Migration 与部署边界

唯一迁移目录：

```text
infra/supabase/apps/data-agent/migrations/
```

禁止第二迁移链。共享 Supabase 仍按完整 `S` 隔离；Browser 无表写权，Backend 仅获精确
EXECUTE。迁移登记 Name+SHA-256，同名异 Hash 失败，并做 clean install、中断前缀、权限/
Checksum Smoke。Redis/Upstash 仅可丢失通知/缓存，不保存 Frontier、Readiness、Grant、
Resource、Relation Key、GO 真值。
