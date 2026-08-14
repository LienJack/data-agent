import { describe, expect, it } from "vitest";
import { type AuthoritySqlPool, createPostgresWorkspaceAuthority } from "../../src/index.js";

const authorityRow = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-00000000aa11",
  environment: "test",
  deployment_id: "00000000-0000-4000-8000-00000000de01",
  principal_id: "00000000-0000-4000-8000-000000001001",
  capability_role: "owner",
  workspace_role: "WORKSPACE_ADMIN",
  system_role: "SUPER_ADMIN",
  membership_version: "3",
  user_authz_epoch: "5",
  workspace_lifecycle_version: "7",
  app_epoch: "11",
  app_lifecycle_state: "ACTIVE",
  workspace_lifecycle: "ACTIVE",
  can_write: true,
} as const;

function poolWith(
  handle: (
    text: string,
    values: readonly unknown[],
  ) => Promise<{
    rows: readonly Record<string, unknown>[];
    rowCount: number;
  }>,
) {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  let releases = 0;
  const pool: AuthoritySqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ) {
          queries.push({ text, values });
          return (await handle(text, values)) as {
            rows: readonly Row[];
            rowCount: number;
          };
        },
        release() {
          releases += 1;
        },
      };
    },
  };
  return { pool, queries, releases: () => releases };
}

describe("PostgreSQL workspace authority", () => {
  it("freezes user, workspace, membership and app versions in the issued capability", async () => {
    const fixture = poolWith(async () => ({ rows: [authorityRow], rowCount: 1 }));
    const authority = createPostgresWorkspaceAuthority(fixture.pool);
    const resolved = await authority.resolveForServerContext({
      deployment_id: authorityRow.deployment_id,
      workspace_id: authorityRow.tenant_id,
      principal_id: authorityRow.principal_id,
      access: "WRITE",
    });
    if (!resolved.ok) throw new Error(resolved.error.code);

    expect(resolved.value.role).toBe("OWNER");
    expect(authority.authorizer.requireRole(resolved.value, ["OWNER"], "WRITE")).toMatchObject({
      ok: true,
    });
    expect(
      authority.authorizer.requireRole({ ...resolved.value }, ["OWNER"], "WRITE"),
    ).toMatchObject({
      ok: false,
      error: { code: "APP_CAPABILITY_ISSUER_MISMATCH" },
    });
    expect(await authority.authorizer.revalidate(resolved.value, ["OWNER"], "WRITE")).toMatchObject(
      {
        ok: true,
      },
    );
    expect(fixture.queries[1]?.values).toEqual([
      authorityRow.app_id,
      authorityRow.tenant_id,
      authorityRow.environment,
      authorityRow.deployment_id,
      authorityRow.principal_id,
      authorityRow.capability_role,
      authorityRow.workspace_role,
      authorityRow.system_role,
      authorityRow.membership_version,
      authorityRow.user_authz_epoch,
      authorityRow.workspace_lifecycle_version,
      authorityRow.app_epoch,
      true,
    ]);
    expect(fixture.releases()).toBe(2);
  });

  it("fails closed when any persisted authorization version changes", async () => {
    let calls = 0;
    const fixture = poolWith(async () => {
      calls += 1;
      return {
        rows: [calls === 1 ? authorityRow : { ...authorityRow, user_authz_epoch: "6" }],
        rowCount: 1,
      };
    });
    const authority = createPostgresWorkspaceAuthority(fixture.pool);
    const resolved = await authority.resolveForServerContext({
      deployment_id: authorityRow.deployment_id,
      workspace_id: authorityRow.tenant_id,
      principal_id: authorityRow.principal_id,
      access: "READ",
    });
    if (!resolved.ok) throw new Error(resolved.error.code);

    expect(await authority.authorizer.revalidate(resolved.value, ["OWNER"], "READ")).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ACCESS_DENIED", retryable: false },
    });
  });

  it("maps only server-resolved auth users and returns contract-parsed workspace projections", async () => {
    const fixture = poolWith(async (text) => {
      if (text.includes("resolve_session_principal")) {
        return {
          rows: [
            {
              app_id: authorityRow.app_id,
              environment: authorityRow.environment,
              principal_id: authorityRow.principal_id,
              auth_user_id: "00000000-0000-4000-8000-00000000a001",
              system_role: "SUPER_ADMIN",
              authz_epoch: "5",
            },
          ],
          rowCount: 1,
        };
      }
      return {
        rows: [
          {
            app_id: authorityRow.app_id,
            environment: authorityRow.environment,
            workspace_id: authorityRow.tenant_id,
            slug: "main-workspace",
            display_name: "Main workspace",
            lifecycle: "ACTIVE",
            lifecycle_version: "7",
            created_at: "2026-08-14T00:00:00.000Z",
            archived_at: null,
            principal_id: authorityRow.principal_id,
            system_role: "SUPER_ADMIN",
            workspace_role: "WORKSPACE_ADMIN",
            membership_version: "3",
          },
        ],
        rowCount: 1,
      };
    });
    const authority = createPostgresWorkspaceAuthority(fixture.pool);
    const principal = await authority.resolveSessionPrincipal({
      deployment_id: authorityRow.deployment_id,
      auth_user_id: "00000000-0000-4000-8000-00000000a001",
    });
    expect(principal).toMatchObject({
      ok: true,
      value: { principal_id: authorityRow.principal_id, authz_epoch: "5" },
    });

    const workspaces = await authority.listWorkspaces({
      deployment_id: authorityRow.deployment_id,
      principal_id: authorityRow.principal_id,
    });
    if (!workspaces.ok) throw new Error(workspaces.error.code);
    expect(workspaces.value[0]).toMatchObject({
      workspace: { workspace_id: authorityRow.tenant_id, lifecycle: "ACTIVE" },
      role: "WORKSPACE_ADMIN",
      allowed_actions: expect.arrayContaining(["WORKSPACE_CREATE", "BILLING_REVIEW"]),
    });
  });

  it("parses identity command receipts and rejects caller-only authority fields", async () => {
    const operationId = "00000000-0000-4000-8000-00000000c001";
    const fixture = poolWith(async () => ({
      rows: [
        {
          receipt: {
            schema_version: "identity-operation-receipt@1.0.0",
            operation_id: operationId,
            actor_principal_id: authorityRow.principal_id,
            target_principal_id: null,
            workspace_id: authorityRow.tenant_id,
            command_kind: "CREATE_WORKSPACE",
            status: "SUCCEEDED",
            input_hash: `sha256:${"a".repeat(64)}`,
            result_version: "1",
            reason_code: "IDENTITY_OPERATION_SUCCEEDED",
            created_at: "2026-08-14T00:00:00.000Z",
            completed_at: "2026-08-14T00:00:00.000Z",
          },
        },
      ],
      rowCount: 1,
    }));
    const authority = createPostgresWorkspaceAuthority(fixture.pool);
    const result = await authority.applyIdentityCommand({
      deployment_id: authorityRow.deployment_id,
      actor_principal_id: authorityRow.principal_id,
      auth_user_id: null,
      command: {
        schema_version: "identity-command@1.0.0",
        operation_id: operationId,
        idempotency_key: "workspace:create:main",
        kind: "CREATE_WORKSPACE",
        workspace_id: authorityRow.tenant_id,
        slug: "main-workspace",
        display_name: "Main workspace",
      },
    });
    expect(result).toMatchObject({ ok: true, value: { operation_id: operationId } });
    expect(
      await authority.applyIdentityCommand({
        deployment_id: authorityRow.deployment_id,
        actor_principal_id: authorityRow.principal_id,
        role: "SUPER_ADMIN",
        auth_user_id: null,
        command: {
          schema_version: "identity-command@1.0.0",
          operation_id: operationId,
          idempotency_key: "workspace:create:main",
          kind: "CREATE_WORKSPACE",
          workspace_id: authorityRow.tenant_id,
          slug: "main-workspace",
          display_name: "Main workspace",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "IDENTITY_COMMAND_INVALID" } });
  });
});
