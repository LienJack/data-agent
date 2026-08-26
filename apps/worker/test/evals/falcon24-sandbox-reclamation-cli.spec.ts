import { buildFalcon24SandboxReclamationReceipt, sha256ContentHash } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  holdReclamationAfterFailure,
  reclaimFalcon24RunSandboxes,
} from "../../src/evals/falcon24-sandbox-reclamation-cli.js";

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
    const claim = vi.fn(async () => ({ disposition: "CLAIMED" as const, receipt: null }));
    const cleanupRun = vi.fn(async () => observation);

    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: () => ({ cleanupRun }),
        claim,
        campaign_id: "E1-C1",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).resolves.toEqual({
      disposition: "CLAIMED",
      receipt: {
        schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
        campaign_id: "E1-C1",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
        ...observation,
        receipt_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    });
    expect(cleanupRun).toHaveBeenCalledWith({ run_id: runId });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupRun.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects invalid campaign/run identity before calling OpenSandbox", async () => {
    const cleanupRun = vi.fn(async () => managementObservation());
    const claim = vi.fn(async () => ({ disposition: "CLAIMED" as const, receipt: null }));
    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: () => ({ cleanupRun }),
        claim,
        campaign_id: "unsafe",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow();
    expect(cleanupRun).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not call OpenSandbox when durable Trace authority is missing", async () => {
    const cleanupRun = vi.fn(async () => managementObservation());
    const claim = vi.fn(async () => {
      throw new TypeError("FALCON24_TRACE_STAGE_REQUIRED");
    });

    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: () => ({ cleanupRun }),
        claim,
        campaign_id: "E1-C1",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow("FALCON24_TRACE_STAGE_REQUIRED");
    expect(claim).toHaveBeenCalledTimes(1);
    expect(cleanupRun).not.toHaveBeenCalled();
  });

  it("does not call OpenSandbox when the durable claim is already owned", async () => {
    const cleanupRun = vi.fn(async () => managementObservation());
    const claim = vi.fn(async () => {
      throw new TypeError("FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED");
    });

    await expect(
      reclaimFalcon24RunSandboxes({
        runtime: () => ({ cleanupRun }),
        claim,
        campaign_id: "E1-C1",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow("FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED");
    expect(claim).toHaveBeenCalledTimes(1);
    expect(cleanupRun).not.toHaveBeenCalled();
  });

  it("returns a completed durable receipt without calling OpenSandbox again", async () => {
    const observation = await managementObservation();
    const receipt = await buildFalcon24SandboxReclamationReceipt({
      schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
      campaign_id: "E1-C1",
      run_id: runId,
      runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      ...observation,
    });
    const cleanupRun = vi.fn(async () => observation);
    const runtime = vi.fn(() => ({ cleanupRun }));
    const claim = vi.fn(async () => ({ disposition: "COMPLETED" as const, receipt }));

    await expect(
      reclaimFalcon24RunSandboxes({
        runtime,
        claim,
        campaign_id: "E1-C1",
        run_id: runId,
        runtime_attestation_hash: `sha256:${"a".repeat(64)}`,
      }),
    ).resolves.toEqual({ disposition: "COMPLETED", receipt });
    expect(runtime).not.toHaveBeenCalled();
    expect(cleanupRun).not.toHaveBeenCalled();
  });

  it("keeps Sandbox failure primary after durable campaign HOLD", async () => {
    const originalError = new TypeError("FALCON24_SANDBOX_RECLAMATION_INCOMPLETE");
    const hold = vi.fn().mockResolvedValue({ ok: true, value: { status: "HOLD" } });

    await expect(holdReclamationAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("does not HOLD when another process already owns the durable claim", async () => {
    const originalError = new TypeError("FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED");
    const hold = vi.fn();

    await expect(holdReclamationAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(hold).not.toHaveBeenCalled();
  });

  it("does not HOLD while the reclamation COMMIT outcome is unknown", async () => {
    const originalError = new TypeError("FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN");
    const hold = vi.fn();

    await expect(holdReclamationAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(hold).not.toHaveBeenCalled();
  });
});
