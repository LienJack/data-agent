import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresOperationsAdminRepository } from "../../src/tenancy/postgres-operations-admin.js";

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  authUser: "00000000-0000-4000-8000-00000000a001",
  workspace: "00000000-0000-4000-8000-00000000aa11",
} as const;

const context = { deployment_id: ids.deployment, principal_id: ids.principal };
const now = "2026-08-14T00:00:00.000Z";

function pool(handler: (text: string, values: readonly unknown[]) => SqlQueryResult): SqlPool {
  return {
    async connect() {
      return {
        async query<Row extends object>(text: string, values: readonly unknown[] = []) {
          return handler(text, values) as SqlQueryResult<Row>;
        },
        release() {},
      } satisfies SqlClient;
    },
  };
}

const user = {
  schema_version: "admin-user-projection@1.0.0",
  principal_id: ids.principal,
  auth_user_id: ids.authUser,
  username: "admin",
  email: "admin@example.test",
  display_name: "Admin",
  system_role: "SUPER_ADMIN",
  status: "ACTIVE",
  authz_epoch: 1,
  active_memberships: 1,
  created_at: now,
  disabled_at: null,
} as const;

const workspace = {
  schema_version: "admin-workspace-projection@1.0.0",
  workspace_id: ids.workspace,
  slug: "workspace-one",
  display_name: "Workspace One",
  lifecycle: "ACTIVE",
  lifecycle_version: 1,
  active_members: 1,
  total_members: 1,
  created_at: now,
  archived_at: null,
} as const;

const member = {
  schema_version: "admin-workspace-member-projection@1.0.0",
  workspace_id: ids.workspace,
  principal_id: ids.principal,
  username: "admin",
  email: "admin@example.test",
  display_name: "Admin",
  system_role: "SUPER_ADMIN",
  user_status: "ACTIVE",
  role: "WORKSPACE_ADMIN",
  source: "SYSTEM_ROLE",
  membership_version: 1,
  revoked_at: null,
} as const;

const health = {
  schema_version: "operations-health@1.0.0",
  generated_at: now,
  billing_mode: "SHADOW",
  billing_epoch: 1,
  gates: [
    "IDENTITY_SIDE_EFFECTS",
    "PRICING_SYNC",
    "PRICING_REVIEW",
    "BILLING_REVIEW",
    "BALANCE_INTEGRITY",
    "SHADOW_RECONCILIATION",
  ].map((key) => ({
    key,
    status: "PASS",
    count: 0,
    reason_code: `${key}_CLEAR`,
    last_observed_at: null,
  })),
} as const;

describe("PostgreSQL operations admin repository", () => {
  it("uses only the narrow administration RPCs and parses strict projections", async () => {
    const observed: Array<{ text: string; values: readonly unknown[] }> = [];
    const repository = createPostgresOperationsAdminRepository(
      pool((text, values) => {
        observed.push({ text, values });
        if (text.includes("list_admin_users")) return { rows: [{ projection: user }], rowCount: 1 };
        if (text.includes("list_admin_workspaces")) {
          return { rows: [{ projection: workspace }], rowCount: 1 };
        }
        if (text.includes("list_workspace_members")) {
          return { rows: [{ projection: member }], rowCount: 1 };
        }
        return { rows: [{ health }], rowCount: 1 };
      }),
    );

    await expect(repository.listUsers(context)).resolves.toMatchObject({
      ok: true,
      value: [{ principal_id: ids.principal }],
    });
    await expect(repository.listWorkspaces(context)).resolves.toMatchObject({
      ok: true,
      value: [{ workspace_id: ids.workspace }],
    });
    await expect(
      repository.listWorkspaceMembers({ ...context, workspace_id: ids.workspace }),
    ).resolves.toMatchObject({ ok: true, value: [{ role: "WORKSPACE_ADMIN" }] });
    const healthResult = await repository.readHealth(context);
    expect(healthResult.ok).toBe(true);
    if (healthResult.ok) {
      expect(healthResult.value.gates.map((gate) => gate.key)).toEqual([
        "IDENTITY_SIDE_EFFECTS",
        "PRICING_SYNC",
        "PRICING_REVIEW",
        "BILLING_REVIEW",
        "BALANCE_INTEGRITY",
        "SHADOW_RECONCILIATION",
      ]);
    }

    expect(observed).toHaveLength(4);
    expect(observed[0]?.values).toEqual([ids.deployment, ids.principal]);
    expect(observed[2]?.values).toEqual([ids.deployment, ids.principal, ids.workspace]);
    expect(observed.every(({ text }) => !text.includes("app_data_agent.app_users"))).toBe(true);
  });

  it("fails closed when a projection drifts from the public contract", async () => {
    const repository = createPostgresOperationsAdminRepository(
      pool(() => ({ rows: [{ projection: { ...user, password: "secret" } }], rowCount: 1 })),
    );
    await expect(repository.listUsers(context)).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATIONS_ADMIN_READ_FAILED", retryable: true },
    });
  });

  it("redacts database denial details behind a stable boundary error", async () => {
    const repository = createPostgresOperationsAdminRepository(
      pool(() => {
        throw Object.assign(new Error("WORKSPACE_ADMIN_REQUIRED: internal detail"), {
          code: "42501",
        });
      }),
    );
    const result = await repository.listWorkspaceMembers({
      ...context,
      workspace_id: ids.workspace,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "OPERATIONS_ADMIN_ACCESS_DENIED", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain("internal detail");
  });

  it("rejects unknown context fields before opening a database connection", async () => {
    let connected = false;
    const repository = createPostgresOperationsAdminRepository({
      async connect() {
        connected = true;
        throw new Error("must not connect");
      },
    });
    await expect(repository.listUsers({ ...context, role: "SUPER_ADMIN" })).resolves.toMatchObject({
      ok: false,
      error: { code: "OPERATIONS_ADMIN_CONTEXT_INVALID" },
    });
    expect(connected).toBe(false);
  });
});
