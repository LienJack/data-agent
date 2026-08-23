import { buildArtifactWorkspaceDocument } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { createPostgresQaAdminAuditRepository } from "../../src/tenancy/postgres-qa-admin-audit.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  workspace: "00000000-0000-4000-8000-00000000aa11",
  otherWorkspace: "00000000-0000-4000-8000-00000000aa22",
  deployment: "00000000-0000-4000-8000-00000000de01",
  admin: "00000000-0000-4000-8000-000000003001",
  owner: "00000000-0000-4000-8000-000000003002",
  conversation: "00000000-0000-4000-8000-000000003006",
  run: "00000000-0000-4000-8000-000000003010",
  event: "00000000-0000-4000-8000-000000003011",
  receipt: "00000000-0000-4000-8000-000000003020",
  artifact: "00000000-0000-4000-8000-000000003021",
} as const;

function authority(role: "OWNER" | "ANALYST" = "OWNER") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [{ subject: ids.admin, deployment_id: ids.deployment, tenant_id: ids.workspace, role }],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.admin });
  if (!resolved.ok) throw new Error(resolved.error.code);
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handler: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  let connections = 0;
  const pool: SqlPool = {
    async connect() {
      connections += 1;
      return {
        async query<Row extends object>(text: string, values: readonly unknown[] = []) {
          calls.push({ text, values });
          const result = handler(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      } satisfies SqlClient;
    },
  };
  return { pool, calls, connections: () => connections };
}

const receipt = {
  schema_version: "qa-admin-audit-receipt-ref@1.0.0",
  receipt_id: ids.receipt,
  operation: "DIRECTORY_READ",
  reason_code: "QA_ADMIN_DIRECTORY_REVIEW",
  request_digest: `sha256:${"a".repeat(64)}`,
  occurred_at: "2026-08-22T00:00:00.000Z",
} as const;

const directoryQuery = {
  schema_version: "qa-admin-directory-query@1.0.0",
  workspace_id: ids.workspace,
  owner_principal_id: null,
  folder_id: null,
  lifecycle: null,
  live_state: null,
  query: null,
  cursor: null,
  limit: 25,
} as const;

describe("PostgreSQL Q&A admin audit repository", () => {
  it("uses only the audited directory RPC and parses its receipt", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("read_qa_admin_directory")
        ? {
            rows: [
              {
                result: {
                  schema_version: "qa-admin-directory-page@1.0.0",
                  workspace_id: ids.workspace,
                  read_only: true,
                  folders: [],
                  conversations: [],
                  next_cursor: null,
                  receipt,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.readDirectory(issued.capability, directoryQuery),
    ).resolves.toMatchObject({
      ok: true,
      value: { read_only: true, receipt: { operation: "DIRECTORY_READ" } },
    });
    expect(fixture.calls.some(({ text }) => text.includes("read_qa_admin_directory"))).toBe(true);
    expect(fixture.calls.every(({ text }) => !text.includes("from qa_conversations"))).toBe(true);
  });

  it("projects authoritative runtime events to public events", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("read_qa_admin_run_events")
        ? {
            rows: [
              {
                result: {
                  schema_version: "qa-admin-run-events-raw-page@1.0.0",
                  workspace_id: ids.workspace,
                  owner_principal_id: ids.owner,
                  conversation_id: ids.conversation,
                  run_id: ids.run,
                  read_only: true,
                  event_documents: [
                    {
                      schema_version: "run-runtime-event@2.0.0",
                      event_id: ids.event,
                      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
                      run_id: ids.run,
                      sequence: 1,
                      worker_fence: 1,
                      idempotency_key: "admin:test:event",
                      occurred_at: "2026-08-22T00:00:00.000Z",
                      event_type: "run.agent_status",
                      payload: {
                        profile_id: "report-writing-agent",
                        task_id: "00000000-0000-4000-8000-000000003012",
                        status: "RUNNING",
                        phase: "draft.report",
                        title: "Report",
                        summary: "drafting",
                        duration_ms: null,
                        error_code: null,
                      },
                    },
                  ],
                  next_sequence: null,
                  receipt: {
                    ...receipt,
                    operation: "RUN_REPLAY",
                    reason_code: "QA_ADMIN_RUN_REPLAY",
                  },
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    const result = await repository.readRunEvents(issued.capability, {
      schema_version: "qa-admin-run-events-query@1.0.0",
      operation: "RUN_REPLAY",
      workspace_id: ids.workspace,
      owner_principal_id: ids.owner,
      conversation_id: ids.conversation,
      run_id: ids.run,
      profile_id: null,
      task_id: null,
      after_sequence: 0,
      limit: 100,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { events: [{ schema_version: "public-run-event@2.0.0", type: "agent" }] },
    });
  });

  it("rejects non-owner capabilities before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority("ANALYST");
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    await expect(
      repository.readDirectory(issued.capability, directoryQuery),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_WRITE_DENIED" },
    });
    expect(fixture.connections()).toBe(0);
  });

  it("fails closed before RPC execution on a cross-workspace query", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    await expect(
      repository.readDirectory(issued.capability, {
        ...directoryQuery,
        workspace_id: ids.otherWorkspace,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED" },
    });
    expect(fixture.calls.some(({ text }) => text.includes("read_qa_admin_directory"))).toBe(false);
  });

  it("maps an atomic receipt failure to a retryable empty response", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("read_qa_admin_directory")) {
        throw Object.assign(new Error("QA_ADMIN_AUDIT_UNAVAILABLE"), { code: "P0001" });
      }
      return undefined;
    });
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    await expect(
      repository.readDirectory(issued.capability, directoryQuery),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "QA_ADMIN_AUDIT_UNAVAILABLE", retryable: true },
    });
  });

  it("rejects unknown query fields before opening a database connection", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    await expect(
      repository.readDirectory(issued.capability, { ...directoryQuery, actor_role: "SUPER_ADMIN" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "QA_ADMIN_QUERY_INVALID" } });
    expect(fixture.connections()).toBe(0);
  });

  it("projects an audited artifact document instead of exposing raw JSON", async () => {
    const document = await buildArtifactWorkspaceDocument({
      schema_version: "artifact-workspace-document@1.0.0",
      document_ref: {
        artifact_id: ids.artifact,
        artifact_type: "ArtifactWorkspaceDocument",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      projection: {
        kind: "TABLE",
        columns: [{ key: "value", label: "Value", data_type: "NUMBER" }],
        rows: [{ value: 42 }],
        total_rows: 1,
      },
    });
    const fixture = scriptedPool((text) =>
      text.includes("authorize_qa_admin_artifact_access")
        ? {
            rows: [
              {
                result: {
                  schema_version: "qa-admin-artifact-access-result@1.0.0",
                  workspace_id: ids.workspace,
                  owner_principal_id: ids.owner,
                  conversation_id: ids.conversation,
                  run_id: ids.run,
                  read_only: true,
                  reference: document.document_ref,
                  artifact_document: document,
                  receipt: {
                    ...receipt,
                    operation: "ARTIFACT_PREVIEW",
                    reason_code: "QA_ADMIN_ARTIFACT_PREVIEW",
                  },
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const issued = authority();
    const repository = createPostgresQaAdminAuditRepository(fixture.pool, issued.authorizer);
    const result = await repository.authorizeArtifactAccess(issued.capability, {
      schema_version: "qa-admin-artifact-access-query@1.0.0",
      operation: "ARTIFACT_PREVIEW",
      workspace_id: ids.workspace,
      owner_principal_id: ids.owner,
      conversation_id: ids.conversation,
      run_id: ids.run,
      reference: document.document_ref,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { preview: { projection: { kind: "TABLE", rows: [{ value: 42 }] } } },
    });
    if (result.ok) expect(result.value).not.toHaveProperty("artifact_document");
  });
});
