import { z } from "zod";
import { pythonOutputContractSchema } from "../../common/index.js";
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
  analysisPlanRefSchema,
  causalEstimateRefSchema,
  derivedAnalysisEvidenceRefSchema,
  discoveryCandidateRefSchema,
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
  "ANALYSIS_BUDGET_EXCEEDED",
  "ANALYSIS_PLAN_CYCLE",
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

const analysisPlanNodeSchema = z.strictObject({
  node_id: identifierSchema,
  skill_id: analysisSkillIdSchema,
  metric_refs: z.array(metricRefSchema).max(ANALYSIS_LIMITS.max_metrics_per_node),
  dimension_refs: uniqueIdentifierArraySchema(0, ANALYSIS_LIMITS.max_dimensions_per_node),
  time_window: halfOpenTimeWindowSchema,
  comparison_window: halfOpenTimeWindowSchema.nullable(),
  parameters: z.json(),
  execution_mode: z.enum(["FROZEN_TEMPLATE", "MODEL_GENERATED"]),
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

function validateAnalysisPlanGraph(
  nodes: readonly z.infer<typeof analysisPlanNodeSchema>[],
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
          message: "AnalysisPlan 依赖必须命中同图其他节点。",
          path: ["nodes", index, "dependency_node_ids"],
        });
      }
    }
  }
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      ctx.addIssue({ code: "custom", message: "AnalysisPlan DAG 不能成环。", path: ["nodes"] });
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

export const analysisPlanPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AnalysisPlan"),
    protocol_version: z.literal("analysis-plan@1.0.0"),
    brief_ref: researchBriefRefSchema,
    analysis_context_hash: contentHashSchema,
    nodes: z.array(analysisPlanNodeSchema).min(1).max(ANALYSIS_LIMITS.max_plan_nodes),
    budget: z.strictObject({
      max_steps: positiveIntSchema.max(64),
      max_sql_executions: nonNegativeIntSchema.max(16),
      max_sandbox_executions: nonNegativeIntSchema.max(16),
      max_series_rows: positiveIntSchema.max(ANALYSIS_LIMITS.max_series_points),
      max_group_rows: positiveIntSchema.max(ANALYSIS_LIMITS.max_groups),
      max_elapsed_ms: positiveIntSchema.max(600_000),
    }),
    planner_kind: z.enum(["DETERMINISTIC_DEFAULT", "MODEL_CANDIDATE_HOST_VERIFIED"]),
    planner_version: versionIdentifierSchema,
    plan_hash: contentHashSchema,
  })
  .superRefine((plan, ctx) => {
    addUniqueIssues(plan.nodes, ({ node_id }) => node_id, ctx, ["nodes"], "node_id 必须唯一。");
    validateAnalysisPlanGraph(plan.nodes, ctx);
    for (const [index, node] of plan.nodes.entries()) {
      if (node.execution_mode === "MODEL_GENERATED" && node.output_contract === null) {
        ctx.addIssue({
          code: "custom",
          message: "MODEL_GENERATED 节点必须声明 Output Contract。",
          path: ["nodes", index, "output_contract"],
        });
      }
    }
  });

export const analysisSandboxProgramPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("SandboxProgram"),
    protocol_version: z.literal("analysis-sandbox-program@1.0.0"),
    plan_ref: analysisPlanRefSchema,
    node_id: identifierSchema,
    language: z.literal("PYTHON_3_12"),
    entrypoint: z.literal("main"),
    source_sha256: contentHashSchema,
    source_text_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
    input_refs: uniqueReferences(artifactReferenceSchema, 1, 64),
    output_contract: pythonOutputContractSchema,
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
    plan_ref: analysisPlanRefSchema,
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
    plan_ref: analysisPlanRefSchema,
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
        !claim.disclosures.includes("CAUSAL_ESTIMATE_ASSUMPTION_BOUND"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CAUSAL_ESTIMATE 必须仅消费 CausalEstimate 并披露假设边界。",
        path: ["observation_bindings"],
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
export type AnalysisPlanPayload = z.infer<typeof analysisPlanPayloadSchema>;
export type AnalysisSandboxProgramPayload = z.infer<typeof analysisSandboxProgramPayloadSchema>;
export type DerivedAnalysisEvidencePayload = z.infer<typeof derivedAnalysisEvidencePayloadSchema>;
export type AnalysisCompletionReceiptPayload = z.infer<
  typeof analysisCompletionReceiptPayloadSchema
>;
export type AtomicClaimV3Payload = z.infer<typeof atomicClaimV3PayloadSchema>;
export type EvidenceRelationV3Payload = z.infer<typeof evidenceRelationV3PayloadSchema>;
