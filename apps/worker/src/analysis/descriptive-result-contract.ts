import {
  type AnalysisResultContract,
  buildAnalysisResultContract,
  type QueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import type { AnalysisContext } from "@data-agent/contracts/context";

/** Common fixed result/table/lineage encoding only. Callers must verify source and method eligibility. */
export function buildDescriptiveResultContract(input: {
  readonly context: AnalysisContext;
  readonly binding: QueryEvidenceSemanticBinding;
  readonly columns: readonly { readonly label: string }[];
  readonly metrics: AnalysisContext["metrics"];
  readonly derived_fields: readonly string[];
  readonly grain: AnalysisResultContract["grain"];
  readonly contract_id: string;
  readonly table: {
    readonly id: string;
    readonly title: string;
    readonly max_rows: number;
    readonly max_columns: number;
  };
  readonly chart: {
    readonly id: string;
    readonly title: string;
    readonly intent: "TREND" | "COMPARISON";
    readonly template_id: "line.multi-series@1" | "bar.grouped@1";
  };
  readonly invalid_shape: () => never;
}) {
  const { context, binding, metrics, grain } = input;
  const semanticIds = [...new Set(binding.columns.map((column) => column.semantic_object_id))];
  return buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: input.contract_id,
    semantic_context_hash: context.semantic_context_binding.package_hash,
    result_fields: [
      { field: "observations", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
      ...input.derived_fields.map<AnalysisResultContract["result_fields"][number]>((field) => ({
        field,
        data_type: "JSON",
        nullable: false,
        semantic_role: "DERIVED",
      })),
      {
        field: "claim_strength",
        data_type: "STRING",
        nullable: false,
        semantic_role: "LIMITATION",
        text_constraints: {
          required_substrings: ["DESCRIPTIVE"],
          forbidden_substrings: [],
          required_suffix: "DESCRIPTIVE",
        },
      },
    ],
    metric_bindings: metrics.map((metric) => ({
      semantic_metric_id: metric.metric_ref.node_id,
      field: "observations",
      unit: metric.unit?.unit_id ?? null,
      aggregation: "NONE",
      formula_hash: metric.formula_hash,
    })),
    dimension_bindings: grain.dimension_ids.map((semantic_dimension_id) => ({
      semantic_dimension_id,
      field: "observations",
    })),
    grain,
    lineage: ["observations", ...input.derived_fields, "claim_strength"].map((field) => ({
      field,
      source_semantic_object_ids: semanticIds,
      source_physical_fields: binding.columns.map(
        (column) => `query_evidence.${column.output_name}`,
      ),
      transformation: field === "observations" ? "DIRECT" : "AGGREGATION",
    })),
    collection_constraints: [],
    tables: [
      {
        table_id: input.table.id,
        title_zh: input.table.title,
        required: true,
        columns: binding.columns.map((column, index) => {
          if (column.semantic_role === "PHYSICAL_COLUMN") return input.invalid_shape();
          return {
            key: column.output_name,
            label_zh: input.columns[index]?.label ?? column.output_name,
            data_type: column.semantic_role === "DIMENSION" ? "STRING" : "NUMBER",
            nullable: column.nullable,
            semantic_object_id: column.semantic_object_id,
            semantic_role: column.semantic_role,
          };
        }),
        projection: {
          mode: "RESULT_COLLECTION",
          collection_field: "observations",
          column_mappings: binding.columns.map((column) => ({
            result_field: column.output_name,
            table_column: column.output_name,
            source: { input_name: "query_evidence", output_name: column.output_name },
          })),
        },
        max_rows: input.table.max_rows,
      },
    ],
    charts: [
      {
        chart_id: input.chart.id,
        title_zh: input.chart.title,
        required: true,
        intent: input.chart.intent,
        table_id: input.table.id,
        allowed_template_ids: [input.chart.template_id],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: input.table.max_rows,
      max_table_columns: input.table.max_columns,
      max_closure_bytes: 4_194_304,
    },
  });
}
