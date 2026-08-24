import { z } from "zod";
import {
  analysisResultChartIntentSchema,
  analysisResultChartTemplateIdSchema,
} from "../artifacts/analysis-result-contract.js";
import { contentHashSchema } from "../common/index.js";
import { statisticalOperatorIdSchema } from "../generated/statistical-operators.js";

export const ANALYSIS_RESULT_PUBLISH_TOOL_NAME = "publish_analysis_result" as const;

const stableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const analysisPythonSymbolSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const fieldNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const optionalFieldNameSchema = z.string().regex(/^(?:|[A-Za-z_][A-Za-z0-9_]{0,127})$/u);

const tableBindingSchema = z.strictObject({
  table_id: stableIdSchema,
  data_symbol: analysisPythonSymbolSchema,
});

const chartBindingFields = {
  chart_id: stableIdSchema,
  intent: analysisResultChartIntentSchema,
  template_id: analysisResultChartTemplateIdSchema,
  data_symbol: analysisPythonSymbolSchema,
  x_field: fieldNameSchema,
  y_fields: z.array(fieldNameSchema).min(1).max(8),
  series_field: optionalFieldNameSchema,
  lower_bound_field: optionalFieldNameSchema,
  upper_bound_field: optionalFieldNameSchema,
} as const;

const refineChartBinding = (
  binding: {
    readonly y_fields: readonly string[];
    readonly lower_bound_field: string;
    readonly upper_bound_field: string;
  },
  context: z.RefinementCtx,
) => {
  if (new Set(binding.y_fields).size !== binding.y_fields.length) {
    context.addIssue({
      code: "custom",
      path: ["y_fields"],
      message: "Chart y fields must be unique.",
    });
  }
  if ((binding.lower_bound_field === "") !== (binding.upper_bound_field === "")) {
    context.addIssue({
      code: "custom",
      path: ["lower_bound_field"],
      message: "Chart interval bounds must be declared together.",
    });
  }
};

const chartBindingSchema = z.strictObject(chartBindingFields).superRefine((binding, context) => {
  refineChartBinding(binding, context);
});

const modelChartBindingSchema = z
  .strictObject({
    chart_id: chartBindingFields.chart_id,
    x_field: chartBindingFields.x_field,
    y_fields: chartBindingFields.y_fields,
    series_field: chartBindingFields.series_field,
    lower_bound_field: chartBindingFields.lower_bound_field,
    upper_bound_field: chartBindingFields.upper_bound_field,
  })
  .superRefine(refineChartBinding);

const operatorBindingSchema = z.strictObject({
  call_id: stableIdSchema,
  operator_id: statisticalOperatorIdSchema,
  result_symbol: analysisPythonSymbolSchema,
});

const sharedAnalysisResultPublishToolArgumentFields = {
  publish_id: stableIdSchema,
  result_symbol: analysisPythonSymbolSchema,
  table_bindings: z.array(tableBindingSchema).min(1).max(32),
  operator_bindings: z.array(operatorBindingSchema).max(32),
} as const;

const analysisResultPublishToolArgumentFields = {
  ...sharedAnalysisResultPublishToolArgumentFields,
  chart_bindings: z.array(chartBindingSchema).min(1).max(32),
} as const;

function refineAnalysisResultPublishManifest(
  manifest: {
    readonly table_bindings: readonly { readonly table_id: string }[];
    readonly chart_bindings: readonly { readonly chart_id: string }[];
    readonly operator_bindings: readonly { readonly call_id: string }[];
  },
  context: z.RefinementCtx,
) {
  const unique = (
    values: readonly string[],
    path: "table_bindings" | "chart_bindings" | "operator_bindings",
    message: string,
  ) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message });
    }
  };
  unique(
    manifest.table_bindings.map(({ table_id }) => table_id),
    "table_bindings",
    "Table bindings must be unique.",
  );
  unique(
    manifest.chart_bindings.map(({ chart_id }) => chart_id),
    "chart_bindings",
    "Chart bindings must be unique.",
  );
  unique(
    manifest.operator_bindings.map(({ call_id }) => call_id),
    "operator_bindings",
    "Operator bindings must be unique.",
  );
}

/**
 * Model-facing arguments intentionally exclude protocol metadata. The server
 * injects the version before validating against the versioned authority below.
 * Both schemas share the same fields and refinements; there is no handwritten
 * JSON-schema twin.
 */
export const analysisResultPublishModelArgumentsSchema = z
  .strictObject({
    ...sharedAnalysisResultPublishToolArgumentFields,
    chart_bindings: z.array(modelChartBindingSchema).min(1).max(32),
  })
  .superRefine(refineAnalysisResultPublishManifest);

export const analysisResultPublishToolArgumentsSchema = z
  .strictObject({
    schema_version: z.literal("analysis-result-publish-tool@1.0.0"),
    ...analysisResultPublishToolArgumentFields,
  })
  .superRefine(refineAnalysisResultPublishManifest);

export const ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST = Object.freeze({
  manifest_version: "analysis-result-publish-tool-manifest@1.0.0" as const,
  tool_name: ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
  description:
    "Publish one governed analysis result by referencing allowlisted Python symbols and binding declared table/chart/operator identities. The server extracts, validates, renders, hashes, and stages the complete result closure; this tool accepts no file paths or serialized artifacts.",
  input_schema: analysisResultPublishToolArgumentsSchema,
});

export const analysisResultPublishedArtifactSchema = z.strictObject({
  artifact_name: stableIdSchema,
  artifact_kind: z.enum(["RESULT", "TABLE", "CHART"]),
  media_type: z.literal("application/json"),
  content_sha256: contentHashSchema,
  bytes: z.number().int().positive(),
});

export const analysisResultPublishObservationSchema = z.strictObject({
  schema_version: z.literal("analysis-result-publish-observation@1.0.0"),
  publish_id: stableIdSchema,
  status: z.literal("PUBLISHED"),
  contract_hash: contentHashSchema,
  manifest_hash: contentHashSchema,
  closure_hash: contentHashSchema,
  stage_id: stableIdSchema,
  artifacts: z.array(analysisResultPublishedArtifactSchema).min(3).max(65),
});

export type AnalysisResultPublishToolArguments = z.infer<
  typeof analysisResultPublishToolArgumentsSchema
>;
export type AnalysisResultPublishModelArguments = z.infer<
  typeof analysisResultPublishModelArgumentsSchema
>;
export type AnalysisResultPublishObservation = z.infer<
  typeof analysisResultPublishObservationSchema
>;
