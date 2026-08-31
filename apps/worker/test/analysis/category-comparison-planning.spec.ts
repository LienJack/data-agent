import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import { compileCategoryComparisonPlan } from "../../src/analysis/category-comparison-planning.js";
import { categoryComparisonFixture } from "./support/category-comparison-fixture.js";
import { comparisonHash } from "./support/monthly-comparison-fixture.js";

async function inputFor(two = false, derived = false) {
  const source = await categoryComparisonFixture(two, derived);
  return {
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  };
}

describe("published category comparison planning", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "preserves complete source groups and ratio roles: two=%s derived=%s",
    async (two, derived) => {
      const input = await inputFor(two, derived);
      const plan = await compileCategoryComparisonPlan(input);
      expect(plan.shape.rows).toHaveLength(two ? 8 : 4);
      expect(plan.shape.dimension_columns).toEqual(two ? ["channel", "audience"] : ["channel"]);
      expect(plan.result_contract.metric_bindings.map((item) => item.semantic_metric_id)).toEqual([
        "metric.revenue",
        "metric.spend",
      ]);
      expect(plan.result_contract.tables[0]?.columns.at(-1)?.semantic_role).toBe(
        derived ? "REQUEST_DERIVED" : "FORMULA",
      );
      expect(plan.result_contract.tables[0]?.columns.every((column) => column.nullable)).toBe(true);
      expect(plan.result_contract.grain.time_grain).toBe("NONE");
      expect(plan.execution_contract.chart_bindings).toEqual({
        x_field: "channel",
        y_fields: ["spend", "revenue", "return_rate"],
        series_field: two ? "audience" : null,
        lower_bound_field: null,
        upper_bound_field: null,
      });
      expect(plan.execution_contract.claim_strength).toBe("DESCRIPTIVE");
      expect(plan.required_operator_obligations).toEqual([]);
      expect(JSON.stringify(plan.execution_contract)).not.toContain('"spend":100');
      expect(plan.shape.rows[0]?.channel).toBe("Email");
      expect(plan.shape.rows.at(-1)?.return_rate).toBeNull();
    },
  );

  it("preserves an exact accepted bounded window without adding a time grouping", async () => {
    const input = await inputFor();
    const draft = structuredClone(input.query_evidence_document);
    if (draft.provenance?.kind !== "GOVERNED_QUERY_RESULT") throw new Error("TEST_QUERY_REQUIRED");
    const { binding_hash: _hash, ...material } = draft.provenance.semantic_binding;
    draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding({
      ...material,
      time_window: {
        dimension_id: "dimension.month",
        start: "2024-01-01",
        end: "2025-01-01",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    });
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_QUERY_REQUIRED");
    const plan = await compileCategoryComparisonPlan({
      ...input,
      query_evidence_ref: document.artifact_ref,
      query_evidence_document: document,
    });
    expect(plan.shape.time_window?.start).toBe("2024-01-01T00:00:00.000+08:00");
    expect(plan.result_contract.grain.time_dimension_id).toBeNull();
  });

  it.each([
    "context",
    "release",
    "snapshot",
    "capability",
    "formula",
    "dimension",
    "unit",
    "grain",
    "null-policy",
  ])("rejects original authority drift: %s", async (kind) => {
    const input = await inputFor();
    const { context_hash: _hash, ...context } = structuredClone(input.context);
    const metric = context.metrics[0];
    if (!metric) throw new Error("TEST_METRIC_REQUIRED");
    if (kind === "context") context.semantic_context_binding.receipt_hash = comparisonHash("f");
    if (kind === "release") context.semantic_release_ref.revision += 1;
    if (kind === "snapshot") context.schema_snapshot_ref.content_hash = comparisonHash("f");
    if (kind === "capability") metric.analysis_capabilities = ["TREND_CHANGE"];
    if (kind === "formula") metric.formula_hash = comparisonHash("f");
    if (kind === "dimension") metric.allowed_dimensions = [];
    if (kind === "unit") metric.unit = null;
    if (kind === "grain") metric.grain = { grain_id: "other", granularity: "day" };
    if (kind === "null-policy") metric.null_policy = "coalesce-zero";
    await expect(
      compileCategoryComparisonPlan({ ...input, context: await buildAnalysisContext(context) }),
    ).rejects.toThrow(/CATEGORY_COMPARISON_AUTHORITY_INVALID/);
  });

  it.each([
    "null-category",
    "duplicate-tuple",
    "all-null-measure",
    "empty",
    "too-many",
    "temporal-dimension",
    "unknown-role",
  ])("rejects unsupported actual input: %s", async (kind) => {
    const input = await inputFor(true);
    const draft = structuredClone(input.query_evidence_document);
    if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
      throw new Error("TEST_QUERY_REQUIRED");
    const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
    if (kind === "null-category")
      draft.projection.rows[0] = { ...draft.projection.rows[0], channel: null };
    if (kind === "duplicate-tuple") draft.projection.rows[1] = { ...draft.projection.rows[0] };
    if (kind === "all-null-measure")
      draft.projection.rows = draft.projection.rows.map((row) => ({ ...row, return_rate: null }));
    if (kind === "empty") draft.projection.rows = [];
    const firstRow = draft.projection.rows[0];
    if (kind === "too-many")
      draft.projection.rows = Array.from({ length: 201 }, (_, index) => ({
        ...firstRow,
        channel: `channel_${index}`,
      }));
    if (kind === "temporal-dimension")
      binding.columns = binding.columns.map((column, index) =>
        index === 0 ? { ...column, grain: { grain_id: "month", granularity: "month" } } : column,
      );
    if (kind === "unknown-role")
      binding.columns = binding.columns.map((column, index) =>
        index === 0 ? { ...column, semantic_role: "PHYSICAL_COLUMN" } : column,
      );
    draft.projection.total_rows = draft.projection.rows.length;
    draft.provenance.row_count = draft.projection.rows.length;
    draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_QUERY_REQUIRED");
    await expect(
      compileCategoryComparisonPlan({
        ...input,
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
      }),
    ).rejects.toThrow(/CATEGORY_COMPARISON_(SHAPE|VALUE)_INVALID/);
  });

  it("uses complete tuple identity even when category strings contain separators", async () => {
    const input = await inputFor(true);
    const draft = structuredClone(input.query_evidence_document);
    if (draft.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
    draft.projection.rows[0] = { ...draft.projection.rows[0], channel: "a|b", audience: "c" };
    draft.projection.rows[1] = { ...draft.projection.rows[1], channel: "a", audience: "b|c" };
    draft.projection.rows.reverse();
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_QUERY_REQUIRED");
    const plan = await compileCategoryComparisonPlan({
      ...input,
      query_evidence_ref: document.artifact_ref,
      query_evidence_document: document,
    });
    expect(plan.shape.rows).toEqual(draft.projection.rows);
  });
});
