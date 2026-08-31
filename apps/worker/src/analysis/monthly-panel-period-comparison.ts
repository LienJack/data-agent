import type { QueryEvidenceSemanticBinding } from "@data-agent/contracts/artifacts";
import { z } from "zod";

export const PANEL_PERIOD_COMPARISON_MODULE_URL = import.meta.url;
const finite = z.number().finite();
const totals = z.strictObject({
  period: z.string().regex(/^\d{4}-\d{2}-01$/u),
  current_value: finite.nullable(),
  comparison_value: finite.nullable(),
  absolute_change: finite.nullable(),
  yoy_rate: finite.nullable(),
  ranking_eligible: z.boolean(),
});
export const panelPeriodComparisonSchema = z.strictObject({
  comparison_kind: z.literal("YEAR_OVER_YEAR"),
  group_coverage: z.literal("BOTH_PERIOD_GROUPS"),
  ranking_basis: z.literal("TOTAL_YOY_RATE"),
  months: z.array(totals).length(12),
  largest_declines: z
    .array(
      totals.extend({
        groups: z
          .array(
            z.strictObject({
              group: z.record(z.string(), z.string().min(1).max(256)),
              current_value: finite,
              comparison_value: finite,
              absolute_change: finite,
              yoy_rate: finite.nullable(),
              contribution_to_total_growth: finite,
            }),
          )
          .min(1)
          .max(32),
      }),
    )
    .max(3),
});

function fail(kind: "AUTHORITY" | "VALUE" | "NUMERIC_RANGE"): never {
  throw new TypeError(`MONTHLY_PANEL_COMPARISON_${kind}_INVALID`);
}

/** Called only after the QueryEvidence binding and its current-Run authority are verified. */
export function resolvePanelPeriodComparison(binding: QueryEvidenceSemanticBinding) {
  const rates = binding.columns.filter(
    (c) => c.request_derivation?.interpretation.operator.kind === "PERIOD_COMPARISON_RATE",
  );
  if (!rates.length) return null;
  const rate = rates[0],
    mapping = rate?.request_derivation?.period_comparison;
  if (
    rates.length !== 1 ||
    !rate ||
    !mapping ||
    mapping.group_coverage !== "BOTH_PERIOD_GROUPS" ||
    !mapping.category_output
  )
    return fail("AUTHORITY");
  return {
    ...mapping,
    category_output: mapping.category_output,
    group_coverage: "BOTH_PERIOD_GROUPS" as const,
    rate_output: rate.output_name,
  };
}
type ComparisonColumns = NonNullable<ReturnType<typeof resolvePanelPeriodComparison>>;

/** Independent Host arithmetic. Neither model output nor an earlier Run supplies expected values. */
export function evaluatePanelPeriodComparison(
  columns: ComparisonColumns,
  rows: readonly Readonly<Record<string, unknown>>[],
) {
  const number = (value: unknown) => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) return fail("VALUE");
    return value;
  };
  const sum = (values: readonly (number | null)[]) => {
    if (values.some((v) => v === null)) return null;
    return values.reduce<number>((total, value) => total + (value ?? fail("VALUE")), 0);
  };
  const periods = [...new Set(rows.map((row) => String(row[columns.time_output])))].sort();
  const months = periods.map((period) => {
    const selected = rows.filter((row) => row[columns.time_output] === period);
    const current = sum(selected.map((row) => number(row[columns.current_output])));
    const prior = sum(selected.map((row) => number(row[columns.comparison_output])));
    const change = current === null || prior === null ? null : current - prior;
    const rate = change === null || prior === null || prior === 0 ? null : change / prior;
    return {
      period,
      current_value: current,
      comparison_value: prior,
      absolute_change: change,
      yoy_rate: rate,
      ranking_eligible: current !== null && prior !== null && prior > 0,
    };
  });
  const ranked = months
    .filter((m) => m.ranking_eligible && m.yoy_rate !== null && m.yoy_rate < 0)
    .sort((a, b) => (a.yoy_rate ?? 0) - (b.yoy_rate ?? 0) || a.period.localeCompare(b.period))
    .slice(0, 3);
  const largest = ranked.map((month) => ({
    ...month,
    groups: rows
      .filter((row) => row[columns.time_output] === month.period)
      .map((row) => {
        const current = number(row[columns.current_output]),
          prior = number(row[columns.comparison_output]);
        const category = row[columns.category_output];
        if (
          current === null ||
          prior === null ||
          month.comparison_value === null ||
          typeof category !== "string"
        )
          return fail("VALUE");
        const change = current - prior;
        return {
          group: { [columns.category_output]: category },
          current_value: current,
          comparison_value: prior,
          absolute_change: change,
          yoy_rate: number(row[columns.rate_output]),
          contribution_to_total_growth: change / month.comparison_value,
        };
      }),
  }));
  const result = panelPeriodComparisonSchema.safeParse({
    comparison_kind: "YEAR_OVER_YEAR",
    group_coverage: "BOTH_PERIOD_GROUPS",
    ranking_basis: "TOTAL_YOY_RATE",
    months,
    largest_declines: largest,
  });
  return result.success ? result.data : fail("NUMERIC_RANGE");
}

export const PANEL_PERIOD_COMPARISON_RULES = Object.freeze([
  "When period_comparison is supplied, publish one additional data.period_comparison matching its schema. Copy comparison_kind=YEAR_OVER_YEAR, group_coverage=BOTH_PERIOD_GROUPS and ranking_basis=TOTAL_YOY_RATE exactly. Column roles come only from that sealed mapping, never names, labels, another Run, group averages or adjacent-month changes.",
  "months contains the twelve calendar periods ascending. For each period, sum raw current and comparison values independently across every category in source row order with an explicit loop initialized to 0.0 and repeated total += float(value); do not use sum(), pandas/numpy aggregates, rounding or reordering. If any contributing value is NULL, that side's total is NULL, not a partial sum or zero. absolute_change=current_value-comparison_value; yoy_rate=absolute_change/comparison_value, NULL when a side is missing or comparison_value=0. ranking_eligible is true only when both totals are observed and comparison_value>0; a negative base is not a standard decline-ranking denominator.",
  "largest_declines contains at most three ranking_eligible months whose total yoy_rate is strictly negative, ordered by total yoy_rate ascending then period ascending. It is NOT ranked by absolute amounts, individual category rates, their average, or largest_drops. Copy each month's complete total fields. For each selected month retain every category in source row order in groups; group contains the category output key and exact value. Copy raw current_value, comparison_value and the already proven group yoy_rate from rate_output. absolute_change is raw current minus prior; contribution_to_total_growth is that group difference divided by the overall comparison_value, not by the group's prior or the total decline. Contributions are growth-rate fractions (display as percentage points), not percentages of the total loss. Never infer causation.",
  "A missing comparison or non-positive total comparison denominator excludes the month from decline ranking. Do not manufacture three eligible declines when fewer exist. Generic measure largest_drops still describes adjacent-month changes within that source series only; it is not the year-over-year decomposition. Preserve all raw observations/table/chart rows, including missing values.",
]);
