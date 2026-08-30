import { createHash } from "node:crypto";
import type { Falcon24FourLayerManifestTurn } from "@data-agent/contracts/evals";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity-core";

export function stableFalcon24FourLayerUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function falcon24FourLayerShouldLoadRubricEvidence(
  runStatus: "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
  rubricEvidencePath: string | undefined,
): boolean {
  return runStatus === "SUCCEEDED" && rubricEvidencePath !== undefined;
}

export function falcon24FourLayerConversationMatchesDefaults(input: {
  readonly conversation: {
    readonly datasource_id: string | null;
    readonly model_id: string | null;
    readonly model_profile_id?: string | null;
  };
  readonly defaults: {
    readonly datasource_resource_id: string;
    readonly model_resource_id: string;
  };
}): boolean {
  return (
    input.conversation.datasource_id === input.defaults.datasource_resource_id &&
    input.conversation.model_id === input.defaults.model_resource_id &&
    input.conversation.model_profile_id === input.defaults.model_resource_id
  );
}

export function falcon24FourLayerBindingIdentity(input: {
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly attempt_id: string;
  readonly turn: Falcon24FourLayerManifestTurn;
}) {
  const conversationKey = input.turn.conversation_group ?? input.turn.turn_id;
  const conversationId = stableFalcon24FourLayerUuid(
    `falcon24:four-layer:conversation:${input.attempt_id}:${conversationKey}`,
  );
  const idempotencyKey = stableFalcon24FourLayerUuid(
    `falcon24:four-layer:turn:${input.attempt_id}:${input.turn.turn_id}`,
  );
  return Object.freeze({
    conversation_id: conversationId,
    idempotency_key: idempotencyKey,
    ...deriveRunCommandIdentities({
      workspace_id: input.workspace_id,
      principal_id: input.principal_id,
      idempotency_key: idempotencyKey,
    }),
  });
}
