# U6 L2 Research Planning Wire Payload 契约

> 状态：`FROZEN_DESIGN_CONTRACT`
> 上位合同：`docs/design/u6-research-authority-contract.md`
> 下游 Wire：`docs/design/u6-research-wire-payload-contract.md`
> 实现状态：`NOT_IMPLEMENTED`

本文完整冻结 U6 共同 Wire primitive、目标类型引用、`ResearchBrief@2`、
`HypothesisSet@2` 与 `EvidencePlan@2`。下游 Wire 单向依赖本文；本文不依赖下游
Payload，因此不存在“Authority 与 Wire 相互指回却没有任何一处给出完整字段”的循环。

## 1. Strict primitive 与统一上限

实现必须把以下文档类型逐一落成 `z.strictObject`。下列别名的运行时含义固定：

```ts
type ImmutableId = string;      // 复用 immutableIdSchema（UUID）
type Identifier = string;       // z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
type PrincipalId = string;      // z.string().min(1).max(256)
type IdempotencyKey = string;   // z.string().min(1).max(256)
type Version = string;          // z.string().min(1).max(128)，复用 versionIdentifierSchema
type NonEmptyText = string;     // z.string().min(1).max(2_000)
type Sha256 = `sha256:${string}`; // 复用 contentHashSchema
type HmacSha256 = `hmac-sha256:${string}`;
type Timestamp = string;        // 复用 timestampSchema
type NonNegativeInt = number;   // z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
type PositiveInt = number;      // z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
type FiniteNumber = number;     // z.number().finite()
type ModelProvider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "glm"
  | "kimi"
  | "grok"
  | "gemini";                   // 复用 modelProviderSchema

type U6ResearchReasonCode =
  | "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE"
  | "EVIDENCE_PLAN_REPLAN_REQUIRED"
  | "OBLIGATION_QUERY_SEMANTICS_MISMATCH"
  | "ATOMIC_CLAIM_OBSERVATION_MISMATCH"
  | "OBSERVATION_NULL_REJECTED"
  | "OBSERVATION_EMPTY_AFTER_NULL_FILTER"
  | "OBSERVATION_RATIO_DENOMINATOR_INVALID"
  | "EVIDENCE_SUPPORT_INSUFFICIENT"
  | "MATERIAL_CONFLICT_UNDISCLOSED"
  | "CRITICAL_OBLIGATION_FAILED"
  | "EVIDENCE_REVISION_STALE"
  | "OBLIGATION_SATISFIED"
  | "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION"
  | "EVIDENCE_COVERAGE_INSUFFICIENT"
  | "ANALYSIS_INCONCLUSIVE"
  | "REPORT_PROJECTION_AUTHORITY_INVALID"
  | "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE"
  | "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED"
  | "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED"
  | "REPORT_READY_AUTHORITY_REQUIRED"
  | "REPORT_READY_CERTIFICATE_TAMPERED"
  | "CERTIFICATE_SEMANTIC_HASH_MISMATCH"
  | "READINESS_REVOKED_DURING_CONSUMPTION"
  | "RESEARCH_STOP_INPUT_INCONSISTENT"
  | "UNSUPPORTED_SOURCE_KIND"
  | "HYPOTHESIS_COLLAPSE"
  | "SEMANTIC_REVISION_CHANGED"
  | "SCHEMA_REVISION_CHANGED"
  | "DATA_SNAPSHOT_STALE"
  | "POLICY_CHANGED"
  | "IDENTITY_AUTHORITY_CHANGED"
  | "EVIDENCE_REVOKED"
  | "CERTIFICATE_TAMPERED"
  | "CURRENT_READINESS_REVOKED"
  | "MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED"
  | "RESEARCH_RESOURCE_LIMIT_EXCEEDED";
```

所有数组先执行 `min/max`，再执行基于规范身份的唯一性 Refinement。U6 Wire 上限固定为：

```ts
const U6_WIRE_LIMITS = {
  max_dimensions: 32,
  max_metric_refs: 32,
  max_success_criteria: 32,
  max_required_disclosures: 32,
  max_hypotheses: 8,
  max_predictions_per_hypothesis: 32,
  max_falsifiers_per_hypothesis: 32,
  max_tests_per_hypothesis: 32,
  max_obligations: 32,
  max_hypothesis_refs_per_obligation: 8,
  max_criterion_refs_per_obligation: 32,
  max_dependencies_per_obligation: 32,
  max_reason_codes: 32,
  max_artifact_input_refs: 256,
  max_recursive_closure_nodes: 1024,
  max_dependency_depth: 32,
  max_artifact_bytes: 1_048_576,
  max_resolved_closure_bytes: 16_777_216,
} as const;
```

数组的“唯一”不是对象引用相等，而是：

- Artifact Reference 使用现有 `artifactReferenceIdentity`；
- Embedded Node Reference 使用
  `artifactReferenceIdentity(container_ref) + "\0" + node_id`；
- ID、Version、Reason Code 与 Disclosure 使用逐字值；
- 对顺序有领域含义的数组保留输入顺序；集合型数组先拒绝重复，再按上述身份规范排序后
  参与 Semantic Hash。

## 2. 精确 Artifact Reference

`ArtifactReference` 继续复用 HEAD 的完整
`artifact_id/artifact_type/app_id/tenant_id/environment/run_id/revision/content_hash`
结构。Payload 中禁止出现裸 `ArtifactReference`；每个字段只能使用下列目标类型别名：

```ts
type U6ReferenceTarget =
  | "QuestionFrame"
  | "ResearchBrief"
  | "HypothesisSet"
  | "EvidencePlan"
  | "QueryContract"
  | "SemanticRelease"
  | "SchemaSnapshot"
  | "PolicyReceipt"
  | "SqlArtifact"
  | "ValidationReceipt"
  | "ExecutionReceipt"
  | "SandboxResult"
  | "SandboxExecutionReceipt"
  | "ObligationExecutionDecision"
  | "QueryEvidence"
  | "AtomicClaim"
  | "EvidenceRelation"
  | "EvidenceCheckReceipt"
  | "SupportDecision"
  | "HypothesisAssessment"
  | "CoverageState"
  | "ResearchStopDecision"
  | "ReportManifest"
  | "AnalysisReport"
  | "ReportProjectionReceipt"
  | "EvidenceGateReceipt"
  | "ReportReadyCertificate"
  | "ReadinessRevocationReceipt"
  | "ModelCertificationReceipt";

type TypedArtifactReference<T extends U6ReferenceTarget> =
  ArtifactReference & { artifact_type: T };

type QuestionFrameRef = TypedArtifactReference<"QuestionFrame">;
type ResearchBriefRef = TypedArtifactReference<"ResearchBrief">;
type HypothesisSetRef = TypedArtifactReference<"HypothesisSet">;
type EvidencePlanRef = TypedArtifactReference<"EvidencePlan">;
type QueryContractRef = TypedArtifactReference<"QueryContract">;
type SemanticReleaseRef = TypedArtifactReference<"SemanticRelease">;
type SchemaSnapshotRef = TypedArtifactReference<"SchemaSnapshot">;
type PolicyReceiptRef = TypedArtifactReference<"PolicyReceipt">;
type SqlArtifactRef = TypedArtifactReference<"SqlArtifact">;
type ValidationReceiptRef = TypedArtifactReference<"ValidationReceipt">;
type ExecutionReceiptRef = TypedArtifactReference<"ExecutionReceipt">;
type SandboxResultRef = TypedArtifactReference<"SandboxResult">;
type SandboxExecutionReceiptRef = TypedArtifactReference<"SandboxExecutionReceipt">;
type ObligationExecutionDecisionRef =
  TypedArtifactReference<"ObligationExecutionDecision">;
type QueryEvidenceRef = TypedArtifactReference<"QueryEvidence">;
type AtomicClaimRef = TypedArtifactReference<"AtomicClaim">;
type EvidenceRelationRef = TypedArtifactReference<"EvidenceRelation">;
type EvidenceCheckReceiptRef = TypedArtifactReference<"EvidenceCheckReceipt">;
type SupportDecisionRef = TypedArtifactReference<"SupportDecision">;
type HypothesisAssessmentRef = TypedArtifactReference<"HypothesisAssessment">;
type CoverageStateRef = TypedArtifactReference<"CoverageState">;
type ResearchStopDecisionRef = TypedArtifactReference<"ResearchStopDecision">;
type ReportManifestRef = TypedArtifactReference<"ReportManifest">;
type AnalysisReportRef = TypedArtifactReference<"AnalysisReport">;
type ReportProjectionReceiptRef = TypedArtifactReference<"ReportProjectionReceipt">;
type EvidenceGateReceiptRef = TypedArtifactReference<"EvidenceGateReceipt">;
type ReportReadyCertificateRef = TypedArtifactReference<"ReportReadyCertificate">;
type ReadinessRevocationReceiptRef =
  TypedArtifactReference<"ReadinessRevocationReceipt">;
type ModelCertificationReceiptRef =
  TypedArtifactReference<"ModelCertificationReceipt">;

type EmbeddedNodeReference<T extends
  "ResearchBrief" | "HypothesisSet" | "EvidencePlan" | "SemanticRelease"> = {
  container_ref: TypedArtifactReference<T>;
  node_id: Identifier;
};

type SuccessCriterionRef = EmbeddedNodeReference<"ResearchBrief">;
type HypothesisRef = EmbeddedNodeReference<"HypothesisSet">;
type ProofObligationRef = EmbeddedNodeReference<"EvidencePlan">;
type MetricRef = EmbeddedNodeReference<"SemanticRelease">;
```

`ProofObligation.depends_on` 是同一个、尚未提交的 `EvidencePlan` Payload 内的局部边。
它不能嵌入带 `content_hash` 的自容器引用，否则会形成 Content Hash 自引用。该字段使用：

```ts
type LocalProofObligationReference = {
  node_id: Identifier;
};
```

提交 `EvidencePlan` 后，任何下游 Artifact 都必须把局部引用提升为
`ProofObligationRef={container_ref: exact EvidencePlanRef,node_id}`。不得把局部引用跨出
容器或解析为“最新 EvidencePlan”。

## 3. 共同 Value Contract

```ts
type IdentityBinding = {
  principal_id: PrincipalId;
  delegation_chain_hash: Sha256;
  authority_epoch: NonNegativeInt;
};

type DataSnapshotBinding = {
  protocol_version: "data-snapshot-binding@1.0.0";
  datasource_id: ImmutableId;
  strategy: "CONTROLLED_REVISION" | "NONE";
  snapshot_token: Version | null;
  schema_manifest_hash: Sha256 | null;
  data_manifest_hash: Sha256 | null;
  fixture_manifest_hash: Sha256 | null;
  replay_state: "REPLAYABLE" | "REPLAY_UNAVAILABLE";
  binding_hash: Sha256;
};

type VersionFrontier = {
  semantic_release_ref: SemanticReleaseRef;
  schema_snapshot_ref: SchemaSnapshotRef;
  data_snapshot: DataSnapshotBinding;
  policy_receipt_ref: PolicyReceiptRef;
  identity_binding: IdentityBinding;
};

type ModelProfileReference = {
  provider: ModelProvider;
  profile_id: ImmutableId;
  profile_version: Version;
  model_id: NonEmptyText; // 1..256
  profile_hash: Sha256;
  certification_receipt_ref: ModelCertificationReceiptRef;
};

type RetentionPolicyReference = {
  policy_id: Identifier;
  policy_version: Version;
  policy_hash: Sha256;
};

type ResearchBudgetLimit = {
  max_steps: PositiveInt;                         // <= 24
  max_model_calls: NonNegativeInt;               // <= 32
  max_sql_executions: NonNegativeInt;            // <= 16
  max_source_calls: 0;
  max_elapsed_ms: PositiveInt;                   // <= 600_000
  max_provider_input_tokens_per_call: PositiveInt;  // <= 32_000
  max_provider_output_tokens_per_call: PositiveInt; // <= 8_000
  max_provider_tokens_per_run: PositiveInt;         // <= 256_000
  max_provider_cost_microusd_per_run: NonNegativeInt; // <= 5_000_000
};

type ResearchBudgetUsage = {
  steps: NonNegativeInt;
  model_calls: NonNegativeInt;
  sql_executions: NonNegativeInt;
  source_calls: 0;
  elapsed_ms: NonNegativeInt;
  provider_input_tokens: NonNegativeInt;
  provider_output_tokens: NonNegativeInt;
  provider_tokens: NonNegativeInt;
  provider_cost_microusd: NonNegativeInt;
};

type ResearchBudgetBalance = {
  steps: NonNegativeInt;
  model_calls: NonNegativeInt;
  sql_executions: NonNegativeInt;
  source_calls: 0;
  elapsed_ms: NonNegativeInt;
  provider_tokens: NonNegativeInt;
  provider_cost_microusd: NonNegativeInt;
};

type ResearchBudgetDemand = ResearchBudgetBalance;
```

`VersionFrontier` 的五个维度必须全部属于 Envelope 的同一
App/Tenant/Environment/Run。`DataSnapshotBinding` 从 U5 `SnapshotDescriptor` 中排除
execution-specific 的 `execution_id/observed_at/descriptor_hash` 后规范化派生；它绑定
Datasource、Snapshot Token 与三张 Manifest，而不是任选某次
`SandboxExecutionReceipt` 充当整个 Research Run 的 DATA Frontier。每张
QueryEvidence 的 Sandbox Receipt/Descriptor 都必须重新映射到同一个
`binding_hash`；Q1/Q2 换 Snapshot Token、Watermark 或 Manifest 必须 `STALE`。

`ModelProfileReference` 必须由现有
`authorizeAvailableModelProfile` 等价校验：解析已提交
`ModelCertificationReceipt`，逐字匹配 `profile_id/profile_version/profile_hash`，
且 Receipt 为 `PASS`；未认证 Profile 不能进入外发成功路径。

`ResearchBudgetUsage.provider_tokens` 必须严格等于
`provider_input_tokens + provider_output_tokens`，并小于等于
`max_provider_tokens_per_run`；每次调用的输入/输出 Token 还必须分别满足 per-call
上限。`ResearchBudgetBalance` 与 `ResearchBudgetDemand` 使用总 Token，因为
Run Ledger 的可用余额只有一个总 Token 上限，不能虚构彼此独立的输入/输出余额。

## 4. `ResearchBrief@2`

```ts
type ResearchBriefV2Payload = {
  artifact_type: "ResearchBrief";
  protocol_version: "research-brief@2.0.0";
  question_frame_ref: QuestionFrameRef;
  scope: {
    subject: NonEmptyText;
    time_window: {
      start: Timestamp;
      end: Timestamp;
      timezone: NonEmptyText; // 1..64
      semantics: "HALF_OPEN";
    };
    dimensions: Identifier[]; // 0..32，唯一
    metric_refs: MetricRef[]; // 1..32，唯一
  };
  success_criteria: Array<{
    criterion_id: Identifier;
    statement: NonEmptyText;
    materiality: "CRITICAL" | "SUPPORTING";
  }>; // 1..32，criterion_id 唯一
  evidence_policy: {
    allowed_kinds: readonly ["QUERY"];
    minimum_support_mode: "DETERMINISTIC";
    unsupported_source_behavior: "REJECT";
  };
  hypothesis_universe_policy: {
    candidate_sources: Array<
      "USER_PROVIDED" | "METRIC_DECOMPOSITION" | "DOMAIN_TAXONOMY"
    >; // 1..3，唯一
    enumerator_version: Version;
    required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE";
  };
  freshness_policy: {
    max_age_seconds: NonNegativeInt;
    require_snapshot_replayable: boolean;
  };
  source_independence_policy: {
    mode:
      | "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE"
      | "MULTI_PROVENANCE_REQUIRED";
    minimum_provenance_groups: PositiveInt; // 1..32
    required_disclosures: Identifier[]; // 0..32，唯一
  };
  claim_policy: {
    allowed_modes: readonly ["DESCRIPTIVE", "COMPARATIVE", "DIAGNOSTIC"];
    forbidden_modes: readonly ["CAUSAL", "PRESCRIPTIVE", "ACTION_EXECUTING"];
  };
  budget: ResearchBudgetLimit;
  policy_ref: PolicyReceiptRef;
  policy_digest: Sha256;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  retention_policy_ref: RetentionPolicyReference;
};
```

等价 Zod/Authority Refinement：

1. `time_window.start < time_window.end`，并按声明时区解释为半开区间；
2. 至少一项 `CRITICAL` Success Criterion；
3. 所有 `MetricRef.container_ref` 必须是同一个精确 `SemanticRelease` Revision；
4. `policy_digest` 必须由解析后的 exact `PolicyReceipt` 重算；
5. `ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE` 要求
   `minimum_provenance_groups===1` 且 disclosures 含 `SINGLE_AUTHORITY_SOURCE`；
   `MULTI_PROVENANCE_REQUIRED` 要求 `minimum_provenance_groups>=2`；
6. 所有预算均不超过 `RESEARCH_RUNTIME_LIMITS@1`，`max_source_calls` 字面等于 `0`；
7. `PolicyReceipt`、Question、Semantic Release 与 Envelope Scope/Run 全部一致；
8. `SOURCE/DOCUMENT/BENCHMARK`、额外 Claim Mode、未知字段或非有限数字均解析失败。

Success Criterion 的可引用节点 ID 就是 `criterion_id`。只有提交后的 exact Brief
Revision 才能形成 `SuccessCriterionRef`。

## 5. `HypothesisSet@2`

```ts
type HypothesisV2 = {
  hypothesis_id: Identifier;
  mechanism_class: Identifier;
  statement: NonEmptyText;
  predictions: NonEmptyText[];          // 1..32，规范值唯一
  falsifiers: NonEmptyText[];           // 1..32，规范值唯一
  discriminating_test_ids: Identifier[]; // 1..32，唯一
  materiality: "MATERIAL" | "ALTERNATIVE";
  planning_status: "ADMISSIBLE";
};

type HypothesisSetV2Payload = {
  artifact_type: "HypothesisSet";
  protocol_version: "hypothesis-set@2.0.0";
  brief_ref: ResearchBriefRef;
  hypotheses: HypothesisV2[]; // 2..8
  mechanism_validator_version: Version;
  hypothesis_universe_hash: Sha256;
};
```

等价 Zod/Authority Refinement：

1. `hypothesis_id` 唯一，且至少两个 Hypothesis 为 `MATERIAL`；
2. Prediction 与 Falsifier 在各自 Hypothesis 内唯一；
   `discriminating_test_ids` 在整个 HypothesisSet 内全局唯一，避免多假设引用同名
   Test 时无法确定 Obligation 覆盖关系；
3. 规范化
   `(mechanism_class,sort(predictions),sort(falsifiers))` 后重复时返回
   `HYPOTHESIS_COLLAPSE`；更强的领域等价由
   `mechanism_validator_version` 指向的确定性 Validator 重算；
4. `hypothesis_universe_hash` 覆盖完整候选数组、Materiality、Enumerator Version 与
   Mechanism Validator Version，不接受调用方预填值；
5. `brief_ref` 必须解析为 exact `ResearchBrief@2`，并与 Envelope Scope/Run 一致；
6. `PROPOSED` 只属于非权威工具输出，不能进入本 Payload。

提交后 `HypothesisRef.node_id` 必须命中该 Revision 的 `hypothesis_id`。

## 6. `EvidencePlan@2`

```ts
type ObservationPredicate =
  | {
      operator: "GT" | "GTE" | "LT" | "LTE" | "EQ";
      threshold: FiniteNumber;
    }
  | {
      operator: "BETWEEN";
      threshold: readonly [FiniteNumber, FiniteNumber];
      bounds: "CLOSED";
    };

type ObservationContract = {
  metric_ref: MetricRef;
  aggregation: "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | "RATIO";
  unit: NonEmptyText; // 1..128
  support_predicate: ObservationPredicate;
  refute_predicate: ObservationPredicate;
  null_behavior: "FAIL" | "IGNORE" | "ZERO";
  contract_hash: Sha256;
};

type ProofObligationV2 = {
  obligation_id: Identifier;
  hypothesis_refs: HypothesisRef[]; // 1..8，唯一
  success_criterion_refs: SuccessCriterionRef[]; // 1..32，唯一且 exact
  discriminating_test_ids: Identifier[]; // 1..32，命中所引假设声明，集合内唯一
  materiality: "CRITICAL" | "SUPPORTING";
  evidence_kind: "QUERY";
  depends_on: LocalProofObligationReference[]; // 0..32，唯一
  observation_contract: ObservationContract;
  failure_behavior: "BLOCK_READY" | "ALLOW_PARTIAL_WITH_DISCLOSURE";
};

type EvidencePlanV2Payload = {
  artifact_type: "EvidencePlan";
  protocol_version: "evidence-plan@2.0.0";
  brief_ref: ResearchBriefRef;
  hypothesis_set_ref: HypothesisSetRef;
  obligations: ProofObligationV2[]; // 1..32
  planner_version: Version;
  obligation_graph_hash: Sha256;
};
```

等价 Zod/Authority Refinement：

1. `obligation_id` 唯一；每个引用数组内部唯一；依赖目标必须命中同一 Payload 中的
   `obligation_id`，不得自依赖，整图无环且深度不超过 32；
2. `brief_ref` 必须逐字等于 `hypothesis_set_ref` 解析结果中的 `brief_ref`；
3. 每个 `HypothesisRef.container_ref` 必须逐字等于 `hypothesis_set_ref`；
4. 每个 `SuccessCriterionRef.container_ref` 必须逐字等于 `brief_ref`，且 `node_id`
   命中该 Brief 的 `criterion_id`；
5. 每个 `MATERIAL` Hypothesis 至少由一个 `CRITICAL` Obligation 覆盖；每个
   Obligation 的 `discriminating_test_ids` 必须来自其 `hypothesis_refs` 指向的假设，
   且每个假设声明的 `discriminating_test_id` 必须在引用该假设的全部 Obligation 中
   **精确出现一次**；
6. 每个 `CRITICAL` Success Criterion 至少由一个 `CRITICAL` Obligation 覆盖；
   `SUPPORTING` Criterion 可以进入 `SUPPORTING` 或 `CRITICAL` Obligation，但
   `CRITICAL` Criterion 绝不能只进入 `SUPPORTING`；
7. Obligation 的 `materiality` 必须由引用节点重算：引用任一 `CRITICAL` Criterion
   或任一 `MATERIAL` Hypothesis 时必须为 `CRITICAL`；不得由 Planner 降级；
8. 同一 Obligation 内不得重复 Criterion；跨 Obligation 重用同一 Criterion 是有意的
   多测试覆盖，必须由不同 `obligation_id` 表达，不能复制同一个 ID；
9. 每个 `BETWEEN` Predicate 的二元组必须升序，且真值固定为
   `low <= observed && observed <= high`；其他 Operator 只能使用标量。两端点必须有
   Oracle；
   Support 与 Refute Predicate 必须分别执行自身 Operator，二者真值区域不得重叠；
   `support>=0.60/refute<=0.30` 这类相反方向不能由一个共享 Comparison 猜测；
10. Null 只作用于 QueryContract 产出的权威聚合标量，不在聚合前擅自改写原始行：
    `FAIL` 遇 null 固定 `OBSERVATION_NULL_REJECTED`；`IGNORE` 移除 null 后若无标量，
    固定 `OBSERVATION_EMPTY_AFTER_NULL_FILTER`；`ZERO` 只把合法 null 标量替换为 0，
    不能替代缺行/类型错误。`RATIO` 的分母为 0/null 时始终
    `OBSERVATION_RATIO_DENOMINATOR_INVALID`，不得由 ZERO 绕过；
11. `contract_hash` 从 Metric、Aggregation、Unit、两个完整 Predicate 与 Null
    Behavior 重算；`obligation_graph_hash` 从规范排序后的节点和边重算；
12. 所有 Metric 必须来自 Brief 绑定的同一 Semantic Release；Plan 在 Brief 预算和
    服务端上限下不可执行时不得提交；
13. `evidence_kind` 只能为 `QUERY`；未知 Source 类型固定
    `UNSUPPORTED_SOURCE_KIND`。

`EvidencePlan` Envelope `input_refs` 必须至少精确包含 `brief_ref`、
`hypothesis_set_ref`、所有 Hypothesis/SuccessCriterion/Metric 的 `container_ref`；
局部 `depends_on` 不进入 `input_refs`，因为其容器就是当前 Payload。

## 7. Planning Wire 注册与失败规则

| Artifact | Envelope `schema_version` | Payload `protocol_version` |
| --- | --- | --- |
| `ResearchBrief` V2 | `2.0.0` | `research-brief@2.0.0` |
| `HypothesisSet` V2 | `2.0.0` | `hypothesis-set@2.0.0` |
| `EvidencePlan` V2 | `2.0.0` | `evidence-plan@2.0.0` |

Parser 必须先按上述三元组选择唯一 strict Schema，再运行本文 Refinement。以下全部失败
关闭：

- 未注册版本元组、未知字段、重复集合成员、超限数组或非有限数字；
- 引用目标类型不符、Scope/Run 不符、Reference 未进入 Envelope `input_refs`；
- Node ID 不存在、跨容器偷换、Critical 覆盖不完整、Materiality 降级或依赖成环；
- 调用方 Hash 与服务端重算不一致；
- V1/V2 Planning Artifact 混入同一 Authority 闭包。

本文冻结的是实现输入，不是实现证据。普通 Schema Parse 仍只产生 Candidate。
