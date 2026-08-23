import { describe, expect, it } from "vitest";
import {
  buildStorageRetentionPolicyRevision,
  buildStorageRetentionPolicyUpdateCommand,
  buildWorkspaceContentGcEvaluationCommand,
  buildWorkspaceContentGcReceipt,
  buildWorkspaceFileDeleteCommand,
  buildWorkspaceFileDeletionReceipt,
  buildWorkspaceFileLegalHoldCommand,
  buildWorkspaceFileLegalHoldReceipt,
  buildWorkspaceFileRevision,
  buildWorkspaceFileScanReceipt,
  buildWorkspaceFileUploadCommitCommand,
  computeWorkspaceFileRevisionHash,
  verifyStorageRetentionPolicyRevision,
  verifyStorageRetentionPolicyUpdateCommand,
  verifyWorkspaceContentGcEvaluationCommand,
  verifyWorkspaceContentGcReceipt,
  verifyWorkspaceFileDeletionReceipt,
  verifyWorkspaceFileLegalHoldCommand,
  verifyWorkspaceFileLegalHoldReceipt,
  verifyWorkspaceFileRevision,
  verifyWorkspaceFileScanReceipt,
  verifyWorkspaceFileUploadCommitCommand,
  workspaceContentOrphanCheckCommandSchema,
  workspaceContentOrphanCheckResultSchema,
  workspaceFileRevisionSchema,
  workspaceFileUploadIntentSchema,
} from "../src/workspaces/files.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  workspace: "10000000-0000-4000-8000-000000000001",
  principal: "20000000-0000-4000-8000-000000000001",
  file: "30000000-0000-4000-8000-000000000001",
  session: "40000000-0000-4000-8000-000000000001",
  revisionReceipt: "50000000-0000-4000-8000-000000000001",
  scanReceipt: "60000000-0000-4000-8000-000000000001",
  deletionReceipt: "70000000-0000-4000-8000-000000000001",
  job: "80000000-0000-4000-8000-000000000001",
  attempt: "90000000-0000-4000-8000-000000000001",
  policy: "a0000000-0000-4000-8000-000000000001",
  operation: "b0000000-0000-4000-8000-000000000001",
} as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "local",
  workspace_id: ids.workspace,
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

describe("U6 workspace file contracts", () => {
  it("accepts only bounded public upload intent and never trusts MIME/hash/scope from the client", () => {
    const intent = workspaceFileUploadIntentSchema.parse({
      schema_version: "workspace-file-upload-intent@1.0.0",
      original_filename: "quarterly-report.pdf",
      visibility: "SESSION",
      session_id: ids.session,
      idempotency_key: "file-upload-0001",
    });
    expect(intent.original_filename).toBe("quarterly-report.pdf");
    expect(
      workspaceFileUploadIntentSchema.safeParse({
        ...intent,
        client_mime: "application/pdf",
        content_hash: hash("a"),
        workspace_id: ids.workspace,
      }).success,
    ).toBe(false);
    expect(
      workspaceFileUploadIntentSchema.safeParse({
        ...intent,
        original_filename: "../secret.txt",
      }).success,
    ).toBe(false);
    expect(
      workspaceFileUploadIntentSchema.safeParse({
        ...intent,
        visibility: "WORKSPACE",
      }).success,
    ).toBe(false);
  });

  it("hashes server-observed upload facts and all mutating revision commands", async () => {
    const upload = await buildWorkspaceFileUploadCommitCommand({
      schema_version: "workspace-file-upload-commit@1.0.0",
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      intent: {
        schema_version: "workspace-file-upload-intent@1.0.0",
        original_filename: "report.pdf",
        visibility: "SESSION",
        session_id: ids.session,
        idempotency_key: "file-upload-0002",
      },
      observed_content: {
        blob_hash: hash("a"),
        byte_size: 1024,
        detected_mime: "application/pdf",
        storage_key: `workspace-content/v1/${ids.app}/${ids.workspace}/local/aa/${"a".repeat(64)}`,
      },
    });
    await expect(verifyWorkspaceFileUploadCommitCommand(upload)).resolves.toEqual(upload);
    await expect(
      verifyWorkspaceFileUploadCommitCommand({
        ...upload,
        observed_content: { ...upload.observed_content, byte_size: 1025 },
      }),
    ).rejects.toThrow("WORKSPACE_FILE_UPLOAD_REQUEST_HASH_MISMATCH");

    const deletion = await buildWorkspaceFileDeleteCommand({
      schema_version: "workspace-file-delete@1.0.0",
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      file_ref: { file_id: ids.file, revision: 2, revision_hash: hash("2") },
      idempotency_key: "file-delete-0001",
    });
    expect(deletion.request_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds a canonical quarantined revision from server-observed content facts", async () => {
    const draft = {
      schema_version: "workspace-file-revision@1.0.0",
      scope,
      file_id: ids.file,
      revision: 1,
      parent_ref: null,
      owner_principal_id: ids.principal,
      visibility: "SESSION" as const,
      session_id: ids.session,
      original_filename: "quarterly-report.pdf",
      detected_mime: "application/pdf",
      byte_size: 1_024,
      blob_hash: hash("a"),
      status: "QUARANTINED" as const,
      scan_receipt_ref: null,
      deletion_receipt_ref: null,
      promoted_from_ref: null,
      retention_policy_ref: {
        policy_id: ids.policy,
        policy_revision: 1,
        policy_hash: hash("b"),
      },
      created_by_principal_id: ids.principal,
      created_at: "2026-08-17T12:00:00.000Z",
    };
    const revision = await buildWorkspaceFileRevision(draft);
    expect(revision.revision_hash).toBe(await computeWorkspaceFileRevisionHash(draft));
    await expect(verifyWorkspaceFileRevision(revision)).resolves.toEqual(revision);
    expect(Object.isFrozen(revision)).toBe(true);
    await expect(
      verifyWorkspaceFileRevision({ ...revision, byte_size: revision.byte_size + 1 }),
    ).rejects.toThrow("WORKSPACE_FILE_REVISION_HASH_MISMATCH");
  });

  it("requires exact parent lineage and promotion preserves blob identity", async () => {
    const parent = await buildWorkspaceFileRevision({
      schema_version: "workspace-file-revision@1.0.0",
      scope,
      file_id: ids.file,
      revision: 1,
      parent_ref: null,
      owner_principal_id: ids.principal,
      visibility: "SESSION",
      session_id: ids.session,
      original_filename: "notes.md",
      detected_mime: "text/markdown",
      byte_size: 100,
      blob_hash: hash("c"),
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
      created_at: "2026-08-17T12:00:00.000Z",
    });
    const parentRef = {
      file_id: parent.file_id,
      revision: parent.revision,
      revision_hash: parent.revision_hash,
    };
    const { revision_hash: _revisionHash, ...parentDraft } = parent;
    const promoted = await buildWorkspaceFileRevision({
      ...parentDraft,
      revision: 2,
      parent_ref: parentRef,
      visibility: "WORKSPACE",
      session_id: null,
      promoted_from_ref: { ...parentRef, blob_hash: parent.blob_hash },
      created_at: "2026-08-17T12:01:00.000Z",
    });
    expect(promoted.blob_hash).toBe(parent.blob_hash);
    expect(promoted.promoted_from_ref).toEqual({ ...parentRef, blob_hash: parent.blob_hash });
    expect(
      workspaceFileRevisionSchema.safeParse({ ...promoted, blob_hash: hash("d") }).success,
    ).toBe(false);
  });

  it("only a clean exact scan receipt can authorize READY", async () => {
    const fileRef = { file_id: ids.file, revision: 1, revision_hash: hash("1") };
    const clean = await buildWorkspaceFileScanReceipt({
      schema_version: "workspace-file-scan-receipt@1.0.0",
      receipt_id: ids.scanReceipt,
      scope,
      file_ref: fileRef,
      blob_hash: hash("a"),
      byte_size: 1_024,
      job_id: ids.job,
      attempt_id: ids.attempt,
      worker_fence: 3,
      scanner: {
        engine: "CLAMAV",
        engine_version: "1.4.2",
        signature_version: "20260817",
        signature_observed_at: "2026-08-17T11:59:00.000Z",
        policy_version: "workspace-file-policy@1.0.0",
      },
      verdict: "CLEAN",
      malware_name: null,
      credential_match_count: 0,
      content_policy_findings: [],
      scanned_at: "2026-08-17T12:02:00.000Z",
    });
    await expect(verifyWorkspaceFileScanReceipt(clean)).resolves.toEqual(clean);
    await expect(
      buildWorkspaceFileScanReceipt({
        ...clean,
        verdict: "CLEAN",
        credential_match_count: 1,
        receipt_hash: undefined,
      }),
    ).rejects.toThrow();
    await expect(verifyWorkspaceFileScanReceipt({ ...clean, worker_fence: 4 })).rejects.toThrow(
      "WORKSPACE_FILE_SCAN_RECEIPT_HASH_MISMATCH",
    );
  });

  it("closes retention truth and deletion revokes bytes without claiming physical GC", async () => {
    const policy = await buildStorageRetentionPolicyRevision({
      schema_version: "storage-retention-policy-revision@1.0.0",
      scope,
      policy_id: ids.policy,
      revision: 1,
      parent_ref: null,
      quarantine_ttl_seconds: 86_400,
      deleted_reference_ttl_seconds: 0,
      orphan_blob_ttl_seconds: 86_400,
      backup_expiry_seconds: 2_592_000,
      legal_hold_enabled: true,
      created_by_principal_id: ids.principal,
      created_at: "2026-08-17T12:00:00.000Z",
    });
    await expect(verifyStorageRetentionPolicyRevision(policy)).resolves.toEqual(policy);

    const receipt = await buildWorkspaceFileDeletionReceipt({
      schema_version: "workspace-file-deletion-receipt@1.0.0",
      receipt_id: ids.deletionReceipt,
      operation_id: ids.operation,
      scope,
      file_ref: { file_id: ids.file, revision: 2, revision_hash: hash("2") },
      blob_hash: hash("a"),
      deleted_by_principal_id: ids.principal,
      access_revoked_at: "2026-08-17T12:03:00.000Z",
      legal_hold_active: false,
      remaining_active_references: 1,
      blob_deletion_status: "RETAINED_BY_REFERENCE",
      backup_expires_at: "2026-09-16T12:03:00.000Z",
    });
    await expect(verifyWorkspaceFileDeletionReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      buildWorkspaceFileDeletionReceipt({
        ...receipt,
        remaining_active_references: 0,
        blob_deletion_status: "RETAINED_BY_REFERENCE",
        receipt_hash: undefined,
      }),
    ).rejects.toThrow();
  });

  it("hashes legal hold and GC authority without restoring deleted byte access", async () => {
    const holdCommand = await buildWorkspaceFileLegalHoldCommand({
      schema_version: "workspace-file-legal-hold@1.0.0",
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      file_id: ids.file,
      active: true,
      reason_code: "LEGAL_REQUEST",
      idempotency_key: "file-hold-0001",
    });
    await expect(verifyWorkspaceFileLegalHoldCommand(holdCommand)).resolves.toEqual(holdCommand);
    const hold = await buildWorkspaceFileLegalHoldReceipt({
      schema_version: "workspace-file-legal-hold-receipt@1.0.0",
      scope,
      file_id: ids.file,
      hold_revision: 1,
      active: true,
      operation_id: ids.operation,
      principal_id: ids.principal,
      reason_code: "LEGAL_REQUEST",
      created_at: "2026-08-17T12:04:00.000Z",
    });
    await expect(verifyWorkspaceFileLegalHoldReceipt(hold)).resolves.toEqual(hold);
    await expect(
      buildWorkspaceFileLegalHoldCommand({
        ...holdCommand,
        active: false,
        reason_code: "LEGAL_REQUEST",
        request_hash: undefined,
      }),
    ).rejects.toThrow();

    const evaluate = await buildWorkspaceContentGcEvaluationCommand({
      schema_version: "workspace-content-gc-evaluate@1.0.0",
      operation_id: "c0000000-0000-4000-8000-000000000001",
      workspace_id: ids.workspace,
      blob_hash: hash("a"),
      idempotency_key: "blob-gc-0001",
    });
    await expect(verifyWorkspaceContentGcEvaluationCommand(evaluate)).resolves.toEqual(evaluate);
    const eligible = await buildWorkspaceContentGcReceipt({
      schema_version: "workspace-content-gc-receipt@1.0.0",
      receipt_id: "d0000000-0000-4000-8000-000000000001",
      operation_id: evaluate.operation_id,
      scope,
      blob_hash: evaluate.blob_hash,
      status: "ELIGIBLE",
      parent_receipt_ref: null,
      active_reference_count: 0,
      legal_hold_active: false,
      retention_expires_at: "2026-08-17T12:03:00.000Z",
      backup_expires_at: "2026-08-17T12:03:00.000Z",
      evaluated_at: "2026-08-17T12:04:00.000Z",
    });
    await expect(verifyWorkspaceContentGcReceipt(eligible)).resolves.toEqual(eligible);
    await expect(
      buildWorkspaceContentGcReceipt({
        ...eligible,
        active_reference_count: 1,
        receipt_hash: undefined,
      }),
    ).rejects.toThrow();
  });

  it("hashes retention policy CAS updates and rejects stale hash tampering", async () => {
    const command = await buildStorageRetentionPolicyUpdateCommand({
      schema_version: "storage-retention-policy-update@1.0.0",
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      expected_policy_ref: {
        policy_id: "00000000-0000-4000-8000-00000000f601",
        policy_revision: 1,
        policy_hash: hash("f"),
      },
      quarantine_ttl_seconds: 3_600,
      deleted_reference_ttl_seconds: 60,
      orphan_blob_ttl_seconds: 7_200,
      backup_expiry_seconds: 86_400,
      legal_hold_enabled: true,
      idempotency_key: "retention-policy-0001",
    });
    await expect(verifyStorageRetentionPolicyUpdateCommand(command)).resolves.toEqual(command);
    await expect(
      verifyStorageRetentionPolicyUpdateCommand({ ...command, orphan_blob_ttl_seconds: 1 }),
    ).rejects.toThrow("STORAGE_RETENTION_POLICY_UPDATE_HASH_MISMATCH");
  });

  it("closes bounded orphan checks to an exact storage key and observation time", () => {
    const storageKey = `workspace-content/v1/${ids.app}/${ids.workspace}/local/aa/${"a".repeat(64)}`;
    const command = workspaceContentOrphanCheckCommandSchema.parse({
      schema_version: "workspace-content-orphan-check@1.0.0",
      workspace_id: ids.workspace,
      storage_key: storageKey,
      blob_hash: hash("a"),
      observed_at: "2026-08-17T12:00:00.000Z",
    });
    expect(
      workspaceContentOrphanCheckResultSchema.parse({
        schema_version: "workspace-content-orphan-check-result@1.0.0",
        storage_key: command.storage_key,
        blob_hash: command.blob_hash,
        authorized: false,
        orphan_ttl_seconds: 86_400,
        observed_at: command.observed_at,
        checked_at: "2026-08-18T12:00:00.000Z",
      }).authorized,
    ).toBe(false);
    expect(
      workspaceContentOrphanCheckResultSchema.safeParse({
        schema_version: "workspace-content-orphan-check-result@1.0.0",
        storage_key: command.storage_key,
        blob_hash: command.blob_hash,
        authorized: false,
        orphan_ttl_seconds: 86_400,
        observed_at: command.observed_at,
        checked_at: "2026-08-16T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
