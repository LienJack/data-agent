import {
  type ArtifactReference,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import { evaluateAnalysisApplicability } from "@data-agent/semantic/runtime-context";
import { z } from "zod";
import { resolveAnalysisEvidenceTimeWindow } from "./analysis-evidence-time-window.js";
import {
  resolveAnalysisResultSourceObjects,
  verifyAcceptedAnalysisQueryEvidence,
} from "./analysis-result-source-authority.js";
import { buildDescriptiveResultContract } from "./descriptive-result-contract.js";

export const CATEGORY_COMPARISON_METHOD_ID = "published-category-multi-measure-comparison@1";
export const CATEGORY_COMPARISON_CONTRACT_ID = "category-multi-measure-comparison.result";
export const CATEGORY_COMPARISON_TABLE_ID = "category_comparison";
export const CATEGORY_COMPARISON_CHART_ID = "category_comparison_bar";
// The required BAR projection preserves every row and the existing V3 chart bound is 64.
const MAX_ROWS = 64;
const rankedCategorySchema = z.strictObject({
  source_row_index: z
    .number()
    .int()
    .min(0)
    .max(MAX_ROWS - 1),
  group: z.record(z.string(), z.string().min(1).max(256)),
  value: z.number().finite(),
});
export const categoryComparisonMeasureSchema = z.strictObject({
  source_column: z.string(),
  observed_count: z.number().int().min(1).max(MAX_ROWS),
  missing_count: z
    .number()
    .int()
    .min(0)
    .max(MAX_ROWS - 1),
  minimum: z.number().finite(),
  maximum: z.number().finite(),
  lowest: z.array(rankedCategorySchema).min(1).max(3),
  highest: z.array(rankedCategorySchema).min(1).max(3),
});

interface CategoryComparisonInput {
  readonly context: AnalysisContext;
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly query_evidence_document: ProductTeamArtifactDocument;
}
function fail(kind: "AUTHORITY" | "SHAPE" | "VALUE"): never {
  throw new TypeError(`CATEGORY_COMPARISON_${kind}_INVALID`);
}

/** Source shape and published capability only. No question keywords or benchmark case dispatch. */
export async function compileCategoryComparisonPlan(input: CategoryComparisonInput) {
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
  const measures = binding.columns.filter(
    (column) =>
      ["METRIC", "FORMULA", "REQUEST_DERIVED"].includes(column.semantic_role) &&
      column.logical_type === "NUMBER",
  );
  const columns = document.projection.columns;
  const rows = document.projection.rows;
  if (
    dimensions.length < 1 ||
    dimensions.length > 2 ||
    measures.length < 1 ||
    measures.length > 4 ||
    dimensions.length + measures.length !== binding.columns.length ||
    rows.length < 1 ||
    rows.length > MAX_ROWS ||
    dimensions.some(
      (column) => column.logical_type !== "STRING" || column.grain.granularity !== "atomic",
    ) ||
    new Set(dimensions.map((column) => column.semantic_object_id)).size !== dimensions.length ||
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
  const groupKeys = new Set<string>();
  for (const row of rows) {
    const values = dimensions.map((column) => row[column.output_name]);
    if (
      values.some(
        (value) => typeof value !== "string" || value.trim().length === 0 || value.length > 256,
      )
    )
      return fail("VALUE");
    const group = JSON.stringify(values);
    if (groupKeys.has(group)) return fail("SHAPE");
    groupKeys.add(group);
    for (const measure of measures) {
      const value = row[measure.output_name];
      if (value === null ? !measure.nullable : typeof value !== "number" || !Number.isFinite(value))
        return fail("VALUE");
    }
  }
  if (measures.some((column) => rows.every((row) => row[column.output_name] === null)))
    return fail("VALUE");
  const metricIds = [
    ...new Set(
      measures
        .filter((column) => column.semantic_role === "METRIC")
        .map((column) => column.semantic_object_id),
    ),
  ].sort();
  const dimensionIds = dimensions.map((column) => column.semantic_object_id);
  const metrics = metricIds.map(
    (id) => context.metrics.find((metric) => metric.metric_ref.node_id === id) ?? fail("AUTHORITY"),
  );
  if (
    metrics.length < 1 ||
    metrics.length > 3 ||
    metrics.length !== context.metrics.length ||
    metrics.some(
      (metric) =>
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
  if (
    binding.time_window &&
    metrics.some(
      (metric) =>
        metric.time_dimension_ref !== binding.time_window?.dimension_id ||
        metric.time_domain?.timezone !== binding.time_window?.timezone ||
        metric.time_domain?.calendar !== "gregorian",
    )
  )
    return fail("AUTHORITY");
  const timeWindow = resolveAnalysisEvidenceTimeWindow(binding, context);
  const measureFields = measures.map((column, index) => ({
    field: `measure_${index + 1}`,
    source_column: column.output_name,
  }));
  const contract = await buildDescriptiveResultContract({
    context,
    binding,
    metrics,
    columns,
    contract_id: CATEGORY_COMPARISON_CONTRACT_ID,
    derived_fields: measureFields.map(({ field }) => field),
    grain: { dimension_ids: dimensionIds, time_dimension_id: null, time_grain: "NONE" },
    table: {
      id: CATEGORY_COMPARISON_TABLE_ID,
      title: "分类结果比较",
      max_rows: MAX_ROWS,
      max_columns: 6,
    },
    chart: {
      id: CATEGORY_COMPARISON_CHART_ID,
      title: "分类结果与缺失观测",
      intent: "COMPARISON",
      template_id: "bar.grouped@1",
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
  const dimensionColumns = dimensions.map((column) => column.output_name);
  const xField = dimensionColumns[0] ?? fail("SHAPE");
  return Object.freeze({
    result_contract: contract,
    required_operator_obligations: Object.freeze([]),
    shape: {
      binding,
      rows,
      columns,
      measures,
      dimension_columns: dimensionColumns,
      dimension_ids: dimensionIds,
      time_window: timeWindow,
    },
    execution_contract: Object.freeze({
      method_id: CATEGORY_COMPARISON_METHOD_ID,
      claim_strength: "DESCRIPTIVE" as const,
      dimension_columns: dimensionColumns,
      measure_fields: measureFields,
      measure_schema: z.toJSONSchema(categoryComparisonMeasureSchema),
      chart_bindings: {
        x_field: xField,
        y_fields: measures.map((column) => column.output_name),
        series_field: dimensionColumns[1] ?? null,
        lower_bound_field: null,
        upper_bound_field: null,
      },
      rules: [
        "observations contains every accepted row in its original row order and exactly its original source columns/values/NULLs. Never regroup, drop a row or dimension, fill NULL, aggregate measures together, sum ratios or average ratios.",
        "For each measure field use only its source_column. observed_count excludes NULL and missing_count counts NULL; minimum and maximum use observed values. lowest/highest contain up to three observations sorted by value ascending/descending, ties by source_row_index ascending (zero-based original input row index).",
        "Each ranked observation is {source_row_index,group,value}; group contains every dimension_columns key with that exact source row value. Two-dimension identities are complete tuples, never the first category alone. Do not merge groups or invent a composite source column.",
        "claim_strength must equal DESCRIPTIVE. No free-form summary, extra fields, temporal growth, inferential significance or causal claims. Use the existing result/table/chart publisher once and the exact supplied chart_bindings with bar.grouped@1; each y measure remains independent.",
      ],
    }),
  });
}

export type CategoryComparisonPlan = Awaited<ReturnType<typeof compileCategoryComparisonPlan>>;
