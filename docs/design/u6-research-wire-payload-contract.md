# U6 L2 Research Proof、Stop 与 Readiness Wire Payload 契约

> 状态：`FROZEN_DESIGN_CONTRACT`
> 上位合同：`docs/design/u6-research-authority-contract.md`
> Planning Wire：`docs/design/u6-research-planning-payload-contract.md`
> 实现状态：纯 Research Kernel 为 `KERNEL_CANDIDATE_ONLY`；生产 Authority 为
> `NOT_IMPLEMENTED`

本文冻结 Obligation Execution 到 Provider Egress 的 Payload/Refinement；
Primitive、Typed Ref 与共同 Value 复用 Planning Wire。对象和判别联合均须 strict，
禁止宽 Parse 后断言；`*Ref` 使用固定目标别名。

## 1. Proof 与 Evidence Payload

OED v2 见 `docs/design/u6-research-oed-v2-contract.md`；下文从 QueryEvidence 开始。

```ts
type QueryEvidenceV2Payload = {
  artifact_type: "QueryEvidence";
  protocol_version: "query-evidence@2.0.0";
  obligation_ref: ProofObligationRef;
  obligation_execution_decision_ref: ObligationExecutionDecisionRef;
  query_contract_ref: QueryContractRef;
  sql_artifact_ref: SqlArtifactRef;
  validation_receipt_ref: ValidationReceiptRef;
  execution_receipt_ref: ExecutionReceiptRef;
  sandbox_execution_receipt_ref: SandboxExecutionReceiptRef;
  sandbox_result_ref: SandboxResultRef;
  dependency_evidence_refs: QueryEvidenceRef[]; // 0..32，唯一；Q2 精确绑定 Q1
  provenance_group: Identifier;
  observed_version: VersionFrontier;
  observation: {
    result_hash: Sha256;
    row_count: NonNegativeInt;
    schema_hash: Sha256;
  };
};

type ClaimScalarValue =
  | {
      value_kind: "NUMBER";
      number_value: FiniteNumber;
      text_value: null;
      unit: Identifier;
    }
  | {
      value_kind: "TEXT";
      number_value: null;
      text_value: NonEmptyText;
      unit: null;
    };

type ClaimObservationBinding = {
  binding_id: Identifier;
  evidence_ref: QueryEvidenceRef;
  metric_ref: MetricRef;
  output_alias: Identifier;
  row_key_hash: Sha256;
  observed_value: ClaimScalarValue;
  time_window_hash: Sha256;
  dimension_slice_hash: Sha256;
  result_cell_hash: Sha256;
};

type AtomicClaimPredicate =
  | {
      claim_mode: "DESCRIPTIVE";
      observation_binding_id: Identifier;
      operator: "EQ" | "GTE" | "LTE";
      asserted_value: ClaimScalarValue;
    }
  | {
      claim_mode: "COMPARATIVE";
      left_binding_id: Identifier;
      right_binding_id: Identifier;
      operator: "GT" | "GTE" | "LT" | "LTE" | "EQ";
      absolute_delta: FiniteNumber;
      relative_delta: FiniteNumber | null;
    }
  | {
      claim_mode: "DIAGNOSTIC";
      outcome_change_binding_id: Identifier;
      contribution_binding_ids: Identifier[]; // 1..32，唯一
      operator: "SUM_EQUALS" | "SHARE_OF";
      asserted_value: FiniteNumber;
      tolerance: 0; // 首版只允许精确算术；调用方不能放大容差
    };

type AtomicClaimV2Payload = {
  artifact_type: "AtomicClaim";
  protocol_version: "atomic-claim@2.0.0";
  claim_id: Identifier;
  observation_bindings: ClaimObservationBinding[]; // 1..32，binding_id 唯一
  predicate: AtomicClaimPredicate;
  claim_renderer_version: Version;
  statement: NonEmptyText;
  statement_hash: Sha256;
  evidence_refs: QueryEvidenceRef[]; // 1..32，唯一
  limitations: NonEmptyText[]; // 0..32，规范值唯一
};

type EvidenceRelationV2Payload = {
  artifact_type: "EvidenceRelation";
  protocol_version: "evidence-relation@2.0.0";
  claim_ref: AtomicClaimRef;
  evidence_ref: QueryEvidenceRef;
  proposed_relation:
    | "SUPPORTS"
    | "REFUTES"
    | "CONFLICTS"
    | "QUALIFIES"
    | "CONTEXT_ONLY";
  rationale: NonEmptyText;
  obligation_ref: ProofObligationRef;
};

type EvidenceCheckInputRef =
  | EvidenceRelationRef
  | AtomicClaimRef
  | QueryEvidenceRef
  | QueryContractRef
  | SemanticReleaseRef
  | SchemaSnapshotRef
  | PolicyReceiptRef
  | SandboxExecutionReceiptRef
  | SandboxResultRef;

type EvidenceCheckReceiptPayload = {
  artifact_type: "EvidenceCheckReceipt";
  protocol_version: "evidence-check@1.0.0";
  relation_ref: EvidenceRelationRef;
  check_kind: "DETERMINISTIC_CHECK" | "PROVENANCE_CHECK";
  verdict: "PASS" | "FAIL";
  observed_contract_hash: Sha256;
  evaluated_refs: EvidenceCheckInputRef[]; // 1..128，唯一
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
  evaluator_version: Version;
  check_input_hash: Sha256;
};

type SupportDecisionPayload = {
  artifact_type: "SupportDecision";
  protocol_version: "support-decision@1.0.0";
  claim_ref: AtomicClaimRef;
  relation_refs: EvidenceRelationRef[]; // 1..32，唯一
  check_receipt_refs: EvidenceCheckReceiptRef[]; // 2..64，唯一；每 Relation 恰两张
  obligation_refs: ProofObligationRef[]; // 1..32，唯一
  decision:
    | "SUPPORTED"
    | "REFUTED"
    | "CONFLICTED"
    | "INSUFFICIENT"
    | "UNSUPPORTED";
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
  evaluator_version: Version;
  input_closure_hash: Sha256;
};

type HypothesisAssessmentPayload = {
  artifact_type: "HypothesisAssessment";
  protocol_version: "hypothesis-assessment@1.0.0";
  hypothesis_ref: HypothesisRef;
  support_decision_refs: SupportDecisionRef[]; // 0..128，唯一
  status: "TESTED" | "REFUTED" | "SURVIVED" | "UNRESOLVED";
  unresolved_obligation_refs: ProofObligationRef[]; // 0..32，唯一
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
};
```

等价 Refinement：

1. Validation、Execution、Sandbox Execution/Result 必须形成 HEAD 定义的同一 SQL
   闭包；Result Hash、Row Count、Schema Hash、Provenance Group 均由服务端重算。
2. 每条已满足的依赖入边都要有 exact `dependency_evidence_refs`；无依赖则为空，
   Prompt 文本不能替代 Reference。
3. AtomicClaim 禁止 `support_state`、因果与行动模式，Evidence 只能是
   `QueryEvidence@2`。Authority 从 exact SandboxResult 以
   `row_key_hash + output_alias` 定位 Cell，重算 `observed_value`、Metric、Unit、时间窗、
   维度切片与 `result_cell_hash`；`evidence_refs` 等于
   `observation_bindings[].evidence_ref` 的规范去重集，Predicate 只能引用存在且实际
   使用的 Binding。
4. Relation 的 Claim 必须列出其 Evidence；`obligation_ref` 等于该 Evidence 的唯一
   Obligation 并命中 Plan。
5. `DETERMINISTIC_CHECK` 覆盖 Relation、Claim、全部 Evidence/Result、Metric 与
   Observation Contract，重算值、方向、差值、贡献/占比，并按
   `claim_renderer_version` 唯一渲染 `statement`、重算 `statement_hash`；不一致返回
   `ATOMIC_CLAIM_OBSERVATION_MISMATCH`。
   `PROVENANCE_CHECK` 还覆盖 QueryContract 与完整 Frontier。
6. SupportDecision 的 Relation 与 Claim Evidence 按 Reference Identity 严格一一
   对应，不得漏 adverse Evidence、重复或夹带；每条 Relation 恰有一张 PASS
   Deterministic Check 和一张 PASS Provenance Check。当前水位同一 exact
   `(claim_ref,evidence_ref)` 只能有一个 active Relation Identity，否则返回
   `EVIDENCE_RELATION_IDENTITY_CONFLICT`，不得只选有利边。
7. `SUPPORTED` 只能从第 6 条完整闭包派生；Context/Refute/Conflict、缺检查、仅有引用
   或 SQL 非空均不能升级。
8. Assessment 覆盖 Hypothesis 全部 Obligation；`SURVIVED` 仅表示未被冻结测试反证，
   `REFUTED` 要有权威 Refuted Decision。`TESTED/REFUTED/SURVIVED` 要求非空 Decision；
   `UNRESOLVED` 可为空，但须精确列出全部未闭合 Obligation，不能造占位 Evidence。
9. 引用与 Envelope 同 Scope/Run、全部列入 `input_refs`；Hash 由 Authority 重算。

## 2. Coverage 与预算账本

```ts
type ResearchBudgetLedgerBinding = {
  ledger_version: "research-budget-ledger@1.0.0";
  evaluated_through_reservation_seq: NonNegativeInt;
  effective_limit: ResearchBudgetLimit;
  used: ResearchBudgetUsage;
  remaining: ResearchBudgetBalance;
  top_up_allowed: boolean;
  ledger_hash: Sha256;
};

type ObligationCoverage = {
  obligation_ref: ProofObligationRef;
  materiality: "CRITICAL" | "SUPPORTING";
  state: "OPEN" | "SATISFIED" | "BLOCKED" | "FAILED" | "STALE";
  obligation_execution_decision_refs: ObligationExecutionDecisionRef[]; // 0..32
  query_evidence_refs: QueryEvidenceRef[]; // 0..32
  support_decision_refs: SupportDecisionRef[]; // 0..32
  conflict_refs: EvidenceRelationRef[]; // 0..64，只允许 CONFLICTS
  reason_codes: U6ResearchReasonCode[]; // 1..32，唯一
};

type CoverageCounts = {
  critical_total: NonNegativeInt;
  critical_open: NonNegativeInt;
  critical_satisfied: NonNegativeInt;
  critical_blocked: NonNegativeInt;
  critical_failed: NonNegativeInt;
  critical_stale: NonNegativeInt;
  supporting_total: NonNegativeInt;
  supporting_open: NonNegativeInt;
  supporting_satisfied: NonNegativeInt;
  supporting_blocked: NonNegativeInt;
  supporting_failed: NonNegativeInt;
  supporting_stale: NonNegativeInt;
};

type CoverageStatePayload = {
  artifact_type: "CoverageState";
  protocol_version: "coverage-state@1.0.0";
  evidence_plan_ref: EvidencePlanRef;
  obligation_execution_decision_refs: ObligationExecutionDecisionRef[]; // 0..32
  query_evidence_refs: QueryEvidenceRef[]; // 0..32
  atomic_claim_refs: AtomicClaimRef[]; // 0..32
  evidence_relation_refs: EvidenceRelationRef[]; // 0..64
  support_decision_refs: SupportDecisionRef[]; // 0..32
  hypothesis_assessment_refs: HypothesisAssessmentRef[]; // 2..8
  obligations: ObligationCoverage[]; // 1..32，按 Plan 顺序
  derived_counts: CoverageCounts;
  material_conflict_refs: EvidenceRelationRef[]; // 0..64，只允许 CONFLICTS
  budget_ledger: ResearchBudgetLedgerBinding;
  version_frontier: VersionFrontier;
  version_frontier_hash: Sha256;
  coverage_input_hash: Sha256;
};
```

等价 Refinement：

- `effective_limit=min(RESEARCH_RUNTIME_LIMITS@1,Tenant Policy,ResearchBrief)`；
  六个预算维度各满足 `used + remaining === effective_limit`，Provider Token 等于
  Input+Output，`source_calls===0`；Ledger Hash 覆盖序号和全部数值。
- `obligations` 与 exact Plan 一一对应；状态只按
  `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 派生。`SATISFIED` 要求 OED PASS、
  成功执行、current Evidence、Observation 命中、已提交 Support/Assessment 且无未决 Conflict。
- Authority 按 Plan、Run、`evaluated_through_reservation_seq` 从 Store 枚举全部
  current OED/QueryEvidence/AtomicClaim/EvidenceRelation，不接受 Candidate 挑选；
  每张 QueryEvidence 至少进入一项 Claim，且满足第 1 节闭包。
- 外层 OED/QueryEvidence/Claim/Relation/Support 数组等于各 Obligation 与
  SupportDecision 递归闭包的规范去重并集；不得隐藏失败或 adverse 输入。
- `material_conflict_refs` 等于完整 Relation 闭包中的未决 Conflict；
  `derived_counts` 由 Obligation 重算，五态之和等于各 Materiality total。
- 五维 Frontier（含 `schema_snapshot_ref`）、Frontier Hash 与 Coverage Input Hash
  全由 Authority 重算。

## 3. Research Stop 判别联合

```ts
type CandidateQueryAssessment = {
  query_contract_ref: QueryContractRef;
  obligation_refs: ProofObligationRef[]; // 1..32，唯一
  admissibility:
    | "EXECUTABLE_NOW"
    | "WAITING_EXTERNAL_CAPABILITY"
    | "BUDGET_BLOCKED"
    | "INADMISSIBLE";
  expected_information_gain_microunits: NonNegativeInt; // 0..1_000_000
  required_budget: ResearchBudgetDemand;
  waiting_on_codes: Identifier[]; // 0..32，唯一
  reason_codes: U6ResearchReasonCode[]; // 1..32，唯一
  assessment_hash: Sha256;
};

type SupportedSubsetBinding = {
  claim_refs: AtomicClaimRef[]; // 0..32，唯一
  support_decision_refs: SupportDecisionRef[]; // 0..32，唯一
  required_disclosures: Identifier[]; // 0..32，唯一
  subset_hash: Sha256;
};

type ResearchStopCommon = {
  artifact_type: "ResearchStopDecision";
  protocol_version: "research-stop@1.0.0";
  coverage_ref: CoverageStateRef;
  budget_ledger: ResearchBudgetLedgerBinding;
  candidate_queries: CandidateQueryAssessment[]; // 0..32，QueryContract 唯一
  candidate_set: {
    enumerator_version: Version;
    unresolved_obligation_refs: ProofObligationRef[]; // 0..32，Coverage OPEN/BLOCKED/FAILED
    no_candidate_obligation_refs: ProofObligationRef[]; // 0..32，前者子集
    candidate_set_hash: Sha256;
  };
  supported_subset: SupportedSubsetBinding;
  reason_codes: U6ResearchReasonCode[]; // 1..32，唯一
  eig_policy_version: Version;
  decision_input_hash: Sha256;
};

type ResearchStopDecisionPayload =
  | (ResearchStopCommon & {
      decision: "CONTINUE";
      selected_next_query_ref: QueryContractRef;
    })
  | (ResearchStopCommon & {
      decision: "REPLAN";
      replan_obligation_refs: ProofObligationRef[]; // 1..32
      replan_assessment: {
        trigger: "PLAN_INVALIDATED" | "QUERY_COMPILATION_GAP";
        executable_with_remaining_budget: true;
        assessment_hash: Sha256;
      };
    })
  | (ResearchStopCommon & {
      decision: "STOP_READY";
    })
  | (ResearchStopCommon & {
      decision: "STOP_PARTIAL";
      non_ready_terminal: "PARTIAL";
      partial_disclosure_codes: Identifier[]; // 1..32
    })
  | (ResearchStopCommon & {
      decision: "STOP_NEEDS_MORE_RESEARCH";
      non_ready_terminal: "NEEDS_MORE_RESEARCH";
      resume_requirement_codes: Identifier[]; // 1..32
    })
  | (ResearchStopCommon & {
      decision: "STOP_INCONCLUSIVE";
      non_ready_terminal: "INCONCLUSIVE";
      inadmissibility_summary_hash: Sha256;
    });
```

每个联合分支必须是单独的 `z.strictObject`。因此 `STOP_READY` 携带
`non_ready_terminal`、`STOP_PARTIAL` 缺少固定 terminal、或 `CONTINUE` 缺少选择项均在
Schema 层失败，而不是留给调用者解释。

跨字段 Refinement：

1. `budget_ledger` 必须逐字等于 `coverage_ref` 中的 Ledger Binding，并由当前数据库账本
   按相同 reservation seq 重算；
2. `CandidateQueryAssessment` Hash 覆盖 Query、Obligation、Admissibility、EIG、
   Required Budget、Waiting 与 Reason；同一 Query 只能出现一次；
3. `EXECUTABLE_NOW` 要求 EIG `>0`、`waiting_on_codes=[]` 且 Required Budget 不超过
   Remaining；`WAITING_EXTERNAL_CAPABILITY` 要求非空 Waiting；
   `BUDGET_BLOCKED` 要求语义 admissible 但 Required Budget 超过 Remaining；
   `INADMISSIBLE` 不得被选中；
4. Stop 前要求 Frontier exact current 且 Coverage 无 `STALE`；否则
   `RESEARCH_STOP_INPUT_STALE`，不创建 StopDecision/Public Terminal。通过后
   `candidate_set.unresolved_obligation_refs` 必须严格等于 Coverage 中
   `OPEN|BLOCKED|FAILED` 的集合；`no_candidate_obligation_refs` 是其子集（可为空或
   等于全集），表示 Enumerator 已证明不存在可形成 QueryContract 的 Candidate。其
   补集必须严格等于至少被一项 Candidate Assessment 覆盖的 Obligation 集。Enumerator 按冻结版本穷举
   admissible Query/等待/预算/inadmissible 结论并重算 Set Hash，不能通过把失败态或
   等待态排除、或省略 Candidate 改变 Stop 分支；
5. `ready_predicate` 由“全部 critical Obligation `SATISFIED` 且无 material conflict”
   重算；命中时唯一合法分支是 `STOP_READY`。Supporting Query 不阻断 READY，所有后续
   分支都显式要求 `ready_predicate===false`；
6. `CONTINUE` 要求 ready=false，且只能选择唯一最高 EIG 的 `EXECUTABLE_NOW` Query；
   稳定 Tie-break 使用 Query Reference Identity；
7. `REPLAN` 要求 ready=false，且没有
   `EXECUTABLE_NOW/WAITING_EXTERNAL_CAPABILITY/BUDGET_BLOCKED`
   Candidate，至少一个 unresolved Obligation，且确定性 Replanner 证明当前 Plan 已失效或存在
   Query Compilation Gap，并可在 Remaining Budget 内生成新 Plan。没有这张
   `replan_assessment` 不得用 REPLAN 代替 NEEDS_MORE 或 INCONCLUSIVE；
8. `STOP_NEEDS_MORE_RESEARCH` 要求 ready=false、没有 `EXECUTABLE_NOW`、没有可执行
   Replan，并存在
   `WAITING_EXTERNAL_CAPABILITY`，或存在 `BUDGET_BLOCKED` 且
   `top_up_allowed===true`；Resume Requirement 必须精确覆盖等待条件；
9. `supported_subset` 必须严格等于当前 Coverage 闭包中全部 current
   `SUPPORTED` Decision 及其 Claim 的一一映射，不接受调用方挑选。`STOP_PARTIAL`
   要求 ready=false、没有 EXECUTABLE/WAITING/可执行 Replan、至少一个未满足 critical
   Obligation、`top_up_allowed===false`、所有剩余 admissible path 都是
   `BUDGET_BLOCKED`，且 Supported Subset 非空并具有披露；它不是兜底分支；
10. `STOP_INCONCLUSIVE` 要求 ready=false、没有任何非 `INADMISSIBLE` Candidate、
    没有可执行 Replan、继续增加相同预算也不改变可判定性，且第 9 条
    `STOP_PARTIAL` 谓词为 false；
11. 无法唯一命中一个分支时返回 `RESEARCH_STOP_INPUT_INCONSISTENT`；
12. `decision_input_hash` 覆盖 exact Coverage、Ledger、完整 Candidate Set、
    全部 Candidate Assessment、
    Supported Subset、EIG Policy、Decision 与分支字段。

U6 Mutation 若预期 `PARTIAL`，Fixture 必须显式冻结第 9 条全部输入；仅“查询失败”、
“引用不足”或“SQL 答错问题”本身不能跳过 CONTINUE/REPLAN/NEEDS_MORE/INCONCLUSIVE
判定。

## 4. Report、Material Claim 与 Projection

```ts
type ReportSectionId =
  | "EXECUTIVE_SUMMARY"
  | "SUPPORTED_FINDINGS"
  | "REFUTED_HYPOTHESES"
  | "CONFLICTS"
  | "LIMITATIONS"
  | "METHOD";

type ReportManifestSection = {
  section_id: ReportSectionId;
  claim_refs: AtomicClaimRef[]; // 0..32，唯一
  hypothesis_assessment_refs: HypothesisAssessmentRef[]; // 0..8，唯一
  conflict_refs: EvidenceRelationRef[]; // 0..64，只允许 CONFLICTS
  limitation_codes: Identifier[]; // 0..32，唯一
};

type ReportManifestV2Payload = {
  artifact_type: "ReportManifest";
  protocol_version: "report-manifest@2.0.0";
  brief_ref: ResearchBriefRef;
  stop_decision_ref: ResearchStopDecisionRef;
  sections: ReportManifestSection[]; // 1..6，section_id 唯一
  material_claim_refs: AtomicClaimRef[]; // 0..32，唯一、由章节确定性派生
  required_disclosures: Identifier[]; // 1..32，唯一
  allowed_style_profile: "ZH_L2_RESEARCH_V1";
  manifest_hash: Sha256;
};

type AnalysisReportV2Payload = {
  artifact_type: "AnalysisReport";
  protocol_version: "analysis-report@2.0.0";
  manifest_ref: ReportManifestRef;
  title_template_id: "ZH_L2_RESEARCH_TITLE_V1";
  title: NonEmptyText; // 由模板从 exact Brief 研究问题唯一渲染，不接受 Writer 自由文本
  title_hash: Sha256;
  sections: Array<{
    section_id: ReportSectionId;
    statement_units: NonEmptyText[]; // 每节 0..128
  }>; // 与 Manifest 章节一一对应
  disclosures: Identifier[]; // 1..32，唯一
  projection_hash: Sha256;
};

type ReportProjectionReceiptPayload = {
  artifact_type: "ReportProjectionReceipt";
  protocol_version: "report-projection@1.0.0";
  manifest_ref: ReportManifestRef;
  report_ref: AnalysisReportRef;
  manifest_hash: Sha256;
  claim_closure_hash: Sha256;
  title_hash: Sha256;
  rendered_statement_hashes: Sha256[]; // 1..128，顺序等于报告投影顺序
  projection_hash: Sha256;
  projector_version: Version;
  forbidden_claim_mode_scan: "PASS" | "FAIL";
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
};
```

Material Claim 的唯一规则为：

- `material_claim_refs` 必须严格等于
  `EXECUTIVE_SUMMARY` 与 `SUPPORTED_FINDINGS` 两节 `claim_refs` 的规范去重并集；
- 两节必须各存在一次；同一 Claim 可以在两节重复引用，但集合只保留一次；
- 其他章节不能偷偷承载新的结论 Claim；`REFUTED_HYPOTHESES` 使用 Assessment，
  `CONFLICTS` 使用 Conflict Relation，因此这四节的 `claim_refs` 必须为空；
- `material_claim_refs` 允许为空，但此时 `REFUTED_HYPOTHESES` 必须包含至少一张
  current `REFUTED` Assessment，且必须精确覆盖当前闭包的全部反证 Assessment；
  完全没有受支持 Claim、也没有非空反证闭包的“空报告”失败关闭；
- 每个 Material Claim 必须属于 StopDecision 的 `supported_subset.claim_refs`；
- 每个 Material Claim 必须存在唯一、current、`SUPPORTED` 的
  `SupportDecision`；Materiality 不接受 Agent 自报。

Manifest 必须绑定 `STOP_READY`。Required Disclosures 至少包含 Brief 要求项、
`L2_NON_CAUSAL` 与 `BOUNDED_HYPOTHESIS_UNIVERSE`，单一来源模式还必须包含
`SINGLE_AUTHORITY_SOURCE`。Projector 必须逐节、逐 Statement 从 Manifest 闭包生成；
总 Statement Unit 不超过 128。Title 只能由
`ZH_L2_RESEARCH_TITLE_V1(exact ResearchBrief)` 唯一渲染，Receipt 必须重算并绑定
`title_hash`；`forbidden_claim_mode_scan` 同时扫描 Title 与全部 Statement。Title 或
正文新增数字、实体、比较方向、因果词或行动建议固定
`REPORT_PROJECTION_AUTHORITY_INVALID`。

全反驳并不等于“没有研究结论”。当 `STOP_READY.supported_subset` 的 Claim 与
SupportDecision 均为空时，报告只能沿
`REFUTED HypothesisAssessment -> REFUTED SupportDecision -> AtomicClaim ->
REFUTES EvidenceRelation -> PASS EvidenceCheckReceipt -> QueryEvidence`
形成非空、精确、可重放的反证链；Projector 只能把该链投影到
`REFUTED_HYPOTHESES`，不能伪造受支持的 Material Claim。

## 5. Gate、Certificate 与撤权

```ts
type EvidenceGateInputRef =
  | ResearchBriefRef
  | EvidencePlanRef
  | QueryContractRef
  | ObligationExecutionDecisionRef
  | QueryEvidenceRef
  | AtomicClaimRef
  | EvidenceRelationRef
  | EvidenceCheckReceiptRef
  | SupportDecisionRef
  | HypothesisAssessmentRef
  | CoverageStateRef
  | ResearchStopDecisionRef
  | ReportManifestRef
  | AnalysisReportRef
  | ReportProjectionReceiptRef
  | SemanticReleaseRef
  | SchemaSnapshotRef
  | PolicyReceiptRef
  | SandboxExecutionReceiptRef;

type EvidenceGateReceiptPayload = {
  artifact_type: "EvidenceGateReceipt";
  protocol_version: "evidence-gate@1.0.0";
  gate: "SUPPORT" | "CONFLICT" | "FRESHNESS" | "SOURCE_INDEPENDENCE";
  verdict: "PASS" | "FAIL";
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
  evaluated_refs: EvidenceGateInputRef[]; // 1..256，唯一
  evaluator_version: Version;
  gate_input_hash: Sha256;
};

type ReportReadyCertificateV3Payload = {
  artifact_type: "ReportReadyCertificate";
  protocol_version: "report-ready@3.0.0";
  stop_decision_ref: ResearchStopDecisionRef;
  report_manifest_ref: ReportManifestRef;
  analysis_report_ref: AnalysisReportRef;
  projection_receipt_ref: ReportProjectionReceiptRef;
  gate_receipt_refs: {
    support: EvidenceGateReceiptRef;
    conflict: EvidenceGateReceiptRef;
    freshness: EvidenceGateReceiptRef;
    source_independence: EvidenceGateReceiptRef;
  };
  material_support_decision_refs: SupportDecisionRef[]; // 0..32，唯一且精确相等
  version_frontier: VersionFrontier;
  input_closure_hash: Sha256;
  certificate_semantic_hash: Sha256;
  evaluated_through_input_event_seq: NonNegativeInt;
};

type ReadinessRevocationReason =
  | "SEMANTIC_REVISION_CHANGED"
  | "SCHEMA_REVISION_CHANGED"
  | "DATA_SNAPSHOT_STALE"
  | "POLICY_CHANGED"
  | "IDENTITY_AUTHORITY_CHANGED"
  | "EVIDENCE_REVOKED"
  | "CERTIFICATE_TAMPERED";

type ReadinessRevocationReceiptPayload = {
  artifact_type: "ReadinessRevocationReceipt";
  protocol_version: "readiness-revocation@1.0.0";
  certificate_ref: ReportReadyCertificateRef;
  observed_frontier: VersionFrontier;
  reason: ReadinessRevocationReason;
  trigger: "FRONTIER_ADVANCE" | "SERVICE_REQUEST";
  source_operation_id: ImmutableId;
  observed_frontier_event_seq: NonNegativeInt;
  revocation_semantic_hash: Sha256;
};
```

Gate-specific Refinement：

- `SUPPORT` 必须覆盖 Manifest 的全部 `material_claim_refs`、对应 Relation/Check 和唯一
  `SUPPORTED` Decision；全反驳报告则必须覆盖 Manifest 的全部
  `REFUTED` Assessment 及其精确 Support/Claim/Relation/Check/QueryEvidence 闭包；
- `CONFLICT` 必须覆盖全部 Relation、Conflict 与披露；
- `FRESHNESS` 必须覆盖 Brief、QueryEvidence observed frontier、当前 Semantic、
  **Schema**、Data、Policy、Identity Frontier；
- `SOURCE_INDEPENDENCE` 必须覆盖全部 material QueryEvidence provenance group、
  Brief policy 与限制披露；material QueryEvidence 同时包含受支持链与全反驳链的
  Evidence。

Certificate Authority 必须：

1. 要求 `stop_decision_ref.decision==="STOP_READY"`；
2. 要求 Manifest、Report 与 Projection Receipt 互相逐字绑定；
3. 四个 Gate Ref 各自解析为对应 Gate 的唯一 PASS Receipt；
4. 从 Manifest 的 `material_claim_refs` 重算唯一 SupportDecision 集合，并要求
   `material_support_decision_refs` 与该集合按 Reference Identity **严格相等**，不能是
   子集或超集；当两者均为空时，必须另外证明 Manifest 非空
   `REFUTED_HYPOTHESES` 与当前全部 `REFUTED` Assessment/Support/Relation/Check/
   QueryEvidence 的 exact closure，不能以空集合真值签发；
5. 重算五维 Version Frontier、四个 Gate Input Hash、Closure Hash、Semantic Hash 与
   Event Watermark；Schema Snapshot 是正式 Frontier 维度；
6. 未注册历史/当前 tuple 混合、Hash 篡改或历史 Certificate 全部拒绝 current-ready。

当任一 Frontier 维度变化时，current-ready 立即拒绝；对应 Revocation Reason 必须与
实际变化维度一致。特别地，`schema_snapshot_ref` 变化固定使用
`SCHEMA_REVISION_CHANGED`，不能伪装成 Data 或 Semantic 变化。

## 6. 平台事务与资源调用权威指针

current-ready、Frontier、Stop Terminal、Grant、Revocation、GO 的 strict Wire、真值表、
锁序、幂等与 Port 只见 `docs/design/u6-research-platform-contract.md`；Reservation、
Invocation 与 System Record 只见
`docs/design/u6-research-resource-invocation-contract.md`，本文不复制以免形成第二条 Authority。

## 7. Provider Egress System Receipt

```ts
type AgentProjectionInputRef =
  | ResearchBriefRef
  | HypothesisSetRef
  | EvidencePlanRef
  | QueryContractRef
  | SemanticReleaseRef
  | SchemaSnapshotRef
  | PolicyReceiptRef
  | QueryEvidenceRef
  | AtomicClaimRef
  | EvidenceRelationRef
  | SupportDecisionRef
  | HypothesisAssessmentRef
  | CoverageStateRef
  | ResearchStopDecisionRef
  | ReportManifestRef;

type ModelInvocationReservationBinding = {
  reservation_id: ImmutableId;
  reservation_seq: PositiveInt;
  resource_lease_id: ImmutableId;
  invocation_id: ImmutableId;
  attempt_id: ImmutableId;
  worker_fence: PositiveInt;
  request_id: ImmutableId;
  canonical_request_digest: Sha256;
  reserved: {
    resource_kind: "MODEL";
    input_tokens: NonNegativeInt;
    output_tokens: NonNegativeInt;
    cost_microusd: NonNegativeInt;
    concurrent_slots: 1;
  };
};

type AgentDataProjectionReceipt = {
  artifact_type: "AgentDataProjectionReceipt";
  protocol_version: "agent-data-projection@1.0.0";
  scope: AppScope;
  run_id: ImmutableId;
  attempt_id: ImmutableId;
  request_id: ImmutableId;
  principal_id: PrincipalId;
  role:
    | "research-supervisor"
    | "semantic-sql"
    | "evidence"
    | "report-projector";
  model_profile_ref: ModelProfileReference;
  model_invocation: ModelInvocationReservationBinding;
  provider: ModelProvider;
  model_id: NonEmptyText; // 1..256
  input_refs: AgentProjectionInputRef[]; // 1..32，唯一
  approved_fields: NonEmptyText[]; // 1..128，唯一
  inherited_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  projected_bytes: NonNegativeInt;
  projected_tokens: NonNegativeInt;
  redaction_count: NonNegativeInt;
  small_group_suppression: "PASS" | "FAIL";
  dlp_scan: "PASS" | "FAIL";
  egress_payload_digest: HmacSha256;
  egress_policy_version: Version;
  receipt_hash: Sha256;
};
```

`model_profile_ref` 不是 Artifact Reference；它须匹配 HEAD Profile 的
`profile_id/profile_version/profile_hash`，绑定 exact、已提交、PASS 的
`ModelCertificationReceiptRef`，并经 `authorizeAvailableModelProfile` 重验。

`AgentProjectionInputRef` 故意不包含 `SandboxResultRef`、Credential、连接串、原始行或
任意 System Artifact。Role Allowlist、最高 Lineage 分类、Byte/Token 上限、小群组抑制、
DLP、Redaction、Keyed HMAC 必须全 PASS。Receipt 与最终 Request 须逐字绑定同一
`reservation_id/reservation_seq/resource_lease_id/invocation_id/attempt_id/
worker_fence/request_id/canonical_request_digest/reserved bounds`；缺 Begin、换绑或
超限返回 `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED`。

## 8. 全局 strict Refinement 与 Registry

| Artifact | Envelope `schema_version` | Payload `protocol_version` |
| --- | --- | --- |
| `ObligationExecutionDecision` | `2.0.0` | `obligation-execution@2.0.0` |
| `QueryEvidence` V2 | `2.0.0` | `query-evidence@2.0.0` |
| `AtomicClaim` V2 | `2.0.0` | `atomic-claim@2.0.0` |
| `EvidenceRelation` V2 | `2.0.0` | `evidence-relation@2.0.0` |
| `EvidenceCheckReceipt` | `1.0.0` | `evidence-check@1.0.0` |
| `SupportDecision` | `1.0.0` | `support-decision@1.0.0` |
| `HypothesisAssessment` | `1.0.0` | `hypothesis-assessment@1.0.0` |
| `CoverageState` | `1.0.0` | `coverage-state@1.0.0` |
| `ResearchStopDecision` | `1.0.0` | `research-stop@1.0.0` |
| `ReportManifest` V2 | `2.0.0` | `report-manifest@2.0.0` |
| `AnalysisReport` V2 | `2.0.0` | `analysis-report@2.0.0` |
| `ReportProjectionReceipt` | `1.0.0` | `report-projection@1.0.0` |
| `EvidenceGateReceipt` | `1.0.0` | `evidence-gate@1.0.0` |
| `ReportReadyCertificate` V3 | `3.0.0` | `report-ready@3.0.0` |
| `ReadinessRevocationReceipt` | `1.0.0` | `readiness-revocation@1.0.0` |

当前 exact tuple 分别是 `ReportManifest/2.0.0/report-manifest@2.0.0` 与
`ReportReadyCertificate/3.0.0/report-ready@3.0.0`。
`ReportManifest/1.0.0/report-manifest@1.0.0` 与
`ReportReadyCertificate/2.0.0/report-ready@2.0.0` 保留为
`HISTORICAL_READ_ONLY`：二者仍要求 material Claim/Support 集合非空，不能通过当前
Candidate Writer、current-ready 或 Release Authority。全反驳空 Supported 集合只属于
上述 V2/V3 当前 tuple，不能以旧协议版本重封。
legacy protocol-null V1 仅允许显式 `readHistoricalL2ResearchDocument`，同样不得进入
Writer、Committer、current-ready、Grant、RunTerminal 或 Release `GO`。

实现还必须统一执行：

1. 所有数字为有限、安全范围整数；Threshold 是有限数；
2. 所有数组遵守 Planning Wire 上限和唯一性；
3. 每个 `*Ref` 的 `artifact_type` 必须命中其别名目标，Scope/Run 一致、Revision 为
   exact `COMMITTED`，并出现在 Envelope `input_refs`；
4. Embedded Node 必须存在于 exact Container Revision；
5. Payload 中不允许裸 `ArtifactReference`、未知字段、historical/current tuple 混合
   或未注册元组；
6. `input_refs` 不得夹带 Payload 闭包外输入；
7. Envelope Content Hash 与领域 Semantic/Input Hash 分别按上位 Authority 合同重算；
8. `AgentDataProjectionReceipt` 进入 `research_system_artifacts`，不进入 L2 union；
9. Identity、Current Readiness、Grant 与 Revocation Operation 是事务 Value/Record，
   不伪装成 Agent Artifact；
10. 普通 Zod Parse 只产生 Candidate，Registrar、Seal、Committer 与 current-ready
    consumer 仅从 server-only 子路径导出。

public replay boundary 在 Zod/hash/replay 前预检：unique logical node `1024`
（ordinary + strict Artifact Identity，Array 只作边）、container occurrence `32768`、
total-value occurrence `262144`、Document `1MiB`、closure `16MiB`。共享 DAG 仍按展开
累计 occurrence/bytes，inert JSON 副本计不同节点；伪 Document parse 失败后回补普通
identity 与真实深度。

Authority 按 Reference Identity 去重 direct `*Ref`，总数须在上限内并与 Envelope
`input_refs` 严格相等；禁止截断。
