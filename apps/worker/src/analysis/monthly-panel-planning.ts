import {
  type ArtifactReference,
  buildAnalysisResultContract,
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
import { MONTHLY_PANEL_PREPARATION_REFERENCE } from "./monthly-panel-preparation-reference.js";
import {
  PANEL_RATIO_ROLLUP_RULES,
  panelRatioRollupSchema,
  resolvePanelRatioRollup,
} from "./monthly-panel-ratio-rollup.js";

export const MONTHLY_PANEL_METHOD_ID = "published-monthly-group-panel@2";
export const MONTHLY_PANEL_CONTRACT_ID = "monthly-group-panel.result";
export const MONTHLY_PANEL_TABLE_ID = "monthly_panel";
export const MONTHLY_PANEL_CHART_ID = "monthly_panel_line";
export const MONTHLY_PANEL_OVERALL_TABLE_ID = "monthly_overall_trend";
export const MONTHLY_PANEL_DECLINE_TABLE_ID = "monthly_decline_groups";
export const MONTHLY_PANEL_OVERALL_CHART_ID = "monthly_overall_yoy_trend";
export const MONTHLY_PANEL_DECLINE_CHART_ID = "monthly_decline_group_comparison";
const MAX_GROUPS = 32;
const MAX_MONTHS = 12;
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
    rows.length < 2 ||
    rows.length > MAX_MONTHS * MAX_GROUPS ||
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
  const lastExclusive = calendarDate(window.end, timezone);
  const end = new Date(`${lastExclusive}T00:00:00.000Z`);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (months !== 2 && months !== 12) return fail("WINDOW");
  const periods = Array.from({ length: months + 1 }, (_, index) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))
      .toISOString()
      .slice(0, 10),
  );
  if (lastExclusive !== periods[months]) return fail("WINDOW");
  const orderedRows = rows
    .map((row) => {
      const raw = row[time.output_name];
      if (typeof raw !== "string") return fail("VALUE");
      const month = time.logical_type === "DATE" ? raw : calendarDate(raw, timezone);
      if (!periods.slice(0, months).includes(month)) return fail("WINDOW");
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
        group.rows.length !== months ||
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

  const metricIds = [...new Set(context.metrics.map((metric) => metric.metric_ref.node_id))].sort();
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
  if (comparison && months !== 12) return fail("WINDOW");
  if (comparison && metrics.some((metric) => metric.additivity !== "additive"))
    return fail("AUTHORITY");
  const ratioRollup = resolvePanelRatioRollup(binding, context, months);
  let contract = await buildDescriptiveResultContract({
    context,
    binding,
    metrics,
    columns,
    contract_id: MONTHLY_PANEL_CONTRACT_ID,
    derived_fields: [
      ...measureFields.map(({ field }) => field),
      "opposed_changes",
      ...(comparison ? ["period_comparison"] : []),
      ...(ratioRollup ? ["ratio_rollup"] : []),
    ],
    grain: {
      dimension_ids: dimensionIds,
      time_dimension_id: time.semantic_object_id,
      time_grain: "MONTH",
    },
    table: {
      id: MONTHLY_PANEL_TABLE_ID,
      title: "月度分群结果",
      max_rows: months * MAX_GROUPS,
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
  const comparisonChartBindings = comparison
    ? [
        {
          chart_id: MONTHLY_PANEL_OVERALL_CHART_ID,
          x_field: "period",
          y_fields: ["current_value", "comparison_value", "yoy_rate"],
          series_field: null,
          lower_bound_field: null,
          upper_bound_field: null,
        },
        {
          chart_id: MONTHLY_PANEL_DECLINE_CHART_ID,
          x_field: "group_value",
          y_fields: ["current_value", "comparison_value"],
          series_field: "period",
          lower_bound_field: null,
          upper_bound_field: null,
        },
      ]
    : null;
  if (comparison && comparisonChartBindings) {
    const { contract_hash: _contractHash, ...material } = contract;
    const semanticIds = [...new Set(binding.columns.map((column) => column.semantic_object_id))];
    const physicalFields = binding.columns.map((column) => `query_evidence.${column.output_name}`);
    const byOutput = (output: string) =>
      binding.columns.find((column) => column.output_name === output) ?? fail("AUTHORITY");
    const current = byOutput(comparison.current_output);
    const prior = byOutput(comparison.comparison_output);
    const rate = byOutput(comparison.rate_output);
    const category = byOutput(comparison.category_output);
    const derivedNumber = (
      key: string,
      label_zh: string,
      semantic_object_id: string,
      nullable: boolean,
    ) => ({
      key,
      label_zh,
      data_type: "NUMBER" as const,
      nullable,
      semantic_object_id,
      semantic_role: "DERIVED" as const,
    });
    const projection = (collection_field: string, keys: readonly string[]) => ({
      mode: "RESULT_COLLECTION" as const,
      collection_field,
      column_mappings: keys.map((key) => ({ result_field: key, table_column: key })),
    });
    contract = await buildAnalysisResultContract({
      ...material,
      result_fields: [
        ...material.result_fields,
        {
          field: "overall_trend_rows",
          data_type: "JSON",
          nullable: false,
          semantic_role: "DERIVED",
        },
        {
          field: "largest_decline_group_rows",
          data_type: "JSON",
          nullable: false,
          semantic_role: "DERIVED",
        },
      ],
      lineage: [
        ...material.lineage,
        ...["overall_trend_rows", "largest_decline_group_rows"].map((field) => ({
          field,
          source_semantic_object_ids: semanticIds,
          source_physical_fields: physicalFields,
          transformation: "AGGREGATION" as const,
        })),
      ],
      tables: [
        material.tables[0] ?? fail("SHAPE"),
        {
          table_id: MONTHLY_PANEL_OVERALL_TABLE_ID,
          title_zh: "整体月度同比趋势",
          required: true,
          columns: [
            {
              key: "period",
              label_zh: "月份",
              data_type: "DATE",
              nullable: false,
              semantic_object_id: time.semantic_object_id,
              semantic_role: "DIMENSION",
            },
            derivedNumber("current_value", "本期值", current.semantic_object_id, true),
            derivedNumber("comparison_value", "同期值", prior.semantic_object_id, true),
            derivedNumber("yoy_rate", "同比", rate.semantic_object_id, true),
          ],
          projection: projection("overall_trend_rows", [
            "period",
            "current_value",
            "comparison_value",
            "yoy_rate",
          ]),
          max_rows: 12,
        },
        {
          table_id: MONTHLY_PANEL_DECLINE_TABLE_ID,
          title_zh: "下降月份客户类型对比",
          required: true,
          columns: [
            {
              key: "period",
              label_zh: "月份",
              data_type: "DATE",
              nullable: false,
              semantic_object_id: time.semantic_object_id,
              semantic_role: "DIMENSION",
            },
            {
              key: "group_value",
              label_zh: "客户类型",
              data_type: "STRING",
              nullable: false,
              semantic_object_id: category.semantic_object_id,
              semantic_role: "DIMENSION",
            },
            derivedNumber("current_value", "本期值", current.semantic_object_id, false),
            derivedNumber("comparison_value", "同期值", prior.semantic_object_id, false),
            derivedNumber("yoy_rate", "分组同比", rate.semantic_object_id, true),
            derivedNumber(
              "contribution_to_total_growth",
              "整体同比贡献",
              rate.semantic_object_id,
              false,
            ),
          ],
          projection: projection("largest_decline_group_rows", [
            "period",
            "group_value",
            "current_value",
            "comparison_value",
            "yoy_rate",
            "contribution_to_total_growth",
          ]),
          max_rows: MAX_GROUPS * 3,
        },
      ],
      charts: [
        {
          chart_id: MONTHLY_PANEL_OVERALL_CHART_ID,
          title_zh: "整体月度同比趋势",
          required: true,
          intent: "TREND",
          table_id: MONTHLY_PANEL_OVERALL_TABLE_ID,
          allowed_template_ids: ["line.multi-series@1"],
        },
        {
          chart_id: MONTHLY_PANEL_DECLINE_CHART_ID,
          title_zh: "下降月份客户类型对比",
          required: true,
          intent: "COMPARISON",
          table_id: MONTHLY_PANEL_DECLINE_TABLE_ID,
          allowed_template_ids: ["bar.grouped@1"],
        },
      ],
    });
  }
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
      month_count: months,
      claim_strength: "DESCRIPTIVE" as const,
      time_column: time.output_name,
      time_logical_type: time.logical_type,
      timezone: window.timezone,
      source_columns: columns.map((column) => column.key),
      category_columns: categories.map((column) => column.output_name),
      measure_fields: measureFields,
      measure_schema: z.toJSONSchema(monthlyPanelMeasureSchema),
      opposed_changes_schema: z.toJSONSchema(monthlyPanelOpposedChangesSchema),
      ...(ratioRollup
        ? {
            ratio_rollup_mapping: ratioRollup,
            ratio_rollup_schema: z.toJSONSchema(panelRatioRollupSchema),
          }
        : {}),
      ...(comparison
        ? {
            period_comparison: comparison,
            period_comparison_schema: z.toJSONSchema(panelPeriodComparisonSchema),
          }
        : {}),
      chart_bindings: comparisonChartBindings ?? {
        x_field: time.output_name,
        y_fields: measures.map((column) => column.output_name),
        series_field: categories[0]?.output_name ?? fail("SHAPE"),
        lower_bound_field: null,
        upper_bound_field: null,
        ...(facet ? { facet_field: facet.output_name } : {}),
      },
      rules: [
        "Use preparation_reference as the data-free reference implementation of these descriptive rules. Copy its function into your actual python_cell. Call prepare_monthly_panel with the exact bound input DataFrame and a configuration dict copying only source_columns, time_column, time_logical_type, timezone, month_count, category_columns, measure_fields, and period_comparison when supplied. Do not copy schemas, rules or preparation_reference into that dict. Assign the returned dict to a named result symbol and construct the table from result['observations'] with exactly source_columns. Never add temporary columns such as month_str to the source or later look them up in observations; the approved time_column remains the calendar-date key throughout. The reference is not pre-executed output and does not replace Cell policy, Publisher or FULL Oracle checks.",
        ...(comparison ? PANEL_PERIOD_COMPARISON_RULES : []),
        ...(comparison
          ? [
              "For the two governed chart collections, build one exact-column table symbol from result['overall_trend_rows'] and one from result['largest_decline_group_rows']. Bind all three required tables and both required charts in one publish_analysis_result call. Copy the supplied chart_bindings array exactly; do not chart the raw monthly_panel table, merge the two chart datasets, omit a chart, or add a third chart.",
            ]
          : []),
        ...(ratioRollup
          ? [
              "Also copy the supplied ratio_rollup_mapping into the preparation configuration. The reference computes data.ratio_rollup from original observations; do not copy or precompute an answer into the configuration.",
              ...PANEL_RATIO_ROLLUP_RULES,
            ]
          : []),
        "observations contains every source row and exactly its source columns/values/NULLs, stably sorted by calendar month. DATE retains its date; DATETIME becomes calendar date in the explicit timezone. Never merge tuples, invent composite columns, drop rows, fill NULL or average ratios.",
        "Each measure field is an object with only groups, an array in group first-appearance order in observations. Each item has group (all category_columns and exact values), source_column and the supplied monthly measure fields. Compute each group and measure independently from its exact month_count (2 or 12) complete calendar months. Two months support an endpoint comparison, not a persistent trend or trend-strength claim. observed_count excludes NULL; missing_count counts NULL; minimum/maximum use observed values. lowest/highest contain up to three {period,value}, ordered by value ascending/descending then period ascending.",
        "first_period/last_period and first_value/last_value use the original window endpoints, retaining NULL. absolute_change=last-first, NULL if either is missing; relative_change=absolute_change/first, NULL if missing or zero denominator. Never move endpoints. largest_drops contains up to three strictly negative adjacent-month changes, sorted by absolute_change then to_period. NULL breaks adjacency; relative_change is NULL for zero previous value.",
        "opposed_changes is an object with only pairs, an array listing all ordered source-measure pairs in each group whose endpoint absolute changes are respectively strictly positive and strictly negative. Order by group first-appearance, increasing source column order, then decreasing source column order. Copy both endpoint changes and relative changes, original first/last periods and the complete group. Missing endpoints yield no pair; do not infer causality, materiality or direction from relative-change signs with negative denominators.",
        comparison
          ? "claim_strength must equal DESCRIPTIVE. No extra fields, free-form facts, statistical significance or causal claims. The overall line and decline-group comparison bar are the only charts and remain independently bound to their exact governed collections."
          : "claim_strength must equal DESCRIPTIVE. No extra fields, free-form facts, statistical significance or causal claims. Use the existing publisher once with the exact chart_bindings and line.multi-series@1; all measures stay independent and the second category is an explicit facet.",
      ],
      preparation_reference: MONTHLY_PANEL_PREPARATION_REFERENCE,
    }),
  });
}

export type MonthlyPanelPlan = Awaited<ReturnType<typeof compileMonthlyPanelPlan>>;
