import { z } from "zod";
import { contentHashSchema, versionIdentifierSchema } from "../common/index.js";
import {
  statisticalOperatorCallReceiptSchema,
  statisticalOperatorIdSchema,
} from "../generated/statistical-operators.js";

export const ANALYSIS_PYTHON_CELL_TOOL_NAME = "python_cell" as const;
export const ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME = "statistical_operator" as const;

const stableCellIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const outputNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u);
const safeRelativeOutputPathSchema = z
  .string()
  .regex(/^\/workspace\/outputs\/[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u);

export const analysisPythonCellToolArgumentsSchema = z.strictObject({
  schema_version: z.literal("analysis-python-cell-tool@1.0.0"),
  cell_id: stableCellIdSchema,
  source: z.string().min(1).max(100_000),
  timeout_ms: z.number().int().min(100).max(120_000),
  declared_output_names: z
    .array(outputNameSchema)
    .max(32)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Cell declared outputs must be unique." });
      }
    }),
});

export const analysisStatisticalOperatorToolArgumentsSchema = z.strictObject({
  schema_version: z.literal("analysis-statistical-operator-tool@1.0.0"),
  call_id: stableCellIdSchema,
  operator_id: statisticalOperatorIdSchema,
  inputs: z.record(z.string().min(1).max(128), z.json()),
  parameters: z.record(z.string().min(1).max(128), z.json()).nullable(),
});

export const analysisToolCallCandidateSchema = z.discriminatedUnion("tool_name", [
  z.strictObject({
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.literal(ANALYSIS_PYTHON_CELL_TOOL_NAME),
    arguments: analysisPythonCellToolArgumentsSchema,
  }),
  z.strictObject({
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.literal(ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME),
    arguments: analysisStatisticalOperatorToolArgumentsSchema,
  }),
]);

export const analysisCellObservationSchema = z.strictObject({
  schema_version: z.literal("analysis-cell-observation@1.0.0"),
  cell_id: stableCellIdSchema,
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]),
  execution_id: z.string().max(256).nullable(),
  execution_count: z.number().int().nonnegative().nullable(),
  elapsed_ms: z.number().int().nonnegative(),
  stdout: z.string().max(4_096),
  stderr: z.string().max(16_384),
  result_text: z.string().max(64_000).nullable(),
  error: z
    .strictObject({
      name: z.string().min(1).max(256),
      value: z.string().max(4_096),
    })
    .nullable(),
  declared_outputs: z.array(
    z.strictObject({
      name: outputNameSchema,
      path: safeRelativeOutputPathSchema,
      content_sha256: contentHashSchema,
      bytes: z.number().int().nonnegative(),
    }),
  ),
});

export const statisticalOperatorExecutionEvidenceSchema = z.strictObject({
  call_id: stableCellIdSchema,
  operator_id: statisticalOperatorIdSchema,
  operator_registry_digest: contentHashSchema,
  implementation_digest: contentHashSchema,
  resolved_parameters: z.record(z.string().min(1).max(128), z.json()),
  resolved_parameters_hash: contentHashSchema,
  input_hash: contentHashSchema,
  output_hash: contentHashSchema,
  sample_size: z.number().int().nonnegative().nullable(),
  group_count: z.number().int().nonnegative().nullable(),
  family_size: z.number().int().nonnegative().nullable(),
  rank: z.number().int().nonnegative().nullable(),
  applicability: z.enum(["PASS", "ASSUMPTION_BOUND", "HOLD"]),
  limitation_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)).max(16),
});

export const analysisStatisticalOperatorObservationSchema = z.strictObject({
  schema_version: z.literal("analysis-statistical-operator-observation@1.0.0"),
  call_id: stableCellIdSchema,
  operator_id: statisticalOperatorIdSchema,
  operator_registry_digest: contentHashSchema,
  status: z.literal("SUCCEEDED"),
  output: z.json(),
  execution_evidence: statisticalOperatorExecutionEvidenceSchema,
  sealed_result_path: z
    .string()
    .regex(/^\/workspace\/sealed\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u),
  sealed_result_sha256: contentHashSchema,
});

export const analysisOperatorFinalizationResultSchema = z.strictObject({
  schema_version: z.literal("statistical-operator-finalization-result@1.0.0"),
  operator_registry_digest: contentHashSchema,
  operator_receipts: z.array(statisticalOperatorCallReceiptSchema).max(32),
  operator_receipt_closure_hash: contentHashSchema,
});

export const analysisAgentFinalResponseSchema = z.strictObject({
  schema_version: z.literal("analysis-agent-final@1.0.0"),
  summary_zh: z.string().trim().min(1).max(20_000),
  output_names: z.array(outputNameSchema).min(1).max(32),
});

export const analysisToolProtocolVersionSchema = versionIdentifierSchema;

export type AnalysisPythonCellToolArguments = z.infer<typeof analysisPythonCellToolArgumentsSchema>;
export type AnalysisStatisticalOperatorToolArguments = z.infer<
  typeof analysisStatisticalOperatorToolArgumentsSchema
>;
export type AnalysisToolCallCandidate = z.infer<typeof analysisToolCallCandidateSchema>;
export type AnalysisCellObservation = z.infer<typeof analysisCellObservationSchema>;
export type AnalysisStatisticalOperatorObservation = z.infer<
  typeof analysisStatisticalOperatorObservationSchema
>;
export type AnalysisOperatorFinalizationResult = z.infer<
  typeof analysisOperatorFinalizationResultSchema
>;
export type AnalysisAgentFinalResponse = z.infer<typeof analysisAgentFinalResponseSchema>;
