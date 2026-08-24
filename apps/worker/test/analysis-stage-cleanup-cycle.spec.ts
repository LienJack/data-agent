import { describe, expect, it, vi } from "vitest";
import { runAnalysisStageCleanupCycle } from "../src/run-worker-cli.js";

const scope = {
  app_id: "91000000-0000-4000-8000-000000000001",
  tenant_id: "91000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const principalId = "91000000-0000-4000-8000-000000000003";
const cleanupId = "91000000-0000-4000-8000-000000000004";

describe("analysis stage cleanup cycle", () => {
  it("uses one bounded server-owned command without exposing table deletion", async () => {
    const receipt = {
      schema_version: "analysis-result-stage-cleanup-receipt@1.0.0" as const,
      scope,
      principal_id: principalId,
      cleanup_id: cleanupId,
      idempotency_key: `analysis-stage-cleanup:${cleanupId}`,
      requested_limit: 100,
      cutoff_at: "2026-08-25T00:00:00.000Z",
      deleted_count: 0,
      deleted_stages: [],
      receipt_hash: `sha256:${"a".repeat(64)}` as const,
    };
    const sweepExpiredAnalysisResultStages = vi.fn(async () => ({
      ok: true as const,
      receipt,
    }));

    await expect(
      runAnalysisStageCleanupCycle({
        authority: { sweepExpiredAnalysisResultStages },
        capability_input: { authority: "EVIDENCE" },
        scope,
        principal_id: principalId,
        create_id: () => cleanupId,
      }),
    ).resolves.toEqual({ ok: true, receipt });
    expect(sweepExpiredAnalysisResultStages).toHaveBeenCalledWith(
      { authority: "EVIDENCE" },
      {
        schema_version: "analysis-result-stage-cleanup@1.0.0",
        scope,
        principal_id: principalId,
        cleanup_id: cleanupId,
        idempotency_key: `analysis-stage-cleanup:${cleanupId}`,
        requested_limit: 100,
      },
    );
  });
});
