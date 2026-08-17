import { describe, expect, it } from "vitest";
import {
  assertJobStatusTransition,
  buildCapabilityReadinessReceipt,
  buildJobOutputReceipt,
  buildJobSubmissionCommand,
  buildJobSubmissionReceipt,
  buildJobWorkerHeartbeat,
  buildJobWorkLease,
  computeJobRequestHash,
  JOB_KINDS,
  jobInputSchema,
  jobKindSchema,
  jobSubmissionCommandSchema,
  verifyCapabilityReadinessReceipt,
  verifyJobOutputReceipt,
  verifyJobSubmissionCommand,
  verifyJobSubmissionReceipt,
  verifyJobWorkerHeartbeat,
  verifyJobWorkLease,
} from "../src/jobs/runtime.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "10000000-0000-4000-8000-000000000001",
  environment: "local",
} as const;

const input = jobInputSchema.parse({
  schema_version: "job-input@1.0.0",
  kind: "ARTIFACT_EXPORT",
  resource_refs: [],
  parameters: {
    source_artifact_id: "20000000-0000-4000-8000-000000000001",
    format: "CSV",
  },
});

describe("U10 job runtime contract", () => {
  it("extends the core job kinds with U6 FILE_SCAN and U15 KNOWLEDGE_INDEX", () => {
    expect(JOB_KINDS).toEqual([
      "SCHEMA_SCAN",
      "RELATIONSHIP_INDEX",
      "ARTIFACT_EXPORT",
      "SEMANTIC_INDUCTION",
      "METRIC_IMPORT",
      "DATALINK_REBUILD",
      "FILE_SCAN",
      "KNOWLEDGE_INDEX",
    ]);
    expect(jobKindSchema.safeParse("FILE_SCAN").success).toBe(true);
  });

  it("builds and verifies a canonical submission command", async () => {
    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-0001",
      input,
      priority: 50,
      max_attempts: 5,
      cancel_policy: "COOPERATIVE",
    });

    expect(command.request_hash).toBe(await computeJobRequestHash(command));
    expect(await verifyJobSubmissionCommand(command)).toEqual(command);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it("requires the exact U6 file revision identity for FILE_SCAN", () => {
    expect(
      jobInputSchema.safeParse({
        schema_version: "job-input@1.0.0",
        kind: "FILE_SCAN",
        resource_refs: [],
        parameters: {
          file_id: "70000000-0000-4000-8000-000000000001",
          revision: 1,
          revision_hash: `sha256:${"7".repeat(64)}`,
        },
      }).success,
    ).toBe(true);
    expect(
      jobInputSchema.safeParse({
        schema_version: "job-input@1.0.0",
        kind: "FILE_SCAN",
        resource_refs: [],
        parameters: {
          file_id: "70000000-0000-4000-8000-000000000001",
          revision: 1,
          revision_hash: `sha256:${"7".repeat(64)}`,
          storage_key: "forbidden",
        },
      }).success,
    ).toBe(false);
  });

  it("allows a successful FILE_SCAN to reference its committed domain receipt", async () => {
    const receipt = await buildJobOutputReceipt({
      schema_version: "job-output-receipt@1.0.0",
      receipt_id: "71000000-0000-4000-8000-000000000001",
      scope,
      principal_id: "72000000-0000-4000-8000-000000000001",
      job_id: "73000000-0000-4000-8000-000000000001",
      kind: "FILE_SCAN",
      request_hash: `sha256:${"1".repeat(64)}`,
      attempt_id: "74000000-0000-4000-8000-000000000001",
      worker_fence: 1,
      terminal: "SUCCEEDED",
      output_refs: [
        {
          schema_version: "job-domain-output-reference@1.0.0",
          resource_kind: "WORKSPACE_FILE_SCAN_RECEIPT",
          app_id: scope.app_id,
          tenant_id: scope.tenant_id,
          environment: scope.environment,
          resource_id: "75000000-0000-4000-8000-000000000001",
          resource_revision: 1,
          resource_hash: `sha256:${"2".repeat(64)}`,
        },
      ],
      error_code: null,
      committed_at: "2026-08-17T12:00:00.000Z",
    });
    expect(await verifyJobOutputReceipt(receipt)).toEqual(receipt);
    await expect(
      verifyJobOutputReceipt({
        ...receipt,
        output_refs: [{ ...receipt.output_refs[0], resource_hash: `sha256:${"3".repeat(64)}` }],
      }),
    ).rejects.toThrow("JOB_OUTPUT_RECEIPT_HASH_MISMATCH");
  });

  it("binds the database submission receipt to the exact request and acceptance time", async () => {
    const receipt = await buildJobSubmissionReceipt({
      schema_version: "job-submission-receipt@1.0.0",
      disposition: "CREATED",
      scope,
      principal_id: "30000000-0000-4000-8000-000000000001",
      job_id: "40000000-0000-4000-8000-000000000001",
      kind: "ARTIFACT_EXPORT",
      request_hash: `sha256:${"1".repeat(64)}`,
      status: "QUEUED",
      accepted_at: "2026-08-17T12:00:00.000Z",
    });
    expect(await verifyJobSubmissionReceipt(receipt)).toEqual(receipt);
    await expect(
      verifyJobSubmissionReceipt({ ...receipt, disposition: "REPLAYED" }),
    ).rejects.toThrow("JOB_SUBMISSION_RECEIPT_HASH_MISMATCH");
  });

  it("rejects unknown fields, kind substitution, and a stale request hash", async () => {
    expect(jobInputSchema.safeParse({ ...input, raw_secret: "forbidden" }).success).toBe(false);
    expect(
      jobSubmissionCommandSchema.safeParse({
        schema_version: "job-submit@1.0.0",
        scope,
        kind: "SCHEMA_SCAN",
        idempotency_key: "artifact-export-0001",
        input,
        priority: 50,
        max_attempts: 5,
        cancel_policy: "COOPERATIVE",
        request_hash: `sha256:${"0".repeat(64)}`,
      }).success,
    ).toBe(false);

    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-0001",
      input,
      priority: 50,
      max_attempts: 5,
      cancel_policy: "COOPERATIVE",
    });
    await expect(verifyJobSubmissionCommand({ ...command, priority: 51 })).rejects.toThrow(
      "JOB_REQUEST_HASH_MISMATCH",
    );
  });

  it("accepts only explicit state-machine transitions", () => {
    expect(() => assertJobStatusTransition("QUEUED", "LEASED")).not.toThrow();
    expect(() => assertJobStatusTransition("RUNNING", "RETRY_WAIT")).not.toThrow();
    expect(() => assertJobStatusTransition("CANCEL_REQUESTED", "CANCELLED")).not.toThrow();
    expect(() => assertJobStatusTransition("SUCCEEDED", "RUNNING")).toThrow(
      "JOB_STATUS_TRANSITION_INVALID",
    );
    expect(() => assertJobStatusTransition("QUEUED", "SUCCEEDED")).toThrow(
      "JOB_STATUS_TRANSITION_INVALID",
    );
  });

  it("binds work leases to the exact request, attempt, handler revision, and fence", async () => {
    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-0001",
      input,
      priority: 50,
      max_attempts: 5,
      cancel_policy: "COOPERATIVE",
    });
    const lease = await buildJobWorkLease({
      schema_version: "job-work-lease@1.0.0",
      scope,
      principal_id: "30000000-0000-4000-8000-000000000001",
      job_id: "40000000-0000-4000-8000-000000000001",
      kind: "ARTIFACT_EXPORT",
      request_hash: command.request_hash,
      input,
      attempt_id: "50000000-0000-4000-8000-000000000001",
      attempt_no: 1,
      delivery_attempt_no: 1,
      worker_id: "job-worker-1",
      lease_token: 1,
      worker_fence: 1,
      lease_duration_ms: 30_000,
      expires_at: "2026-08-17T12:00:30.000Z",
      handler_revision: "artifact-export-handler@1.0.0",
    });
    expect(await verifyJobWorkLease(lease)).toEqual(lease);
    await expect(verifyJobWorkLease({ ...lease, worker_fence: 2 })).rejects.toThrow(
      "JOB_WORK_LEASE_HASH_MISMATCH",
    );
  });

  it("signs canonical worker heartbeats and rejects handler substitution", async () => {
    const heartbeat = await buildJobWorkerHeartbeat({
      schema_version: "job-worker-heartbeat@1.0.0",
      heartbeat_id: "60000000-0000-4000-8000-000000000002",
      scope,
      worker_id: "job-worker-1",
      handlers: [
        { kind: "ARTIFACT_EXPORT", handler_revision: "artifact-export-handler@1.0.0" },
        { kind: "SCHEMA_SCAN", handler_revision: "schema-scan-handler@1.0.0" },
      ],
      capacity: 2,
      observed_at: "2026-08-17T12:00:00.000Z",
      expires_at: "2026-08-17T12:01:00.000Z",
    });
    expect(await verifyJobWorkerHeartbeat(heartbeat)).toEqual(heartbeat);
    await expect(
      verifyJobWorkerHeartbeat({
        ...heartbeat,
        handlers: [
          { kind: "ARTIFACT_EXPORT", handler_revision: "artifact-export-handler@2.0.0" },
          { kind: "SCHEMA_SCAN", handler_revision: "schema-scan-handler@1.0.0" },
        ],
      }),
    ).rejects.toThrow("JOB_WORKER_HEARTBEAT_HASH_MISMATCH");
  });

  it("only marks a capability READY when every authority fact is closed", async () => {
    const ready = await buildCapabilityReadinessReceipt({
      schema_version: "capability-readiness-receipt@1.0.0",
      receipt_id: "60000000-0000-4000-8000-000000000001",
      scope,
      capability: "ARTIFACT_EXPORT",
      status: "READY",
      reason_code: "CAPABILITY_READY",
      handler_revision: "artifact-export-handler@1.0.0",
      handler_registered: true,
      worker_heartbeat_fresh: true,
      dependencies_ready: true,
      output_receipt_required: true,
      output_receipt_available: true,
      evaluated_at: "2026-08-17T12:00:00.000Z",
      valid_until: "2026-08-17T12:01:00.000Z",
    });
    expect(await verifyCapabilityReadinessReceipt(ready)).toEqual(ready);

    const { receipt_hash: _receiptHash, ...readyDraft } = ready;
    await expect(
      buildCapabilityReadinessReceipt({
        ...readyDraft,
        worker_heartbeat_fresh: false,
      }),
    ).rejects.toThrow("CAPABILITY_READINESS_CLOSURE_INVALID");
  });
});
