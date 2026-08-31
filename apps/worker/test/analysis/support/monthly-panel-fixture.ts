import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
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
