import { type SemanticManualEdit, semanticManualEditSchema } from "@data-agent/contracts";

/**
 * The shared client command boundary for Agent-adjacent and direct edits.
 * It validates a typed operation only; persistence and authority stay on the server.
 */
export function createSemanticManualEditCommand(input: unknown): SemanticManualEdit {
  return semanticManualEditSchema.parse(input);
}
