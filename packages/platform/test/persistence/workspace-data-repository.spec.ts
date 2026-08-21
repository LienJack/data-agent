import { buildWorkspaceConversationDirectoryCommand } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresWorkspaceDataRepository } from "../../src/persistence/workspace-data-repository.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-00000000aa11",
  otherTenant: "00000000-0000-4000-8000-00000000aa22",
  principal: "00000000-0000-4000-8000-000000001001",
  deployment: "00000000-0000-4000-8000-00000000de01",
  datasource: "00000000-0000-4000-8000-00000000d211",
  conversation: "00000000-0000-4000-8000-00000000c211",
  run: "00000000-0000-4000-8000-00000000f211",
  model: "30000000-0000-4000-8000-000000000003",
  folder: "00000000-0000-4000-8000-00000000c212",
  operation: "00000000-0000-4000-8000-00000000c213",
} as const;

function authority(role: "OWNER" | "ANALYST" | "VIEWER" = "OWNER") {
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
  if (!resolved.ok) throw new Error(resolved.error.code);
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function scriptedPool(
  handle: (
    text: string,
    values: readonly unknown[],
  ) => SqlQueryResult | undefined | Promise<SqlQueryResult | undefined>,
) {
  const calls: QueryCall[] = [];
  let connections = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const result = await handle(text, values);
      if (result) return result as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlPool = {
    async connect() {
      connections += 1;
      return client;
    },
  };
  return { calls, connections: () => connections, pool };
}

const datasourceRow = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
  datasource_id: ids.datasource,
  resource_version: "7",
  name: "workspace sqlite",
  datasource_type: "sqlite",
  host: null,
  port: null,
  database_name: null,
  username: null,
  credential_ref_id: null,
  secret_ref_id: null,
  secret_version: null,
  rotation_state: null,
  ssl_mode: "disable",
  file_path: "/tmp/workspace.db",
  catalog_name: null,
  schema_name: null,
  status: "ACTIVE",
  last_tested_at: null,
  created_by_principal_id: ids.principal,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
} as const;

const createDatasource = {
  schema_version: "workspace-datasource-create@1.0.0",
  datasource_id: ids.datasource,
  name: "workspace sqlite",
  type: "sqlite",
  host: null,
  port: null,
  database: null,
  username: null,
  credential_ref: null,
  ssl: "disable",
  path: "/tmp/workspace.db",
  catalog: null,
  schema: null,
} as const;

describe("PostgreSQL workspace data repository", () => {
  it("creates a datasource with server-derived scope and principal", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("insert into datasource_connections")
        ? { rows: [datasourceRow], rowCount: 1 }
        : undefined,
    );
    const issued = authority();
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    const result = await repository.createDatasource(issued.capability, createDatasource);

    expect(result).toMatchObject({
      ok: true,
      value: {
        workspace_id: ids.tenant,
        datasource_id: ids.datasource,
        resource_version: 7,
        created_by_principal_id: ids.principal,
      },
    });
    const insert = fixture.calls.find(({ text }) =>
      text.includes("insert into datasource_connections"),
    );
    expect(insert?.values.slice(0, 4)).toEqual([ids.app, ids.tenant, "test", ids.datasource]);
    expect(insert?.values.at(-1)).toBe(ids.principal);
    expect(insert?.text).toContain("resource_version");
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("denies datasource mutation to ANALYST before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    expect(await repository.createDatasource(issued.capability, createDatasource)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_WRITE_DENIED", retryable: false },
    });
    expect(fixture.connections()).toBe(0);
  });

  it("rejects cross-workspace SecretRef metadata in the transaction", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority();
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);
    const result = await repository.createDatasource(issued.capability, {
      ...createDatasource,
      type: "postgresql",
      host: "db.internal",
      database: "analytics",
      username: "reader",
      path: null,
      credential_ref: {
        schema_version: "datasource-credential-ref@1.0.0",
        app_id: ids.app,
        tenant_id: ids.otherTenant,
        environment: "test",
        credential_ref_id: "00000000-0000-4000-8000-00000000ec01",
        secret_ref_id: "00000000-0000-4000-8000-00000000ec02",
        secret_version: 1,
        rotation_state: "ACTIVE",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_CREDENTIAL_SCOPE_INVALID", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("keeps repository instances stateless and reads the same PostgreSQL row", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("from datasource_connections")
        ? { rows: [datasourceRow], rowCount: 1 }
        : undefined,
    );
    const issued = authority();
    const first = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);
    const second = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(first.listDatasources(issued.capability)).resolves.toMatchObject({
      ok: true,
      value: [{ datasource_id: ids.datasource, resource_version: 7 }],
    });
    await expect(second.listDatasources(issued.capability)).resolves.toMatchObject({
      ok: true,
      value: [{ datasource_id: ids.datasource, resource_version: 7 }],
    });
    const select = fixture.calls.find(({ text }) => text.includes("from datasource_connections"));
    expect(select?.text).toContain("resource_version");
    expect(fixture.connections()).toBe(2);
  });

  it("rejects plaintext secrets in messages before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    expect(
      await repository.appendMessage(issued.capability, ids.conversation, {
        schema_version: "workspace-conversation-message-append@1.0.0",
        role: "user",
        content: "connect with password=hunter2",
        type: "text",
        run_id: null,
        metadata: {},
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONVERSATION_INPUT_INVALID", retryable: false },
    });
    expect(fixture.connections()).toBe(0);
  });

  it("denies message reads and writes after a conversation enters trash", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("select 1 from qa_conversations") ? { rows: [], rowCount: 0 } : undefined,
    );
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.listMessages(issued.capability, ids.conversation),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CONVERSATION_NOT_FOUND_OR_DENIED" },
    });
    await expect(
      repository.appendMessage(issued.capability, ids.conversation, {
        schema_version: "workspace-conversation-message-append@1.0.0",
        role: "user",
        content: "should not append",
        type: "text",
        run_id: null,
        metadata: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CONVERSATION_NOT_FOUND_OR_DENIED" },
    });
    expect(fixture.calls.some(({ text }) => text.includes("insert into qa_messages"))).toBe(false);
  });

  it("lets a Workspace READ member list only the current conversation Run bindings", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("select 1 from qa_conversations")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (text.includes("from workspace_run_bindings") && text.includes("conversation_id")) {
        return {
          rows: [
            {
              app_id: ids.app,
              tenant_id: ids.tenant,
              environment: "test",
              run_id: ids.run,
              datasource_id: ids.datasource,
              conversation_id: ids.conversation,
              principal_id: ids.principal,
              created_at: "2026-08-14T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const issued = authority("VIEWER");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.listRunBindingsForConversation(issued.capability, ids.conversation),
    ).resolves.toMatchObject({
      ok: true,
      value: [{ run_id: ids.run, conversation_id: ids.conversation }],
    });
    const list = fixture.calls.find(({ text }) => text.includes("from workspace_run_bindings"));
    expect(list?.values).toEqual([ids.conversation]);
  });

  it("hides direct Run bindings after their conversation enters trash", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("from workspace_run_bindings as binding")) {
        return { rows: [], rowCount: 0 };
      }
      return undefined;
    });
    const issued = authority("VIEWER");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(repository.getRunBinding(issued.capability, ids.run)).resolves.toEqual({
      ok: true,
      value: null,
    });
    const lookup = fixture.calls.find(({ text }) =>
      text.includes("from workspace_run_bindings as binding"),
    );
    expect(lookup?.text).toContain("conversation.deleted_at is null");
  });

  it("maps datasource-freeze markers to the stable public reason code", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("select 1 from datasource_connections")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (text.includes("update qa_conversations")) {
        throw Object.assign(new Error("CONVERSATION_DATASOURCE_FROZEN"), { code: "23514" });
      }
      return undefined;
    });
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    expect(
      await repository.bindConversationDatasource(issued.capability, ids.conversation, {
        schema_version: "workspace-conversation-bind-datasource@1.0.0",
        datasource_id: ids.datasource,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONVERSATION_DATASOURCE_FROZEN", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("switches frozen resources through one PostgreSQL authority operation", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("switch_qa_conversation_resources")) {
        return {
          rows: [
            {
              result: {
                kind: "UPDATED_CURRENT",
                conversation: {
                  schema_version: "workspace-conversation@1.0.0",
                  workspace_id: ids.tenant,
                  conversation_id: ids.conversation,
                  owner_principal_id: ids.principal,
                  title: "Revenue analysis",
                  datasource_id: ids.datasource,
                  model_id: ids.model,
                  model_profile_id: ids.model,
                  resource_version: 2,
                  message_count: 0,
                  created_at: "2026-08-16T00:00:00.000Z",
                  updated_at: "2026-08-16T00:00:00.000Z",
                },
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.switchConversationResources(issued.capability, ids.conversation, {
        schema_version: "qa-conversation-resource-switch@1.0.0",
        datasource_id: ids.datasource,
        model_profile_id: ids.model,
        expected_resource_version: 1,
        idempotency_key: "switch-resource-001",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "UPDATED_CURRENT", conversation: { resource_version: 2 } },
    });
    const switchCall = fixture.calls.find(({ text }) =>
      text.includes("switch_qa_conversation_resources"),
    );
    expect(switchCall?.values[0]).toMatchObject({
      conversation_id: ids.conversation,
      datasource_id: ids.datasource,
      model_profile_id: ids.model,
    });
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("lists only the strict private conversation directory projection", async () => {
    const result = {
      schema_version: "workspace-conversation-directory-page@1.0.0",
      workspace_id: ids.tenant,
      view: "active",
      folders: [
        {
          schema_version: "workspace-conversation-folder@1.0.0",
          workspace_id: ids.tenant,
          folder_id: ids.folder,
          owner_principal_id: ids.principal,
          name: "Research",
          sort_order: 0,
          resource_version: 1,
          archived_at: null,
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      conversations: [],
      next_cursor: null,
    };
    const fixture = scriptedPool((text) =>
      text.includes("list_qa_conversation_directory")
        ? { rows: [{ result }], rowCount: 1 }
        : undefined,
    );
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.listConversationDirectory(issued.capability, {
        schema_version: "workspace-conversation-directory-query@1.0.0",
        view: "active",
        folder_id: null,
        query: "orders",
        cursor: null,
        limit: 20,
      }),
    ).resolves.toEqual({ ok: true, value: result });
    expect(
      fixture.calls.find(({ text }) => text.includes("list_qa_conversation_directory"))?.values,
    ).toEqual([expect.objectContaining({ view: "active", query: "orders", limit: 20 })]);
  });

  it("verifies a hashed directory command before the PostgreSQL authority call", async () => {
    const command = await buildWorkspaceConversationDirectoryCommand({
      schema_version: "workspace-conversation-directory-command@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "directory-folder-create-1",
      action: "FOLDER_CREATE",
      folder_id: ids.folder,
      name: "Research",
      sort_order: 0,
    });
    const result = {
      schema_version: "workspace-conversation-directory-command-result@1.0.0",
      operation_id: ids.operation,
      action: "FOLDER_CREATE",
      command_hash: command.command_hash,
      replayed: false,
      folder: {
        schema_version: "workspace-conversation-folder@1.0.0",
        workspace_id: ids.tenant,
        folder_id: ids.folder,
        owner_principal_id: ids.principal,
        name: "Research",
        sort_order: 0,
        resource_version: 1,
        archived_at: null,
        created_at: "2026-08-22T00:00:00.000Z",
        updated_at: "2026-08-22T00:00:00.000Z",
      },
      conversation: null,
      affected_conversation_ids: [],
      committed_at: "2026-08-22T00:00:00.000Z",
    };
    const fixture = scriptedPool((text) =>
      text.includes("apply_qa_directory_command") ? { rows: [{ result }], rowCount: 1 } : undefined,
    );
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.applyConversationDirectoryCommand(issued.capability, command),
    ).resolves.toEqual({ ok: true, value: result });
    await expect(
      repository.applyConversationDirectoryCommand(issued.capability, {
        ...command,
        name: "Forged",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "QA_DIRECTORY_COMMAND_INVALID" },
    });
    expect(
      fixture.calls.filter(({ text }) => text.includes("apply_qa_directory_command")),
    ).toHaveLength(1);
  });

  it("uses lease/fence retention RPCs without client-side time decisions", async () => {
    const claimId = "00000000-0000-4000-8000-00000000c214";
    const receiptId = "00000000-0000-4000-8000-00000000c215";
    const claim = {
      schema_version: "conversation-trash-retention-claim@1.0.0",
      claim_id: claimId,
      workspace_id: ids.tenant,
      owner_principal_id: ids.principal,
      conversation_id: ids.conversation,
      deleted_at: "2026-07-01T00:00:00.000Z",
      purge_after: "2026-07-31T00:00:00.000Z",
      fence: 3,
      lease_expires_at: "2026-08-22T00:01:00.000Z",
    };
    const fixture = scriptedPool((text) => {
      if (text.includes("claim_qa_conversation_retention")) {
        return { rows: [{ result: [claim] }], rowCount: 1 };
      }
      if (text.includes("complete_qa_conversation_retention")) {
        return {
          rows: [
            {
              result: {
                schema_version: "conversation-trash-retention-receipt@1.0.0",
                receipt_id: receiptId,
                claim_id: claimId,
                conversation_id: ids.conversation,
                fence: 3,
                outcome: "HELD",
                reason_code: "CONVERSATION_RETENTION_REFERENCES_HELD",
                committed_at: "2026-08-22T00:00:10.000Z",
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const issued = authority("ANALYST");
    const repository = createPostgresWorkspaceDataRepository(fixture.pool, issued.authorizer);

    await expect(
      repository.claimConversationRetention(issued.capability, {
        limit: 25,
        lease_duration_ms: 60_000,
      }),
    ).resolves.toMatchObject({ ok: true, value: [{ claim_id: claimId, fence: 3 }] });
    await expect(
      repository.completeConversationRetention(issued.capability, {
        schema_version: "conversation-trash-retention-complete@1.0.0",
        claim_id: claimId,
        fence: 3,
        outcome: "PURGED",
        reason_code: "CONVERSATION_RETENTION_DUE",
      }),
    ).resolves.toMatchObject({ ok: true, value: { outcome: "HELD" } });
    expect(
      fixture.calls.find(({ text }) => text.includes("claim_qa_conversation_retention"))?.values,
    ).toEqual([25, 60_000]);
  });
});
