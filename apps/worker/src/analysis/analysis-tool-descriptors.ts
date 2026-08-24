import type { ServerOwnedToolDescriptor } from "@data-agent/agent-runtime";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  analysisPythonCellToolArgumentsSchema,
  analysisResultPublishModelArgumentsSchema,
  analysisStatisticalOperatorToolArgumentsSchema,
} from "@data-agent/contracts/ports";
import { z } from "zod";
import { analysisOperatorArgumentSymbols } from "./analysis-operator-symbols.js";

export const analysisPythonCellModelArgumentsSchema = analysisPythonCellToolArgumentsSchema.omit({
  schema_version: true,
  cell_id: true,
});
export const analysisStatisticalOperatorModelArgumentsSchema =
  analysisStatisticalOperatorToolArgumentsSchema.omit({
    schema_version: true,
    inputs_symbol: true,
    parameters_symbol: true,
  });
export const analysisModelToolCallCandidateSchema = z.discriminatedUnion("tool_name", [
  z.strictObject({
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.literal(ANALYSIS_PYTHON_CELL_TOOL_NAME),
    arguments: analysisPythonCellModelArgumentsSchema,
  }),
  z.strictObject({
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.literal(ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME),
    arguments: analysisStatisticalOperatorModelArgumentsSchema,
  }),
  z.strictObject({
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.literal(ANALYSIS_RESULT_PUBLISH_TOOL_NAME),
    arguments: analysisResultPublishModelArgumentsSchema,
  }),
]);

export const ANALYSIS_MODEL_TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    tool_name: ANALYSIS_PYTHON_CELL_TOOL_NAME,
    description:
      "Run one bounded Python 3.12 analysis Cell in the stateful Agent sandbox. Use pandas/numpy for loading, transformation, validation, and named in-memory result/table symbols. Do not send schema_version or cell_id; the server binds both. Do not serialize final artifacts or implement governed statistical formulas.",
    input_schema: analysisPythonCellModelArgumentsSchema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
  Object.freeze({
    tool_name: ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
    description:
      "Invoke one server-governed statistical operator obligation. Supply only the exact authorized call id and operator id. The server binds the required in-memory Python input and parameter symbols together with the protocol version, implementation, registry digest, and receipt.",
    input_schema: analysisStatisticalOperatorModelArgumentsSchema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
  Object.freeze({
    tool_name: ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.tool_name,
    description: `${ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.description} Supply table symbols and chart field selections only. Do not send schema_version, chart intent, template id, or chart data symbol; the server binds those values from the result contract.`,
    input_schema: analysisResultPublishModelArgumentsSchema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
] satisfies readonly ServerOwnedToolDescriptor[]);

export const ANALYSIS_MODEL_TOOL_ALLOWLIST = Object.freeze(
  ANALYSIS_MODEL_TOOL_DESCRIPTORS.map(({ tool_name: toolName }) => toolName),
);

export { analysisOperatorArgumentSymbols };
