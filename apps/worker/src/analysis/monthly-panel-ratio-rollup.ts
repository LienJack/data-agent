import type { QueryEvidenceSemanticBinding } from "@data-agent/contracts/artifacts";
import type { AnalysisContext } from "@data-agent/contracts/context";
import { z } from "zod";

export const PANEL_RATIO_ROLLUP_MODULE_URL = import.meta.url;
const finite = z.number().finite().nullable();
const values = z.strictObject({ numerator: finite, denominator: finite, ratio: finite });
const change = z.strictObject({
  from: values,
  to: values,
  denominator_change: finite,
  ratio_change: finite,
});
export const panelRatioRollupSchema = z.strictObject({
  basis: z.literal("SUM_BEFORE_RATIO"),
  from_period: z.string().regex(/^\d{4}-\d{2}-01$/u),
  to_period: z.string().regex(/^\d{4}-\d{2}-01$/u),
  numerator_output: z.string(),
  denominator_output: z.string(),
  ratio_output: z.string(),
  numerator_adjustment: z.enum(["NONE", "SUBTRACT_DENOMINATOR"]),
  axes: z
    .array(
      z.strictObject({
        dimension_id: z.string(),
        dimension_output: z.string(),
        groups: z
          .array(
            change.extend({
              value: z.string(),
              selected: z.boolean(),
              children: z.array(change.extend({ group: z.record(z.string(), z.string()) })).max(32),
            }),
          )
          .min(1)
          .max(32),
      }),
    )
    .length(2),
});

function fail(kind: "AUTHORITY" | "VALUE" | "NUMERIC_RANGE"): never {
  throw new TypeError(`MONTHLY_PANEL_RATIO_${kind}_INVALID`);
}

/** Shape metadata only, called after exact QueryEvidence/context authority verification. */
export function resolvePanelRatioRollup(
  binding: QueryEvidenceSemanticBinding,
  context: AnalysisContext,
  monthCount: number,
) {
  const categories = binding.columns.filter(
    (column) => column.semantic_role === "DIMENSION" && column.logical_type === "STRING",
  );
  if (monthCount !== 2 || categories.length !== 2) return null;
  const ratios = binding.columns.filter(
    (column) => column.request_derivation?.interpretation.operator.kind === "AGGREGATE_RATIO",
  );
  if (!ratios.length) return null;
  const ratio = ratios[0];
  const operator = ratio?.request_derivation?.interpretation.operator;
  const time = binding.columns.filter(
    (column) =>
      column.semantic_role === "DIMENSION" && ["DATE", "DATETIME"].includes(column.logical_type),
  );
  if (
    ratios.length !== 1 ||
    !ratio ||
    operator?.kind !== "AGGREGATE_RATIO" ||
    time.length !== 1 ||
    !time[0]
  )
    return fail("AUTHORITY");
  const operand = (metricId: string) => {
    const columns = binding.columns.filter(
      (column) => column.semantic_role === "METRIC" && column.semantic_object_id === metricId,
    );
    const metric = context.metrics.find((candidate) => candidate.metric_ref.node_id === metricId);
    if (columns.length !== 1 || !columns[0] || metric?.additivity !== "additive")
      return fail("AUTHORITY");
    return columns[0].output_name;
  };
  return {
    time_output: time[0].output_name,
    categories: categories.map((column) => ({
      dimension_id: column.semantic_object_id,
      dimension_output: column.output_name,
    })),
    numerator_output: operand(operator.numerator_metric_id),
    denominator_output: operand(operator.denominator_metric_id),
    ratio_output: ratio.output_name,
    numerator_adjustment: operator.numerator_adjustment,
  };
}
type Mapping = NonNullable<ReturnType<typeof resolvePanelRatioRollup>>;

/** Independent Host sums of raw additive operands; never averages source ratios or filters children first. */
export function evaluatePanelRatioRollup(
  mapping: Mapping,
  rows: readonly Readonly<Record<string, unknown>>[],
) {
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : fail("VALUE");
  const periods = [...new Set(rows.map((row) => text(row[mapping.time_output])))].sort();
  const from = periods[0],
    to = periods[1];
  if (periods.length !== 2 || !from || !to) return fail("VALUE");
  const sum = (selected: typeof rows, column: string) => {
    if (!selected.length) return null;
    let total = 0;
    for (const row of selected) {
      const value = row[column];
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("VALUE");
      total += value;
    }
    return total;
  };
  const at = (selected: typeof rows, period: string) => {
    const subset = selected.filter((row) => row[mapping.time_output] === period);
    const numerator = sum(subset, mapping.numerator_output),
      denominator = sum(subset, mapping.denominator_output);
    return {
      numerator,
      denominator,
      ratio:
        numerator === null || denominator === null || denominator === 0
          ? null
          : (numerator -
              (mapping.numerator_adjustment === "SUBTRACT_DENOMINATOR" ? denominator : 0)) /
            denominator,
    };
  };
  const compare = (selected: typeof rows) => {
    const before = at(selected, from),
      after = at(selected, to);
    return {
      from: before,
      to: after,
      denominator_change:
        before.denominator === null || after.denominator === null
          ? null
          : after.denominator - before.denominator,
      ratio_change:
        before.ratio === null || after.ratio === null ? null : after.ratio - before.ratio,
    };
  };
  const result = panelRatioRollupSchema.safeParse({
    basis: "SUM_BEFORE_RATIO",
    from_period: from,
    to_period: to,
    numerator_output: mapping.numerator_output,
    denominator_output: mapping.denominator_output,
    ratio_output: mapping.ratio_output,
    numerator_adjustment: mapping.numerator_adjustment,
    axes: mapping.categories.map((axis) => ({
      ...axis,
      groups: [...new Set(rows.map((row) => text(row[axis.dimension_output])))].map((value) => {
        const selectedRows = rows.filter((row) => row[axis.dimension_output] === value);
        const parent = compare(selectedRows);
        const selected =
          parent.from.denominator !== null &&
          parent.from.denominator > 0 &&
          parent.to.denominator !== null &&
          parent.to.denominator > 0 &&
          parent.denominator_change !== null &&
          parent.denominator_change > 0 &&
          parent.ratio_change !== null &&
          parent.ratio_change < 0;
        const tuples = new Map<
          string,
          { group: Record<string, string>; rows: Record<string, unknown>[] }
        >();
        if (selected)
          for (const row of selectedRows) {
            const group = Object.fromEntries(
              mapping.categories.map((category) => [
                category.dimension_output,
                text(row[category.dimension_output]),
              ]),
            );
            const key = JSON.stringify(Object.values(group));
            const entry = tuples.get(key) ?? { group, rows: [] };
            entry.rows.push(row);
            tuples.set(key, entry);
          }
        return {
          value,
          ...parent,
          selected,
          children: [...tuples.values()].map(({ group, rows: children }) => ({
            group,
            ...compare(children),
          })),
        };
      }),
    })),
  });
  return result.success ? result.data : fail("NUMERIC_RANGE");
}

export const PANEL_RATIO_ROLLUP_RULES = Object.freeze([
  "ratio_rollup is aggregate-before-filter evidence for two complete months. Use only ratio_rollup_mapping for operand roles and the two original category axes. For each axis and value, sum raw numerator and denominator independently over every child in each month, in source order; any NULL contribution makes that total NULL. Recompute the ratio from these sums with the sealed adjustment; never sum/average source ratios.",
  "A parent is selected only when both total denominators are positive, denominator_change is strictly positive and ratio_change strictly negative. Include every parent's totals, including unselected parents. Only selected parents receive children, and those children include every original tuple, even ones with rising ratios or falling denominators. Do not apply the parent predicate again to children. Missing/zero/nonpositive denominators cannot justify selection; preserve undefined ratios and empty selections. No causal or persistent-trend claims. Keep the entire original observations/table/chart unchanged.",
]);
