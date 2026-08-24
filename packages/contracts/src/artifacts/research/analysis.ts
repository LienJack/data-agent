import { z } from "zod";
import { pythonOutputContractSchema } from "../../common/index.js";
import {
  generatedAnalysisSourcePolicySchema,
  statisticalOperatorObligationsSchema,
} from "../../generated/statistical-operators.js";
import {
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../envelope.js";
import {
  addUniqueIssues,
  contentHashSchema,
  finiteNumberSchema,
  identifierSchema,
  nonEmptyTextSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  timestampSchema,
  uniqueIdentifierArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import { claimScalarValueSchema } from "./proof.js";
import {
  analysisProgramRefSchema,
  causalEstimateRefSchema,
  causalQuestionRefSchema,
  derivedAnalysisEvidenceRefSchema,
  discoveryCandidateRefSchema,
  discoveryReceiptRefSchema,
  identificationCertificateRefSchema,
  identificationPlanRefSchema,
  metricRefSchema,
  policyReceiptRefSchema,
  queryEvidenceRefSchema,
  researchBriefRefSchema,
  sandboxExecutionReceiptRefSchema,
  sandboxProgramRefSchema,
  sandboxResultRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
} from "./references.js";

export const ANALYSIS_LIMITS = Object.freeze({
  max_plan_nodes: 64,
  max_metrics_per_node: 3,
  max_dimensions_per_node: 5,
  max_dependencies_per_node: 16,
  max_query_evidence_refs: 64,
  max_result_refs: 32,
  max_series_points: 5_000,
  max_groups: 5_000,
  max_claim_bindings: 64,
  max_disclosures: 64,
} as const);

export const ANALYSIS_SKILL_IDS = [
  "data-profile@1",
  "semantic-transform@1",
  "trend-change@1",
  "contribution-concentration@1",
  "robust-anomaly@1",
  "association-outlier-completeness@1",
  "baseline-forecast-backtest@1",
  "open-python-analysis@1",
  "root-cause-investigation@1",
  "visual-insight-story@1",
] as const;
export const analysisSkillIdSchema = z.enum(ANALYSIS_SKILL_IDS);

export const ANALYSIS_REASON_CODES = [
  "UNRESOLVED_SEMANTICS",
  "UNPUBLISHED_SEMANTIC_INPUT",
  "SEMANTIC_FRONTIER_STALE",
  "POLICY_SCOPE_BLOCKED",
  "ANALYSIS_CAPABILITY_NOT_PUBLISHED",
  "TIME_DOMAIN_NOT_PUBLISHED",
  "TIMEZONE_MISMATCH",
  "GRAIN_MISMATCH",
  "UNIT_MISMATCH",
  "NULL_POLICY_CONFLICT",
  "DIMENSION_NOT_ALLOWED",
  "SENSITIVE_DIMENSION_BLOCKED",
  "RELATIONSHIP_NOT_PUBLISHED",
  "FANOUT_NOT_CLOSED",
  "CAUSAL_POLICY_NOT_PUBLISHED",
  "CAUSAL_ROLE_INCOMPLETE",
  "ANALYSIS_BUDGET_EXCEEDED",
  "ANALYSIS_PROGRAM_CYCLE",
  "ANALYSIS_NODE_DEPENDENCY_FAILED",
  "NON_ADDITIVE_CONTRIBUTION_NOT_LOWERABLE",
  "CONCENTRATION_NOT_APPLICABLE",
  "RELATIVE_DELTA_UNDEFINED",
  "INSUFFICIENT_SAMPLE_SIZE",
  "IRREGULAR_TIME_SERIES",
  "MISSING_PERIOD_POLICY_UNRESOLVED",
  "SEASONALITY_NOT_PUBLISHED",
  "OUTLIER_SENSITIVE_ASSOCIATION",
  "FORECAST_NOT_USEFUL",
  "PROGRAM_POLICY_REJECTED",
  "PROGRAM_OUTPUT_CONTRACT_FAILED",
  "SANDBOX_EXECUTION_FAILED",
  "SANDBOX_FENCE_STALE",
  "ANALYSIS_ORACLE_FAILED",
  "PROGRAM_VERIFICATION_FAILED",
  "PROGRAM_REFERENCE_CLOSURE_FAILED",
  "PLAN_NODE_MISMATCH",
  "RECEIPT_NOT_SUCCESSFUL",
  "RECEIPT_REFERENCE_CLOSURE_FAILED",
  "RECEIPT_HARD_CONTROL_MISMATCH",
  "RECEIPT_RUNTIME_MISMATCH",
  "RECEIPT_SCOPE_MISMATCH",
  "OPERATOR_AUTHORITY_CLOSURE_FAILED",
  "RESULT_REFERENCE_CLOSURE_FAILED",
  "QUERY_REFERENCE_CLOSURE_FAILED",
  "INPUT_REFERENCE_CLOSURE_FAILED",
  "RESULT_ORACLE_FAILED",
  "DERIVATION_HASH_MISMATCH",
  "EVIDENCE_SCHEMA_INVALID",
  "DERIVATION_REPLAY_MISMATCH",
  "ROOT_CAUSE_NOT_IDENTIFIABLE",
  "CAUSAL_OVERLAP_INSUFFICIENT",
  "CAUSAL_REFUTATION_FAILED",
  "CHART_EVIDENCE_CLOSURE_FAILED",
] as const;
export const analysisReasonCodeSchema = z.enum(ANALYSIS_REASON_CODES);

export const ANALYSIS_DISCLOSURE_CODES = [
  "STATISTICAL_ASSOCIATION_NOT_CAUSATION",
  "ROOT_CAUSE_CANDIDATE_NOT_CERTIFIED",
  "BASELINE_FORECAST_NOT_COMMITMENT",
  "EXPLORATORY_SEMANTICS_NOT_GOVERNED",
  "PARTIAL_PERIOD_EXCLUDED",
  "SUPPRESSED_SENSITIVE_GROUPS",
  "CAUSAL_ESTIMATE_ASSUMPTION_BOUND",
] as const;
export const analysisDisclosureCodeSchema = z.enum(ANALYSIS_DISCLOSURE_CODES);

export const analysisRuntimeProfileSchema = z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]);

const uniqueReferences = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => artifactReferenceIdentity(value as never),
        ctx,
        [],
        "Artifact Reference 必须唯一。",
      );
    });

const halfOpenTimeWindowSchema = z
  .strictObject({
    start: timestampSchema,
    end: timestampSchema,
    timezone: z.string().min(1).max(64),
    semantics: z.literal("HALF_OPEN"),
  })
  .superRefine((window, ctx) => {
    if (Date.parse(window.start) >= Date.parse(window.end)) {
      ctx.addIssue({ code: "custom", message: "时间窗口必须满足 start < end。", path: ["end"] });
    }
  });

const dataProfileColumnSchema = z.strictObject({
  name: identifierSchema,
  physical_type: versionIdentifierSchema,
  null_count: nonNegativeIntSchema,
  distinct_estimate: nonNegativeIntSchema,
});

export const dataProfilePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("DataProfile"),
    protocol_version: z.literal("data-profile@1.0.0"),
    schema_snapshot_ref: schemaSnapshotRefSchema,
    input_artifact_refs: uniqueReferences(artifactReferenceSchema, 1, 64),
    tables: z
      .array(
        z.strictObject({
          table_ref: identifierSchema,
          row_count: nonNegativeIntSchema,
          columns: z.array(dataProfileColumnSchema).min(1).max(256),
          sample_projection_ref: artifactReferenceFor("SensitiveExecutionArtifact").nullable(),
          time_coverage: halfOpenTimeWindowSchema.nullable(),
          candidate_grain: uniqueIdentifierArraySchema(0, 32),
        }),
      )
      .min(1)
      .max(64),
    semantic_binding_status: z.enum(["PUBLISHED", "CANDIDATE", "UNRESOLVED"]),
    limitation_codes: z.array(analysisReasonCodeSchema).max(32),
    profile_hash: contentHashSchema,
  })
  .superRefine((profile, ctx) => {
    addUniqueIssues(
      profile.tables,
      ({ table_ref }) => table_ref,
      ctx,
      ["tables"],
      "DataProfile table_ref 必须唯一。",
    );
    for (const [index, table] of profile.tables.entries()) {
      addUniqueIssues(
        table.columns,
        ({ name }) => name,
        ctx,
        ["tables", index, "columns"],
        "DataProfile column name 必须唯一。",
      );
    }
    if (
      profile.semantic_binding_status !== "PUBLISHED" &&
      !profile.limitation_codes.includes("UNRESOLVED_SEMANTICS")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "未发布语义绑定必须披露 UNRESOLVED_SEMANTICS。",
        path: ["limitation_codes"],
      });
    }
  });

export const researchBriefV3PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("ResearchBrief"),
    protocol_version: z.literal("research-brief@3.0.0"),
    question_frame_ref: artifactReferenceFor("QuestionFrame"),
    research_mode: z.literal("EXPLORATORY_DETERMINISTIC"),
    question: nonEmptyTextSchema,
    semantic_release_ref: semanticReleaseRefSchema,
    schema_snapshot_ref: schemaSnapshotRefSchema,
    policy_receipt_ref: policyReceiptRefSchema,
    primary_metric_refs: z.array(metricRefSchema).min(1).max(3),
    approved_dimension_refs: uniqueIdentifierArraySchema(0, 5),
    requested_time_window: halfOpenTimeWindowSchema.nullable(),
    analysis_mode: z.enum(["AUTO", "EXPLICIT", "FOLLOW_UP"]),
    root_cause_mode: z.enum(["DISABLED", "TRY_WHEN_SUPPORTED", "REQUIRE_CERTIFIED"]),
    code_generation: z.enum(["FROZEN_ONLY", "ALLOW_SANDBOXED"]),
    success_criteria: z.array(nonEmptyTextSchema).min(1).max(32),
    required_disclosures: z
      .array(analysisDisclosureCodeSchema)
      .max(ANALYSIS_LIMITS.max_disclosures),
    budget: z.strictObject({
      max_steps: positiveIntSchema.max(64),
      max_model_calls: nonNegativeIntSchema.max(32),
      max_sql_executions: nonNegativeIntSchema.max(16),
      max_sandbox_executions: nonNegativeIntSchema.max(16),
      max_elapsed_ms: positiveIntSchema.max(600_000),
    }),
    brief_hash: contentHashSchema,
  })
  .superRefine((brief, ctx) => {
    addUniqueIssues(
      brief.primary_metric_refs,
      ({ container_ref, node_id }) => `${artifactReferenceIdentity(container_ref)}\0${node_id}`,
      ctx,
      ["primary_metric_refs"],
      "Primary Metric Reference 必须唯一。",
    );
    if (
      brief.root_cause_mode === "REQUIRE_CERTIFIED" &&
      !brief.required_disclosures.includes("CAUSAL_ESTIMATE_ASSUMPTION_BOUND")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "要求 Certified Causal 时必须披露因果假设边界。",
        path: ["required_disclosures"],
      });
    }
  });

const analysisProgramNodeSchema = z.strictObject({
  node_id: identifierSchema,
  skill_id: analysisSkillIdSchema,
  metric_refs: z.array(metricRefSchema).max(ANALYSIS_LIMITS.max_metrics_per_node),
  dimension_refs: uniqueIdentifierArraySchema(0, ANALYSIS_LIMITS.max_dimensions_per_node),
  time_window: halfOpenTimeWindowSchema,
  comparison_window: halfOpenTimeWindowSchema.nullable(),
  parameters: z.json(),
  execution_mode: z.enum(["FROZEN_TEMPLATE", "MODEL_GENERATED"]),
  generated_source_policy: generatedAnalysisSourcePolicySchema,
  operator_obligations: statisticalOperatorObligationsSchema,
  output_contract: pythonOutputContractSchema.nullable(),
  dependency_node_ids: uniqueIdentifierArraySchema(0, ANALYSIS_LIMITS.max_dependencies_per_node),
  activation_rule: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ALWAYS") }),
    z.strictObject({
      kind: z.literal("MATERIAL_CHANGE"),
      source_node_id: identifierSchema,
      policy_threshold_id: identifierSchema,
    }),
    z.strictObject({
      kind: z.literal("HISTORY_SUFFICIENT"),
      source_node_id: identifierSchema,
      minimum_points: positiveIntSchema.max(ANALYSIS_LIMITS.max_series_points),
    }),
  ]),
  criticality: z.enum(["CRITICAL", "OPTIONAL"]),
});

function validateAnalysisProgramGraph(
  nodes: readonly z.infer<typeof analysisProgramNodeSchema>[],
  ctx: z.RefinementCtx,
): void {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const activationSource =
      node.activation_rule.kind === "ALWAYS" ? null : node.activation_rule.source_node_id;
    for (const dependency of [
      ...node.dependency_node_ids,
      ...(activationSource ? [activationSource] : []),
    ]) {
      if (!byId.has(dependency) || dependency === node.node_id) {
        ctx.addIssue({
          code: "custom",
          message: "AnalysisProgram 依赖必须命中同图其他节点。",
          path: ["nodes", index, "dependency_node_ids"],
        });
      }
    }
  }
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      ctx.addIssue({ code: "custom", message: "AnalysisProgram DAG 不能成环。", path: ["nodes"] });
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    const activationSource =
      node?.activation_rule.kind === "ALWAYS" ? null : node?.activation_rule.source_node_id;
    for (const dependency of [
      ...(node?.dependency_node_ids ?? []),
      ...(activationSource ? [activationSource] : []),
    ]) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of byId.keys()) visit(nodeId);
}

export const analysisProgramPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AnalysisProgram"),
    protocol_version: z.literal("analysis-program@1.0.0"),
    brief_ref: researchBriefRefSchema,
    analysis_context_hash: contentHashSchema,
    semantic_context_package_hash: contentHashSchema,
    operator_registry_digest: contentHashSchema,
    nodes: z.array(analysisProgramNodeSchema).min(1).max(ANALYSIS_LIMITS.max_plan_nodes),
    budget: z.strictObject({
      max_steps: positiveIntSchema.max(64),
      max_sql_executions: nonNegativeIntSchema.max(16),
      max_sandbox_executions: nonNegativeIntSchema.max(16),
      max_series_rows: positiveIntSchema.max(ANALYSIS_LIMITS.max_series_points),
      max_group_rows: positiveIntSchema.max(ANALYSIS_LIMITS.max_groups),
      max_elapsed_ms: positiveIntSchema.max(600_000),
    }),
    compiler_kind: z.enum(["DETERMINISTIC_DEFAULT", "MODEL_CANDIDATE_HOST_VERIFIED"]),
    compiler_version: versionIdentifierSchema,
    program_hash: contentHashSchema,
  })
  .superRefine((program, ctx) => {
    addUniqueIssues(program.nodes, ({ node_id }) => node_id, ctx, ["nodes"], "node_id 必须唯一。");
    validateAnalysisProgramGraph(program.nodes, ctx);
    for (const [index, node] of program.nodes.entries()) {
      if (node.execution_mode === "MODEL_GENERATED" && node.output_contract === null) {
        ctx.addIssue({
          code: "custom",
          message: "MODEL_GENERATED 节点必须声明 Output Contract。",
          path: ["nodes", index, "output_contract"],
        });
      }
      if (
        node.execution_mode === "FROZEN_TEMPLATE" &&
        (node.generated_source_policy !== "NO_GENERATED_SOURCE" ||
          node.operator_obligations.length !== 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "FROZEN_TEMPLATE 节点必须明确禁止生成源码且不能声明算子义务。",
          path: ["nodes", index, "generated_source_policy"],
        });
      }
      if (
        node.execution_mode === "MODEL_GENERATED" &&
        node.generated_source_policy === "NO_GENERATED_SOURCE"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "MODEL_GENERATED 节点必须声明生成源码策略。",
          path: ["nodes", index, "generated_source_policy"],
        });
      }
      if (
        (node.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
        node.operator_obligations.length > 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "只有受治理算子编排策略可以且必须声明算子义务。",
          path: ["nodes", index, "operator_obligations"],
        });
      }
      const outputByName = new Map(
        node.output_contract?.outputs.map((output) => [output.name, output]) ?? [],
      );
      for (const [obligationIndex, obligation] of node.operator_obligations.entries()) {
        const output = outputByName.get(obligation.result_binding.result_output_name);
        if (output?.type !== "JSON") {
          ctx.addIssue({
            code: "custom",
            message: "算子结果绑定必须命中已声明的 JSON 输出。",
            path: ["nodes", index, "operator_obligations", obligationIndex, "result_binding"],
          });
        }
      }
    }
  });

export const analysisSandboxProgramPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("SandboxProgram"),
    protocol_version: z.literal("analysis-sandbox-program@2.0.0"),
    analysis_program_ref: analysisProgramRefSchema,
    node_id: identifierSchema,
    language: z.literal("PYTHON_3_12"),
    entrypoint: z.literal("main"),
    source_sha256: contentHashSchema,
    source_text_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
    query_evidence_refs: uniqueReferences(
      queryEvidenceRefSchema,
      1,
      ANALYSIS_LIMITS.max_query_evidence_refs,
    ),
    input_refs: uniqueReferences(artifactReferenceSchema, 1, 64),
    input_materialization_receipt_refs: uniqueReferences(
      artifactReferenceFor("AnalysisInputMaterializationReceipt"),
      1,
      64,
    ),
    output_contract: pythonOutputContractSchema,
    generated_source_policy: generatedAnalysisSourcePolicySchema,
    operator_registry_digest: contentHashSchema,
    operator_obligations: statisticalOperatorObligationsSchema,
    import_profile: analysisRuntimeProfileSchema,
    random_seed: nonNegativeIntSchema,
    runtime_digest: contentHashSchema,
    dependency_lock_digest: contentHashSchema,
    policy_version: versionIdentifierSchema,
    program_hash: contentHashSchema,
  })
  .superRefine((program, ctx) => {
    if (program.source_text_ref.content_hash !== program.source_sha256) {
      ctx.addIssue({
        code: "custom",
        message: "source_sha256 必须绑定 SensitiveExecutionArtifact。",
        path: ["source_sha256"],
      });
    }
    if (
      program.query_evidence_refs.length !== program.input_refs.length ||
      program.input_materialization_receipt_refs.length !== program.input_refs.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "每个 QueryEvidence 必须经一个物化回执绑定一个 Sandbox 输入。",
        path: ["input_refs"],
      });
    }
    if (
      (program.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      program.operator_obligations.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SandboxProgram 的源码策略与算子义务不闭合。",
        path: ["operator_obligations"],
      });
    }
    const outputByName = new Map(
      program.output_contract.outputs.map((output) => [output.name, output]),
    );
    for (const [index, obligation] of program.operator_obligations.entries()) {
      if (outputByName.get(obligation.result_binding.result_output_name)?.type !== "JSON") {
        ctx.addIssue({
          code: "custom",
          message: "SandboxProgram 算子结果绑定必须命中已声明的 JSON 输出。",
          path: ["operator_obligations", index, "result_binding"],
        });
      }
    }
  });

const trendResultSchema = z.strictObject({
  result_kind: z.literal("TREND_CHANGE"),
  points: z
    .array(
      z.strictObject({
        period_start: timestampSchema,
        value: finiteNumberSchema.nullable(),
        absolute_delta: finiteNumberSchema.nullable(),
        relative_delta: finiteNumberSchema.nullable(),
      }),
    )
    .max(ANALYSIS_LIMITS.max_series_points),
  first_value: finiteNumberSchema.nullable(),
  last_value: finiteNumberSchema.nullable(),
});

const contributionResultSchema = z.strictObject({
  result_kind: z.literal("CONTRIBUTION_CONCENTRATION"),
  groups: z
    .array(
      z.strictObject({
        group_key_hash: contentHashSchema,
        baseline: finiteNumberSchema,
        current: finiteNumberSchema,
        signed_delta: finiteNumberSchema,
        change_share: finiteNumberSchema.nullable(),
      }),
    )
    .max(ANALYSIS_LIMITS.max_groups),
  residual: finiteNumberSchema,
  closure_tolerance: finiteNumberSchema.nonnegative(),
  hhi: finiteNumberSchema.nullable(),
});

const anomalyResultSchema = z.strictObject({
  result_kind: z.literal("ROBUST_ANOMALY"),
  anomalies: z
    .array(
      z.strictObject({
        period_start: timestampSchema,
        observed: finiteNumberSchema,
        expected: finiteNumberSchema,
        robust_score: finiteNumberSchema,
        direction: z.enum(["HIGH", "LOW"]),
      }),
    )
    .max(ANALYSIS_LIMITS.max_series_points),
  sample_size: nonNegativeIntSchema,
});

const associationQualityResultSchema = z.strictObject({
  result_kind: z.literal("ASSOCIATION_OUTLIER_COMPLETENESS"),
  pearson_r: finiteNumberSchema.min(-1).max(1).nullable(),
  spearman_rho: finiteNumberSchema.min(-1).max(1).nullable(),
  q_value: finiteNumberSchema.min(0).max(1).nullable(),
  paired_sample_size: nonNegativeIntSchema,
  missing_pair_count: nonNegativeIntSchema,
  outlier_count: nonNegativeIntSchema,
  completeness_ratio: finiteNumberSchema.min(0).max(1),
});

const forecastResultSchema = z.strictObject({
  result_kind: z.literal("BASELINE_FORECAST_BACKTEST"),
  selected_model: versionIdentifierSchema.nullable(),
  baseline_model: versionIdentifierSchema,
  horizon: nonNegativeIntSchema,
  mae: finiteNumberSchema.nonnegative().nullable(),
  mase: finiteNumberSchema.nonnegative().nullable(),
  useful: z.boolean(),
  forecast_rows_ref: artifactReferenceSchema.nullable(),
  backtest_hash: contentHashSchema,
});

const generatedResultSchema = z.strictObject({
  result_kind: z.literal("GENERATED_ANALYSIS"),
  declared_method: versionIdentifierSchema,
  structured_output_refs: uniqueReferences(
    artifactReferenceSchema,
    1,
    ANALYSIS_LIMITS.max_result_refs,
  ),
  oracle_scope: z.enum(["FULL", "INVARIANTS_ONLY", "NONE"]),
});

const rootCauseResultSchema = z.strictObject({
  result_kind: z.literal("ROOT_CAUSE_DISCOVERY"),
  candidate_refs: uniqueReferences(discoveryCandidateRefSchema, 1, 20),
  certified_estimate_refs: uniqueReferences(causalEstimateRefSchema, 0, 5),
  unenumerated_boundary: nonEmptyTextSchema,
});

export const analysisResultSchema = z.discriminatedUnion("result_kind", [
  trendResultSchema,
  contributionResultSchema,
  anomalyResultSchema,
  associationQualityResultSchema,
  forecastResultSchema,
  generatedResultSchema,
  rootCauseResultSchema,
]);

export const derivedAnalysisEvidencePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("DerivedAnalysisEvidence"),
    protocol_version: z.literal("derived-analysis-evidence@1.0.0"),
    analysis_program_ref: analysisProgramRefSchema,
    node_id: identifierSchema,
    skill_id: analysisSkillIdSchema,
    algorithm_version: versionIdentifierSchema,
    query_evidence_refs: uniqueReferences(
      queryEvidenceRefSchema,
      1,
      ANALYSIS_LIMITS.max_query_evidence_refs,
    ),
    sandbox_program_ref: sandboxProgramRefSchema,
    sandbox_execution_receipt_ref: sandboxExecutionReceiptRefSchema,
    sandbox_result_refs: uniqueReferences(
      sandboxResultRefSchema,
      1,
      ANALYSIS_LIMITS.max_result_refs,
    ),
    runtime_digest: contentHashSchema,
    dependency_lock_digest: contentHashSchema,
    generated_source_policy: generatedAnalysisSourcePolicySchema,
    operator_registry_digest: contentHashSchema,
    operator_obligations: statisticalOperatorObligationsSchema,
    operator_receipt_closure_hash: contentHashSchema,
    parameter_hash: contentHashSchema,
    input_closure_hash: contentHashSchema,
    result: analysisResultSchema,
    quality: z.strictObject({
      oracle_verdict: z.enum(["PASS", "FAIL", "UNAVAILABLE"]),
      deterministic_replay: z.enum(["PASS", "FAIL", "NOT_APPLICABLE"]),
      sample_size: nonNegativeIntSchema,
      coverage_ratio: finiteNumberSchema.min(0).max(1),
    }),
    limitation_codes: z.array(analysisReasonCodeSchema).max(32),
    mandatory_disclosures: z.array(analysisDisclosureCodeSchema).max(32),
    derivation_hash: contentHashSchema,
  })
  .superRefine((evidence, ctx) => {
    if (
      (evidence.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      evidence.operator_obligations.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "DerivedAnalysisEvidence 的源码策略与算子义务不闭合。",
        path: ["operator_obligations"],
      });
    }
    if (
      evidence.quality.oracle_verdict !== "PASS" ||
      evidence.quality.deterministic_replay === "FAIL"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "DerivedAnalysisEvidence 只接受 Oracle PASS 且重放未失败的结果。",
        path: ["quality"],
      });
    }
    if (
      evidence.result.result_kind === "ROOT_CAUSE_DISCOVERY" &&
      !evidence.mandatory_disclosures.includes("STATISTICAL_ASSOCIATION_NOT_CAUSATION")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "根因候选证据必须携带非因果披露。",
        path: ["mandatory_disclosures"],
      });
    }
  });

export const analysisCompletionReceiptPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AnalysisCompletionReceipt"),
    protocol_version: z.literal("analysis-completion@1.0.0"),
    analysis_program_ref: analysisProgramRefSchema,
    node_results: z
      .array(
        z.strictObject({
          node_id: identifierSchema,
          criticality: z.enum(["CRITICAL", "OPTIONAL"]),
          status: z.enum(["SUCCEEDED", "SKIPPED", "FAILED", "CANCELLED"]),
          evidence_ref: derivedAnalysisEvidenceRefSchema.nullable(),
          reason_codes: z.array(analysisReasonCodeSchema).max(16),
        }),
      )
      .min(1)
      .max(ANALYSIS_LIMITS.max_plan_nodes),
    budget_usage: z.strictObject({
      steps: nonNegativeIntSchema,
      sql_executions: nonNegativeIntSchema,
      sandbox_executions: nonNegativeIntSchema,
      series_rows: nonNegativeIntSchema,
      group_rows: nonNegativeIntSchema,
      elapsed_ms: nonNegativeIntSchema,
    }),
    terminal: z.enum(["READY", "PARTIAL", "HOLD"]),
    limitation_codes: z.array(analysisReasonCodeSchema).max(32),
    completion_hash: contentHashSchema,
  })
  .superRefine((receipt, ctx) => {
    addUniqueIssues(
      receipt.node_results,
      ({ node_id }) => node_id,
      ctx,
      ["node_results"],
      "Completion node_id 必须唯一。",
    );
    addUniqueIssues(
      receipt.limitation_codes,
      (reasonCode) => reasonCode,
      ctx,
      ["limitation_codes"],
      "Completion limitation code 必须唯一。",
    );
    for (const [index, result] of receipt.node_results.entries()) {
      if ((result.status === "SUCCEEDED") !== (result.evidence_ref !== null)) {
        ctx.addIssue({
          code: "custom",
          message: "只有 SUCCEEDED 节点可以且必须引用 DerivedAnalysisEvidence。",
          path: ["node_results", index, "evidence_ref"],
        });
      }
      if (result.status === "SUCCEEDED" && result.reason_codes.length !== 0) {
        ctx.addIssue({
          code: "custom",
          message: "SUCCEEDED 节点不能携带失败 Reason Code。",
          path: ["node_results", index, "reason_codes"],
        });
      }
      if (
        result.status !== "SUCCEEDED" &&
        (result.reason_codes.length === 0 ||
          result.reason_codes.some((reasonCode) => !receipt.limitation_codes.includes(reasonCode)))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "未成功节点必须给出 Reason Code，并在 Completion limitation closure 中披露。",
          path: ["node_results", index, "reason_codes"],
        });
      }
    }
    const criticalFailure = receipt.node_results.some(
      ({ criticality, status }) => criticality === "CRITICAL" && status !== "SUCCEEDED",
    );
    const optionalFailure = receipt.node_results.some(
      ({ criticality, status }) => criticality === "OPTIONAL" && status !== "SUCCEEDED",
    );
    if (
      (criticalFailure && receipt.terminal !== "HOLD") ||
      (!criticalFailure && optionalFailure && receipt.terminal !== "PARTIAL") ||
      (!criticalFailure && !optionalFailure && receipt.terminal !== "READY")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Analysis Completion terminal 必须由 Critical/Optional 节点状态确定。",
        path: ["terminal"],
      });
    }
  });

const causalOntologyPathSchema = z
  .array(versionIdentifierSchema)
  .min(1)
  .max(64)
  .superRefine((path, ctx) => {
    if (new Set(path).size !== path.length) {
      ctx.addIssue({ code: "custom", message: "Ontology Path 不能包含环。" });
    }
  });

const causalFrontierSchema = z.strictObject({
  semantic_release_ref: semanticReleaseRefSchema,
  schema_snapshot_ref: schemaSnapshotRefSchema,
  policy_receipt_ref: policyReceiptRefSchema,
  analysis_context_hash: contentHashSchema,
  runtime_digest: contentHashSchema.nullable(),
  dependency_lock_digest: contentHashSchema.nullable(),
});

export const rootCauseDiscoveryCandidatePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("DiscoveryCandidate"),
    protocol_version: z.literal("root-cause-discovery@1.0.0"),
    analysis_program_ref: analysisProgramRefSchema,
    analysis_context_hash: contentHashSchema,
    source_evidence_refs: uniqueReferences(
      z.union([queryEvidenceRefSchema, derivedAnalysisEvidenceRefSchema]),
      1,
      64,
    ),
    outcome_metric_ref: metricRefSchema,
    candidate_kind: z.enum(["ROOT_CAUSE", "CAUSAL_GRAPH"]),
    candidates: z
      .array(
        z.strictObject({
          factor_id: versionIdentifierSchema,
          factor_kind: z.enum(["METRIC", "DIMENSION", "EVENT", "RELATIONSHIP"]),
          ontology_path: causalOntologyPathSchema,
          temporal_order: z.enum(["PRECEDES", "SAME_WINDOW", "UNKNOWN"]),
          statistical_support: z.strictObject({
            method: versionIdentifierSchema,
            effect_direction: z.enum(["POSITIVE", "NEGATIVE", "ZERO", "UNKNOWN"]),
            effect_size: finiteNumberSchema.nullable(),
            interval_low: finiteNumberSchema.nullable(),
            interval_high: finiteNumberSchema.nullable(),
            raw_p_value: finiteNumberSchema.min(0).max(1).nullable(),
            adjusted_p_value: finiteNumberSchema.min(0).max(1).nullable(),
            sample_size: nonNegativeIntSchema,
          }),
          competing_explanations: z.array(nonEmptyTextSchema).min(1).max(16),
          uncovered_boundaries: z.array(nonEmptyTextSchema).min(1).max(16),
        }),
      )
      .min(1)
      .max(64),
    evidence_level: z.literal("L4_DISCOVERY"),
    multiple_testing_policy_version: versionIdentifierSchema,
    limitation_codes: z.array(analysisReasonCodeSchema).max(32),
    candidate_hash: contentHashSchema,
  })
  .superRefine((artifact, ctx) => {
    addUniqueIssues(
      artifact.candidates,
      ({ factor_id }) => factor_id,
      ctx,
      ["candidates"],
      "Root Cause Candidate factor_id 必须唯一。",
    );
    for (const [index, candidate] of artifact.candidates.entries()) {
      const support = candidate.statistical_support;
      if (
        (support.interval_low === null) !== (support.interval_high === null) ||
        (support.interval_low !== null &&
          support.interval_high !== null &&
          support.interval_low > support.interval_high) ||
        (support.raw_p_value === null) !== (support.adjusted_p_value === null) ||
        (support.raw_p_value !== null &&
          support.adjusted_p_value !== null &&
          support.adjusted_p_value < support.raw_p_value)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Candidate interval 与 multiple-testing closure 无效。",
          path: ["candidates", index, "statistical_support"],
        });
      }
    }
  });

export const rootCauseDiscoveryReceiptPayloadSchema = z.strictObject({
  artifact_type: z.literal("DiscoveryReceipt"),
  protocol_version: z.literal("root-cause-discovery-receipt@1.0.0"),
  candidate_ref: discoveryCandidateRefSchema,
  frontier: causalFrontierSchema,
  input_closure_hash: contentHashSchema,
  novelty_verdict: z.enum(["PASS", "HOLD"]),
  multiple_testing_verdict: z.enum(["PASS", "HOLD"]),
  temporal_order_verdict: z.enum(["PASS", "HOLD"]),
  validation_verdict: z.enum(["PASS", "HOLD"]),
  reason_codes: z.array(analysisReasonCodeSchema).max(32),
  receipt_hash: contentHashSchema,
});

export const causalQuestionPayloadSchema = z.strictObject({
  artifact_type: z.literal("CausalQuestion"),
  protocol_version: z.literal("causal-question@1.0.0"),
  discovery_candidate_ref: discoveryCandidateRefSchema,
  outcome_metric_ref: metricRefSchema,
  treatment_object_id: versionIdentifierSchema,
  population: nonEmptyTextSchema,
  estimand: z.enum(["ATE", "ATT", "CATE"]),
  time_zero: timestampSchema,
  intervention_semantics_ref: versionIdentifierSchema,
  target_window: halfOpenTimeWindowSchema,
  question_hash: contentHashSchema,
});

const causalDagEdgeSchema = z.strictObject({
  source_object_id: versionIdentifierSchema,
  target_object_id: versionIdentifierSchema,
  mechanism_ref: versionIdentifierSchema,
  ontology_path: causalOntologyPathSchema,
});

export const identificationPlanPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("IdentificationPlan"),
    protocol_version: z.literal("identification-plan@1.0.0"),
    causal_question_ref: causalQuestionRefSchema,
    discovery_receipt_ref: discoveryReceiptRefSchema,
    frontier: causalFrontierSchema,
    dag_edges: z.array(causalDagEdgeSchema).min(1).max(512),
    adjustment_set_object_ids: uniqueIdentifierArraySchema(0, 64),
    excluded_mediator_ids: uniqueIdentifierArraySchema(0, 64),
    excluded_collider_ids: uniqueIdentifierArraySchema(0, 64),
    assumptions: z
      .array(
        z.enum([
          "CONSISTENCY",
          "SUTVA",
          "EXCHANGEABILITY",
          "POSITIVITY",
          "NO_POST_TREATMENT_ADJUSTMENT",
          "MISSING_AT_RANDOM",
        ]),
      )
      .min(4)
      .max(6),
    minimum_effective_sample_size: positiveIntSchema,
    minimum_overlap: finiteNumberSchema.min(0).max(1),
    estimator: z.enum(["DOWHY_LINEAR", "DOWHY_PROPENSITY", "ECONML_DML"]),
    refuters: z
      .array(
        z.enum([
          "PLACEBO_TREATMENT",
          "RANDOM_COMMON_CAUSE",
          "DATA_SUBSET",
          "BOOTSTRAP",
          "NEGATIVE_CONTROL",
          "SENSITIVITY",
        ]),
      )
      .min(4)
      .max(6),
    plan_hash: contentHashSchema,
  })
  .superRefine((plan, ctx) => {
    const adjustment = new Set(plan.adjustment_set_object_ids);
    if (
      plan.excluded_mediator_ids.some((id) => adjustment.has(id)) ||
      plan.excluded_collider_ids.some((id) => adjustment.has(id))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Adjustment Set 不能包含 Mediator 或 Collider。",
        path: ["adjustment_set_object_ids"],
      });
    }
  });

const causalRefutationSchema = z.strictObject({
  refuter: z.enum([
    "PLACEBO_TREATMENT",
    "RANDOM_COMMON_CAUSE",
    "DATA_SUBSET",
    "BOOTSTRAP",
    "NEGATIVE_CONTROL",
    "SENSITIVITY",
  ]),
  verdict: z.enum(["PASS", "FAIL"]),
  observed_statistic: finiteNumberSchema.nullable(),
  threshold: finiteNumberSchema.nullable(),
});

export const causalEstimatePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("CausalEstimate"),
    protocol_version: z.literal("causal-estimate@1.0.0"),
    causal_question_ref: causalQuestionRefSchema,
    identification_plan_ref: identificationPlanRefSchema,
    sandbox_program_ref: sandboxProgramRefSchema,
    sandbox_execution_receipt_ref: sandboxExecutionReceiptRefSchema,
    sandbox_result_refs: uniqueReferences(sandboxResultRefSchema, 1, 16),
    estimand: z.enum(["ATE", "ATT", "CATE"]),
    point_estimate: finiteNumberSchema,
    interval_low: finiteNumberSchema,
    interval_high: finiteNumberSchema,
    effective_sample_size: positiveIntSchema,
    overlap_score: finiteNumberSchema.min(0).max(1),
    maximum_standardized_mean_difference: finiteNumberSchema.min(0),
    refutations: z.array(causalRefutationSchema).min(4).max(6),
    sensitivity: z.strictObject({
      robustness_value: finiteNumberSchema.min(0),
      negative_control_passed: z.boolean(),
      unobserved_confounding_bound: finiteNumberSchema.min(0).nullable(),
    }),
    limitation_codes: z.array(analysisReasonCodeSchema).max(32),
    estimate_hash: contentHashSchema,
  })
  .superRefine((estimate, ctx) => {
    if (
      estimate.interval_low > estimate.interval_high ||
      estimate.point_estimate < estimate.interval_low ||
      estimate.point_estimate > estimate.interval_high
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Causal Estimate 必须落在有效区间内。",
        path: ["point_estimate"],
      });
    }
    addUniqueIssues(
      estimate.refutations,
      ({ refuter }) => refuter,
      ctx,
      ["refutations"],
      "Causal Refuter 必须唯一。",
    );
  });

const identificationGateSchema = z.strictObject({
  gate: z.enum([
    "SCHEMA_FRONTIER",
    "SEMANTIC_FRONTIER",
    "POLICY_FRONTIER",
    "PROGRAM_RUNTIME_LOCK",
    "DAG_ADJUSTMENT",
    "DATA_SUFFICIENCY",
    "OVERLAP_BALANCE",
    "REFUTATION",
    "SENSITIVITY",
    "ATTRIBUTION_AUTHORITY",
  ]),
  verdict: z.enum(["PASS", "HOLD"]),
  evidence_hash: contentHashSchema,
});

export const identificationCertificatePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("IdentificationCertificate"),
    protocol_version: z.literal("identification-certificate@1.0.0"),
    causal_question_ref: causalQuestionRefSchema,
    identification_plan_ref: identificationPlanRefSchema,
    causal_estimate_ref: causalEstimateRefSchema,
    discovery_receipt_ref: discoveryReceiptRefSchema,
    frontier: causalFrontierSchema,
    attribution_authority_hash: contentHashSchema,
    gates: z.array(identificationGateSchema).length(10),
    verdict: z.enum(["CERTIFIED", "HOLD"]),
    reason_codes: z.array(analysisReasonCodeSchema).max(32),
    invalidation_hashes: z.strictObject({
      semantic_release_hash: contentHashSchema,
      schema_snapshot_hash: contentHashSchema,
      policy_receipt_hash: contentHashSchema,
      program_hash: contentHashSchema,
      runtime_digest: contentHashSchema,
      dependency_lock_digest: contentHashSchema,
    }),
    certificate_hash: contentHashSchema,
  })
  .superRefine((certificate, ctx) => {
    addUniqueIssues(
      certificate.gates,
      ({ gate }) => gate,
      ctx,
      ["gates"],
      "Identification Gate 必须唯一且完整。",
    );
    const allPass = certificate.gates.every(({ verdict }) => verdict === "PASS");
    if (
      (certificate.verdict === "CERTIFIED") !== allPass ||
      (certificate.verdict === "HOLD") !== certificate.reason_codes.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Certificate verdict 必须由十道 Gate 和 Reason closure 决定。",
        path: ["verdict"],
      });
    }
  });

export const analysisClaimEvidenceRefSchema = z.union([
  queryEvidenceRefSchema,
  derivedAnalysisEvidenceRefSchema,
  discoveryCandidateRefSchema,
  causalEstimateRefSchema,
]);

const analysisClaimBindingSchema = z.strictObject({
  binding_id: identifierSchema,
  evidence_ref: analysisClaimEvidenceRefSchema,
  metric_ref: metricRefSchema.nullable(),
  output_alias: identifierSchema,
  observed_value: claimScalarValueSchema,
  result_cell_hash: contentHashSchema,
});

const analysisClaimPredicateSchema = z.discriminatedUnion("claim_mode", [
  z.strictObject({
    claim_mode: z.literal("DESCRIPTIVE"),
    binding_ids: uniqueIdentifierArraySchema(1, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("COMPARATIVE"),
    binding_ids: z.tuple([identifierSchema, identifierSchema]),
  }),
  z.strictObject({
    claim_mode: z.literal("DIAGNOSTIC"),
    binding_ids: uniqueIdentifierArraySchema(2, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("QUALITY"),
    binding_ids: uniqueIdentifierArraySchema(1, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("ASSOCIATIVE"),
    binding_ids: uniqueIdentifierArraySchema(2, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("ROOT_CAUSE_CANDIDATE"),
    binding_ids: uniqueIdentifierArraySchema(1, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("CAUSAL_ESTIMATE"),
    binding_ids: uniqueIdentifierArraySchema(1, ANALYSIS_LIMITS.max_claim_bindings),
  }),
  z.strictObject({
    claim_mode: z.literal("PREDICTIVE"),
    binding_ids: uniqueIdentifierArraySchema(1, ANALYSIS_LIMITS.max_claim_bindings),
  }),
]);

export const atomicClaimV3PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AtomicClaim"),
    protocol_version: z.literal("atomic-claim@3.0.0"),
    claim_id: identifierSchema,
    observation_bindings: z
      .array(analysisClaimBindingSchema)
      .min(1)
      .max(ANALYSIS_LIMITS.max_claim_bindings),
    predicate: analysisClaimPredicateSchema,
    statement: nonEmptyTextSchema,
    statement_hash: contentHashSchema,
    evidence_refs: uniqueReferences(
      analysisClaimEvidenceRefSchema,
      1,
      ANALYSIS_LIMITS.max_claim_bindings,
    ),
    limitations: z.array(nonEmptyTextSchema).max(32),
    disclosures: z.array(analysisDisclosureCodeSchema).max(ANALYSIS_LIMITS.max_disclosures),
    identification_certificate_ref: identificationCertificateRefSchema.nullable().default(null),
  })
  .superRefine((claim, ctx) => {
    addUniqueIssues(
      claim.observation_bindings,
      ({ binding_id }) => binding_id,
      ctx,
      ["observation_bindings"],
      "Observation Binding ID 必须唯一。",
    );
    const available = new Set(claim.observation_bindings.map(({ binding_id }) => binding_id));
    if (
      claim.predicate.binding_ids.some((bindingId) => !available.has(bindingId)) ||
      new Set(claim.predicate.binding_ids).size !== available.size
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Predicate 必须精确使用全部 Observation Binding。",
        path: ["predicate", "binding_ids"],
      });
    }
    const expectedEvidence = new Set(
      claim.observation_bindings.map(({ evidence_ref }) => artifactReferenceIdentity(evidence_ref)),
    );
    const actualEvidence = new Set(claim.evidence_refs.map(artifactReferenceIdentity));
    if (
      expectedEvidence.size !== actualEvidence.size ||
      [...expectedEvidence].some((identity) => !actualEvidence.has(identity))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "evidence_refs 必须精确等于 Observation Binding Evidence 集合。",
        path: ["evidence_refs"],
      });
    }
    const mode = claim.predicate.claim_mode;
    if (
      ["ASSOCIATIVE", "ROOT_CAUSE_CANDIDATE"].includes(mode) &&
      !claim.disclosures.includes("STATISTICAL_ASSOCIATION_NOT_CAUSATION")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Association/Root Cause Candidate 必须携带非因果披露。",
        path: ["disclosures"],
      });
    }
    if (
      mode === "ROOT_CAUSE_CANDIDATE" &&
      claim.observation_bindings.some(
        ({ evidence_ref }) => evidence_ref.artifact_type !== "DiscoveryCandidate",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ROOT_CAUSE_CANDIDATE 只能消费 DiscoveryCandidate。",
        path: ["observation_bindings"],
      });
    }
    if (
      mode === "CAUSAL_ESTIMATE" &&
      (claim.observation_bindings.some(
        ({ evidence_ref }) => evidence_ref.artifact_type !== "CausalEstimate",
      ) ||
        !claim.disclosures.includes("CAUSAL_ESTIMATE_ASSUMPTION_BOUND") ||
        claim.identification_certificate_ref === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CAUSAL_ESTIMATE 必须仅消费 CausalEstimate 并披露假设边界。",
        path: ["observation_bindings"],
      });
    }
    if (mode !== "CAUSAL_ESTIMATE" && claim.identification_certificate_ref !== null) {
      ctx.addIssue({
        code: "custom",
        message: "只有 CAUSAL_ESTIMATE Claim 可以绑定 Identification Certificate。",
        path: ["identification_certificate_ref"],
      });
    }
    if (mode === "PREDICTIVE" && !claim.disclosures.includes("BASELINE_FORECAST_NOT_COMMITMENT")) {
      ctx.addIssue({
        code: "custom",
        message: "PREDICTIVE Claim 必须披露预测不是承诺。",
        path: ["disclosures"],
      });
    }
  });

export const evidenceRelationV3PayloadSchema = z.strictObject({
  artifact_type: z.literal("EvidenceRelation"),
  protocol_version: z.literal("evidence-relation@3.0.0"),
  claim_ref: artifactReferenceFor("AtomicClaim"),
  evidence_ref: analysisClaimEvidenceRefSchema,
  proposed_relation: z.enum(["SUPPORTS", "REFUTES", "CONFLICTS", "QUALIFIES", "CONTEXT_ONLY"]),
  rationale: nonEmptyTextSchema,
  method_version: versionIdentifierSchema,
});

export type AnalysisSkillId = z.infer<typeof analysisSkillIdSchema>;
export type AnalysisReasonCode = z.infer<typeof analysisReasonCodeSchema>;
export type AnalysisDisclosureCode = z.infer<typeof analysisDisclosureCodeSchema>;
export type DataProfilePayload = z.infer<typeof dataProfilePayloadSchema>;
export type ResearchBriefV3Payload = z.infer<typeof researchBriefV3PayloadSchema>;
export type AnalysisProgramPayload = z.infer<typeof analysisProgramPayloadSchema>;
export type AnalysisSandboxProgramPayload = z.infer<typeof analysisSandboxProgramPayloadSchema>;
export type DerivedAnalysisEvidencePayload = z.infer<typeof derivedAnalysisEvidencePayloadSchema>;
export type AnalysisCompletionReceiptPayload = z.infer<
  typeof analysisCompletionReceiptPayloadSchema
>;
export type RootCauseDiscoveryCandidatePayload = z.infer<
  typeof rootCauseDiscoveryCandidatePayloadSchema
>;
export type RootCauseDiscoveryReceiptPayload = z.infer<
  typeof rootCauseDiscoveryReceiptPayloadSchema
>;
export type CausalQuestionPayload = z.infer<typeof causalQuestionPayloadSchema>;
export type IdentificationPlanPayload = z.infer<typeof identificationPlanPayloadSchema>;
export type CausalEstimatePayload = z.infer<typeof causalEstimatePayloadSchema>;
export type IdentificationCertificatePayload = z.infer<
  typeof identificationCertificatePayloadSchema
>;
export type AtomicClaimV3Payload = z.infer<typeof atomicClaimV3PayloadSchema>;
export type EvidenceRelationV3Payload = z.infer<typeof evidenceRelationV3PayloadSchema>;
