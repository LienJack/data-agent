import { describe, expect, it } from "vitest";
import {
  artifactPreviewResultSchema,
  artifactWorkspaceChartProjectionV2Schema,
  buildArtifactWorkspaceChartDocumentV2,
  verifyArtifactWorkspaceChartDocumentV2,
} from "../src/artifacts/export-receipt.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const sourceRef = {
  artifact_id: id(1),
  artifact_type: "QueryEvidence" as const,
  app_id: id(2),
  tenant_id: id(3),
  environment: "test" as const,
  run_id: id(4),
  revision: 1,
  content_hash: hash("a"),
};

function projection(chartType: "LINE" | "BAR" | "PIE" = "LINE") {
  return {
    kind: "CHART" as const,
    chart_type: chartType,
    title: "月度订单趋势",
    description: "已批准订单的月度数量",
    unit: "单",
    x_key: "month",
    y_keys: ["order_count"],
    legend: { visible: false },
    table: {
      kind: "TABLE" as const,
      columns: [
        { key: "month", label: "月份", data_type: "STRING" as const },
        { key: "order_count", label: "订单量", data_type: "NUMBER" as const },
      ],
      rows: [
        { month: "2026-01", order_count: 137 },
        { month: "2026-02", order_count: 149 },
      ],
      total_rows: 2,
    },
  };
}

async function document(chartType: "LINE" | "BAR" | "PIE" = "LINE") {
  return buildArtifactWorkspaceChartDocumentV2({
    schema_version: "artifact-workspace-chart-document@2.0.0",
    document_ref: {
      ...sourceRef,
      artifact_id: id(5),
      artifact_type: "ArtifactWorkspaceDocument",
      content_hash: hash("0"),
    },
    source_refs: [sourceRef],
    provenance: {
      transform_version: "query-evidence-chart@1.0.0",
      dataset_hash: hash("0"),
      semantic_context: {
        package_id: id(6),
        package_hash: hash("b"),
        receipt_id: id(7),
        receipt_hash: hash("c"),
      },
    },
    projection: projection(chartType),
  });
}

describe("Artifact Workspace V2 chart", () => {
  it("seals dataset, source and semantic-context identity", async () => {
    const sealed = await document();
    await expect(verifyArtifactWorkspaceChartDocumentV2(sealed)).resolves.toEqual(sealed);
    expect(sealed.document_ref.content_hash).not.toBe(hash("0"));
    expect(sealed.provenance.dataset_hash).not.toBe(hash("0"));

    await expect(
      verifyArtifactWorkspaceChartDocumentV2({
        ...sealed,
        provenance: {
          ...sealed.provenance,
          semantic_context: { ...sealed.provenance.semantic_context, receipt_hash: hash("d") },
        },
      }),
    ).rejects.toThrow("ARTIFACT_WORKSPACE_CHART_DOCUMENT_HASH_MISMATCH");
  });

  it.each(["LINE", "BAR", "PIE"] as const)("accepts controlled %s projection", (chartType) => {
    expect(artifactWorkspaceChartProjectionV2Schema.parse(projection(chartType)).chart_type).toBe(
      chartType,
    );
  });

  it("rejects invalid field binding and pie values", () => {
    expect(
      artifactWorkspaceChartProjectionV2Schema.safeParse({
        ...projection("BAR"),
        y_keys: ["missing"],
      }).success,
    ).toBe(false);
    expect(
      artifactWorkspaceChartProjectionV2Schema.safeParse({
        ...projection("PIE"),
        table: {
          ...projection("PIE").table,
          rows: [
            { month: "A", order_count: -1 },
            { month: "B", order_count: 1 },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      artifactWorkspaceChartProjectionV2Schema.safeParse({
        ...projection("PIE"),
        table: {
          ...projection("PIE").table,
          rows: [
            { month: "A", order_count: 0 },
            { month: "B", order_count: 0 },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      artifactWorkspaceChartProjectionV2Schema.safeParse({
        ...projection(),
        table: {
          ...projection().table,
          rows: [
            { month: "A", order_count: null },
            { month: "B", order_count: 1 },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires the sealed chart document to carry its complete bounded dataset", () => {
    expect(
      artifactWorkspaceChartProjectionV2Schema.safeParse({
        ...projection(),
        table: { ...projection().table, total_rows: 3 },
      }).success,
    ).toBe(false);
  });

  it.each(["LINE", "BAR", "PIE"] as const)(
    "treats nullable %s observations according to chart semantics",
    async (chartType) => {
      const base = await document(chartType);
      const candidate = {
        ...base,
        provenance: { ...base.provenance, transform_version: "query-evidence-chart@1.1.0" },
        projection: {
          ...base.projection,
          table: {
            ...base.projection.table,
            rows: [
              base.projection.table.rows[0],
              { month: "2026-01-gap", order_count: null },
              base.projection.table.rows[1],
            ],
            total_rows: 3,
          },
        },
      };
      if (chartType === "PIE") {
        await expect(buildArtifactWorkspaceChartDocumentV2(candidate)).rejects.toThrow();
        return;
      }
      const sealed = await buildArtifactWorkspaceChartDocumentV2(candidate);
      await expect(verifyArtifactWorkspaceChartDocumentV2(sealed)).resolves.toEqual(sealed);
      expect(sealed.projection.table.rows[1]).toEqual({ month: "2026-01-gap", order_count: null });
      await expect(
        verifyArtifactWorkspaceChartDocumentV2({
          ...sealed,
          projection: {
            ...sealed.projection,
            table: {
              ...sealed.projection.table,
              rows: [
                sealed.projection.table.rows[0],
                { month: "2026-01-gap", order_count: 0 },
                sealed.projection.table.rows[2],
              ],
            },
          },
        }),
      ).rejects.toThrow("ARTIFACT_WORKSPACE_CHART_DATASET_HASH_MISMATCH");
    },
  );

  it("fails closed when point limits are exceeded", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(3, "0")}`,
      order_count: index + 1,
    }));
    await expect(
      buildArtifactWorkspaceChartDocumentV2({
        ...(await document()),
        projection: {
          ...projection(),
          table: { ...projection().table, rows, total_rows: rows.length },
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps V1 and V2 preview decoding distinct", async () => {
    const sealed = await document();
    expect(
      artifactPreviewResultSchema.parse({
        schema_version: "artifact-preview-result@2.0.0",
        source_ref: sealed.document_ref,
        renderer_version: "artifact-workspace-renderer@2.0.0",
        source_refs: sealed.source_refs,
        provenance: sealed.provenance,
        projection: sealed.projection,
        viewport: { offset: 0, limit: 100, total_rows: 2, truncated: false },
      }).schema_version,
    ).toBe("artifact-preview-result@2.0.0");
  });
});
