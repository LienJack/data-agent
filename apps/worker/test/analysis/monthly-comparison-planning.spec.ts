import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import { compileMonthlyComparisonPlan } from "../../src/analysis/monthly-comparison-planning.js";
import { comparisonHash, monthlyComparisonFixture } from "./support/monthly-comparison-fixture.js";

async function planInput() {
  const fixture = await monthlyComparisonFixture();
  return {
    context: fixture.context,
    query_evidence_ref: fixture.reference,
    query_evidence_document: fixture.document,
  };
}

describe("published monthly multi-measure comparison plan", () => {
  it.each(["row-order", "column-order", "aliases", "datetime"])(
    "uses typed binding, not %s assumptions",
    async (variant) => {
      const input = await planInput();
      const original = structuredClone(input.query_evidence_document);
      const draft = structuredClone(original);
      if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
        throw new Error("TEST_TABLE_REQUIRED");
      const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
      if (variant === "row-order") draft.projection.rows.reverse();
      if (variant === "column-order") {
        binding.columns.reverse();
        draft.projection.columns.reverse();
      }
      if (variant === "aliases") {
        const renamed: Record<string, string> = {
          month: "t",
          current: "alpha",
          prior: "beta",
          rate: "gamma",
        };
        binding.columns = binding.columns.map((column) => ({
          ...column,
          output_name: renamed[column.output_name] ?? column.output_name,
        }));
        draft.projection.columns = draft.projection.columns.map((column) => ({
          ...column,
          key: renamed[column.key] ?? column.key,
        }));
        draft.projection.rows = draft.projection.rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [renamed[key] ?? key, value]),
          ),
        );
      }
      if (variant === "datetime") {
        binding.columns = binding.columns.map((column) =>
          column.output_name === "month" ? { ...column, logical_type: "DATETIME" } : column,
        );
        draft.projection.rows = draft.projection.rows.map((row) => ({
          ...row,
          month: new Date(Date.parse(`${String(row.month)}T00:00:00+08:00`)).toISOString(),
        }));
      }
      draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
      const document = await buildProductTeamArtifactDocument(draft);
      if (document.artifact_ref.artifact_type !== "QueryEvidence")
        throw new Error("TEST_QUERY_REQUIRED");
      const plan = await compileMonthlyComparisonPlan({
        ...input,
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
      });
      expect(plan.shape.ordered_rows.map((row) => row[plan.shape.time_column])).toEqual(
        Array.from({ length: 12 }, (_, index) => `2024-${String(index + 1).padStart(2, "0")}-01`),
      );
      expect(input.query_evidence_document).toEqual(original);
      expect(
        plan.execution_contract.measure_fields.map(({ source_column }) => source_column),
      ).toEqual(
        variant === "aliases"
          ? ["alpha", "beta", "gamma"]
          : variant === "column-order"
            ? ["rate", "prior", "current"]
            : ["current", "prior", "rate"],
      );
    },
  );

  it("binds each accepted source column while preserving role, NULL and original Metric authority", async () => {
    const input = await planInput();
    const plan = await compileMonthlyComparisonPlan(input);
    const contract = plan.result_contract;
    expect(contract.metric_bindings.map((item) => item.semantic_metric_id)).toEqual([
      "metric.revenue",
    ]);
    expect(contract.tables[0]?.columns.map((item) => item.semantic_role)).toEqual([
      "DIMENSION",
      "METRIC",
      "METRIC",
      "REQUEST_DERIVED",
    ]);
    expect(contract.tables[0]?.columns.map((item) => item.nullable)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(contract.tables[0]?.projection).toMatchObject({
      mode: "RESULT_COLLECTION",
      collection_field: "observations",
      column_mappings: ["month", "current", "prior", "rate"].map((key) => ({
        result_field: key,
        table_column: key,
        source: { input_name: "query_evidence", output_name: key },
      })),
    });
    expect(plan.shape.ordered_rows).toHaveLength(12);
    expect(plan.shape.ordered_rows[0]?.rate).toBeNull();
    expect(plan.required_operator_obligations).toEqual([]);
    expect(plan.execution_contract.claim_strength).toBe("DESCRIPTIVE");
    expect(plan.execution_contract.measure_fields.map((field) => field.source_column)).toEqual([
      "current",
      "prior",
      "rate",
    ]);
    expect(JSON.stringify(plan.execution_contract)).not.toContain("120");
  });

  it.each([
    "context",
    "release",
    "snapshot",
    "scope",
    "capability",
    "formula",
    "dimension",
    "timezone",
  ])("rejects %s authority drift", async (kind) => {
    const input = await planInput();
    const context = structuredClone(input.context);
    const metric = context.metrics[0];
    if (!metric) throw new Error("TEST_METRIC_REQUIRED");
    if (kind === "context") context.semantic_context_binding.package_hash = comparisonHash("f");
    if (kind === "release") context.semantic_release_ref.revision += 1;
    if (kind === "snapshot") context.schema_snapshot_ref.content_hash = comparisonHash("f");
    if (kind === "scope") {
      context.scope.environment = "other";
      for (const ref of [
        context.semantic_release_ref,
        context.schema_snapshot_ref,
        context.policy_receipt_ref,
        metric.metric_ref.container_ref,
      ])
        ref.environment = "other";
    }
    if (kind === "capability") metric.analysis_capabilities = ["TREND_CHANGE"];
    if (kind === "formula") metric.formula_hash = comparisonHash("f");
    if (kind === "dimension") metric.allowed_dimensions = [];
    if (kind === "timezone" && metric.time_domain) metric.time_domain.timezone = "UTC";
    const { context_hash: _contextHash, ...contextMaterial } = context;
    await expect(
      compileMonthlyComparisonPlan({
        ...input,
        context: await buildAnalysisContext(contextMaterial),
      }),
    ).rejects.toThrow("MONTHLY_COMPARISON_AUTHORITY_INVALID");
  });

  it.each([
    "gap",
    "duplicate",
    "null-time",
    "nonfinite",
    "all-null",
    "single-measure",
    "unknown-role",
    "extra-dimension",
    "window",
    "unselected-source",
  ])("rejects %s input instead of silently reshaping it", async (kind) => {
    const input = await planInput();
    const draft = structuredClone(input.query_evidence_document);
    if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
      throw new Error("TEST_TABLE_REQUIRED");
    let binding = structuredClone(draft.provenance.semantic_binding);
    if (kind === "gap") {
      draft.projection.rows.pop();
      draft.projection.total_rows = 11;
      draft.provenance.row_count = 11;
    }
    if (kind === "duplicate")
      draft.projection.rows = draft.projection.rows.map((row, index) =>
        index === 1 ? { ...row, month: "2024-01-01" } : row,
      );
    if (kind === "null-time") {
      binding.columns = binding.columns.map((column, index) =>
        index === 0 ? { ...column, nullable: true } : column,
      );
      draft.projection.rows = draft.projection.rows.map((row, index) =>
        index === 1 ? { ...row, month: null } : row,
      );
    }
    if (kind === "nonfinite")
      draft.projection.rows = draft.projection.rows.map((row, index) =>
        index === 1 ? { ...row, current: "NaN" } : row,
      );
    if (kind === "all-null")
      draft.projection.rows = draft.projection.rows.map((row) => ({ ...row, prior: null }));
    if (kind === "single-measure") {
      binding.columns = binding.columns.slice(0, 2);
      draft.projection.columns = draft.projection.columns.slice(0, 2);
      draft.projection.rows = draft.projection.rows.map(({ month, current }) => ({
        month: month ?? null,
        current: current ?? null,
      }));
    }
    if (kind === "unknown-role")
      binding.columns = binding.columns.map((column, index) =>
        index === 1
          ? {
              ...column,
              semantic_role: "PHYSICAL_COLUMN",
              formula_hash: null,
              aggregate: null,
            }
          : column,
      );
    if (kind === "extra-dimension")
      binding.columns = binding.columns.map((column, index) =>
        index === 2
          ? {
              ...column,
              semantic_role: "DIMENSION",
              formula_hash: null,
              aggregate: null,
            }
          : column,
      );
    if (kind === "window" && binding.time_window) binding.time_window.end = "2025-02-01";
    if (kind === "unselected-source") {
      const derived = binding.columns[3]?.request_derivation;
      if (!derived) throw new Error("TEST_DERIVATION_REQUIRED");
      derived.interpretation.source_object_ids = ["dimension.month", "metric.not_selected"];
      if (derived.interpretation.operator.kind !== "PERIOD_COMPARISON_RATE")
        throw new Error("TEST_OPERATOR_REQUIRED");
      derived.interpretation.operator.metric_id = "metric.not_selected";
    }
    const { binding_hash: _bindingHash, ...bindingMaterial } = binding;
    binding = await buildQueryEvidenceSemanticBinding(bindingMaterial);
    draft.provenance.semantic_binding = binding;
    if (kind === "nonfinite") {
      await expect(buildProductTeamArtifactDocument(draft)).rejects.toThrow(
        "QueryEvidence projection must match its exact semantic binding and receipt.",
      );
      return;
    }
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_QUERY_REQUIRED");
    await expect(
      compileMonthlyComparisonPlan({
        ...input,
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
      }),
    ).rejects.toThrow(
      /MONTHLY_COMPARISON_|ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID|ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID/,
    );
  });
});
