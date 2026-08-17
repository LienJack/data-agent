import { buildJobWorkLease, type JobQueuePort, jobInputSchema } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createJobWorkerRunner } from "../../src/jobs/job-worker-runner.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000000011",
  environment: "test",
} as const;

describe("Job Worker Runner", () => {
  it("publishes readiness before claim and commits only handler-produced references", async () => {
    const lease = await buildJobWorkLease({
      schema_version: "job-work-lease@1.0.0",
      scope,
      principal_id: "00000000-0000-4000-8000-000000000101",
      job_id: "00000000-0000-4000-8000-000000000201",
      kind: "ARTIFACT_EXPORT",
      request_hash: `sha256:${"1".repeat(64)}`,
      input: jobInputSchema.parse({
        schema_version: "job-input@1.0.0",
        kind: "ARTIFACT_EXPORT",
        resource_refs: [],
        parameters: {},
      }),
      attempt_id: "00000000-0000-4000-8000-000000000301",
      attempt_no: 1,
      delivery_attempt_no: 1,
      worker_id: "job-worker-a",
      lease_token: 1,
      worker_fence: 1,
      lease_duration_ms: 30_000,
      expires_at: "2026-08-17T12:00:30.000Z",
      handler_revision: "artifact-export-handler@1.0.0",
    });
    const output = {
      artifact_id: "00000000-0000-4000-8000-000000000401",
      artifact_type: "ArtifactExportReceipt",
      ...scope,
      run_id: "00000000-0000-4000-8000-000000000501",
      revision: 1,
      content_hash: `sha256:${"2".repeat(64)}`,
    } as const;
    const order: string[] = [];
    const queue = {
      publishHeartbeat: vi.fn(async () => {
        order.push("heartbeat");
        return { ok: true, value: {} };
      }),
      claim: vi.fn(async () => {
        order.push("claim");
        return { ok: true, value: lease };
      }),
      start: vi.fn(async () => {
        order.push("start");
        return { ok: true, value: { started: true } };
      }),
      heartbeat: vi.fn(async () => {
        order.push("lease-heartbeat");
        return { ok: true, value: { expires_at: lease.expires_at, cancel_requested: false } };
      }),
      succeed: vi.fn(async () => {
        order.push("succeed");
        return { ok: true, value: {} };
      }),
      fail: vi.fn(),
      acknowledgeCancel: vi.fn(),
      enqueue: vi.fn(),
      requestCancel: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      listReadiness: vi.fn(),
    } as unknown as JobQueuePort;
    const runner = createJobWorkerRunner({
      queue,
      lease_duration_ms: 30_000,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      create_id: () => "00000000-0000-4000-8000-000000000601",
      handlers: [
        {
          binding: { kind: "ARTIFACT_EXPORT", handler_revision: "artifact-export-handler@1.0.0" },
          execute: async () => ({ ok: true, value: [output] }),
        },
      ],
    });
    await expect(
      runner.runOnce({ scope, worker_id: "job-worker-a", signal: new AbortController().signal }),
    ).resolves.toEqual({ ok: true, value: { kind: "COMPLETED", job_id: lease.job_id } });
    expect(order).toEqual(["heartbeat", "claim", "start", "lease-heartbeat", "succeed"]);
    expect(queue.succeed).toHaveBeenCalledWith({ lease, output_refs: [output] });
  });
});
