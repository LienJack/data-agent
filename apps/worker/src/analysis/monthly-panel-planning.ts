import {
  type ArtifactReference,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import { evaluateAnalysisApplicability } from "@data-agent/semantic/runtime-context";
import { z } from "zod";
import {
  resolveAnalysisResultSourceObjects,
  verifyAcceptedAnalysisQueryEvidence,
} from "./analysis-result-source-authority.js";
import { buildDescriptiveResultContract } from "./descriptive-result-contract.js";
import { calendarDate, monthlyComparisonMeasureSchema } from "./monthly-comparison-planning.js";
import {
  PANEL_PERIOD_COMPARISON_RULES,
  panelPeriodComparisonSchema,
  resolvePanelPeriodComparison,
} from "./monthly-panel-period-comparison.js";

export const MONTHLY_PANEL_METHOD_ID = "published-monthly-group-panel@1";
export const MONTHLY_PANEL_CONTRACT_ID = "monthly-group-panel.result";
export const MONTHLY_PANEL_TABLE_ID = "monthly_panel";
export const MONTHLY_PANEL_CHART_ID = "monthly_panel_line";
const MAX_GROUPS = 32;
const MONTHS = 12;
const groupSchema = z.record(z.string(), z.string().min(1).max(256));
const periodSchema = z.string().regex(/^\d{4}-\d{2}-01$/u);
export const monthlyPanelMeasureSchema = z.strictObject({
  groups: z
    .array(monthlyComparisonMeasureSchema.extend({ group: groupSchema }))
    .min(1)
    .max(MAX_GROUPS),
});
export const monthlyPanelOpposedChangesSchema = z.strictObject({
  pairs: z
    .array(
      z.strictObject({
        group: groupSchema,
        increasing_column: z.string(),
        decreasing_column: z.string(),
        from_period: periodSchema,
        to_period: periodSchema,
        increasing_absolute_change: z.number().finite().positive(),
        decreasing_absolute_change: z.number().finite().negative(),
        increasing_relative_change: z.number().finite().nullable(),
        decreasing_relative_change: z.number().finite().nullable(),
      }),
    )
    .max(MAX_GROUPS * 12),
});

interface MonthlyPanelInput {
  readonly context: AnalysisContext;
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly query_evidence_document: ProductTeamArtifactDocument;
}
function fail(kind: "AUTHORITY" | "SHAPE" | "VALUE" | "WINDOW"): never {
  throw new TypeError(`MONTHLY_PANEL_${kind}_INVALID`);
}

/** A complete monthly panel, selected by source shape and published capability, never question text. */
export async function compileMonthlyPanelPlan(input: MonthlyPanelInput) {
  const context = await verifyAnalysisContext(input.context);
  const document = await verifyProductTeamArtifactDocument(input.query_evidence_document);
  const verified = await verifyAcceptedAnalysisQueryEvidence({
    context,
    run_id: input.query_evidence_ref.run_id,
    query_evidence: { reference: input.query_evidence_ref, document },
  }).catch(() => fail("AUTHORITY"));
  const binding = verified.semantic_binding;
  if (document.projection.kind !== "TABLE") return fail("SHAPE");
  const dimensions = binding.columns.filter((column) => column.semantic_role === "DIMENSION");
  const times = dimensions.filter((column) => ["DATE", "DATETIME"].includes(column.logical_type));
  const time = times[0];
  const categories = dimensions.filter((column) => column.logical_type === "STRING");
  const measures = binding.columns.filter(
    (column) =>
      ["METRIC", "FORMULA", "REQUEST_DERIVED"].includes(column.semantic_role) &&
      column.logical_type === "NUMBER",
  );
  const window = binding.time_window;
  const columns = document.projection.columns;
  const rows = document.projection.rows;
  if (
    times.length !== 1 ||
    !time ||
    time.grain.granularity !== "month" ||
    categories.length < 1 ||
    categories.length > 2 ||
    categories.some((column) => column.grain.granularity !== "atomic") ||
    dimensions.length !== categories.length + 1 ||
    new Set(dimensions.map((column) => column.semantic_object_id)).size !== dimensions.length ||
    measures.length < 1 ||
    measures.length > 4 ||
    dimensions.length + measures.length !== binding.columns.length ||
    rows.length < MONTHS ||
    rows.length > MONTHS * MAX_GROUPS ||
    !window?.timezone ||
    window.dimension_id !== time.semantic_object_id ||
    binding.columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(column.output_name)) ||
    columns.length !== binding.columns.length ||
    columns.some(
      (column, index) =>
        column.key !== binding.columns[index]?.output_name ||
        column.label.trim().length === 0 ||
        column.label.length > 80 ||
        column.data_type !==
          (binding.columns[index]?.semantic_role === "DIMENSION" ? "STRING" : "NUMBER"),
    )
  )
    return fail("SHAPE");

  const timezone = window.timezone;
  const first = calendarDate(window.start, timezone);
  const start = new Date(`${first}T00:00:00.000Z`);
  if (
    !periodSchema.safeParse(first).success ||
    !Number.isFinite(start.valueOf()) ||
    start.toISOString().slice(0, 10) !== first
  )
    return fail("WINDOW");
  const periods = Array.from({ length: MONTHS + 1 }, (_, index) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))
      .toISOString()
      .slice(0, 10),
  );
  if (calendarDate(window.end, window.timezone) !== periods[MONTHS]) return fail("WINDOW");
  const orderedRows = rows
    .map((row) => {
      const raw = row[time.output_name];
      if (typeof raw !== "string") return fail("VALUE");
      const month = time.logical_type === "DATE" ? raw : calendarDate(raw, timezone);
      if (!periods.slice(0, MONTHS).includes(month)) return fail("WINDOW");
      for (const column of categories) {
        const value = row[column.output_name];
        if (typeof value !== "string" || !value.trim() || value.length > 256) return fail("VALUE");
      }
      for (const column of measures) {
        const value = row[column.output_name];
        if (
          value === null ? !column.nullable : typeof value !== "number" || !Number.isFinite(value)
        )
          return fail("VALUE");
      }
      return { ...row, [time.output_name]: month };
    })
    .sort((left, right) =>
      String(left[time.output_name]).localeCompare(String(right[time.output_name])),
    );
  const grouped = new Map<string, { group: Record<string, string>; rows: typeof orderedRows }>();
  for (const row of orderedRows) {
    const group = Object.fromEntries(
      categories.map((column) => [column.output_name, String(row[column.output_name])]),
    );
    const key = JSON.stringify(Object.values(group));
    const entry = grouped.get(key) ?? { group, rows: [] };
    entry.rows.push(row);
    grouped.set(key, entry);
  }
  const groups = [...grouped.values()];
  if (
    groups.length > MAX_GROUPS ||
    groups.some(
      (group) =>
        group.rows.length !== MONTHS ||
        group.rows.some((row, index) => row[time.output_name] !== periods[index]),
    )
  )
    return fail("WINDOW");
  const facet = categories[1];
  if (facet && new Set(orderedRows.map((row) => row[facet.output_name])).size > 16)
    return fail("SHAPE");
  if (
    groups.some((group) =>
      measures.some((column) => group.rows.every((row) => row[column.output_name] === null)),
    )
  )
    return fail("VALUE");

  const metricIds = [
    ...new Set(
      measures
        .filter((column) => column.semantic_role === "METRIC")
        .map((column) => column.semantic_object_id),
    ),
  ].sort();
  const dimensionIds = [
    time.semantic_object_id,
    ...categories.map((column) => column.semantic_object_id),
  ];
  const metrics = metricIds.map(
    (id) => context.metrics.find((metric) => metric.metric_ref.node_id === id) ?? fail("AUTHORITY"),
  );
  if (
    metrics.length < 1 ||
    metrics.length > 3 ||
    metrics.length !== context.metrics.length ||
    metrics.some(
      (metric) =>
        metric.time_dimension_ref !== time.semantic_object_id ||
        metric.time_domain?.timezone !== window.timezone ||
        metric.time_domain?.calendar !== "gregorian" ||
        measures.some(
          (column) =>
            column.semantic_role === "METRIC" &&
            column.semantic_object_id === metric.metric_ref.node_id &&
            column.formula_hash !== metric.formula_hash,
        ) ||
        dimensionIds.some(
          (id) =>
            !metric.allowed_dimensions.some(
              (dimension) => dimension.dimension_id === id && dimension.groupable,
            ),
        ),
    ) ||
    (
      await evaluateAnalysisApplicability(context, {
        skill_id: "open-python-analysis@1",
        metric_ids: metricIds,
        dimension_ids: dimensionIds,
      })
    ).verdict !== "APPLICABLE"
  )
    return fail("AUTHORITY");

  const measureFields = measures.map((column, index) => ({
    field: `measure_${index + 1}`,
    source_column: column.output_name,
  }));
  const comparison = resolvePanelPeriodComparison(binding);
  if (comparison && metrics.some((metric) => metric.additivity !== "additive"))
    return fail("AUTHORITY");
  const contract = await buildDescriptiveResultContract({
    context,
    binding,
    metrics,
    columns,
    contract_id: MONTHLY_PANEL_CONTRACT_ID,
    derived_fields: [
      ...measureFields.map(({ field }) => field),
      "opposed_changes",
      ...(comparison ? ["period_comparison"] : []),
    ],
    grain: {
      dimension_ids: dimensionIds,
      time_dimension_id: time.semantic_object_id,
      time_grain: "MONTH",
    },
    table: {
      id: MONTHLY_PANEL_TABLE_ID,
      title: "月度分群结果",
      max_rows: MONTHS * MAX_GROUPS,
      max_columns: 7,
    },
    chart: {
      id: MONTHLY_PANEL_CHART_ID,
      title: "各分类月度结果与缺失观测",
      intent: "TREND",
      template_id: "line.multi-series@1",
    },
    invalid_shape: () => fail("SHAPE"),
  });
  await resolveAnalysisResultSourceObjects({
    result_contract: contract,
    context,
    run_id: input.query_evidence_ref.run_id,
    selected_object_ids: new Set([...metricIds, ...dimensionIds]),
    query_evidence: { reference: input.query_evidence_ref, document },
  });
  return Object.freeze({
    result_contract: contract,
    required_operator_obligations: Object.freeze([]),
    shape: {
      binding,
      columns,
      measures,
      ordered_rows: orderedRows,
      groups,
      time_column: time.output_name,
      time_dimension_id: time.semantic_object_id,
      timezone: window.timezone,
      dimension_ids: dimensionIds,
      category_columns: categories.map((column) => column.output_name),
    },
    execution_contract: Object.freeze({
      method_id: MONTHLY_PANEL_METHOD_ID,
      claim_strength: "DESCRIPTIVE" as const,
      time_column: time.output_name,
      timezone: window.timezone,
      category_columns: categories.map((column) => column.output_name),
      measure_fields: measureFields,
      measure_schema: z.toJSONSchema(monthlyPanelMeasureSchema),
      opposed_changes_schema: z.toJSONSchema(monthlyPanelOpposedChangesSchema),
      ...(comparison
        ? {
            period_comparison: comparison,
            period_comparison_schema: z.toJSONSchema(panelPeriodComparisonSchema),
          }
        : {}),
      chart_bindings: {
        x_field: time.output_name,
        y_fields: measures.map((column) => column.output_name),
        series_field: categories[0]?.output_name ?? fail("SHAPE"),
        lower_bound_field: null,
        upper_bound_field: null,
        ...(facet ? { facet_field: facet.output_name } : {}),
      },
      rules: [
        ...(comparison ? PANEL_PERIOD_COMPARISON_RULES : []),
        "observations contains every source row and exactly its source columns/values/NULLs, stably sorted by calendar month. DATE retains its date; DATETIME becomes calendar date in the explicit timezone. Never merge tuples, invent composite columns, drop rows, fill NULL or average ratios.",
        "Each measure field is an object with only groups, an array in group first-appearance order in observations. Each item has group (all category_columns and exact values), source_column and the supplied monthly measure fields. Compute each group and measure independently from its own twelve months. observed_count excludes NULL; missing_count counts NULL; minimum/maximum use observed values. lowest/highest contain up to three {period,value}, ordered by value ascending/descending then period ascending.",
        "first_period/last_period and first_value/last_value use the original window endpoints, retaining NULL. absolute_change=last-first, NULL if either is missing; relative_change=absolute_change/first, NULL if missing or zero denominator. Never move endpoints. largest_drops contains up to three strictly negative adjacent-month changes, sorted by absolute_change then to_period. NULL breaks adjacency; relative_change is NULL for zero previous value.",
        "opposed_changes is an object with only pairs, an array listing all ordered source-measure pairs in each group whose endpoint absolute changes are respectively strictly positive and strictly negative. Order by group first-appearance, increasing source column order, then decreasing source column order. Copy both endpoint changes and relative changes, original first/last periods and the complete group. Missing endpoints yield no pair; do not infer causality, materiality or direction from relative-change signs with negative denominators.",
        "claim_strength must equal DESCRIPTIVE. No extra fields, free-form facts, statistical significance or causal claims. Use the existing publisher once with the exact chart_bindings and line.multi-series@1; all measures stay independent and the second category is an explicit facet.",
      ],
    }),
  });
}

export type MonthlyPanelPlan = Awaited<ReturnType<typeof compileMonthlyPanelPlan>>;
