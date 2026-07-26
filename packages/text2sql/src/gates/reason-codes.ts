import { TEXT2SQL_GATE_REASON_CODES, type Text2SqlGateReasonCode } from "@data-agent/contracts";

function flattenReasonCodes<
  const Table extends Readonly<{
    PASS: readonly string[];
    FAIL: readonly string[];
    UNAVAILABLE: readonly string[];
  }>,
>(
  table: Table,
): readonly (Table["PASS"][number] | Table["FAIL"][number] | Table["UNAVAILABLE"][number])[] {
  return Object.freeze([...table.PASS, ...table.FAIL, ...table.UNAVAILABLE]);
}

/** 七道 Gate 的 Reason Code 只从 contracts 单一真值源派生。 */
export const INTENT_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.INTENT);
export const SEMANTIC_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.SEMANTIC);
export const STRUCTURAL_GATE_REASON_CODES = flattenReasonCodes(
  TEXT2SQL_GATE_REASON_CODES.STRUCTURAL,
);
export const POLICY_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.POLICY);
export const RESOURCE_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.RESOURCE);
export const EXECUTION_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.EXECUTION);
export const RESULT_GATE_REASON_CODES = flattenReasonCodes(TEXT2SQL_GATE_REASON_CODES.RESULT);

export type IntentGateReasonCode = Text2SqlGateReasonCode<"INTENT">;
export type SemanticGateReasonCode = Text2SqlGateReasonCode<"SEMANTIC">;
export type StructuralGateReasonCode = Text2SqlGateReasonCode<"STRUCTURAL">;
export type PolicyGateReasonCode = Text2SqlGateReasonCode<"POLICY">;
export type ResourceGateReasonCode = Text2SqlGateReasonCode<"RESOURCE">;
export type ExecutionGateReasonCode = Text2SqlGateReasonCode<"EXECUTION">;
export type ResultGateReasonCode = Text2SqlGateReasonCode<"RESULT">;
