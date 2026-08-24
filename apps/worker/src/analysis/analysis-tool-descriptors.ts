import type { ServerOwnedToolDescriptor } from "@data-agent/agent-runtime";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  analysisPythonCellToolArgumentsSchema,
  analysisStatisticalOperatorToolArgumentsSchema,
} from "@data-agent/contracts/ports";

export const ANALYSIS_MODEL_TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    tool_name: ANALYSIS_PYTHON_CELL_TOOL_NAME,
    description:
      "Run one bounded Python 3.12 analysis Cell in the stateful Agent sandbox. Use pandas/numpy for loading, transformation, validation, table files, and PNG/SVG charts. Do not implement governed statistical formulas in this Cell.",
    input_schema: analysisPythonCellToolArgumentsSchema,
    network_access: { mode: "DENY" as const },
  }),
  Object.freeze({
    tool_name: ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
    description:
      "Invoke one server-governed statistical operator obligation. Supply only the exact authorized call id, operator id, inputs, and parameters; the server binds implementation, registry digest, and receipt.",
    input_schema: analysisStatisticalOperatorToolArgumentsSchema,
    network_access: { mode: "DENY" as const },
  }),
] satisfies readonly ServerOwnedToolDescriptor[]);

export const ANALYSIS_MODEL_TOOL_ALLOWLIST = Object.freeze(
  ANALYSIS_MODEL_TOOL_DESCRIPTORS.map(({ tool_name: toolName }) => toolName),
);
