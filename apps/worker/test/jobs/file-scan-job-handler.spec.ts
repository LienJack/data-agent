import {
  buildJobWorkLease,
  buildWorkspaceFileRevision,
  buildWorkspaceFileScanReceipt,
  jobInputSchema,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createFileScanJobHandler } from "../../src/jobs/file-scan-job-handler.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "10000000-0000-4000-8000-000000000001",
  principal: "20000000-0000-4000-8000-000000000001",
  file: "30000000-0000-4000-8000-000000000001",
  session: "40000000-0000-4000-8000-000000000001",
  policy: "50000000-0000-4000-8000-000000000001",
  job: "60000000-0000-4000-8000-000000000001",
  attempt: "70000000-0000-4000-8000-000000000001",
  receipt: "80000000-0000-4000-8000-000000000001",
} as const;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

async function fixtures() {
  const file = await buildWorkspaceFileRevision({
    schema_version: "workspace-file-revision@1.0.0",
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      workspace_id: ids.tenant,
    },
    file_id: ids.file,
    revision: 1,
    parent_ref: null,
    owner_principal_id: ids.principal,
    visibility: "SESSION",
    session_id: ids.session,
    original_filename: "notes.txt",
    detected_mime: "text/plain",
    byte_size: 5,
    blob_hash: hash("a"),
    status: "QUARANTINED",
    scan_receipt_ref: null,
    deletion_receipt_ref: null,
    promoted_from_ref: null,
    retention_policy_ref: {
      policy_id: ids.policy,
      policy_revision: 1,
      policy_hash: hash("b"),
    },
    created_by_principal_id: ids.principal,
    created_at: "2026-08-17T07:00:00.000Z",
  });
  const lease = await buildJobWorkLease({
    schema_version: "job-work-lease@1.0.0",
    scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
    principal_id: ids.principal,
    job_id: ids.job,
    kind: "FILE_SCAN",
    request_hash: hash("c"),
    input: jobInputSchema.parse({
      schema_version: "job-input@1.0.0",
      kind: "FILE_SCAN",
      resource_refs: [],
      parameters: { file_id: ids.file, revision: 1, revision_hash: file.revision_hash },
    }),
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    worker_id: "file-worker-a",
    lease_token: 1,
    worker_fence: 1,
    lease_duration_ms: 30_000,
    expires_at: "2026-08-17T07:00:30.000Z",
    handler_revision: "file-scan-handler@1.0.0",
  });
  return {
    file,
    lease,
    target: {
      file,
      storage_key: `workspace-content/v1/${ids.app}/${ids.tenant}/test/aa/${"a".repeat(64)}`,
      blob_hash: hash("a"),
      byte_size: 5,
      detected_mime: "text/plain",
    } as const,
  };
}

describe("FILE_SCAN Job Handler", () => {
  it("reads exact content and commits the domain receipt before Job success", async () => {
    const { file, lease, target } = await fixtures();
    const scanReceipt = await buildWorkspaceFileScanReceipt({
      schema_version: "workspace-file-scan-receipt@1.0.0",
      receipt_id: ids.receipt,
      scope: file.scope,
      file_ref: {
        file_id: file.file_id,
        revision: file.revision,
        revision_hash: file.revision_hash,
      },
      blob_hash: file.blob_hash,
      byte_size: file.byte_size,
      job_id: lease.job_id,
      attempt_id: lease.attempt_id,
      worker_fence: lease.worker_fence,
      scanner: {
        engine: "CLAMAV",
        engine_version: "1.4.2",
        signature_version: "20260817",
        signature_observed_at: "2026-08-17T06:59:00.000Z",
        policy_version: "workspace-file-policy@1.0.0",
      },
      verdict: "CLEAN",
      malware_name: null,
      credential_match_count: 0,
      content_policy_findings: [],
      scanned_at: "2026-08-17T07:00:01.000Z",
    });
    const { revision_hash: _revisionHash, ...fileDraft } = file;
    const ready = await buildWorkspaceFileRevision({
      ...fileDraft,
      revision: 2,
      parent_ref: {
        file_id: file.file_id,
        revision: file.revision,
        revision_hash: file.revision_hash,
      },
      status: "READY",
      scan_receipt_ref: {
        receipt_id: scanReceipt.receipt_id,
        receipt_hash: scanReceipt.receipt_hash,
        verdict: scanReceipt.verdict,
      },
      created_at: "2026-08-17T07:00:01.000Z",
    });
    const commitScan = vi.fn(async () => ({
      ok: true as const,
      value: { scan_receipt: scanReceipt, revision: ready },
    }));
    const handler = createFileScanJobHandler({
      capability: {},
      files: {
        loadForScan: async () => ({ ok: true, value: target }),
        commitScan,
      },
      content: { get: async () => ({ ok: true, value: new TextEncoder().encode("hello") }) },
      scanner: {
        scan: async () => ({
          verdict: "CLEAN",
          stable_error_code: null,
          scanner: {
            engine_version: "1.4.2",
            signature_version: "20260817",
            signature_observed_at: "2026-08-17T06:59:00.000Z",
          },
          credential_match_count: 0,
          content_policy_findings: [],
          malware_name: null,
        }),
      },
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(handler.execute(lease, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: [
        {
          schema_version: "job-domain-output-reference@1.0.0",
          resource_kind: "WORKSPACE_FILE_SCAN_RECEIPT",
          app_id: ids.app,
          tenant_id: ids.tenant,
          environment: "test",
          resource_id: ids.receipt,
          resource_revision: 1,
          resource_hash: scanReceipt.receipt_hash,
        },
      ],
    });
    expect(commitScan).toHaveBeenCalledWith(
      {},
      lease,
      expect.objectContaining({ verdict: "CLEAN", file_ref: expect.any(Object) }),
    );
  });

  it("keeps the file quarantined and retries when scanner truth is unknown", async () => {
    const { lease, target } = await fixtures();
    const commitScan = vi.fn();
    const handler = createFileScanJobHandler({
      capability: {},
      files: {
        loadForScan: async () => ({ ok: true, value: target }),
        commitScan,
      },
      content: { get: async () => ({ ok: true, value: new Uint8Array([1]) }) },
      scanner: {
        scan: async () => ({
          verdict: "UNKNOWN",
          stable_error_code: "FILE_SCANNER_UNAVAILABLE",
          scanner: null,
          credential_match_count: 0,
          content_policy_findings: [],
          malware_name: null,
        }),
      },
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(handler.execute(lease, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: "FILE_SCANNER_UNAVAILABLE", retryable: true },
    });
    expect(commitScan).not.toHaveBeenCalled();
  });

  it("commits deterministic local policy rejection when scanner evidence is available", async () => {
    const { file, lease, target } = await fixtures();
    const scanReceipt = await buildWorkspaceFileScanReceipt({
      schema_version: "workspace-file-scan-receipt@1.0.0",
      receipt_id: ids.receipt,
      scope: file.scope,
      file_ref: {
        file_id: file.file_id,
        revision: file.revision,
        revision_hash: file.revision_hash,
      },
      blob_hash: file.blob_hash,
      byte_size: file.byte_size,
      job_id: lease.job_id,
      attempt_id: lease.attempt_id,
      worker_fence: lease.worker_fence,
      scanner: {
        engine: "CLAMAV",
        engine_version: "1.4.2",
        signature_version: "20260817",
        signature_observed_at: "2026-08-17T06:59:00.000Z",
        policy_version: "workspace-file-policy@1.0.0",
      },
      verdict: "POLICY_BLOCKED",
      malware_name: null,
      credential_match_count: 0,
      content_policy_findings: ["ACTIVE_CONTENT"],
      scanned_at: "2026-08-17T07:00:01.000Z",
    });
    const { revision_hash: _revisionHash, ...fileDraft } = file;
    const rejected = await buildWorkspaceFileRevision({
      ...fileDraft,
      revision: 2,
      parent_ref: {
        file_id: file.file_id,
        revision: file.revision,
        revision_hash: file.revision_hash,
      },
      status: "REJECTED",
      scan_receipt_ref: {
        receipt_id: scanReceipt.receipt_id,
        receipt_hash: scanReceipt.receipt_hash,
        verdict: scanReceipt.verdict,
      },
      created_at: "2026-08-17T07:00:01.000Z",
    });
    const commitScan = vi.fn(async () => ({
      ok: true as const,
      value: { scan_receipt: scanReceipt, revision: rejected },
    }));
    const handler = createFileScanJobHandler({
      capability: {},
      files: {
        loadForScan: async () => ({ ok: true, value: target }),
        commitScan,
      },
      content: { get: async () => ({ ok: true, value: new Uint8Array([1]) }) },
      scanner: {
        scan: async () => ({
          verdict: "POLICY_BLOCKED",
          stable_error_code: "FILE_CONTENT_POLICY_BLOCKED",
          scanner: {
            engine_version: "1.4.2",
            signature_version: "20260817",
            signature_observed_at: "2026-08-17T06:59:00.000Z",
          },
          credential_match_count: 0,
          content_policy_findings: ["ACTIVE_CONTENT"],
          malware_name: null,
        }),
      },
      policy_version: "workspace-file-policy@1.0.0",
    });

    await expect(handler.execute(lease, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: [{ resource_kind: "WORKSPACE_FILE_SCAN_RECEIPT" }],
    });
    expect(commitScan).toHaveBeenCalledWith(
      {},
      lease,
      expect.objectContaining({
        verdict: "POLICY_BLOCKED",
        content_policy_findings: ["ACTIVE_CONTENT"],
      }),
    );
  });
});
