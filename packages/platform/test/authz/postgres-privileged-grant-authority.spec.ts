import { type CreateSemanticPublisherGrantCommand, sha256ContentHash } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresPrivilegedGrantAuthority } from "../../src/authz/postgres-privileged-grant-authority.js";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const H = (character: string) => `sha256:${character.repeat(64)}` as const;
const ids = {
  app: "00000000-0000-4000-8000-000000000701",
  tenant: "00000000-0000-4000-8000-000000000702",
  deployment: "00000000-0000-4000-8000-000000000703",
  principal: "00000000-0000-4000-8000-000000000704",
  command: "00000000-0000-4000-8000-000000000705",
  releaseSet: "00000000-0000-4000-8000-000000000706",
  policy: "00000000-0000-4000-8000-000000000707",
  grant: "00000000-0000-4000-8000-000000000708",
} as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "OWNER",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!capability.ok) throw new Error("test Authority missing");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

const command: CreateSemanticPublisherGrantCommand = {
  schema_version: "semantic-publisher-grant-create-command@1.0.0",
  command_id: ids.command,
  idempotency_key: "u5-publisher-grant-0001",
  scope: {
    app_id: ids.app,
    tenant_id: ids.tenant,
    workspace_id: ids.tenant,
    environment: "test",
  },
  semantic_domain: "commerce",
  issuer: { principal_id: ids.principal, key_id: "workspace-admin-key", key_revision: 1 },
  operator_principal_id: ids.principal,
  audience: "SEMANTIC_BOOTSTRAP_PUBLISHER",
  release_set_id: ids.releaseSet,
  candidate_set_hash: H("1"),
  policy_ref: { policy_id: ids.policy, policy_revision: 1, policy_hash: H("2") },
  revocation_epoch: 0,
  issued_at: "2026-08-17T00:00:00.000Z",
  expires_at: "2026-08-17T00:10:00.000Z",
};

function poolReturning(value: unknown) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          if (text.includes("create_semantic_bootstrap_publisher_grant")) {
            return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

describe("PostgreSQL Privileged Grant Authority", () => {
  it("returns only a content-addressed Publisher Grant reference", async () => {
    const access = authority();
    const expected = {
      schema_version: "semantic-publisher-grant-create-result@1.0.0",
      grant_ref: { grant_id: ids.grant, grant_hash: H("3") },
      request_hash: await sha256ContentHash(command),
      disposition: "CREATED",
    } as const;
    const scripted = poolReturning(expected);
    const result = await createPostgresPrivilegedGrantAuthority({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).createPublisherGrant(access.capability, command);
    expect(result).toEqual({ ok: true, value: expected });
    expect(JSON.stringify(result)).not.toMatch(/nonce|bearer|private/i);
  });

  it("rejects a database response that leaks a usable nonce", async () => {
    const access = authority();
    const scripted = poolReturning({
      schema_version: "semantic-publisher-grant-create-result@1.0.0",
      grant_ref: { grant_id: ids.grant, grant_hash: H("3"), nonce: "secret" },
      request_hash: await sha256ContentHash(command),
      disposition: "CREATED",
    });
    const result = await createPostgresPrivilegedGrantAuthority({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).createPublisherGrant(access.capability, command);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_PUBLISHER_GRANT_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });
});
