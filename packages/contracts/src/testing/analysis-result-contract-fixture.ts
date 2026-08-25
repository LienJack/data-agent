import {
  type AnalysisResultContract,
  analysisResultContractSchema,
} from "../artifacts/analysis-result-contract.js";

const FIXTURE_HASH = `sha256:${"f".repeat(64)}`;

/** Test-only semantic result closure for consumers that exercise a Program boundary. */
export function analysisResultContractFixture(input: {
  readonly semantic_context_hash: string;
  readonly contract_id?: string;
  readonly metric_id?: string;
  readonly dimension_id?: string;
  readonly contract_hash?: string;
}): AnalysisResultContract {
  const semanticIds = [input.metric_id, input.dimension_id].filter(
    (value): value is string => value !== undefined,
  );
  return analysisResultContractSchema.parse({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: input.contract_id ?? "test.analysis.result",
    semantic_context_hash: input.semantic_context_hash,
    result_fields: [
      { field: "result", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
    ],
    metric_bindings: input.metric_id
      ? [
          {
            semantic_metric_id: input.metric_id,
            field: "result",
            unit: null,
            aggregation: "NONE",
            formula_hash: null,
          },
        ]
      : [],
    dimension_bindings: input.dimension_id
      ? [{ semantic_dimension_id: input.dimension_id, field: "result" }]
      : [],
    grain: {
      dimension_ids: input.dimension_id ? [input.dimension_id] : [],
      time_dimension_id: null,
      time_grain: "NONE",
    },
    lineage: [
      {
        field: "result",
        source_semantic_object_ids: semanticIds.length > 0 ? semanticIds : ["quality.test_fixture"],
        source_physical_fields: ["fixture.value"],
        transformation: "FORMULA",
      },
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "result_table",
        title_zh: "测试结果",
        required: true,
        columns: [
          {
            key: "value",
            label_zh: "值",
            data_type: "NUMBER",
            nullable: true,
            semantic_object_id: semanticIds[0] ?? "quality.test_fixture",
            semantic_role: input.metric_id ? "METRIC" : "DERIVED",
          },
        ],
        projection: { mode: "MODEL_DERIVED" },
        max_rows: 16,
      },
    ],
    charts: [
      {
        chart_id: "result_chart",
        title_zh: "测试图表",
        required: true,
        intent: "TREND",
        table_id: "result_table",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 16,
      max_table_columns: 1,
      max_closure_bytes: 4_194_304,
    },
    contract_hash: input.contract_hash ?? FIXTURE_HASH,
  });
}
