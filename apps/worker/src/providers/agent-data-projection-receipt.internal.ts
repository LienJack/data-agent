import {
  type AgentDataProjectionReceiptV2,
  buildAgentDataProjectionReceiptV2Candidate,
} from "@data-agent/contracts";

const internalProjectionReceipts = new WeakSet<object>();

export type InternalAgentDataProjectionReceipt = AgentDataProjectionReceiptV2;

export async function createInternalAgentDataProjectionReceipt(input: {
  readonly document: Omit<AgentDataProjectionReceiptV2, "receipt_id" | "receipt_hash">;
}): Promise<InternalAgentDataProjectionReceipt> {
  const receipt = await buildAgentDataProjectionReceiptV2Candidate({
    ...input.document,
    receipt_id: input.document.request_id,
  });
  internalProjectionReceipts.add(receipt);
  return Object.freeze(receipt);
}

export function isInternalAgentDataProjectionReceipt(
  input: unknown,
): input is InternalAgentDataProjectionReceipt {
  return typeof input === "object" && input !== null && internalProjectionReceipts.has(input);
}
