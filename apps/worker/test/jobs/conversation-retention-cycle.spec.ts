import { describe, expect, it, vi } from "vitest";
import { runConversationRetentionCycle } from "../../src/jobs/conversation-retention-cycle.js";

const claim = (id: string, fence: number) => ({
  schema_version: "conversation-trash-retention-claim@1.0.0" as const,
  claim_id: id,
  workspace_id: "10000000-0000-4000-8000-000000000001",
  owner_principal_id: "10000000-0000-4000-8000-000000000002",
  conversation_id: "10000000-0000-4000-8000-000000000003",
  deleted_at: "2026-07-01T00:00:00.000Z",
  purge_after: "2026-07-31T00:00:00.000Z",
  fence,
  lease_expires_at: "2026-08-22T01:01:00.000Z",
});

describe("conversation retention cycle", () => {
  it("uses authoritative claims and reports PostgreSQL PURGED/HELD outcomes", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schema_version: "conversation-trash-retention-receipt@1.0.0",
          receipt_id: "10000000-0000-4000-8000-000000000010",
          claim_id: "10000000-0000-4000-8000-000000000011",
          conversation_id: "10000000-0000-4000-8000-000000000003",
          fence: 2,
          outcome: "PURGED",
          reason_code: "CONVERSATION_RETENTION_DUE",
          committed_at: "2026-08-22T01:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schema_version: "conversation-trash-retention-receipt@1.0.0",
          receipt_id: "10000000-0000-4000-8000-000000000012",
          claim_id: "10000000-0000-4000-8000-000000000013",
          conversation_id: "10000000-0000-4000-8000-000000000003",
          fence: 4,
          outcome: "HELD",
          reason_code: "CONVERSATION_RETENTION_REFERENCES_HELD",
          committed_at: "2026-08-22T01:00:00.000Z",
        },
      });
    const result = await runConversationRetentionCycle({
      capability: { principal: "owner" },
      authority: {
        claimConversationRetention: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            claim("10000000-0000-4000-8000-000000000011", 2),
            claim("10000000-0000-4000-8000-000000000013", 4),
          ],
        }),
        completeConversationRetention: complete,
      },
    });

    expect(result).toEqual({ ok: true, value: { claimed: 2, purged: 1, held: 1 } });
    expect(complete).toHaveBeenNthCalledWith(
      1,
      { principal: "owner" },
      expect.objectContaining({
        claim_id: "10000000-0000-4000-8000-000000000011",
        fence: 2,
        outcome: "PURGED",
      }),
    );
  });

  it("stops without completing when claim authority fails", async () => {
    const complete = vi.fn();
    await expect(
      runConversationRetentionCycle({
        capability: {},
        authority: {
          claimConversationRetention: vi.fn().mockResolvedValue({
            ok: false,
            error: { code: "QA_RETENTION_CLAIM_FAILED", message: "failed", retryable: true },
          }),
          completeConversationRetention: complete,
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "QA_RETENTION_CLAIM_FAILED" } });
    expect(complete).not.toHaveBeenCalled();
  });
});
