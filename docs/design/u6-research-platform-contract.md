# U6 L2 Research Platform、事务与 Port 合同

> `FROZEN_DESIGN_CONTRACT / PARTIAL_IMPLEMENTATION` · `u6-research-platform@1.1.0`
>
> Wire 取 Planning/Wire/Derivation Wire；DB-owned Receipt 事务与 C2a/C2b 取
> Derivation Receipt。SQL 面取 Database Surface，执行表取
> Execution Storage，Terminal FK 取 Reference Graph，清理/DDL 取 Cleanup/Migration
> Safety。

本文只闭合 Platform 业务 Wire、事务语义和错误。实现用 strict object、DB 约束和
双连接 Oracle；Parse/Agent/Snapshot/Redis/类型断言均非 Authority。

## 1. 共同 primitive 与调用边界

```ts
type StrictCommandBase = {
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; idempotency_key: IdempotencyKey;
};
type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: U6PlatformError };
type ResolvedU6Capability =
  ServerOnlyResolvedCapability<U6AuthorityCapabilityBinding>;
```

`ImmutableId/PrincipalId/Version/Sha256/Timestamp/Int/AppScope/ArtifactReference` 只取
Planning/Wire，不在本文改义。所有 Port 方法形状均为
`(capabilityInput:unknown, strictInput) => Promise<PortResult<T>>`。Adapter 按 Database
Surface 在事务内解析唯一 capability 行并比较 strict input；
Header/Payload/Agent/缓存/自报 Principal 只是声明，未授权与不存在同错。Hash 用
`canonicalizeJson`，禁止分隔符身份。`S=(app_id,tenant_id,environment)`，所有
Key/Index/Lock/RLS 均展开 `S`。

## 2. Version Frontier Authority

### 2.1 strict value

```ts
type FrontierValue =
  | { frontier_kind: "SEMANTIC"; reference: ArtifactReferenceFor<"SemanticRelease"> }
  | { frontier_kind: "SCHEMA"; reference: ArtifactReferenceFor<"SchemaSnapshot"> }
  | { frontier_kind: "DATA"; data_snapshot: DataSnapshotBinding }
  | { frontier_kind: "POLICY"; reference: ArtifactReferenceFor<"PolicyReceipt"> }
  | { frontier_kind: "IDENTITY"; identity_binding: IdentityBinding };
```

`DataSnapshotBinding` 取 Planning：从 U5 Descriptor 排除 execution id/time/hash 后派生；
controlled 分支四个 binding 非空且 replayable，NONE 分支全空且不可重放。Q1/Q2 可有
不同 Execution Receipt，但 binding hash 必须相同。

```text
binding_hash = sha256(
  UTF8("data-snapshot-binding@1.0.0\0")
  || UTF8(JCS(DataSnapshotBinding without binding_hash))
)
frontier_value_hash = sha256(
  UTF8("research-frontier-value@1.0.0\0")
  || UTF8(JCS(FrontierValue))
)
```

Golden vector：datasource=`11111111-1111-4111-8111-111111111111` 的 NONE 分支，
`binding_hash=sha256:c22bb0a9ca28bffab126885d66d16a80cfc884192ace1fef47abf69c51f2d3d6`，
对应 DATA `frontier_value_hash=sha256:af18836a8a1aed1124c83949b1ce22476edfccfc7147b8fe7dae2cfa16caeee9`。
TS/PG 必须共享并拒绝 caller Hash。

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

`initialize` 仅无行时写 Version 0；`advance` 必须先按 Database Surface 的 Root 顺序
锁 Run、规范 Artifact identity 与 Current，再按固定五维顺序锁全部 Frontier，匹配
expected Version/Hash 后写 `version+1`。两者匹配 capability Owner/Kind 与 Value Kind，
校验 Ref Scope/Run、Epoch、Canonical Hash，按
`S/run/principal/kind/idempotency_key` 幂等；同键异输入冲突。

Advance 同一 security-definer 事务检查 Current；漂移则以
`FRONTIER_ADVANCE/operation_id` 幂等创建 Revocation/Receipt，推进 Current 内嵌的
revocation seq/receipt、置 REVOKED、撤销未响应 Grant 并写 Event/Audit，任一步失败全
回滚。此级联不授予
`SERVICE_REVOCATION_AUTHORITY`，内部 Writer 不公开；无 Current 时 cascade id=null。

### 2.4 表

| 表 | PK / Unique / 必需字段 |
| --- | --- |
| `research_version_frontiers` | PK `(S,run_id,frontier_kind)`；strict Value、Hash/Version/Epoch/time |
| `research_frontier_operations` | PK `(S,operation_id)`；UQ `(S,run_id,principal_id,frontier_kind,idempotency_key)`；Input/expected Hash/Version、Outcome/committed Version/Event Seq/Cascade Op/time/error |
| `research_frontier_events` | PK `(S,run_id,event_seq)`；UQ `(S,operation_id)`；append-only Owner、old/new Version/Hash、`INITIALIZED|ADVANCED`、DB time |

成功/失败 Operation 均 Audit；Event 仅已提交转换。删除/降级/跳号/非 Owner/CAS loser/
同键异 Hash 均失败关闭。

## 3. Platform 业务真值表

Authority/Root 物理 Schema、函数与 GRANT 只取 Database Surface；执行域表只取
Execution Storage；本文只闭合 Frontier/Readiness 业务记录：

| 表 | PK / Unique / 状态与必需字段 |
| --- | --- |
| `current_report_readiness` | PK `(S,run_id)`；`CURRENT|REVOKED`；exact Certificate/Report/Semantic Hash、五维 Version/Hash、Epoch、readiness Version、revocation Seq/Receipt、时间；Seq+Receipt 即 Head |
| `research_readiness_publications` | PK `(S,publication_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；仅成功 append；Input Hash、Certificate/Report、expected/committed Version、Frontier Hash、`CURRENT_PUBLISHED`、时间 |
| `research_readiness_consumptions` | PK `(S,consumption_id)`；UQ `(S,run_id,principal_id,purpose,idempotency_key)`；仅成功 append；Input Hash、Certificate/Report、Readiness/Revocation/Frontier/Epoch、`READY_COMMITTED|STALE_COMMITTED|GRANT_ISSUED`、strict Terminal/Grant 分支、时间 |
| `research_domain_terminals` | PK `(S,run_id)`；UQ `(S,terminal_id)`；append-only；Terminal=`READY|STALE|PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE`；Authority=`CURRENT_READINESS|REVOCATION_CONSUMPTION|RESEARCH_STOP`；Reason、Domain Reasons、exact Refs、nullable Certificate、Input Hash、时间 |
| `research_stop_terminal_commits` | PK `(S,commit_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；仅成功 append；exact Stop/Coverage、Input Hash、Terminal ID、`COMMITTED`、时间 |
| `research_revocation_operations` | PK `(S,operation_id)`；UQ `(S,run_id,owner_principal_id,idempotency_key)`；strict Trigger/Source Operation/Owner/Reason CHECK、Certificate/Frontier/Epoch、`REQUESTED|COMMITTED|FAILED`、Receipt/Error/time |
| `report_read_grants` | PK `(S,grant_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；exact Certificate/Report、server immutable Response Wire、Issue Readiness/Revocation/Frontier/Epoch、五态、`terminal_from_status`、阶段 Key/Hash/时间三元组 |
| `report_read_grant_expiration_operations` | PK `(S,operation_id)`；UQ `(S,grant_id,principal_id,idempotency_key)`；Input Hash、expected/source State、`EXPIRED`、DB time |
| `research_release_decision_commits` | PK `(S,decision_id)`；UQ `(S,run_id,principal_id,idempotency_key)`；仅成功 append；Candidate/Input/Decision Hash、immutable GO、Certificate、Readiness/Revocation/Frontier/Epoch、时间 |

Current、Grant 与 Revocation 的 nullable strict 分支如下，并与表中全部必需列求交；
数据库 `CHECK` 施加同一约束：

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
  | { state: "FAILED"; receipt_ref: null; error_code: U6PlatformErrorCode;
      completed_at: Timestamp };

type FrontierOperationNullable =
  | { outcome: "COMMITTED";
      committed_frontier_version: NonNegativeInt;
      committed_frontier_hash: Sha256; event_seq: PositiveInt;
      cascaded_revocation_operation_id: ImmutableId | null;
      error_code: null; completed_at: Timestamp }
  | { outcome: "REJECTED";
      committed_frontier_version: null; committed_frontier_hash: null;
      event_seq: null; cascaded_revocation_operation_id: null;
      error_code: U6PlatformErrorCode; completed_at: Timestamp };
```

`REVOKED→CURRENT` 重发布写新 Certificate、递增 `readiness_version`，清空**当前代**
Receipt/`revoked_at`，但保持 `revocation_seq` 全 Run 单调；历史由 Operation/Receipt/
Audit 保留；Publish 必须查询历史 Revocation Operation/Receipt，永久拒绝把同一已撤
Certificate 再发布为 CURRENT。

Revocation 的 `REQUESTED` 只在函数事务内可见。预期业务失败使用 PL/pgSQL
subtransaction：回滚 Current/Grant/Receipt/Event 等业务写，再把 Operation 置 FAILED
并返回结构化错误；成功置 COMMITTED。不可恢复 SQL/约束异常终止整个外层事务，可能
不留 FAILED 行，不能用 Operation 表代替运行日志。
编码顺序固定：Authority 校验 → 外层以
`INSERT ... ON CONFLICT DO NOTHING` 创建/定位 Operation → 重锁 Operation
`FOR UPDATE` 并 exact 比较 Input Hash → 内层 `BEGIN ... EXCEPTION` 执行业务写。只捕获
U6 专用 SQLSTATE 与 constraint-name allowlist；内层回滚后外层写
FAILED/REJECTED。`deadlock_detected|serialization_failure|query_canceled`、未知
FK/CHECK/UQ 与所有未列异常必须重新抛出，禁止 `WHEN OTHERS` 吞错。
Frontier 的预期 CAS/Owner/输入拒绝使用相同 subtransaction 语义写 REJECTED；Event
只允许 COMMITTED。Publication/Consumption/Stop/GO 只保存成功记录，调用失败没有伪造
success row。

## 4. 唯一锁序与状态传播

所有 Publish、Current Consume、Research Stop Commit、Frontier 传播撤权、显式
Revoke、Grant Consume/Response/Expire 和 GO Commit 都使用 Database Surface §3 的
逐行唯一 Root 顺序；本文不复制缩写版。Derivation 分册的 Budget/Input Head 只能在其
固定 rank 取得，其他 Head 禁止；Advisory 只补 absent-key，不能替代真实行。
Resource/Invocation 持锁后不得反向进入 Root。

状态顺序固定为：

```text
五维 Frontier 已由五类 Owner initialize
→ ReportReadyCertificate@3 COMMITTED
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
Publish 同键重放仍先按唯一锁序重验 Certificate/Current/Frontier 与 Current 内嵌的
revocation seq/receipt；若已撤权返回 `CURRENT_READINESS_REVOKED`，历史 Publication
仅供审计。

Standalone Revoke 只推进 Current 及其内嵌 seq/receipt、未响应 Grant、Audit，**不创建
STALE**。
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
  reason: "EVIDENCE_REVOKED" | "CERTIFICATE_TAMPERED";
};
type CascadeFrontierRevocationCommand = {
  trigger: "FRONTIER_ADVANCE"; source_operation_id: ImmutableId;
  reason:
    | "SEMANTIC_REVISION_CHANGED" | "SCHEMA_REVISION_CHANGED"
    | "DATA_SNAPSHOT_STALE" | "POLICY_CHANGED"
    | "IDENTITY_AUTHORITY_CHANGED";
};

type CommitResearchStopTerminalInput = StrictCommandBase & {
  commit_id: ImmutableId; terminal_id: ImmutableId;
  stop_decision_ref: ResearchStopDecisionV2Ref;
  coverage_ref: CoverageStateV2Ref;
};
type DerivationReceiptBinding = { receipt_id: ImmutableId; receipt_hash: Sha256 };
type ResearchStopTerminalCommon = {
  commit_id: ImmutableId; terminal_id: ImmutableId;
  domain_reason_codes: U6ResearchReasonCode[]; // 1..32，规范身份唯一
  authority_kind: "RESEARCH_STOP"; certificate_ref: null;
  revocation_receipt_ref: null;
  stop_decision_ref: ResearchStopDecisionV2Ref;
  derivation_receipts: {
    budget: DerivationReceiptBinding; coverage: DerivationReceiptBinding;
    candidate: DerivationReceiptBinding; stop: DerivationReceiptBinding;
  };
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
type ExpiredReportReadGrant = {
  operation_id: ImmutableId; grant_id: ImmutableId; state: "EXPIRED";
  terminal_from_status: "ISSUED" | "CONSUMED"; expired_at: Timestamp;
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
  expireGrant(capabilityInput: unknown, input: ExpireReportReadGrantInput):
    Promise<PortResult<ExpiredReportReadGrant>>;
  commitResponse(capabilityInput: unknown, input: CommitReportReadResponseInput):
    Promise<PortResult<CommittedReportReadResponse>>;
  commitGo(capabilityInput: unknown, input: CommitCurrentGoInput):
    Promise<PortResult<CommittedCurrentGo>>;
}

interface ResearchStopTerminalPort {
  commit(capabilityInput: unknown, input: CommitResearchStopTerminalInput):
    Promise<PortResult<CommittedResearchStopTerminal>>;
}
interface ResearchDerivationPort {
  beginStep(capabilityInput: unknown, input: BeginResearchStepInput):
    Promise<PortResult<BegunResearchStep>>;
  issueBudgetSnapshot(capabilityInput: unknown,
    input: IssueBudgetLedgerSnapshotInput):
    Promise<PortResult<BudgetLedgerReceipt>>;
  issueEnumeratorAttestation(capabilityInput: unknown,
    input: IssueCandidateEnumeratorAttestationInput):
    Promise<PortResult<CandidateEnumeratorAttestation>>;
}
interface RunLockedArtifactCommitPort {
  commit(appCapabilityInput: unknown, input: RunLockedArtifactCommitInput):
    Promise<PortResult<RunLockedArtifactCommitResult>>;
}
interface U6DerivationProvisionerPort {
  provision(input: ProvisionDerivationPolicyInput):
    Promise<PortResult<ProvisionedDerivationPolicy>>;
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
| `CurrentReadinessPort.expireGrant` | `REPORT_READ_EXPIRY_AUTHORITY` |
| `CurrentReadinessPort.commitGo` | `RELEASE_GO_AUTHORITY` |
| `ResearchStopTerminalPort.commit` | `RESEARCH_STOP_AUTHORITY` |
| `ResearchDerivationPort.beginStep` | `RESOURCE_AUTHORITY` |
| `ResearchDerivationPort.issueBudgetSnapshot/issueEnumeratorAttestation` | `RESEARCH_STOP_AUTHORITY` |
| `RunLockedArtifactCommitPort.commit` | current App WRITE；Grounding 分支另需 OWNER |
| `U6DerivationProvisionerPort.provision` | deployment-only `data_agent_u6_provisioner` |

Derivation exact Input/Result/Manifest 只取 Derivation Wire §6。Adapter 方法分别一一映射
Database Surface 同名 RPC；同 operation+Hash 返回 `created=false` 的持久结果，异 Hash
映射 `RESEARCH_DERIVATION_RECEIPT_CONFLICT`。Snapshot 过龄/水位变化与 Root Artifact
revision 漂移映射 `RESEARCH_STOP_INPUT_STALE`；App committer 保持现有 Repository/
ModelCertification 错误码，不伪造 U6 capability。Terminal Result 的 `budget` 是 Artifact
已绑定 Snapshot，`coverage/candidate/stop` 才是 Root 同事务新建的三张 Receipt。

Adapter 入锁前解析方法的 exact Capability；同一 Port 不表示权限互换。Frontier
级联只继承已验证的 matching Authority/`operation_id`，不能调用 public `revoke`。

Research Stop Authority 只接受 exact、current Stop/Coverage v2 绑定的 Budget Snapshot；
Coverage/Candidate/Stop 三张新 Receipt 与 terminal binding 同事务完成，并固定映射：

| Stop Decision | Public Terminal / Reason |
| --- | --- |
| `STOP_PARTIAL` | `PARTIAL / EVIDENCE_PARTIAL` |
| `STOP_NEEDS_MORE_RESEARCH` | `NEEDS_MORE_RESEARCH / EVIDENCE_COVERAGE_INSUFFICIENT` |
| `STOP_INCONCLUSIVE` | `INCONCLUSIVE / ANALYSIS_INCONCLUSIVE` |

Stop Port 仅接受 `RESEARCH_STOP_AUTHORITY`，Reason 集必须 exact。Commit 按 §4
锁内重验 Current/Terminal 不存在、五维 Frontier/Coverage exact current 且无 STALE；
与 Publish/Advance 竞争仅一方提交。它是三个终态唯一入口；重放重验 Revision，同键异
Hash 冲突。通用 `authorizeRunTerminal` 对 READY/STALE 报
`CURRENT_READY_CONSUMPTION_REQUIRED`，对其余三态报
`RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED`。

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
type ExpireReportReadGrantInput = StrictCommandBase & {
  operation_id: ImmutableId; grant_id: ImmutableId;
  expected_state: "ISSUED" | "CONSUMED";
  reason_code: "REPORT_READ_GRANT_TTL_EXPIRED";
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

Issue/Response 不接收 caller Digest/bytes/Media Type/长度。U6 v1 Grant TTL 固定
`60_000ms`，数据库以 `expires_at=db_now+60s` 签发，调用方不能提交或延长。Issue 用固定
`ZH_L2_RESEARCH_V1` 从 exact Report 投影并存 immutable Wire；decoded body ≤1,048,576
bytes，unpadded base64url ≤1,398,102 字符，拒绝非法 alphabet、非最短编码或 re-encode
不等。Consume 仅 `ISSUED→CONSUMED`。在 `db_now>=expires_at` 时，Consume/Response
即使 Expiry Job 未运行也固定拒绝；`expire_report_read_grant` 只把
`ISSUED|CONSUMED→EXPIRED` 持久化，不能读取或响应正文。Response 重投影并逐字节匹配
Wire/body/Digest，重验 Current、五维 Frontier、READY、Current 内嵌的 revocation
seq/receipt、TTL、Principal 后 CAS 为 RESPONDED，再返回 server Wire；CAS 前零字节。
Revoke 先胜则未响应 Grant 为 REVOKED。

## 7. Resource Reservation 与 Invocation

Resource/Invocation strict Wire 取 `u6-research-resource-invocation-contract.md`，
Invocation 状态取 `u6-invocation-state-contract.md`，Result 加密/claim/解密取
`u6-invocation-result-crypto-contract.md`，函数/GRANT 取 Database Surface 分册。
跨域不变量：Seq 单调；I/O 前持 exact IN_USE Lease；未知 Outcome 不释放预算，late
Usage 必须入账。

## 8. Revocation Receipt 与 Release GO

Public Revoke 只接受 `SERVICE_REVOCATION_AUTHORITY`，Frontier 级联只接受 matching
Authority；两者共享不公开的 Writer，trigger 固定为
`SERVICE_REQUEST|FRONTIER_ADVANCE`，且：

```text
ReadinessRevocationReceipt.envelope.attempt_id = source_operation_id
artifacts.worker_fence = 0  // SERVICE_OPERATION_FENCE
```

内部 Writer 对 SERVICE 仅收两种服务 Reason；对 FRONTIER 重验外层
capability/value/event/operation 并按五维唯一映射 Reason。CHECK 强制
Owner/Source/Trigger 互斥、source id exact；两支均重验 Epoch、Certificate/Frontier、
Envelope/Domain Hash。普通 Committer 拒绝 Fence 0；两支无 Worker Lease/SQL/其他
Artifact 权限。

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

GO 在 §4 单事务锁内验证 exact V3 Certificate、同证书 READY、CURRENT、五维
Frontier/Schema、Current 内嵌的 revocation seq/receipt、Epoch、material Claim、
Release Evidence/签名 Outcome，再写 immutable GO/Audit。缺 READY 报
`RESEARCH_READY_TERMINAL_REQUIRED`；同键重放仍重验，撤权后报
`CURRENT_READINESS_REVOKED`。禁用事务外 Snapshot；旧 GO API 报
`CURRENT_RELEASE_COMMIT_REQUIRED`；缺 U7–U9 证据保持 HOLD。

## 9. 错误与历史 tuple

Public mutation、read Resolver、internal-only helper、Capability、GRANT 与 DML
denylist 的闭合枚举只取 Database Surface 分册；本文不得增加隐式数据库函数。

```ts
const U6_ERROR_RETRYABLE = {
  RESEARCH_CAPABILITY_SCOPE_MISMATCH: false,
  RESEARCH_DATABASE_AUTHORITY_REQUIRED: false,
  RESEARCH_DATABASE_CONTRACT_INVALID: false,
  RESEARCH_PERSISTENCE_UNAVAILABLE: true,
  RESEARCH_AUTHORITY_LOCK_CONTENDED: true,
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
  REPORT_READ_GRANT_EXPIRED: false,
  REPORT_READ_RESPONSE_DIGEST_MISMATCH: false,
  REPORT_READ_GRANT_REVOKED: false,
  EVIDENCE_RELATION_IDENTITY_CONFLICT: false,
  RESEARCH_RESOURCE_RESERVATION_CONFLICT: false,
  RESEARCH_DERIVATION_RECEIPT_CONFLICT: false,
  RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED: true,
  RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE: false,
  RESEARCH_RESOURCE_LIMIT_EXCEEDED: false,
  RESEARCH_INVOCATION_TRANSITION_CONFLICT: false,
  RESEARCH_INVOCATION_TERMINAL_CONFLICT: false,
  RESEARCH_INVOCATION_LATE_TERMINAL_CLOSED: false,
  RESEARCH_SYSTEM_RECORD_NOT_ACTIVE: false,
  RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH: false,
  RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT: false,
  RESEARCH_RESULT_SIZE_EXCEEDED: false,
  RESEARCH_RESULT_DIGEST_MISMATCH: false,
  RESEARCH_RESULT_GOVERNANCE_REJECTED: false,
  RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY: true,
  RESEARCH_RESULT_KEY_ROTATION_CONFLICT: true,
  RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE: false,
  RESEARCH_RESULT_INTEGRITY_FAILURE: false,
  RESEARCH_RESULT_ACCESS_RATE_LIMITED: true,
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

固定映射：Frontier 非 Owner/缺行/CAS loser 依次用表中三个 Frontier 错误；Relation Pair
冲突、GO 缺 READY 分别用其同名错误；Authority prefix `55P03` 只映射
`RESEARCH_AUTHORITY_LOCK_CONTENDED` 并整事务回滚。禁止斜杠候选/自由字符串；执行域取 §7。

V1 仅能由显式 `readHistorical*` 返回
`{authority:"HISTORICAL_READ_ONLY",can_authorize_current:false}`；V1 Parser 成功不得取得
Writer、Relation Key、Frontier、Stop Terminal、Readiness、Grant、Revocation 或 GO
Authority。

## 10. 必需 Oracle

双 PG 连接覆盖 Frontier/Readiness/Grant/GO 的 CAS、重放、撤权、tamper，Stop 与
Publish/Advance、Relation Pair 及 Grant 四阶段竞态；Revoke 不建 STALE，losing DOMAIN
只建一个，Response CAS 前零字节。还须证明通用 Repository/raw DML 拒绝 U6、专用
Committer 成功、internal 直调失败；无明文，crypto/hash 篡改失败，replay 不重复加密，
claim takeover 最多一 Blob，Tombstone 不可回放。Hosted/Docker 共用 Case；In-Memory
不替代事务 Oracle。

## 11. Migration 与部署边界

唯一链为 Migration Safety 冻结的 forward-only `10590→10600`；前者已装且 hash
immutable，后者承载 Derivation/兼容 committer/v2 Root，仍 `NOT_IMPLEMENTED`。对象与
Inventory Owner 分别取 Database Surface、Execution Storage、Reference Graph、Cleanup；
共享 Supabase 以 `S` 隔离，Redis/Upstash 仅存可丢缓存。
