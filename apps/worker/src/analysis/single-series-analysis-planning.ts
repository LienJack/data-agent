import {
  type AnalysisResultContract,
  type ArtifactReference,
  buildAnalysisResultContract,
  type ProductTeamArtifactDocument,
  type ResearchBriefV3Payload,
  researchBriefV3PayloadSchema,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import {
  type StatisticalOperatorObligation,
  statisticalOperatorObligationsSchema,
} from "@data-agent/contracts/statistical-operators";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";
import { STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS } from "./statistical-operator-server-transforms.js";

type QueryEvidenceReference = ArtifactReference & { readonly artifact_type: "QueryEvidence" };

export interface SingleSeriesAnalysisPlan {
  readonly brief: ResearchBriefV3Payload;
  readonly result_contract: AnalysisResultContract;
  readonly required_operator_obligations: readonly StatisticalOperatorObligation[];
  readonly query_shape: {
    readonly time_column: string;
    readonly value_column: string;
    readonly ordered_months: readonly string[];
    readonly ordered_values: readonly number[];
    readonly result_hash: string;
  };
}

function addUtcMonths(month: string, count: number): string {
  const match = /^(\d{4})-(\d{2})-01$/u.exec(month);
  if (!match) throw new TypeError("SINGLE_SERIES_MONTH_VALUE_INVALID");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) {
    throw new TypeError("SINGLE_SERIES_MONTH_VALUE_INVALID");
  }
  return new Date(Date.UTC(year, monthIndex + count, 1)).toISOString().slice(0, 10);
}

function exactBinding(field: string) {
  return {
    result_field: field,
    operator_field: field,
    comparison: "EXACT" as const,
    absolute_tolerance: 0,
    relative_tolerance: 0,
  };
}

function operatorResultBinding(input: {
  readonly result_collection_path: string;
  readonly value_fields: readonly string[];
}) {
  return {
    result_output_name: "result",
    result_collection_path: input.result_collection_path,
    operator_collection_path: "/series",
    label_fields: ["label"],
    value_bindings: input.value_fields.map(exactBinding),
    require_exact_label_set: true as const,
  };
}

function trendOperatorObligations(): readonly StatisticalOperatorObligation[] {
  return statisticalOperatorObligationsSchema.parse([
    {
      call_id: "single_series_theil_sen",
      operator_id: "robust-trend.theil-sen-slope@1",
      input_lineage_bindings: [
        {
          lineage_kind: "SERVER_TRANSFORM_EXACT",
          operator_input_name: "series",
          governed_input_name: "query_evidence",
          transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesTheilSen,
        },
      ],
      result_binding: operatorResultBinding({
        result_collection_path: "/theil_sen/series",
        value_fields: ["slope", "sample_size", "pair_count"],
      }),
    },
    {
      call_id: "single_series_mann_kendall",
      operator_id: "trend.mann-kendall-original@1",
      input_lineage_bindings: [
        {
          lineage_kind: "SERVER_TRANSFORM_EXACT",
          operator_input_name: "series",
          governed_input_name: "query_evidence",
          transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesMannKendall,
        },
      ],
      result_binding: operatorResultBinding({
        result_collection_path: "/mann_kendall/series",
        value_fields: [
          "s",
          "variance_s",
          "z",
          "p_value",
          "tau",
          "trend",
          "rejected",
          "sample_size",
          "tie_group_count",
          "alpha",
          "variant",
        ],
      }),
    },
  ]);
}

async function extractQueryShape(input: {
  readonly query_evidence_ref: QueryEvidenceReference;
  readonly query_evidence_document: ProductTeamArtifactDocument;
}) {
  const evidence = await verifyProductTeamArtifactDocument(input.query_evidence_document);
  const verified = await verifyProductTeamQueryEvidenceInput({
    query_evidence_ref: input.query_evidence_ref,
    query_evidence_document: evidence,
    expected_row_count: 12,
  });
  if (evidence.projection.kind !== "TABLE" || evidence.projection.columns.length !== 2) {
    throw new TypeError("SINGLE_SERIES_QUERY_SHAPE_INVALID");
  }
  const timeColumns = evidence.projection.columns.filter(({ data_type }) => data_type === "STRING");
  const valueColumns = evidence.projection.columns.filter(
    ({ data_type }) => data_type === "NUMBER",
  );
  if (timeColumns.length !== 1 || valueColumns.length !== 1) {
    throw new TypeError("SINGLE_SERIES_QUERY_SHAPE_INVALID");
  }
  const timeColumn = timeColumns[0]?.key;
  const valueColumn = valueColumns[0]?.key;
  if (
    !timeColumn ||
    !valueColumn ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(timeColumn) ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(valueColumn)
  ) {
    throw new TypeError("SINGLE_SERIES_QUERY_SHAPE_INVALID");
  }

  const points = evidence.projection.rows
    .map((row) => {
      const month = row[timeColumn];
      const value = row[valueColumn];
      if (
        typeof month !== "string" ||
        !/^\d{4}-\d{2}-01$/u.test(month) ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        throw new TypeError("SINGLE_SERIES_QUERY_VALUE_INVALID");
      }
      return { month, value };
    })
    .sort((left, right) => left.month.localeCompare(right.month));
  if (
    points.length !== 12 ||
    new Set(points.map(({ month }) => month)).size !== 12 ||
    points.some(
      ({ month }, index) => index > 0 && month !== addUtcMonths(points[0]?.month ?? "", index),
    )
  ) {
    throw new TypeError("SINGLE_SERIES_COMPLETE_MONTH_WINDOW_INVALID");
  }
  return Object.freeze({
    time_column: timeColumn,
    time_label: timeColumns[0]?.label ?? timeColumn,
    value_column: valueColumn,
    value_label: valueColumns[0]?.label ?? valueColumn,
    ordered_months: Object.freeze(points.map(({ month }) => month)),
    ordered_values: Object.freeze(points.map(({ value }) => value)),
    result_hash: verified.result_hash,
  });
}

export async function compileSingleSeriesAnalysisPlan(input: {
  readonly question: string;
  readonly question_frame_ref: ArtifactReference & { readonly artifact_type: "QuestionFrame" };
  readonly context: AnalysisContext;
  readonly query_evidence_ref: QueryEvidenceReference;
  readonly query_evidence_document: ProductTeamArtifactDocument;
}): Promise<SingleSeriesAnalysisPlan> {
  const question = input.question.normalize("NFKC").trim();
  if (question.length === 0) throw new TypeError("SINGLE_SERIES_QUESTION_REQUIRED");
  const context = await verifyAnalysisContext(input.context);
  if (context.metrics.length !== 1) throw new TypeError("SINGLE_SERIES_METRIC_AUTHORITY_INVALID");
  const metric = context.metrics[0];
  if (
    !metric?.analysis_capabilities.includes("TREND_CHANGE") ||
    !metric.analysis_capabilities.includes("CHART_DATASET") ||
    metric.time_domain === null ||
    metric.time_dimension_ref === null ||
    metric.grain.granularity !== "month"
  ) {
    throw new TypeError("SINGLE_SERIES_METRIC_AUTHORITY_INVALID");
  }
  const timeDimension = metric.allowed_dimensions.find(
    ({ dimension_id: dimensionId, groupable, data_type: dataType }) =>
      dimensionId === metric.time_dimension_ref &&
      groupable &&
      (dataType === "date" || dataType === "timestamp"),
  );
  if (!timeDimension) throw new TypeError("SINGLE_SERIES_TIME_DIMENSION_AUTHORITY_INVALID");
  const shape = await extractQueryShape(input);
  const window = {
    start: `${shape.ordered_months[0]}T00:00:00.000Z`,
    end: `${addUtcMonths(shape.ordered_months[11] ?? "", 1)}T00:00:00.000Z`,
    timezone: metric.time_domain.timezone,
    semantics: "HALF_OPEN" as const,
  };
  const briefMaterial = {
    artifact_type: "ResearchBrief" as const,
    protocol_version: "research-brief@3.0.0" as const,
    question_frame_ref: input.question_frame_ref,
    research_mode: "EXPLORATORY_DETERMINISTIC" as const,
    question,
    semantic_release_ref: context.semantic_release_ref,
    schema_snapshot_ref: context.schema_snapshot_ref,
    policy_receipt_ref: context.policy_receipt_ref,
    primary_metric_refs: [metric.metric_ref],
    approved_dimension_refs: [timeDimension.dimension_id],
    requested_time_window: window,
    analysis_mode: "AUTO" as const,
    root_cause_mode: "DISABLED" as const,
    code_generation: "ALLOW_SANDBOXED" as const,
    success_criteria: [
      "结果必须覆盖 QueryEvidence 中连续且完整的 12 个自然月。",
      "Theil-Sen 斜率和 original Mann-Kendall 趋势检验必须来自治理算子。",
      "必须返回月度序列表格和折线图。",
    ],
    required_disclosures: [],
    budget: {
      max_steps: 1,
      max_model_calls: 2,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_elapsed_ms: 300_000,
    },
  };
  const brief = researchBriefV3PayloadSchema.parse({
    ...briefMaterial,
    brief_hash: await sha256ContentHash({
      hash_domain: "single-series-analysis-brief@1.0.0",
      value: briefMaterial,
      query_result_hash: shape.result_hash,
    }),
  });
  const semanticMetricId = metric.metric_ref.node_id;
  const semanticDimensionId = timeDimension.dimension_id;
  const physicalSources = [
    `query_evidence.${shape.time_column}`,
    `query_evidence.${shape.value_column}`,
  ];
  const resultContract = await buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "single-series-trend.result",
    semantic_context_hash: context.semantic_context_binding.package_hash,
    result_fields: [
      { field: "series", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
      { field: "theil_sen", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
      { field: "mann_kendall", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
      { field: "summary_zh", data_type: "STRING", nullable: false, semantic_role: "DERIVED" },
    ],
    metric_bindings: [
      {
        semantic_metric_id: semanticMetricId,
        field: "series",
        unit: metric.unit?.unit_id ?? null,
        aggregation: "NONE",
        formula_hash: metric.formula_hash,
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: semanticDimensionId, field: "series" }],
    grain: {
      dimension_ids: [semanticDimensionId],
      time_dimension_id: semanticDimensionId,
      time_grain: "MONTH",
    },
    lineage: [
      {
        field: "series",
        source_semantic_object_ids: [semanticMetricId, semanticDimensionId],
        source_physical_fields: physicalSources,
        transformation: "DIRECT",
      },
      ...["theil_sen", "mann_kendall", "summary_zh"].map((field) => ({
        field,
        source_semantic_object_ids: [semanticMetricId, semanticDimensionId],
        source_physical_fields: physicalSources,
        transformation: "STATISTICAL_OPERATOR" as const,
      })),
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "single_series_monthly",
        title_zh: `${shape.value_label}月度趋势`,
        required: true,
        columns: [
          {
            key: "period",
            label_zh: shape.time_label,
            data_type: "STRING",
            nullable: false,
            semantic_object_id: semanticDimensionId,
            semantic_role: "DIMENSION",
          },
          {
            key: "value",
            label_zh: shape.value_label,
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: semanticMetricId,
            semantic_role: "METRIC",
          },
        ],
        projection: {
          mode: "RESULT_COLLECTION",
          collection_field: "series",
          column_mappings: [
            { result_field: "period", table_column: "period" },
            { result_field: "value", table_column: "value" },
          ],
        },
        max_rows: 12,
      },
    ],
    charts: [
      {
        chart_id: "single_series_monthly_line",
        title_zh: `${shape.value_label}最近12个完整月趋势`,
        required: true,
        intent: "TREND",
        table_id: "single_series_monthly",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 12,
      max_table_columns: 2,
      max_closure_bytes: 4_194_304,
    },
  });
  return Object.freeze({
    brief,
    result_contract: resultContract,
    required_operator_obligations: trendOperatorObligations(),
    query_shape: shape,
  });
}

export const singleSeriesAnalysisPlanningInternals = Object.freeze({
  addUtcMonths,
  extractQueryShape,
  trendOperatorObligations,
});
