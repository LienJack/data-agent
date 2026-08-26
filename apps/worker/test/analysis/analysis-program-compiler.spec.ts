import {
  type ArtifactReference,
  analysisResultContractMaterialSchema,
  buildAnalysisResultContract,
  researchBriefV3PayloadSchema,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import {
  analysisProgramCandidateSchema,
  compileAnalysisProgramCandidate,
} from "../../src/analysis/analysis-program-compiler.js";

const id = (suffix: number) => `94000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const window = {
  start: "2025-08-01T00:00:00.000+08:00",
  end: "2026-08-01T00:00:00.000+08:00",
  timezone: "Asia/Shanghai",
  semantics: "HALF_OPEN" as const,
};

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  };
}

async function fixture() {
  const semanticReleaseRef = reference("SemanticRelease", 10);
  const schemaSnapshotRef = reference("SchemaSnapshot", 11);
  const policyReceiptRef = reference("PolicyReceipt", 12);
  const briefRef = reference("ResearchBrief", 13);
  const metricRef = {
    container_ref: semanticReleaseRef,
    node_id: "metric.order_revenue",
  } as const;
  const context = await buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(20),
      package_hash: hash("a"),
      receipt_id: id(21),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
    semantic_retrieval_receipt_hash: hash("c"),
    semantic_inference_receipt_hash: hash("d"),
    metrics: [
      {
        metric_ref: metricRef,
        formula_hash: hash("e"),
        unit: {
          unit_id: "unit.cny",
          dimension: "currency",
          base_unit: "CNY",
          conversion_factor: 1,
        },
        grain: { grain_id: "grain.order-month", granularity: "month" },
        time_domain: {
          time_domain_id: "time.order-created-at",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: null,
          max_time: null,
        },
        time_dimension_ref: "dimension.order_month",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY",
        seasonality: null,
        priority: 100,
        causal_role: null,
        allowed_dimensions: [
          {
            dimension_id: "dimension.order_month",
            grain: { grain_id: "grain.order-month", granularity: "month" },
            data_type: "date",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: false,
            causal_role: null,
          },
        ],
        analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
  const brief = researchBriefV3PayloadSchema.parse({
    artifact_type: "ResearchBrief",
    protocol_version: "research-brief@3.0.0",
    question_frame_ref: reference("QuestionFrame", 14),
    research_mode: "EXPLORATORY_DETERMINISTIC",
    question: "复盘最近12个完整月的订单收入趋势。",
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
    primary_metric_refs: [metricRef],
    approved_dimension_refs: ["dimension.order_month"],
    requested_time_window: window,
    analysis_mode: "AUTO",
    root_cause_mode: "DISABLED",
    code_generation: "ALLOW_SANDBOXED",
    success_criteria: ["返回月度趋势和一张折线图。"],
    required_disclosures: [],
    budget: {
      max_steps: 1,
      max_model_calls: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_elapsed_ms: 120_000,
    },
    brief_hash: hash("f"),
  });
  const resultContract = await buildAnalysisResultContract(
    analysisResultContractMaterialSchema.parse({
      ...resultContractMaterial(),
      semantic_context_hash: context.semantic_context_binding.package_hash,
      limits: {
        max_result_bytes: 1_048_576,
        max_table_rows: 12,
        max_table_columns: 2,
        max_closure_bytes: 4_194_304,
      },
    }),
  );
  return {
    brief,
    brief_ref: briefRef,
    context,
    result_contract: resultContract,
    required_operator_obligations: [],
  };
}

function resultContractMaterial() {
  return {
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "monthly-revenue-trend-result",
    result_fields: [
      { field: "period", data_type: "STRING", nullable: false, semantic_role: "DIMENSION" },
      { field: "revenue", data_type: "NUMBER", nullable: false, semantic_role: "METRIC" },
      { field: "summary_zh", data_type: "STRING", nullable: false, semantic_role: "DERIVED" },
    ],
    metric_bindings: [
      {
        semantic_metric_id: "metric.order_revenue",
        field: "revenue",
        unit: "CNY",
        aggregation: "SUM",
        formula_hash: hash("e"),
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: "dimension.order_month", field: "period" }],
    grain: {
      dimension_ids: ["dimension.order_month"],
      time_dimension_id: "dimension.order_month",
      time_grain: "MONTH",
    },
    lineage: [
      {
        field: "period",
        source_semantic_object_ids: ["dimension.order_month"],
        source_physical_fields: ["orders.order_created_at"],
        transformation: "DIRECT",
      },
      {
        field: "revenue",
        source_semantic_object_ids: ["metric.order_revenue"],
        source_physical_fields: ["orders.order_total"],
        transformation: "AGGREGATION",
      },
      {
        field: "summary_zh",
        source_semantic_object_ids: ["metric.order_revenue", "dimension.order_month"],
        source_physical_fields: ["orders.order_created_at", "orders.order_total"],
        transformation: "FORMULA",
      },
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "monthly_revenue",
        title_zh: "月度订单收入",
        required: true,
        columns: [
          {
            key: "period",
            label_zh: "月份",
            data_type: "STRING",
            nullable: false,
            semantic_object_id: "dimension.order_month",
            semantic_role: "DIMENSION",
          },
          {
            key: "revenue",
            label_zh: "订单收入",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.order_revenue",
            semantic_role: "METRIC",
          },
        ],
        projection: { mode: "MODEL_DERIVED" },
        max_rows: 12,
      },
    ],
    charts: [
      {
        chart_id: "monthly_revenue_line",
        title_zh: "最近12个完整月订单收入趋势",
        required: true,
        intent: "TREND",
        table_id: "monthly_revenue",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
  } as const;
}

function candidate() {
  return {
    schema_version: "analysis-program-candidate@1.0.0",
    node_id: "monthly-revenue-trend",
    metric_ids: ["metric.order_revenue"],
    dimension_ids: ["dimension.order_month"],
    time_window: window,
    comparison_window: null,
    parameters: {
      result_schema_version: "monthly-revenue-result@1",
      claim_strength: "DESCRIPTIVE",
    },
    operator_obligations: [],
  } as const;
}

function trendObligation() {
  return {
    call_id: "trend_theil_sen",
    operator_id: "robust-trend.theil-sen-slope@1",
    input_lineage_bindings: [
      {
        lineage_kind: "SERVER_TRANSFORM_EXACT",
        operator_input_name: "series",
        governed_input_name: "query_evidence",
        transform_id: "analysis.single-series.theil-sen.v1",
      },
    ],
    result_binding: {
      result_output_name: "result",
      result_collection_path: "/theil_sen",
      operator_collection_path: "/series",
      label_fields: ["label"],
      value_bindings: [
        {
          result_field: "slope",
          operator_field: "slope",
          comparison: "EXACT",
          absolute_tolerance: 0,
          relative_tolerance: 0,
        },
      ],
      require_exact_label_set: true,
    },
  } as const;
}

describe("generic analysis program host compiler", () => {
  it("binds the actual user question and published semantic authority", async () => {
    const input = await fixture();
    const program = await compileAnalysisProgramCandidate({
      ...input,
      candidate: candidate(),
    });

    expect(program.compiler_kind).toBe("MODEL_CANDIDATE_HOST_VERIFIED");
    expect(program.analysis_context_hash).toBe(input.context.context_hash);
    expect(program.semantic_context_package_hash).toBe(
      input.context.semantic_context_binding.package_hash,
    );
    expect(program.nodes[0]?.parameters).toMatchObject({ question: input.brief.question });
    expect(program.nodes[0]).toMatchObject({
      generated_source_policy: "OPEN_ANALYSIS",
      operator_obligations: [],
      parameters: { declared_method: "open-python-analysis@1" },
    });
    expect(JSON.stringify(program)).not.toContain("acceptance_case_id");
    expect(program.nodes[0]?.metric_refs.map(({ node_id: nodeId }) => nodeId)).toEqual([
      "metric.order_revenue",
    ]);
  });

  it("rejects metrics and dimensions outside the published context", async () => {
    const input = await fixture();
    await expect(
      compileAnalysisProgramCandidate({
        ...input,
        candidate: { ...candidate(), metric_ids: ["metric.unpublished"] },
      }),
    ).rejects.toThrowError("ANALYSIS_PROGRAM_CANDIDATE_METRIC_NOT_PUBLISHED");
    await expect(
      compileAnalysisProgramCandidate({
        ...input,
        candidate: { ...candidate(), dimension_ids: ["dimension.customer_secret"] },
      }),
    ).rejects.toThrowError("ANALYSIS_PROGRAM_CANDIDATE_DIMENSION_NOT_PUBLISHED");
  });

  it("does not let the model claim a generated-source policy or governed method", () => {
    expect(() =>
      analysisProgramCandidateSchema.parse({
        ...candidate(),
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
      }),
    ).toThrow();
    expect(() =>
      analysisProgramCandidateSchema.parse({
        ...candidate(),
        parameters: { ...candidate().parameters, required_methods: ["mann-kendall@1"] },
      }),
    ).toThrow();
    expect(() =>
      analysisProgramCandidateSchema.parse({
        ...candidate(),
        result_contract: resultContractMaterial(),
      }),
    ).toThrow();
  });

  it("does not let the model downgrade a host-required governed operator", async () => {
    const input = await fixture();
    await expect(
      compileAnalysisProgramCandidate({
        ...input,
        required_operator_obligations: [trendObligation()],
        candidate: candidate(),
      }),
    ).rejects.toThrowError("ANALYSIS_PROGRAM_OPERATOR_REQUIREMENT_MISMATCH");
  });

  it("rejects a host contract outside the selected semantic authority", async () => {
    const input = await fixture();
    const mismatchedContract = await buildAnalysisResultContract(
      analysisResultContractMaterialSchema.parse({
        ...resultContractMaterial(),
        semantic_context_hash: hash("9"),
        limits: input.result_contract.limits,
      }),
    );
    await expect(
      compileAnalysisProgramCandidate({
        ...input,
        result_contract: mismatchedContract,
        candidate: candidate(),
      }),
    ).rejects.toThrowError("ANALYSIS_PROGRAM_RESULT_CONTRACT_AUTHORITY_MISMATCH");
  });
});
