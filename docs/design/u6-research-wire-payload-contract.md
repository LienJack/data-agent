# U6 L2 Research Proof、Stop 与 Readiness Wire Payload 契约

> 状态：`FROZEN_DESIGN_CONTRACT`
> 上位合同：`docs/design/u6-research-authority-contract.md`
> Planning Wire：`docs/design/u6-research-planning-payload-contract.md`
> 实现状态：`NOT_IMPLEMENTED`

本文冻结 Obligation Execution 到 Provider Egress 的 strict Payload/Refinement。
Primitive、Typed Ref、共同 Value 与 Planning Artifact 均由 Planning Wire 定义；
依赖方向仅为“本文 → Planning Wire”。

所有对象使用 `z.strictObject`，判别联合由 strict Object 分支组成；禁止宽 Parse 后
Type Assertion。`*Ref` 均为 Planning Wire 的固定目标别名。

## 1. Proof 与 Evidence Payload

```ts
type ObligationSemanticCheck =
  | "metric"
  | "metric_formula"
  | "time_window"
  | "timezone"
  | "grain"
  | "dimensions"
  | "grouping"
  | "joins"
  | "canonical_predicates"
  | "cohort"
  | "null_semantics"
  | "authorization_scope";

type ObligationExecutionDecisionPayload = {
  artifact_type: "ObligationExecutionDecision";
  protocol_version: "obligation-execution@1.0.0";
  brief_ref: ResearchBriefRef;
  obligation_ref: ProofObligationRef;
  query_contract_ref: QueryContractRef;
  semantic_release_ref: SemanticReleaseRef;
  policy_receipt_ref: PolicyReceiptRef;
  observation_contract_hash: Sha256;
  verdict: "PASS" | "FAIL";
  checks: Record<ObligationSemanticCheck, "MATCH" | "MISMATCH">;
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
  evaluator_version: Version;
  decision_semantic_hash: Sha256;
};

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

1. OED 必须解析 exact Brief、Obligation、QueryContract、Semantic Release 和 Policy；
   12 个检查键必须完整且无额外键。`PASS` 要求全部 `MATCH` 且 Reason Code 为空；
   任一 `MISMATCH` 固定 `FAIL/OBLIGATION_QUERY_SEMANTICS_MISMATCH`；
2. `observation_contract_hash` 必须等于 Obligation 内重算值；OED Hash 覆盖完整检查输入、
   Evaluator Version、Verdict 和 Reason Code；
3. QueryEvidence 只接受 OED `PASS`，且 OED 的唯一 Obligation、QueryContract、
   Semantic、Policy 必须逐字匹配当前 Payload；一个 Query 同时服务多个 Obligation 时，
   必须基于同一 Execution 分别提交一张 OED 和一张 QueryEvidence，不能用 A 的 PASS
   为 B 背书；
4. Validation、Execution、Sandbox Execution 与 Sandbox Result 必须形成 HEAD 已定义的
   同一 SQL 执行闭包；Result Hash、Row Count、Schema Hash 与 Provenance Group 均由
   服务端重算；
5. 依赖 Obligation 的每条已满足入边都必须在 `dependency_evidence_refs` 中有 exact
   QueryEvidence；无依赖时数组必须为空，Prompt 文本不能替代 Reference；
6. AtomicClaim 不得出现 `support_state`、因果或行动模式；Evidence 必须全部为
   `QueryEvidence@2`。Authority 必须从每张 QueryEvidence 解析 exact SandboxResult，
   用 `row_key_hash + output_alias` 唯一定位 Cell，重算 `observed_value`、Metric、
   Unit、时间窗、维度切片与 `result_cell_hash`。`evidence_refs` 必须严格等于
   `observation_bindings[].evidence_ref` 的规范去重集合；Predicate 引用的 Binding ID
   必须存在且不得夹带未使用 Binding；
7. Relation 的 Claim 必须列出其 `evidence_ref`，且 `obligation_ref` 必须逐字等于
   该 QueryEvidence 的唯一 Obligation 并命中对应 Plan；
8. `DETERMINISTIC_CHECK` 必须评估 Relation、Claim、Claim 的全部 QueryEvidence/
   SandboxResult、Metric 与 Observation Contract，重新计算描述值、比较方向、差值、
   贡献合计或占比，并使用 `claim_renderer_version` 唯一渲染 `statement` 后重算
   `statement_hash`；Claim 中任一数字、单位、方向或文本与 Predicate 不一致固定
   `ATOMIC_CLAIM_OBSERVATION_MISMATCH`。`PROVENANCE_CHECK` 还必须评估 QueryContract
   和完整 Version Frontier；
9. SupportDecision 的 `relation_refs` 必须与 Claim 的 `evidence_refs` 按 Evidence
   Reference Identity **严格一一对应**：每个 Evidence 恰有一条同 Claim Relation，
   不得遗漏 adverse Evidence、重复或夹带其他 Claim。`check_receipt_refs` 必须对每条
   Relation 恰有一张 PASS `DETERMINISTIC_CHECK` 和一张 PASS
   `PROVENANCE_CHECK`，不得漏项或用其他 Relation 的 Receipt 替代；
   Research Committer 还必须保证同一 exact `(claim_ref,evidence_ref)` 在当前水位只有
   一个 active Relation Identity；第二个不同 Relation ID 或同 Revision 的相反边固定
   `EVIDENCE_RELATION_IDENTITY_CONFLICT`，不能只把有利边选入 SupportDecision；
10. `SUPPORTED` 必须基于第 9 条完整闭包派生；`CONTEXT_ONLY`、`REFUTES`、
    `CONFLICTS`、缺检查、引用存在或 SQL 非空都不能被省略后升级为 `SUPPORTED`；
11. Hypothesis Assessment 必须覆盖该 Hypothesis 的全部 Obligation；`SURVIVED` 仅表示
    冻结测试未反证，`REFUTED` 必须有权威 `REFUTED` Decision。`TESTED/REFUTED/
    SURVIVED` 要求非空 SupportDecision；`UNRESOLVED` 可以为空，但必须把全部未闭合
    Obligation 精确列入 `unresolved_obligation_refs`，不能伪造占位 Evidence；
12. 所有引用必须与 Envelope 同 Scope/Run，并全部出现在 Envelope `input_refs`；Hash
    由 Authority 重算。

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

- `effective_limit` 等于
  `min(RESEARCH_RUNTIME_LIMITS@1,Tenant Policy,ResearchBrief)`；
  steps/model/sql/elapsed/provider-token/provider-cost 六个维度分别满足
  `used + remaining === effective_limit`，其中
  `used.provider_tokens === used.provider_input_tokens + used.provider_output_tokens`；
  `source_calls===0`，Ledger Hash 覆盖序号和全部数值；
- `obligations` 与 exact Plan 中的 Obligation 一一对应，不得缺失、重复或增加；
- 每项状态只按 `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 派生。`SATISFIED`
  要求 OED PASS、成功执行、current QueryEvidence、Observation 命中、Support 与
  Assessment 已提交且无未处理 Conflict；
- Authority 必须按 Plan、Run 与 `evaluated_through_reservation_seq` 从权威 Store 枚举
  全部 current OED/QueryEvidence/AtomicClaim/EvidenceRelation，而不是接受 Candidate
  挑选。每张 QueryEvidence 必须至少进入一个 AtomicClaim；每个 Claim 的
  Relation/Check 与 Evidence 必须满足第 1 节的一一闭包；
- 外层 OED/QueryEvidence/Claim/Relation/Support Ref 数组必须严格等于各 Obligation
  与 SupportDecision 递归闭包的规范去重并集；不得在外层隐藏失败或 adverse 输入；
- `material_conflict_refs` 必须严格等于完整 Relation 闭包中仍未解决的
  `CONFLICTS` 集合，不接受调用方删减；
- `derived_counts` 从 `obligations` 重算，分别满足每个 Materiality 下五态之和等于
  total；
- Version Frontier 五维全部重算，包含 `schema_snapshot_ref`；Frontier Hash 与
  Coverage Input Hash 不信任调用方。

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

type ReportManifestPayload = {
  artifact_type: "ReportManifest";
  protocol_version: "report-manifest@1.0.0";
  brief_ref: ResearchBriefRef;
  stop_decision_ref: ResearchStopDecisionRef;
  sections: ReportManifestSection[]; // 1..6，section_id 唯一
  material_claim_refs: AtomicClaimRef[]; // 1..32，唯一、由章节确定性派生
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

type ReportReadyCertificateV2Payload = {
  artifact_type: "ReportReadyCertificate";
  protocol_version: "report-ready@2.0.0";
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
  material_support_decision_refs: SupportDecisionRef[]; // 1..32，唯一且精确相等
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
  `SUPPORTED` Decision；
- `CONFLICT` 必须覆盖全部 Relation、Conflict 与披露；
- `FRESHNESS` 必须覆盖 Brief、QueryEvidence observed frontier、当前 Semantic、
  **Schema**、Data、Policy、Identity Frontier；
- `SOURCE_INDEPENDENCE` 必须覆盖全部 QueryEvidence provenance group、Brief policy
  与限制披露。

Certificate Authority 必须：

1. 要求 `stop_decision_ref.decision==="STOP_READY"`；
2. 要求 Manifest、Report 与 Projection Receipt 互相逐字绑定；
3. 四个 Gate Ref 各自解析为对应 Gate 的唯一 PASS Receipt；
4. 从 Manifest 的 `material_claim_refs` 重算唯一 SupportDecision 集合，并要求
   `material_support_decision_refs` 与该集合按 Reference Identity **严格相等**，不能是
   子集或超集；
5. 重算五维 Version Frontier、四个 Gate Input Hash、Closure Hash、Semantic Hash 与
   Event Watermark；Schema Snapshot 是正式 Frontier 维度；
6. 未注册 V1/V2 混合、Hash 篡改或历史 V1 Certificate 全部拒绝 current-ready。

当任一 Frontier 维度变化时，current-ready 立即拒绝；对应 Revocation Reason 必须与
实际变化维度一致。特别地，`schema_snapshot_ref` 变化固定使用
`SCHEMA_REVISION_CHANGED`，不能伪装成 Data 或 Semantic 变化。

## 6. 平台事务与资源调用权威指针

current-ready、Frontier、Research Stop Terminal、Grant、Revocation、Release GO 的
strict Wire、状态真值表、锁序、幂等与数据库 Port 只由
`docs/design/u6-research-platform-contract.md` 定义；Resource Reservation、
Model/SQL/Tool Invocation 与 System Record 只由
`docs/design/u6-research-resource-invocation-contract.md` 定义。本文不得复制这些
平台 Record，避免旧字段形成第二条 Authority。

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
  worker_fence: NonNegativeInt;
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

`model_profile_ref` 不是 Artifact Reference；它必须匹配 HEAD 的 Profile
`profile_id/profile_version/profile_hash`，并绑定 exact、已提交、PASS 的
`ModelCertificationReceiptRef`。Authority 必须按现有
`authorizeAvailableModelProfile` 语义重验，不能仅凭 `profile_id` 或版本字符串放行。

`AgentProjectionInputRef` 故意不包含 `SandboxResultRef`、Credential、连接串、原始行或
其他任意 System Artifact。Role Allowlist、最高 Lineage 分类、Byte/Token 上限、小群组
抑制、DLP、Redaction 与 Keyed HMAC 必须全部 PASS 后才能提交 Receipt。
Receipt 与最终 Model Request 必须逐字绑定同一
`reservation_id/reservation_seq/resource_lease_id/invocation_id/attempt_id/
worker_fence/request_id/canonical_request_digest/reserved bounds`；缺 Begin、换绑或超出
Reserved 上限固定 `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED`。

## 8. 全局 strict Refinement 与 Registry

| Artifact | Envelope `schema_version` | Payload `protocol_version` |
| --- | --- | --- |
| `ObligationExecutionDecision` | `1.0.0` | `obligation-execution@1.0.0` |
| `QueryEvidence` V2 | `2.0.0` | `query-evidence@2.0.0` |
| `AtomicClaim` V2 | `2.0.0` | `atomic-claim@2.0.0` |
| `EvidenceRelation` V2 | `2.0.0` | `evidence-relation@2.0.0` |
| `EvidenceCheckReceipt` | `1.0.0` | `evidence-check@1.0.0` |
| `SupportDecision` | `1.0.0` | `support-decision@1.0.0` |
| `HypothesisAssessment` | `1.0.0` | `hypothesis-assessment@1.0.0` |
| `CoverageState` | `1.0.0` | `coverage-state@1.0.0` |
| `ResearchStopDecision` | `1.0.0` | `research-stop@1.0.0` |
| `ReportManifest` | `1.0.0` | `report-manifest@1.0.0` |
| `AnalysisReport` V2 | `2.0.0` | `analysis-report@2.0.0` |
| `ReportProjectionReceipt` | `1.0.0` | `report-projection@1.0.0` |
| `EvidenceGateReceipt` | `1.0.0` | `evidence-gate@1.0.0` |
| `ReportReadyCertificate` V2 | `2.0.0` | `report-ready@2.0.0` |
| `ReadinessRevocationReceipt` | `1.0.0` | `readiness-revocation@1.0.0` |

实现还必须统一执行：

1. 所有数字为有限、安全范围整数；Threshold 是有限数；
2. 所有数组遵守 Planning Wire 上限和唯一性；
3. 每个 `*Ref` 的 `artifact_type` 必须命中其别名目标，Scope/Run 一致、Revision 为
   exact `COMMITTED`，并出现在 Envelope `input_refs`；
4. Embedded Node 必须存在于 exact Container Revision；
5. Payload 中不允许裸 `ArtifactReference`、未知字段、V1/V2 混合或未注册元组；
6. `input_refs` 不得夹带 Payload 闭包外输入；
7. Envelope Content Hash 与领域 Semantic/Input Hash 分别按上位 Authority 合同重算；
8. `AgentDataProjectionReceipt` 进入 `research_system_artifacts`，不进入 L2 union；
9. Identity、Current Readiness、Grant 与 Revocation Operation 是事务 Value/Record，
   不伪装成 Agent Artifact；
10. 普通 Zod Parse 只产生 Candidate，Registrar、Seal、Committer 与 current-ready
    consumer 仅从 server-only 子路径导出。

Authority 按 Reference Identity 去重所有 direct `*Ref`，证明总数不超过全局上限，
并要求与 Envelope `input_refs` 严格相等；禁止截断。本文与 Planning Wire 必须同时
实现。
