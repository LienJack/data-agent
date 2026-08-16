import type { OperationsHealthGate } from "@data-agent/contracts";

export function visibleOperationsHealthGates(
  gates: readonly OperationsHealthGate[],
  billingUiEnabled: boolean,
): readonly OperationsHealthGate[] {
  if (billingUiEnabled) return gates;
  return gates.filter((gate) => gate.key === "IDENTITY_SIDE_EFFECTS");
}
