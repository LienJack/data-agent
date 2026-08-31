import { describe, expect, it } from "vitest";
import {
  type ArtifactWorkspaceChartProjectionV3,
  artifactPreviewResultSchema,
  artifactWorkspaceChartProjectionV3Schema,
  buildArtifactWorkspaceChartDocumentV3,
  verifyArtifactWorkspaceChartDocumentV3,
} from "../src/artifacts/export-receipt.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function reference(artifact_type: string, suffix: number) {
  return {
    artifact_id: id(suffix),
    artifact_type,
    app_id: id(1),
    tenant_id: id(2),
    environment: "test",
    run_id: id(3),
    revision: 1,
    content_hash: hash("a"),
  };
}

function projection(
  chart_type: ArtifactWorkspaceChartProjectionV3["chart_type"] = "LINE",
  nullable = true,
): ArtifactWorkspaceChartProjectionV3 {
  const interval = ["AREA_RANGE", "FORECAST_INTERVAL"].includes(chart_type);
  return {
    kind: "CHART",
    chart_type,
    title: "原始时期与缺失观测",
    description: null,
    unit: null,
    x_key: "month",
    y_keys: ["current", "prior"],
    lower_bound_key: interval ? "lower" : null,
    upper_bound_key: interval ? "upper" : null,
    series_key: null,
    legend: { visible: true },
    evidence_level: "L2_OBSERVATION",
    table: {
      kind: "TABLE",
      columns: [
        { key: "month", label: "月份", data_type: "STRING" },
        ...["current", "prior", "lower", "upper"].map((key) => ({
          key,
          label: key,
          data_type: "NUMBER" as const,
        })),
      ],
      rows: [
        { month: "2024-01", current: 120, prior: 100, lower: 90, upper: 130 },
        { month: "2024-02", current: 90, prior: nullable ? null : 100, lower: 80, upper: 110 },
        { month: "2024-03", current: 105, prior: 100, lower: 90, upper: 120 },
      ],
      total_rows: 3,
    },
  };
}

function draft(chart = projection(), transform_version = "derived-analysis-chart@1.1.0") {
  return {
    schema_version: "artifact-workspace-chart-document@3.0.0",
    document_ref: reference("ArtifactWorkspaceDocument", 4),
    source_refs: {
      query_evidence_refs: [reference("QueryEvidence", 5)],
      derived_evidence_ref: reference("DerivedAnalysisEvidence", 6),
    },
    provenance: {
      transform_version,
      dataset_hash: hash("0"),
      semantic_context: {
        package_id: id(7),
        package_hash: hash("b"),
        receipt_id: id(8),
        receipt_hash: hash("c"),
      },
      algorithm_version: "comparison@1",
      parameter_hash: hash("d"),
      input_closure_hash: hash("e"),
      runtime_profile: "CORE_ANALYSIS",
      agent_image: "agent@sha256:test",
      operator_image: "operator@sha256:test",
    },
    projection: chart,
  };
}

function preview(document: ReturnType<typeof draft>) {
  return {
    schema_version: "artifact-preview-result@3.0.0",
    source_ref: document.document_ref,
    renderer_version: "artifact-workspace-renderer@3.0.0",
    source_refs: document.source_refs,
    provenance: document.provenance,
    projection: document.projection,
    viewport: { offset: 0, limit: 100, total_rows: 3, truncated: false },
  };
}

describe("Analysis V3 versioned missing observations", () => {
  it("keeps a legacy non-null document byte-for-byte hash compatible", async () => {
    const sealed = await buildArtifactWorkspaceChartDocumentV3(
      draft(projection("LINE", false), "derived-analysis-chart@1.0.0"),
    );
    expect(sealed.document_ref.content_hash).toBe(
      "sha256:0e9fc36e926bb29fbe280248c39485a55d7aefc208f13297aa1572ef93abbccb",
    );
    await expect(verifyArtifactWorkspaceChartDocumentV3(sealed)).resolves.toEqual(sealed);
    expect(artifactPreviewResultSchema.parse(preview(sealed)).projection).toEqual(
      sealed.projection,
    );
  });

  it.each(["LINE", "BAR", "HORIZONTAL_BAR"] as const)(
    "preserves each %s period and NULL through seal, verification and preview",
    async (kind) => {
      const input = draft(projection(kind));
      const sealed = await buildArtifactWorkspaceChartDocumentV3(input);
      await expect(verifyArtifactWorkspaceChartDocumentV3(sealed)).resolves.toEqual(sealed);
      expect(artifactPreviewResultSchema.parse(preview(sealed)).projection).toEqual(
        input.projection,
      );
      expect(sealed.projection.table.rows).toEqual(input.projection.table.rows);
    },
  );

  it.each([
    "AREA_RANGE",
    "SCATTER",
    "RELATIONSHIP",
    "DISTRIBUTION",
    "SIGNED_CONTRIBUTION",
    "PRIORITY_MATRIX",
    "FORECAST_INTERVAL",
  ] as const)("does not relax numeric completeness for %s", (kind) => {
    expect(artifactWorkspaceChartProjectionV3Schema.safeParse(projection(kind)).success).toBe(
      false,
    );
  });

  it.each(["LINE", "BAR", "HORIZONTAL_BAR"] as const)(
    "rejects an entirely unobserved %s measure",
    (kind) => {
      const source = projection(kind);
      source.table.rows = source.table.rows.map((row) => ({ ...row, prior: null }));
      expect(artifactWorkspaceChartProjectionV3Schema.safeParse(source).success).toBe(false);
    },
  );

  it.each(["STRING_VALUE", Number.NaN, Number.POSITIVE_INFINITY, true])(
    "does not coerce invalid values: %s",
    (value) => {
      const source = projection();
      source.table.rows = source.table.rows.map((row, index) =>
        index === 1 ? { ...row, prior: value } : row,
      );
      expect(artifactWorkspaceChartProjectionV3Schema.safeParse(source).success).toBe(false);
    },
  );

  it("requires the nullable transform in both document and public preview", async () => {
    const input = draft(projection(), "derived-analysis-chart@1.0.0");
    await expect(buildArtifactWorkspaceChartDocumentV3(input)).rejects.toThrow(
      "CHART_V3_NULLABLE_TRANSFORM_REQUIRED",
    );
    expect(() => artifactPreviewResultSchema.parse(preview(input))).toThrow(
      "CHART_V3_NULLABLE_TRANSFORM_REQUIRED",
    );
  });

  it.each(["zero-fill", "drop-period", "reorder", "change-value"])(
    "rejects old hashes after %s",
    async (mutation) => {
      const sealed = await buildArtifactWorkspaceChartDocumentV3(draft());
      const changed = structuredClone(sealed);
      if (mutation === "zero-fill")
        changed.projection.table.rows = changed.projection.table.rows.map((row, index) =>
          index === 1 ? { ...row, prior: 0 } : row,
        );
      if (mutation === "drop-period") {
        changed.projection.table.rows.splice(1, 1);
        changed.projection.table.total_rows = 2;
      }
      if (mutation === "reorder") changed.projection.table.rows.reverse();
      if (mutation === "change-value")
        changed.projection.table.rows = changed.projection.table.rows.map((row, index) =>
          index === 0 ? { ...row, prior: 101 } : row,
        );
      await expect(verifyArtifactWorkspaceChartDocumentV3(changed)).rejects.toThrow(
        "ARTIFACT_WORKSPACE_CHART_DATASET_HASH_MISMATCH",
      );
    },
  );

  it("keeps row completeness and bounds", () => {
    const source = projection();
    source.table.total_rows = 4;
    expect(artifactWorkspaceChartProjectionV3Schema.safeParse(source).success).toBe(false);
    source.table.rows = Array.from({ length: 513 }, (_, index) => ({
      month: String(index),
      current: 1,
      prior: null,
      lower: 0,
      upper: 2,
    }));
    source.table.total_rows = 513;
    expect(artifactWorkspaceChartProjectionV3Schema.safeParse(source).success).toBe(false);
  });
});
