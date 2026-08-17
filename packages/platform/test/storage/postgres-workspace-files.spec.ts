import {
  buildStorageRetentionPolicyRevision,
  buildStorageRetentionPolicyUpdateCommand,
  buildWorkspaceFileRevision,
  buildWorkspaceFileUploadCommitCommand,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresWorkspaceFiles } from "../../src/storage/postgres-workspace-files.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "10000000-0000-4000-8000-000000000001",
  deployment: "20000000-0000-4000-8000-000000000001",
  principal: "30000000-0000-4000-8000-000000000001",
  operation: "40000000-0000-4000-8000-000000000001",
  session: "50000000-0000-4000-8000-000000000001",
  policy: "60000000-0000-4000-8000-000000000001",
} as const;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

function authority(role: "OWNER" | "ANALYST" = "ANALYST") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role,
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("authority fixture missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(value: unknown) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          if (
            /app_data_agent\.(?:commit_workspace_file_upload|update_storage_retention_policy|classify_workspace_content_orphan)/u.test(
              text,
            )
          ) {
            return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

async function fixtures() {
  const command = await buildWorkspaceFileUploadCommitCommand({
    schema_version: "workspace-file-upload-commit@1.0.0",
    operation_id: ids.operation,
    workspace_id: ids.tenant,
    intent: {
      schema_version: "workspace-file-upload-intent@1.0.0",
      original_filename: "report.pdf",
      visibility: "SESSION",
      session_id: ids.session,
      idempotency_key: "file-upload-0001",
    },
    observed_content: {
      blob_hash: hash("a"),
      byte_size: 100,
      detected_mime: "application/pdf",
      storage_key: `workspace-content/v1/${ids.app}/${ids.tenant}/test/aa/${"a".repeat(64)}`,
    },
  });
  const revision = await buildWorkspaceFileRevision({
    schema_version: "workspace-file-revision@1.0.0",
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      workspace_id: ids.tenant,
    },
    file_id: ids.operation,
    revision: 1,
    parent_ref: null,
    owner_principal_id: ids.principal,
    visibility: "SESSION",
    session_id: ids.session,
    original_filename: "report.pdf",
    detected_mime: "application/pdf",
    byte_size: 100,
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
  return { command, revision };
}

describe("PostgresWorkspaceFiles", () => {
  it("commits through the narrow RPC and verifies exact observed content", async () => {
    const auth = authority();
    const { command, revision } = await fixtures();
    const scripted = scriptedPool(revision);
    const store = createPostgresWorkspaceFiles({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(store.commitUpload(auth.capability, command)).resolves.toEqual({
      ok: true,
      value: revision,
    });
    expect(scripted.calls.some((call) => call.text.includes("commit_workspace_file_upload"))).toBe(
      true,
    );
  });

  it("rejects a self-consistent DB revision that substitutes the observed blob", async () => {
    const auth = authority();
    const { command, revision } = await fixtures();
    const { revision_hash: _revisionHash, ...revisionDraft } = revision;
    const substituted = await buildWorkspaceFileRevision({
      ...revisionDraft,
      blob_hash: hash("c"),
    });
    const scripted = scriptedPool(substituted);
    const store = createPostgresWorkspaceFiles({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(store.commitUpload(auth.capability, command)).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("verifies retention CAS output and exact orphan classification identity", async () => {
    const auth = authority("OWNER");
    const policy1 = await buildStorageRetentionPolicyRevision({
      schema_version: "storage-retention-policy-revision@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.tenant,
        environment: "test",
        workspace_id: ids.tenant,
      },
      policy_id: ids.policy,
      revision: 1,
      parent_ref: null,
      quarantine_ttl_seconds: 86_400,
      deleted_reference_ttl_seconds: 0,
      orphan_blob_ttl_seconds: 86_400,
      backup_expiry_seconds: 2_592_000,
      legal_hold_enabled: true,
      created_by_principal_id: ids.principal,
      created_at: "2026-08-17T07:00:00.000Z",
    });
    const command = await buildStorageRetentionPolicyUpdateCommand({
      schema_version: "storage-retention-policy-update@1.0.0",
      operation_id: ids.operation,
      workspace_id: ids.tenant,
      expected_policy_ref: {
        policy_id: policy1.policy_id,
        policy_revision: policy1.revision,
        policy_hash: policy1.policy_hash,
      },
      quarantine_ttl_seconds: 3_600,
      deleted_reference_ttl_seconds: 60,
      orphan_blob_ttl_seconds: 7_200,
      backup_expiry_seconds: 86_400,
      legal_hold_enabled: true,
      idempotency_key: "retention-policy-0001",
    });
    const policy2 = await buildStorageRetentionPolicyRevision({
      schema_version: "storage-retention-policy-revision@1.0.0",
      scope: policy1.scope,
      policy_id: policy1.policy_id,
      revision: 2,
      parent_ref: {
        policy_id: policy1.policy_id,
        policy_revision: 1,
        policy_hash: policy1.policy_hash,
      },
      quarantine_ttl_seconds: 3_600,
      deleted_reference_ttl_seconds: 60,
      orphan_blob_ttl_seconds: 7_200,
      backup_expiry_seconds: 86_400,
      legal_hold_enabled: true,
      created_by_principal_id: ids.principal,
      created_at: "2026-08-17T08:00:00.000Z",
    });
    const policyStore = createPostgresWorkspaceFiles({
      pool: scriptedPool(policy2).pool,
      authorizer: auth.authorizer,
    });
    await expect(policyStore.updateRetentionPolicy(auth.capability, command)).resolves.toEqual({
      ok: true,
      value: policy2,
    });

    const storageKey = `workspace-content/v1/${ids.app}/${ids.tenant}/test/aa/${"a".repeat(64)}`;
    const orphan = {
      schema_version: "workspace-content-orphan-check-result@1.0.0",
      storage_key: storageKey,
      blob_hash: hash("a"),
      authorized: false,
      orphan_ttl_seconds: 7_200,
      observed_at: "2026-08-16T08:00:00.000Z",
      checked_at: "2026-08-17T08:00:00.000Z",
    } as const;
    const orphanStore = createPostgresWorkspaceFiles({
      pool: scriptedPool(orphan).pool,
      authorizer: auth.authorizer,
    });
    await expect(
      orphanStore.classifyOrphan(auth.capability, {
        schema_version: "workspace-content-orphan-check@1.0.0",
        workspace_id: ids.tenant,
        storage_key: storageKey,
        blob_hash: hash("a"),
        observed_at: orphan.observed_at,
      }),
    ).resolves.toEqual({ ok: true, value: orphan });
  });
});
