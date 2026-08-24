import type { ServerOwnedToolDescriptor } from "@data-agent/agent-runtime";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  analysisPythonCellToolArgumentsSchema,
  analysisStatisticalOperatorToolArgumentsSchema,
} from "@data-agent/contracts/ports";

export const ANALYSIS_MODEL_TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    tool_name: ANALYSIS_PYTHON_CELL_TOOL_NAME,
    description:
      "Run one bounded Python 3.12 analysis Cell in the stateful Agent sandbox. Use pandas/numpy for loading, transformation, validation, and named in-memory result/table symbols. Do not serialize final artifacts or implement governed statistical formulas.",
    input_schema: analysisPythonCellToolArgumentsSchema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
  Object.freeze({
    tool_name: ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
    description:
      "Invoke one server-governed statistical operator obligation. Supply only the exact authorized call id, operator id, and the names of two in-memory Python mapping symbols containing manifest-shaped inputs and parameters; the server extracts their bounded values and binds implementation, registry digest, and receipt.",
    input_schema: analysisStatisticalOperatorToolArgumentsSchema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
  Object.freeze({
    tool_name: ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.tool_name,
    description: ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.description,
    input_schema: ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.input_schema,
    strict: true,
    network_access: { mode: "DENY" as const },
  }),
] satisfies readonly ServerOwnedToolDescriptor[]);

export const ANALYSIS_MODEL_TOOL_ALLOWLIST = Object.freeze(
  ANALYSIS_MODEL_TOOL_DESCRIPTORS.map(({ tool_name: toolName }) => toolName),
);
