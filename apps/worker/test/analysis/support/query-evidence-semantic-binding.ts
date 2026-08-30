import { buildQueryEvidenceSemanticBinding } from "@data-agent/contracts";

const id = (suffix: number) => `61900000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

export async function buildTestQueryEvidenceSemanticBinding(input: {
  readonly columns: readonly {
    readonly name: string;
    readonly logical_type: "NUMBER" | "STRING" | "DATE" | "DATETIME" | "BOOLEAN";
    readonly nullable: boolean;
    readonly semantic_role:
      | "METRIC"
      | "FORMULA"
      | "DIMENSION"
      | "PHYSICAL_COLUMN"
      | "REQUEST_DERIVED";
    readonly semantic_object_id: string;
    readonly grain?: {
      readonly grain_id: string;
      readonly granularity: "atomic" | "hour" | "day" | "week" | "month" | "quarter" | "year";
    };
  }[];
  readonly time_window?: {
    readonly dimension_id: string;
    readonly start: string;
    readonly end: string;
    readonly semantics: "HALF_OPEN";
    readonly timezone: string | null;
  } | null;
}) {
  return buildQueryEvidenceSemanticBinding({
    protocol_version: "query-evidence-semantic-binding@1.0.0",
    semantic_release_ref: {
      resource_id: id(1),
      resource_revision: 1,
      resource_hash: hash("1"),
      datasource_id: id(2),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    semantic_context_ref: {
      package_id: id(3),
      package_hash: hash("3"),
      receipt_id: id(4),
      receipt_hash: hash("4"),
    },
    schema_snapshot_ref: {
      resource_id: id(5),
      resource_revision: 1,
      resource_hash: hash("5"),
      datasource_id: id(2),
      semantic_release_id: id(1),
      semantic_generation: 1,
    },
    datasource_ref: { resource_id: id(2), resource_revision: 1, resource_hash: hash("2") },
    target_binding_hash: hash("6"),
    columns: input.columns.map((column, index) => ({
      output_name: column.name,
      logical_type: column.logical_type,
      nullable: column.nullable,
      semantic_role: column.semantic_role,
      semantic_object_id: column.semantic_object_id,
      formula_hash: ["METRIC", "FORMULA", "REQUEST_DERIVED"].includes(column.semantic_role)
        ? hash("7")
        : null,
      ...(column.semantic_role === "REQUEST_DERIVED"
        ? {
            request_derivation: {
              semantic_query_context_hash: hash("8"),
              interpretation: {
                interpretation_id: column.semantic_object_id,
                requested_term: "同比",
                scope: "REQUEST_ONLY",
                source_object_ids: ["dimension.month", "metric.revenue"],
                operator: {
                  kind: "PERIOD_COMPARISON_RATE",
                  metric_id: "metric.revenue",
                  time_dimension_id: "dimension.month",
                  comparison_offset: { unit: "YEAR", value: 1 },
                  formula: "(current_value - comparison_value) / NULLIF(comparison_value, 0)",
                },
                user_explanation: "测试请求内同比",
                publication_effect: "NONE",
              },
            },
          }
        : {}),
      aggregate: column.semantic_role === "METRIC" ? ("sum" as const) : null,
      grain: column.grain ?? {
        grain_id: column.semantic_role === "METRIC" ? "order" : column.semantic_object_id,
        granularity: column.logical_type === "DATE" ? ("day" as const) : ("atomic" as const),
      },
      physical_sources: [
        {
          schema_name: "falcon_db_24",
          relation_name: "orders",
          column_name: `column_${String(index + 1)}`,
          formatted_type:
            column.logical_type === "NUMBER"
              ? "numeric"
              : column.logical_type === "BOOLEAN"
                ? "boolean"
                : column.logical_type === "DATE"
                  ? "date"
                  : column.logical_type === "DATETIME"
                    ? "timestamp with time zone"
                    : "text",
          nullable: column.nullable,
        },
      ],
    })),
    time_window: input.time_window ?? null,
  });
}
