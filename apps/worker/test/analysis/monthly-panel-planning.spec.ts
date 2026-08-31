import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import { compileMonthlyPanelPlan } from "../../src/analysis/monthly-panel-planning.js";
import { comparisonHash } from "./support/monthly-comparison-fixture.js";
import { monthlyPanelFixture, monthlyPeriodPanelFixture } from "./support/monthly-panel-fixture.js";

async function inputFor(two = true, derived = true, datetime = false) {
  const source = await monthlyPanelFixture(two, derived, datetime);
  return {
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  };
}

describe("source-bound monthly group panel plan", () => {
  it.each([false, true])(
    "accepts two exact complete calendar months: datetime=%s",
    async (datetime) => {
      const source = await monthlyPanelFixture(true, true, datetime, 2);
      const original = structuredClone(source);
      const plan = await compileMonthlyPanelPlan({
        context: source.context,
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
      });
      expect(plan.execution_contract.method_id).toBe("published-monthly-group-panel@2");
      expect(plan.execution_contract.month_count).toBe(2);
      expect(plan.shape.groups.every(({ rows }) => rows.length === 2)).toBe(true);
      expect(plan.shape.ordered_rows).toHaveLength(8);
      expect(plan.result_contract.tables[0]?.max_rows).toBe(64);
      expect(source).toEqual(original);
    },
  );

  it.each(["gap", "duplicate", "one-month", "three-months", "partial-end"])(
    "rejects an incomplete two-month panel: %s",
    async (kind) => {
      const source = await monthlyPanelFixture(true, true, false, 2);
      const draft = structuredClone(source.document);
      if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
        throw new Error("TEST_QUERY_REQUIRED");
      const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
      if (kind === "gap") draft.projection.rows.pop();
      if (kind === "duplicate") draft.projection.rows[1] = { ...draft.projection.rows[0] };
      if (binding.time_window) {
        if (kind === "one-month") binding.time_window.end = "2024-02-01";
        if (kind === "three-months") binding.time_window.end = "2024-04-01";
        if (kind === "partial-end") binding.time_window.end = "2024-03-02";
      }
      draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
      draft.provenance.row_count = draft.projection.total_rows = draft.projection.rows.length;
      const document = await buildProductTeamArtifactDocument(draft);
      if (document.artifact_ref.artifact_type !== "QueryEvidence")
        throw new Error("TEST_QUERY_REQUIRED");
      await expect(
        compileMonthlyPanelPlan({
          context: source.context,
          query_evidence_ref: document.artifact_ref,
          query_evidence_document: document,
        }),
      ).rejects.toThrow(/MONTHLY_PANEL_WINDOW_INVALID/);
    },
  );

  it("takes period roles from sealed proof metadata, not misleading output names", async () => {
    const source = await monthlyPeriodPanelFixture();
    const plan = await compileMonthlyPanelPlan({
      context: source.context,
      query_evidence_ref: source.reference,
      query_evidence_document: source.document,
    });
    expect(plan.execution_contract.period_comparison).toEqual({
      time_output: "month",
      current_output: "revenue",
      comparison_output: "spend",
      category_output: "channel",
      rate_output: "return_rate",
      group_coverage: "BOTH_PERIOD_GROUPS",
    });
    expect(plan.result_contract.result_fields.map(({ field }) => field)).toContain(
      "period_comparison",
    );
    expect(JSON.stringify(plan.execution_contract)).not.toContain('"largest_declines":[');
  });
  it.each(["missing-metadata", "current-only", "nonadditive"])(
    "rejects incomplete overall comparison authority: %s",
    async (kind) => {
      const source = await monthlyPeriodPanelFixture();
      const draft = structuredClone(source.document);
      if (draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
        throw new Error("TEST_QUERY_REQUIRED");
      const { binding_hash: _hash, ...material } = draft.provenance.semantic_binding;
      const rate = material.columns.find((column) => column.request_derivation);
      if (!rate?.request_derivation?.period_comparison) throw new Error("TEST_RATE_REQUIRED");
      if (kind === "missing-metadata") delete rate.request_derivation.period_comparison;
      if (kind === "current-only" && rate.request_derivation.period_comparison)
        rate.request_derivation.period_comparison.group_coverage = "CURRENT_PERIOD_GROUPS";
      draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(material);
      const document = await buildProductTeamArtifactDocument(draft);
      if (document.artifact_ref.artifact_type !== "QueryEvidence")
        throw new Error("TEST_QUERY_REQUIRED");
      const { context_hash: _contextHash, ...contextMaterial } = structuredClone(source.context);
      if (kind === "nonadditive")
        for (const metric of contextMaterial.metrics) metric.additivity = "non-additive";
      await expect(
        compileMonthlyPanelPlan({
          context: await buildAnalysisContext(contextMaterial),
          query_evidence_ref: document.artifact_ref,
          query_evidence_document: document,
        }),
      ).rejects.toThrow(/MONTHLY_PANEL_(COMPARISON_)?AUTHORITY_INVALID/);
    },
  );
  it.each(["row-order", "column-order", "aliases", "tuple-separator", "32-groups", "16-facets"])(
    "preserves complete source identity at %s",
    async (variant) => {
      const input = await inputFor();
      const draft = structuredClone(input.query_evidence_document);
      if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
        throw new Error("TEST_QUERY_REQUIRED");
      const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
      if (variant === "row-order") draft.projection.rows.reverse();
      if (variant === "column-order") {
        binding.columns.reverse();
        draft.projection.columns.reverse();
      }
      if (variant === "aliases") {
        const rename = (key: string) => `source_${key}`;
        binding.columns = binding.columns.map((column) => ({
          ...column,
          output_name: rename(column.output_name),
        }));
        draft.projection.columns = draft.projection.columns.map((column) => ({
          ...column,
          key: rename(column.key),
        }));
        draft.projection.rows = draft.projection.rows.map((row) =>
          Object.fromEntries(Object.entries(row).map(([key, value]) => [rename(key), value])),
        );
      }
      if (variant === "tuple-separator")
        draft.projection.rows = draft.projection.rows
          .filter((row) => row.audience === "新客")
          .map((row) => ({
            ...row,
            channel: row.channel === "Email" ? "a|b" : "a",
            audience: row.channel === "Email" ? "c" : "b|c",
          }));
      if (variant === "32-groups" || variant === "16-facets") {
        const rows = draft.projection.rows.filter(
          (row) => row.channel === "Email" && row.audience === "新客",
        );
        draft.projection.rows = Array.from(
          { length: variant === "32-groups" ? 32 : 16 },
          (_, index) =>
            rows.map((row) => ({
              ...row,
              channel: `channel_${index}`,
              audience: variant === "16-facets" ? `audience_${index}` : "新客",
            })),
        ).flat();
      }
      draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
      draft.provenance.row_count = draft.projection.rows.length;
      draft.projection.total_rows = draft.projection.rows.length;
      const document = await buildProductTeamArtifactDocument(draft);
      if (document.artifact_ref.artifact_type !== "QueryEvidence")
        throw new Error("TEST_QUERY_REQUIRED");
      const plan = await compileMonthlyPanelPlan({
        ...input,
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
      });
      expect(plan.shape.groups).toHaveLength(
        variant === "32-groups"
          ? 32
          : variant === "16-facets"
            ? 16
            : variant === "tuple-separator"
              ? 2
              : 4,
      );
      expect(plan.shape.ordered_rows).toHaveLength(draft.projection.rows.length);
      expect(plan.shape.ordered_rows[0]?.[plan.shape.time_column]).toBe("2024-01-01");
      expect(plan.shape.groups.every(({ rows }) => rows.length === 12)).toBe(true);
      expect(plan.result_contract.tables[0]?.columns.map(({ key }) => key)).toEqual(
        binding.columns.map(({ output_name }) => output_name),
      );
      if (variant === "aliases")
        expect(plan.execution_contract.chart_bindings).toMatchObject({
          x_field: "source_month",
          series_field: "source_channel",
          facet_field: "source_audience",
        });
    },
  );
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, false],
  ])(
    "preserves each original monthly tuple: two=%s derived=%s datetime=%s",
    async (two, derived, datetime) => {
      const input = await inputFor(two, derived, datetime);
      const original = structuredClone(input);
      const plan = await compileMonthlyPanelPlan(input);
      expect(input).toEqual(original);
      expect(plan.shape.groups).toHaveLength(two ? 4 : 2);
      expect(plan.shape.groups.every((group) => group.rows.length === 12)).toBe(true);
      expect(plan.shape.ordered_rows).toHaveLength(two ? 48 : 24);
      expect(plan.shape.ordered_rows[0]?.month).toBe("2024-01-01");
      expect(plan.result_contract.grain).toEqual({
        dimension_ids: [
          "dimension.month",
          "dimension.channel",
          ...(two ? ["dimension.audience"] : []),
        ],
        time_dimension_id: "dimension.month",
        time_grain: "MONTH",
      });
      expect(plan.result_contract.tables[0]?.columns.at(-1)?.semantic_role).toBe(
        derived ? "REQUEST_DERIVED" : "FORMULA",
      );
      expect(plan.result_contract.metric_bindings).toHaveLength(2);
      expect(plan.execution_contract.chart_bindings).toEqual({
        x_field: "month",
        y_fields: ["spend", "revenue", "return_rate"],
        series_field: "channel",
        lower_bound_field: null,
        upper_bound_field: null,
        ...(two ? { facet_field: "audience" } : {}),
      });
      expect(plan.execution_contract.measure_fields.map(({ field }) => field)).toEqual([
        "measure_1",
        "measure_2",
        "measure_3",
      ]);
      expect(plan.result_contract.result_fields.map(({ field }) => field)).toContain(
        "opposed_changes",
      );
      expect(plan.required_operator_obligations).toEqual([]);
      expect(JSON.stringify(plan.execution_contract)).not.toContain('"spend":100');
    },
  );

  it.each([
    "gap",
    "duplicate",
    "no-window",
    "short-window",
    "null-group",
    "empty-group",
    "null-month",
    "all-null",
    "too-many-groups",
    "17-facets",
    "fourth-dimension",
    "unknown-role",
  ])("rejects unproved panel shape: %s", async (kind) => {
    const input = await inputFor();
    const draft = structuredClone(input.query_evidence_document);
    if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
      throw new Error("TEST_QUERY_REQUIRED");
    const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
    if (kind === "gap") draft.projection.rows.splice(5, 1);
    if (kind === "duplicate") draft.projection.rows[1] = { ...draft.projection.rows[0] };
    if (kind === "null-group" || kind === "empty-group")
      draft.projection.rows[0] = {
        ...draft.projection.rows[0],
        audience: kind === "null-group" ? null : "",
      };
    if (kind === "null-month")
      draft.projection.rows[0] = { ...draft.projection.rows[0], month: null };
    if (kind === "all-null")
      draft.projection.rows = draft.projection.rows.map((row) =>
        row.channel === "Email" ? { ...row, return_rate: null } : row,
      );
    if (kind === "no-window") binding.time_window = null;
    if (kind === "short-window" && binding.time_window) binding.time_window.end = "2024-12-01";
    if (kind === "too-many-groups") {
      const rows = draft.projection.rows.filter(
        (row) => row.channel === "Email" && row.audience === "新客",
      );
      draft.projection.rows = Array.from({ length: 33 }, (_, index) =>
        rows.map((row) => ({ ...row, channel: `group_${index}` })),
      ).flat();
    }
    if (kind === "17-facets") {
      const rows = draft.projection.rows.filter(
        (row) => row.channel === "Email" && row.audience === "新客",
      );
      draft.projection.rows = Array.from({ length: 17 }, (_, index) =>
        rows.map((row) => ({ ...row, audience: `audience_${index}` })),
      ).flat();
    }
    if (kind === "fourth-dimension") {
      const first = binding.columns[1];
      if (!first) throw new Error("TEST_COLUMN_REQUIRED");
      binding.columns.push({
        ...first,
        output_name: "extra",
        semantic_object_id: "dimension.extra",
      });
      draft.projection.columns.push({ key: "extra", label: "额外分类", data_type: "STRING" });
      draft.projection.rows = draft.projection.rows.map((row) => ({ ...row, extra: "x" }));
    }
    if (kind === "unknown-role")
      binding.columns = binding.columns.map((column, index) =>
        index === 1 ? { ...column, semantic_role: "PHYSICAL_COLUMN" } : column,
      );
    draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
    draft.projection.total_rows = draft.projection.rows.length;
    draft.provenance.row_count = draft.projection.rows.length;
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_QUERY_REQUIRED");
    await expect(
      compileMonthlyPanelPlan({
        ...input,
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
      }).then(() => "ACCEPTED"),
    ).rejects.toThrow(/MONTHLY_(PANEL|COMPARISON)_/);
  });

  it.each(["context", "capability", "dimension", "unit", "grain", "formula", "timezone", "run"])(
    "preserves original source and applicability boundaries: %s",
    async (kind) => {
      const input = await inputFor();
      const { context_hash: _hash, ...material } = structuredClone(input.context);
      const metric = material.metrics[0];
      if (!metric) throw new Error("TEST_METRIC_REQUIRED");
      if (kind === "context") material.semantic_context_binding.package_hash = comparisonHash("e");
      if (kind === "capability") metric.analysis_capabilities = [];
      if (kind === "dimension")
        metric.allowed_dimensions = metric.allowed_dimensions.filter(
          (item) => item.dimension_id !== "dimension.audience",
        );
      if (kind === "unit")
        metric.unit = {
          unit_id: "count",
          dimension: "count",
          base_unit: "count",
          conversion_factor: 1,
        };
      if (kind === "grain") metric.grain = { grain_id: "different", granularity: "atomic" };
      if (kind === "formula") metric.formula_hash = comparisonHash("f");
      if (kind === "timezone" && metric.time_domain) metric.time_domain.timezone = "UTC";
      if (kind === "run")
        input.query_evidence_ref = {
          ...input.query_evidence_ref,
          run_id: "62700000-0000-4000-8000-000000000999",
        };
      await expect(
        compileMonthlyPanelPlan({ ...input, context: await buildAnalysisContext(material) }).then(
          () => "ACCEPTED",
        ),
      ).rejects.toThrow("MONTHLY_PANEL_AUTHORITY_INVALID");
    },
  );
});
