import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { categoryComparisonFixture } from "./category-comparison-fixture.js";
import { monthlyComparisonFixture } from "./monthly-comparison-fixture.js";

export async function monthlyPanelFixture(twoGroups = false, derived = true, datetime = false) {
  const category = await categoryComparisonFixture(twoGroups, derived);
  const monthly = await monthlyComparisonFixture();
  if (category.document.provenance?.kind !== "GOVERNED_QUERY_RESULT")
    throw new Error("TEST_QUERY_REQUIRED");
  const time = monthly.binding.columns[0];
  if (!time) throw new Error("TEST_TIME_REQUIRED");
  const { binding_hash: _hash, ...material } = category.binding;
  const binding = await buildQueryEvidenceSemanticBinding({
    ...material,
    columns: [
      { ...time, nullable: true, logical_type: datetime ? "DATETIME" : "DATE" },
      ...category.binding.columns,
    ],
    time_window: monthly.binding.time_window,
  });
  const rows = Array.from({ length: 12 }, (_, index) =>
    ["Email", "App"].flatMap((channel) =>
      (twoGroups ? ["新客", "老客"] : [null]).map((audience) => {
        const factor = audience === "老客" ? 2 : 1;
        const missing = channel === "App" && index === 5;
        const spend = missing ? 0 : (channel === "Email" ? 100 + index * 10 : 80) * factor;
        const revenue = missing
          ? 0
          : (channel === "Email" ? 200 + index * 5 : 120 + index * 10) * factor;
        const date = `2024-${String(index + 1).padStart(2, "0")}-01`;
        return {
          month: datetime ? new Date(`${date}T00:00:00+08:00`).toISOString() : date,
          channel,
          ...(audience ? { audience } : {}),
          spend,
          revenue,
          return_rate: spend === 0 ? null : (revenue - (derived ? spend : 0)) / spend,
        };
      }),
    ),
  ).flat();
  const document = await buildProductTeamArtifactDocument({
    ...category.document,
    provenance: {
      ...category.document.provenance,
      semantic_binding: binding,
      row_count: rows.length,
    },
    projection: {
      kind: "TABLE",
      columns: binding.columns.map((column) => ({
        key: column.output_name,
        label: column.output_name,
        data_type: column.logical_type === "NUMBER" ? "NUMBER" : "STRING",
      })),
      rows,
      total_rows: rows.length,
    },
  });
  if (document.artifact_ref.artifact_type !== "QueryEvidence")
    throw new Error("TEST_QUERY_REQUIRED");
  return { context: category.context, binding, document, reference: document.artifact_ref, rows };
}

/** Unit authority fixture, not a real SQL proof or publication receipt. */
export async function monthlyPeriodPanelFixture() {
  const base = await monthlyPanelFixture();
  const revenue = base.binding.columns.find((column) => column.output_name === "revenue");
  if (!revenue || base.document.provenance?.kind !== "GOVERNED_QUERY_RESULT")
    throw new Error("TEST_REVENUE_REQUIRED");
  const { binding_hash: _bindingHash, ...material } = base.binding;
  const binding = await buildQueryEvidenceSemanticBinding({
    ...material,
    columns: material.columns.map((column) =>
      column.output_name === "spend"
        ? { ...revenue, output_name: "spend" }
        : column.output_name === "return_rate"
          ? {
              ...column,
              semantic_object_id: "request-scoped.yoy",
              request_derivation: {
                semantic_query_context_hash: base.binding.semantic_context_ref.package_hash,
                interpretation: {
                  interpretation_id: "request-scoped.yoy",
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
                  user_explanation: "本期收入减上年同期收入后除以上年同期收入",
                  publication_effect: "NONE",
                },
                period_comparison: {
                  time_output: "month",
                  current_output: "revenue",
                  comparison_output: "spend",
                  category_output: "channel",
                  group_coverage: "BOTH_PERIOD_GROUPS",
                },
              },
            }
          : column,
    ),
  });
  const { context_hash: _contextHash, ...contextMaterial } = base.context;
  const context = await buildAnalysisContext({
    ...contextMaterial,
    metrics: contextMaterial.metrics.filter(
      (metric) => metric.metric_ref.node_id === "metric.revenue",
    ),
  });
  const document = await buildProductTeamArtifactDocument({
    ...base.document,
    provenance: { ...base.document.provenance, semantic_binding: binding },
  });
  if (document.artifact_ref.artifact_type !== "QueryEvidence")
    throw new Error("TEST_QUERY_REQUIRED");
  return { ...base, context, binding, document, reference: document.artifact_ref };
}
