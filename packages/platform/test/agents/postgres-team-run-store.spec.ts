import { describe, expect, it } from "vitest";
import {
  buildAgentTeamStoreCommand,
  createPostgresTeamRunStore,
} from "../../src/agents/postgres-team-run-store.js";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  task: "00000000-0000-4000-8000-000000000006",
  command: "00000000-0000-4000-8000-000000000007",
} as const;

const lease = {
  scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
  principal_id: ids.principal,
  outbox_id: "00000000-0000-4000-8000-000000000008",
  run_id: ids.run,
  command_id: "00000000-0000-4000-8000-000000000009",
  command_kind: "START_L2_RESEARCH",
  attempt_id: "00000000-0000-4000-8000-000000000010",
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 30_000,
  worker_id: "u19-worker",
  lease_token: 1,
  worker_fence: 7,
  expires_at: "2026-08-17T00:05:00.000Z",
  payload: {
    kind: "START_L2_RESEARCH",
    effective_config_ref: {
      config_id: "00000000-0000-4000-8000-000000000011",
      config_revision: 1,
      config_hash: `sha256:${"1".repeat(64)}`,
    },
  },
} as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("missing authority fixture");
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
          if (text.includes("backend_context_matches"))
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          if (text.includes("agent_team"))
            return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

describe("PostgresTeamRunStore", () => {
  it("uses an exact operation RPC and verifies request/document hashes", async () => {
    const command = await buildAgentTeamStoreCommand({
      schema_version: "agent-team-store-command@1.0.0",
      operation: "CREATE_TASK",
      command_id: ids.command,
      scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
      run_id: ids.run,
      task_id: ids.task,
      expected_revision: null,
      lease,
      selector: null,
      document: { schema_version: "agent-team-task@2.0.0", task_id: ids.task },
    });
    const dbValue = {
      schema_version: "agent-team-store-result@1.0.0",
      operation: command.operation,
      disposition: "CREATED",
      request_hash: command.request_hash,
      document_hash: command.document_hash,
      document: command.document,
    };
    const scripted = scriptedPool(dbValue);
    const auth = authority();
    const store = createPostgresTeamRunStore({ pool: scripted.pool, authorizer: auth.authorizer });
    const result = await store.createTask(auth.capability, command);
    expect(result).toMatchObject({ ok: true, value: { disposition: "CREATED" } });
    expect(scripted.calls.some((call) => call.text.includes("create_agent_team_task"))).toBe(true);
  });

  it("routes accepted sibling attachments through their only authority RPC", async () => {
    const command = await buildAgentTeamStoreCommand({
      schema_version: "agent-team-store-command@1.0.0",
      operation: "ATTACH_ACCEPTED_SIBLING_OUTPUT",
      command_id: ids.command,
      scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
      run_id: ids.run,
      task_id: ids.task,
      expected_revision: 1,
      lease,
      selector: null,
      document: {
        schema_version: "agent-team-accepted-sibling-output-attachment@1.0.0",
        attachment_id: "00000000-0000-4000-8000-000000000012",
      },
    });
    const scripted = scriptedPool({
      schema_version: "agent-team-store-result@1.0.0",
      operation: command.operation,
      disposition: "CREATED",
      request_hash: command.request_hash,
      document_hash: command.document_hash,
      document: command.document,
    });
    const auth = authority();
    const store = createPostgresTeamRunStore({ pool: scripted.pool, authorizer: auth.authorizer });

    await expect(
      store.attachAcceptedSiblingOutput(auth.capability, command),
    ).resolves.toMatchObject({
      ok: true,
      value: { disposition: "CREATED" },
    });
    expect(
      scripted.calls.some((call) =>
        call.text.includes("attach_agent_team_accepted_sibling_output"),
      ),
    ).toBe(true);
  });

  it("rejects a DB document substitution even when the outer shape is valid", async () => {
    const command = await buildAgentTeamStoreCommand({
      schema_version: "agent-team-store-command@1.0.0",
      operation: "COMMIT_COMPLETION",
      command_id: ids.command,
      scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
      run_id: ids.run,
      task_id: ids.task,
      expected_revision: 3,
      lease,
      selector: null,
      document: { schema_version: "task-completion-receipt@2.0.0", task_id: ids.task },
    });
    const scripted = scriptedPool({
      schema_version: "agent-team-store-result@1.0.0",
      operation: command.operation,
      disposition: "CREATED",
      request_hash: command.request_hash,
      document_hash: command.document_hash,
      document: { schema_version: "task-completion-receipt@2.0.0", task_id: ids.run },
    });
    const auth = authority();
    const store = createPostgresTeamRunStore({ pool: scripted.pool, authorizer: auth.authorizer });
    await expect(store.commitCompletion(auth.capability, command)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_TEAM_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });
});
