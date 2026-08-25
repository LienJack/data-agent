import { sha256ContentHash } from "@data-agent/contracts/common";
import { describe, expect, it, vi } from "vitest";
import { reclaimFalcon24RunSandboxes } from "../../src/evals/falcon24-sandbox-reclamation-cli.js";

const runId = "00000000-0000-4000-8000-000000000001";

async function managementObservation() {
  const material = {
    management_observation_schema_version:
      "opensandbox-management-reclamation-observation@1.0.0" as const,
    management_operation_id: "00000000-0000-4000-8000-000000000002",
    observation_source: "OPENSANDBOX_MANAGEMENT_API" as const,
    target_metadata_hash: `sha256:${"b".repeat(64)}` as const,
    before_observation: {
      active_count: 2,
      observation_hash: `sha256:${"c".repeat(64)}` as const,
    },
    killed: 2,
    after_observation: {
      active_count: 0 as const,
      observation_hash: `sha256:${"d".repeat(64)}` as const,
    },
    residual: 0 as const,
    completed_at: "2026-08-25T12:00:00.000Z",
  };
  return {
    ...material,
    management_observation_hash: await sha256ContentHash(material),
  };
}

describe("Falcon24 sandbox reclamation", () => {
  it("builds a management-plane-bound receipt only after the exact run has zero residual sandboxes", async () => {
    const observation = await managementObservation();
    const cleanupRun = vi.fn(async () => observation);

    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: { cleanupRun },
        campaign_id: "falcon24-root-v13-final",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).resolves.toEqual({
      schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
      campaign_id: "falcon24-root-v13-final",
      run_id: runId,
      runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      ...observation,
      receipt_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(cleanupRun).toHaveBeenCalledWith({ run_id: runId });
  });

  it("rejects invalid campaign/run identity before calling OpenSandbox", async () => {
    const cleanupRun = vi.fn(async () => managementObservation());
    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: { cleanupRun },
        campaign_id: "unsafe",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow();
    expect(cleanupRun).not.toHaveBeenCalled();
  });
});
