import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { monthlyPanelOracleInternals } from "../../../src/analysis/monthly-panel-oracle.js";
import { compileMonthlyPanelPlan } from "../../../src/analysis/monthly-panel-planning.js";
import { monthlyPanelFixture, monthlyPeriodPanelFixture } from "./monthly-panel-fixture.js";

export const panelReferenceVariants = [
  "base",
  "two-categories",
  "datetime",
  "period",
  "period-datetime",
  "aliases",
  "reverse-order",
  "null-current",
  "zero-prior",
  "negative-prior",
  "no-decline",
  "floating",
  "two-months",
  "two-months-datetime",
  "two-months-counterexample",
  "two-months-null",
  "two-months-zero",
  "two-months-negative",
  "two-months-no-match",
  "two-months-aliases",
  "two-months-reverse-order",
  "two-months-floating",
] as const;

export async function panelReferenceCase(variant: (typeof panelReferenceVariants)[number]) {
  const twoMonths = variant.startsWith("two-months");
  const period = !twoMonths && !["base", "two-categories", "datetime"].includes(variant);
  const source = period
    ? await monthlyPeriodPanelFixture()
    : await monthlyPanelFixture(
        twoMonths || variant === "two-categories",
        true,
        variant === "datetime" || variant === "two-months-datetime",
        twoMonths ? 2 : 12,
      );
  const draft = structuredClone(source.document);
  if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
    throw new Error("TEST_QUERY_REQUIRED");
  const { binding_hash: _hash, ...binding } = draft.provenance.semantic_binding;
  if (twoMonths) {
    for (const [index, row] of draft.projection.rows.entries()) {
      const before = row.month === "2024-01-01";
      if (variant === "two-months-counterexample" && row.channel === "Email") {
        row.spend = row.audience === "新客" ? (before ? 10 : 20) : before ? 90 : 180;
        row.revenue = row.audience === "新客" ? 100 : before ? 90 : 198;
      }
      if (variant === "two-months-null" && !before && row.audience === "新客") row.revenue = null;
      if (variant === "two-months-zero" && before) row.spend = 0;
      if (variant === "two-months-negative" && before) row.spend = -10;
      if (variant === "two-months-no-match") row.revenue = Number(row.spend) * 2;
      if (variant === "two-months-floating") {
        row.spend = index % 2 === 0 ? 0.1 : 1.23;
        row.revenue = before ? 0.13 : 0.04;
      }
      row.return_rate =
        row.revenue === null || row.spend === 0
          ? null
          : (Number(row.revenue) - Number(row.spend)) / Number(row.spend);
    }
  }
  if (variant === "period-datetime") {
    for (const column of binding.columns)
      if (column.output_name === "month") column.logical_type = "DATETIME";
    for (const row of draft.projection.rows)
      row.month = new Date(`${row.month}T00:00:00+08:00`).toISOString();
  }
  if (
    ["null-current", "zero-prior", "negative-prior", "no-decline", "floating"].includes(variant)
  ) {
    for (const [index, row] of draft.projection.rows.entries()) {
      if (variant === "null-current" && row.month === "2024-12-01" && row.channel === "Email")
        row.revenue = null;
      if (variant === "zero-prior" && row.month === "2024-12-01") row.spend = 0;
      if (variant === "negative-prior" && row.month === "2024-12-01") row.spend = -10;
      if (variant === "no-decline") row.revenue = Number(row.spend) * 2;
      if (variant === "floating") {
        row.spend = index % 2 === 0 ? 0.1 : 1.23;
        row.revenue = index % 3 === 0 ? 0.09 : 0.01;
      }
      row.return_rate =
        row.revenue === null || row.spend === 0
          ? null
          : (Number(row.revenue) - Number(row.spend)) / Number(row.spend);
    }
  }
  if (variant === "aliases" || variant === "two-months-aliases") {
    const rename = (key: string) => `bound_${key}`;
    for (const column of binding.columns) {
      column.output_name = rename(column.output_name);
      const mapping = column.request_derivation?.period_comparison;
      if (mapping) {
        mapping.time_output = rename(mapping.time_output);
        mapping.current_output = rename(mapping.current_output);
        mapping.comparison_output = rename(mapping.comparison_output);
        if (mapping.category_output) mapping.category_output = rename(mapping.category_output);
      }
    }
    draft.projection.columns = draft.projection.columns.map((column) => ({
      ...column,
      key: rename(column.key),
    }));
    draft.projection.rows = draft.projection.rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [rename(key), value])),
    );
  }
  if (variant === "reverse-order" || variant === "two-months-reverse-order") {
    binding.columns.reverse();
    draft.projection.columns.reverse();
    draft.projection.rows.reverse();
  }
  draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(binding);
  const document = await buildProductTeamArtifactDocument(draft);
  if (
    document.artifact_ref.artifact_type !== "QueryEvidence" ||
    document.projection.kind !== "TABLE"
  )
    throw new Error("TEST_QUERY_REQUIRED");
  const plan = await compileMonthlyPanelPlan({
    context: source.context,
    query_evidence_ref: document.artifact_ref,
    query_evidence_document: document,
  });
  const {
    preparation_reference: _reference,
    rules: _rules,
    ...configuration
  } = plan.execution_contract;
  return {
    name: variant,
    source_rows: document.projection.rows,
    configuration,
    expected: monthlyPanelOracleInternals.expectedPanelData(plan).data,
  };
}
