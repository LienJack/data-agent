import {
  type ArtifactReference,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import { evaluateAnalysisApplicability } from "@data-agent/semantic/runtime-context";
import { z } from "zod";
import { resolveAnalysisResultSourceObjects } from "./analysis-result-source-authority.js";
import { buildDescriptiveResultContract } from "./descriptive-result-contract.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";

export const MONTHLY_COMPARISON_METHOD_ID = "published-monthly-multi-measure-comparison@1";
export const MONTHLY_COMPARISON_CONTRACT_ID = "monthly-multi-measure-comparison.result";
export const MONTHLY_COMPARISON_TABLE_ID = "monthly_comparison";
export const MONTHLY_COMPARISON_CHART_ID = "monthly_comparison_line";

const periodSchema = z.string().regex(/^\d{4}-\d{2}-01$/u);
const finite = z.number().finite();
const rankedPointSchema = z.strictObject({ period: periodSchema, value: finite });
export const monthlyComparisonMeasureSchema = z.strictObject({
  source_column: z.string(),
  observed_count: z.number().int().min(1).max(12),
  missing_count: z.number().int().min(0).max(11),
  minimum: finite,
  maximum: finite,
  lowest: z.array(rankedPointSchema).min(1).max(3),
  highest: z.array(rankedPointSchema).min(1).max(3),
  first_period: periodSchema,
  last_period: periodSchema,
  first_value: finite.nullable(),
  last_value: finite.nullable(),
  absolute_change: finite.nullable(),
  relative_change: finite.nullable(),
  largest_drops: z
    .array(
      z.strictObject({
        from_period: periodSchema,
        to_period: periodSchema,
        absolute_change: finite.negative(),
        relative_change: finite.nullable(),
      }),
    )
    .max(3),
});

interface MonthlyComparisonInput {
  readonly context: AnalysisContext;
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly query_evidence_document: ProductTeamArtifactDocument;
}

function fail(kind: "AUTHORITY" | "SHAPE" | "VALUE" | "WINDOW"): never {
  throw new TypeError(`MONTHLY_COMPARISON_${kind}_INVALID`);
}

export function calendarDate(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.valueOf())) return fail("VALUE");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
  } catch {
    return fail("WINDOW");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Explicit input-shape eligibility, never question text or an acceptance-case router. */
export async function extractMonthlyComparisonShape(
  input: Pick<MonthlyComparisonInput, "query_evidence_ref" | "query_evidence_document">,
) {
  const document = await verifyProductTeamArtifactDocument(input.query_evidence_document);
  const verified = await verifyProductTeamQueryEvidenceInput({ ...input, expected_row_count: 12 });
  const binding = verified.semantic_binding;
  if (document.projection.kind !== "TABLE") return fail("SHAPE");
  const dimensions = binding.columns.filter((column) => column.semantic_role === "DIMENSION");
  const measures = binding.columns.filter(
    (column) =>
      ["METRIC", "FORMULA", "REQUEST_DERIVED"].includes(column.semantic_role) &&
      column.logical_type === "NUMBER",
  );
  const time = dimensions[0];
  const window = binding.time_window;
  if (
    dimensions.length !== 1 ||
    !time ||
    !["DATE", "DATETIME"].includes(time.logical_type) ||
    time.grain.granularity !== "month" ||
    measures.length < 2 ||
    measures.length > 4 ||
    measures.length + 1 !== binding.columns.length ||
    !measures.some((column) => column.semantic_role === "METRIC") ||
    !window?.timezone ||
    window.dimension_id !== time.semantic_object_id ||
    binding.columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(column.output_name))
  )
    return fail("SHAPE");
  const timezone = window.timezone;
  const columns = document.projection.columns;
  if (
    columns.length !== binding.columns.length ||
    columns.some(
      (column, index) =>
        column.key !== binding.columns[index]?.output_name ||
        column.label.trim().length === 0 ||
        column.label.length > 80 ||
        column.data_type !== (column.key === time.output_name ? "STRING" : "NUMBER"),
    )
  )
    return fail("SHAPE");
  const orderedRows = document.projection.rows
    .map((row) => {
      const value = row[time.output_name];
      if (typeof value !== "string") return fail("VALUE");
      const month = time.logical_type === "DATE" ? value : calendarDate(value, timezone);
      if (!periodSchema.safeParse(month).success) return fail("VALUE");
      for (const measure of measures) {
        const number = row[measure.output_name];
        if (
          number === null
            ? !measure.nullable
            : typeof number !== "number" || !Number.isFinite(number)
        )
          return fail("VALUE");
      }
      return { ...row, [time.output_name]: month };
    })
    .sort((left, right) =>
      String(left[time.output_name]).localeCompare(String(right[time.output_name])),
    );
  const first = String(orderedRows[0]?.[time.output_name]);
  const start = new Date(`${first}T00:00:00.000Z`);
  if (!Number.isFinite(start.valueOf()) || start.toISOString().slice(0, 10) !== first)
    return fail("WINDOW");
  const expectedMonth = (index: number) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))
      .toISOString()
      .slice(0, 10);
  if (
    orderedRows.some((row, index) => row[time.output_name] !== expectedMonth(index)) ||
    calendarDate(window.start, window.timezone) !== first ||
    calendarDate(window.end, window.timezone) !== expectedMonth(12)
  )
    return fail("WINDOW");
  if (measures.some((column) => orderedRows.every((row) => row[column.output_name] === null)))
    return fail("VALUE");
  return Object.freeze({
    binding,
    time_column: time.output_name,
    time_dimension_id: time.semantic_object_id,
    timezone: window.timezone,
    columns,
    measures,
    ordered_rows: orderedRows,
    result_hash: verified.result_hash,
  });
}

export async function compileMonthlyComparisonPlan(input: MonthlyComparisonInput) {
  const context = await verifyAnalysisContext(input.context);
  const shape = await extractMonthlyComparisonShape(input);
  const binding = shape.binding;
  if (
    input.query_evidence_ref.app_id !== context.scope.app_id ||
    input.query_evidence_ref.tenant_id !== context.scope.tenant_id ||
    input.query_evidence_ref.environment !== context.scope.environment ||
    canonicalizeJson(binding.semantic_context_ref) !==
      canonicalizeJson(context.semantic_context_binding)
  )
    return fail("AUTHORITY");
  for (const [resource, artifact] of [
    [binding.semantic_release_ref, context.semantic_release_ref],
    [binding.schema_snapshot_ref, context.schema_snapshot_ref],
  ] as const) {
    if (
      resource.resource_id !== artifact.artifact_id ||
      resource.resource_revision !== artifact.revision ||
      resource.resource_hash !== artifact.content_hash ||
      artifact.run_id !== input.query_evidence_ref.run_id
    )
      return fail("AUTHORITY");
  }
  const metricIds = [
    ...new Set(
      shape.measures
        .filter((column) => column.semantic_role === "METRIC")
        .map((column) => column.semantic_object_id),
    ),
  ];
  const metrics = metricIds.map(
    (id) => context.metrics.find((metric) => metric.metric_ref.node_id === id) ?? fail("AUTHORITY"),
  );
  if (
    metrics.length > 3 ||
    context.metrics.length !== metrics.length ||
    metrics.some(
      (metric) =>
        metric.time_dimension_ref !== shape.time_dimension_id ||
        metric.time_domain?.timezone !== shape.timezone ||
        metric.time_domain?.calendar !== "gregorian" ||
        shape.measures.some(
          (column) =>
            column.semantic_role === "METRIC" &&
            column.semantic_object_id === metric.metric_ref.node_id &&
            column.formula_hash !== metric.formula_hash,
        ),
    )
  )
    return fail("AUTHORITY");
  if (
    (
      await evaluateAnalysisApplicability(context, {
        skill_id: "open-python-analysis@1",
        metric_ids: metricIds,
        dimension_ids: [shape.time_dimension_id],
      })
    ).verdict !== "APPLICABLE"
  )
    return fail("AUTHORITY");
  if (
    metrics.some(
      (metric) =>
        !metric.allowed_dimensions.some(
          (dimension) => dimension.dimension_id === shape.time_dimension_id && dimension.groupable,
        ),
    )
  )
    return fail("AUTHORITY");
  const measureFields = shape.measures.map((column, index) => ({
    field: `measure_${index + 1}`,
    source_column: column.output_name,
  }));
  const contract = await buildDescriptiveResultContract({
    context,
    binding,
    metrics,
    columns: shape.columns,
    contract_id: MONTHLY_COMPARISON_CONTRACT_ID,
    derived_fields: measureFields.map(({ field }) => field),
    grain: {
      dimension_ids: [shape.time_dimension_id],
      time_dimension_id: shape.time_dimension_id,
      time_grain: "MONTH",
    },
    table: {
      id: MONTHLY_COMPARISON_TABLE_ID,
      title: "月度多结果比较",
      max_rows: 12,
      max_columns: 5,
    },
    chart: {
      id: MONTHLY_COMPARISON_CHART_ID,
      title: "月度结果与缺失观测",
      intent: "TREND",
      template_id: "line.multi-series@1",
    },
    invalid_shape: () => fail("SHAPE"),
  });
  await resolveAnalysisResultSourceObjects({
    result_contract: contract,
    context,
    run_id: input.query_evidence_ref.run_id,
    selected_object_ids: new Set([...metricIds, shape.time_dimension_id]),
    query_evidence: {
      reference: input.query_evidence_ref,
      document: input.query_evidence_document,
    },
  });
  return Object.freeze({
    result_contract: contract,
    required_operator_obligations: Object.freeze([]),
    shape,
    execution_contract: Object.freeze({
      method_id: MONTHLY_COMPARISON_METHOD_ID,
      claim_strength: "DESCRIPTIVE" as const,
      time_column: shape.time_column,
      timezone: shape.timezone,
      measure_fields: measureFields,
      measure_schema: z.toJSONSchema(monthlyComparisonMeasureSchema),
      rules: [
        "observations contains every accepted row, sorted by calendar month, and exactly the contract source columns. DATE stays calendar date; DATETIME becomes its date in the explicit timezone. Never fill NULL, drop a period, aggregate measures together, or average ratios.",
        "Populate each measure field using only its source_column. observed_count excludes NULL; missing_count counts NULL. minimum/maximum use observed values. lowest/highest contain up to three observed {period,value} points ordered by value ascending/descending, with ties ordered by period ascending.",
        "first_period/last_period are the first/last of all 12 calendar months. first_value/last_value retain endpoint NULL. absolute_change=last_value-first_value, NULL if either endpoint is missing. relative_change=absolute_change/first_value, NULL if missing or zero denominator. Do not move endpoints to the first/last observed value.",
        "largest_drops includes up to three strictly negative changes between adjacent calendar months with both values present; order by absolute_change ascending then to_period ascending. from_period/to_period identify the adjacent pair. relative_change=absolute_change/previous_value, NULL at zero denominator. Never bridge a missing observation.",
        "claim_strength must equal DESCRIPTIVE. Do not emit a free-form summary or additional fields; no statistical significance, slope test, causal attribution, or unverified arithmetic. Use the existing result/table/chart publisher once; chart x is time_column, y fields are all source measures in order, series/bounds are null.",
      ],
    }),
  });
}

export type MonthlyComparisonPlan = Awaited<ReturnType<typeof compileMonthlyComparisonPlan>>;
