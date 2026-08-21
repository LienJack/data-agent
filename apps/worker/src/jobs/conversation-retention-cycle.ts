import type {
  ConversationTrashRetentionClaim,
  ConversationTrashRetentionReceipt,
  PortResult,
} from "@data-agent/contracts";

type ConversationRetentionAuthority = Readonly<{
  claimConversationRetention(
    capability: unknown,
    input: Readonly<{ limit: number; lease_duration_ms: number }>,
  ): Promise<PortResult<readonly ConversationTrashRetentionClaim[]>>;
  completeConversationRetention(
    capability: unknown,
    input: Readonly<{
      schema_version: "conversation-trash-retention-complete@1.0.0";
      claim_id: string;
      fence: number;
      outcome: "PURGED";
      reason_code: "CONVERSATION_RETENTION_DUE";
    }>,
  ): Promise<PortResult<ConversationTrashRetentionReceipt>>;
}>;

export type ConversationRetentionCycleResult = Readonly<{
  claimed: number;
  purged: number;
  held: number;
}>;

/**
 * Runs one owner-scoped retention batch inside the existing multi-principal Job worker loop.
 * PostgreSQL remains authoritative for DB time eligibility and may downgrade PURGED to HELD.
 */
export async function runConversationRetentionCycle(
  options: Readonly<{
    authority: ConversationRetentionAuthority;
    capability: unknown;
    batch_size?: number;
    lease_duration_ms?: number;
  }>,
): Promise<PortResult<ConversationRetentionCycleResult>> {
  const claimed = await options.authority.claimConversationRetention(options.capability, {
    limit: options.batch_size ?? 25,
    lease_duration_ms: options.lease_duration_ms ?? 60_000,
  });
  if (!claimed.ok) return claimed;
  let purged = 0;
  let held = 0;
  for (const claim of claimed.value) {
    const completed = await options.authority.completeConversationRetention(options.capability, {
      schema_version: "conversation-trash-retention-complete@1.0.0",
      claim_id: claim.claim_id,
      fence: claim.fence,
      outcome: "PURGED",
      reason_code: "CONVERSATION_RETENTION_DUE",
    });
    if (!completed.ok) return completed;
    if (completed.value.outcome === "PURGED") purged += 1;
    else held += 1;
  }
  return { ok: true, value: { claimed: claimed.value.length, purged, held } };
}
