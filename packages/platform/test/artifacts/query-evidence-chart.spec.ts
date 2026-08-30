import { buildProductTeamArtifactDocument } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { projectArtifactDocument } from "../../src/artifacts/artifact-workspace-service.js";
import { buildQueryEvidenceChartDocument } from "../../src/artifacts/query-evidence-chart.js";
import { buildTestQueryEvidenceSemanticBinding } from "../support/query-evidence-semantic-binding.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function evidence(
  rows: readonly Readonly<Record<string, string | number | boolean | null>>[] = [
    { month: "2026-02", order_count: 149 },
    { month: "2026-01", order_count: 137 },
  ],
  numericKeys: readonly string[] = ["order_count"],
) {
  const sqlRef = {
    artifact_id: id(9),
    artifact_type: "SqlArtifact" as const,
    app_id: id(2),
    tenant_id: id(3),
    environment: "test" as const,
    run_id: id(4),
    revision: 1,
    content_hash: hash("9"),
  };
  return buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(1),
      artifact_type: "QueryEvidence",
      app_id: id(2),
      tenant_id: id(3),
      environment: "test",
      run_id: id(4),
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: id(5),
    source_refs: [sqlRef],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(10),
      request_hash: hash("1"),
      result_hash: hash("2"),
      row_count: rows.length,
      byte_count: 128,
      elapsed_ms: 4,
      truncated: false,
      semantic_binding: await buildTestQueryEvidenceSemanticBinding([
        {
          name: "month",
          logical_type: "STRING",
          nullable: false,
          semantic_role: "DIMENSION",
          semantic_object_id: "dimension.month",
        },
        ...numericKeys.map((key) => ({
          name: key,
          logical_type: "NUMBER" as const,
          nullable: rows.some((row) => row[key] === null),
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.order_count",
        })),
      ]),
    },
    projection: {
      kind: "TABLE",
      columns: [
        { key: "month", label: "月份", data_type: "STRING" },
        ...numericKeys.map((key) => ({ key, label: key, data_type: "NUMBER" as const })),
      ],
      rows,
      total_rows: rows.length,
    },
    committed_at: "2026-08-22T00:00:00.000Z",
  });
}

const documentRef = {
  artifact_id: id(6),
  artifact_type: "ArtifactWorkspaceDocument" as const,
  app_id: id(2),
  tenant_id: id(3),
  environment: "test" as const,
  run_id: id(4),
  revision: 1,
  content_hash: hash("0"),
};

const semanticContext = {
  package_id: id(7),
  package_hash: hash("a"),
  receipt_id: id(8),
  receipt_hash: hash("b"),
};

describe("QueryEvidence chart projection", () => {
  it("projects ordered trend evidence into a sealed V2 chart preview", async () => {
    const chart = await buildQueryEvidenceChartDocument({
      intent: "TREND",
      document_ref: documentRef,
      evidence: await evidence(),
      semantic_context: semanticContext,
      unit: "单",
    });
    expect(chart?.projection.table.rows).toEqual([
      { month: "2026-01", order_count: 137 },
      { month: "2026-02", order_count: 149 },
    ]);
    if (!chart) throw new Error("expected chart");
    const preview = await projectArtifactDocument(chart, chart.document_ref, {
      offset: 0,
      limit: 100,
    });
    expect(preview).toMatchObject({
      schema_version: "artifact-preview-result@2.0.0",
      source_refs: [chart.source_refs[0]],
      projection: { chart_type: "LINE", unit: "单" },
      viewport: { offset: 0, total_rows: 2, truncated: false },
    });
  });

  it("returns no chart when evidence is scalar or exceeds the intent shape", async () => {
    await expect(
      buildQueryEvidenceChartDocument({
        intent: "TREND",
        document_ref: documentRef,
        evidence: await evidence([{ month: "2026-01", order_count: 137 }]),
        semantic_context: semanticContext,
      }),
    ).resolves.toBeNull();
    await expect(
      buildQueryEvidenceChartDocument({
        intent: "COMPOSITION",
        document_ref: documentRef,
        evidence: await evidence([
          { month: "A", order_count: -1 },
          { month: "B", order_count: 1 },
        ]),
        semantic_context: semanticContext,
      }),
    ).resolves.toBeNull();
    await expect(
      buildQueryEvidenceChartDocument({
        intent: "TREND",
        document_ref: documentRef,
        evidence: await evidence([
          { month: "A", order_count: null },
          { month: "B", order_count: 1 },
        ]),
        semantic_context: semanticContext,
      }),
    ).resolves.toBeNull();
  });

  it("preserves missing periods as gaps without changing accepted evidence", async () => {
    const source = await evidence([
      { month: "2026-01", order_count: 137 },
      { month: "2026-02", order_count: null },
      { month: "2026-03", order_count: 149 },
    ]);
    const chart = await buildQueryEvidenceChartDocument({
      intent: "TREND",
      document_ref: documentRef,
      evidence: source,
      semantic_context: semanticContext,
    });
    expect(chart?.projection.table.rows).toEqual([
      { month: "2026-01", order_count: 137 },
      { month: "2026-02", order_count: null },
      { month: "2026-03", order_count: 149 },
    ]);
    expect(chart?.projection.table.total_rows).toBe(3);
    expect(chart?.source_refs).toEqual([source.artifact_ref]);
    if (!chart) throw new Error("expected chart");
    const preview = await projectArtifactDocument(chart, chart.document_ref, {
      offset: 0,
      limit: 100,
    });
    expect(preview.projection).toEqual(chart.projection);
  });

  it.each(["TREND", "COMPARISON"] as const)(
    "preserves current observations with missing comparisons in %s",
    async (intent) => {
      const source = await evidence(
        [
          { month: "2026-01", current: 137, prior: null },
          { month: "2026-02", current: 149, prior: 120 },
        ],
        ["current", "prior"],
      );
      const chart = await buildQueryEvidenceChartDocument({
        intent,
        document_ref: documentRef,
        evidence: source,
        semantic_context: semanticContext,
      });
      expect(chart?.projection.table.total_rows).toBe(2);
      expect(chart?.projection.table.rows).toContainEqual({
        month: "2026-01",
        current: 137,
        prior: null,
      });
      expect(chart?.projection.table.rows).toContainEqual({
        month: "2026-02",
        current: 149,
        prior: 120,
      });
      expect(chart?.provenance.transform_version).toBe("query-evidence-chart@1.1.0");
    },
  );

  it("does not create a composition from incomplete observations", async () => {
    await expect(
      buildQueryEvidenceChartDocument({
        intent: "COMPOSITION",
        document_ref: documentRef,
        evidence: await evidence([
          { month: "A", order_count: 137 },
          { month: "B", order_count: null },
          { month: "C", order_count: 149 },
        ]),
        semantic_context: semanticContext,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    ["COMPARISON", "BAR"],
    ["COMPOSITION", "PIE"],
  ] as const)("maps %s intent into a deterministic %s projection", async (intent, chartType) => {
    const chart = await buildQueryEvidenceChartDocument({
      intent,
      document_ref: documentRef,
      evidence: await evidence([
        { month: "B", order_count: 21 },
        { month: "A", order_count: 34 },
      ]),
      semantic_context: semanticContext,
    });
    expect(chart?.projection.chart_type).toBe(chartType);
    expect(chart?.projection.table.rows[0]).toMatchObject({ month: "A", order_count: 34 });
  });

  it("rejects preview after dataset tampering", async () => {
    const chart = await buildQueryEvidenceChartDocument({
      intent: "TREND",
      document_ref: documentRef,
      evidence: await evidence(),
      semantic_context: semanticContext,
    });
    if (!chart) throw new Error("expected chart");
    await expect(
      projectArtifactDocument(
        {
          ...chart,
          projection: {
            ...chart.projection,
            table: {
              ...chart.projection.table,
              rows: [{ month: "2026-01", order_count: 9 }, chart.projection.table.rows[1]],
            },
          },
        },
        chart.document_ref,
        { offset: 0, limit: 100 },
      ),
    ).rejects.toThrow("ARTIFACT_WORKSPACE_CHART_DATASET_HASH_MISMATCH");
  });
});
