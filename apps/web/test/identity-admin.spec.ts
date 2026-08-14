import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IdentityOperationReceipt } from "@data-agent/contracts";
import {
  createIdentityAdminService,
  type IdentityAdminServiceDependencies,
} from "@/lib/identity-admin";

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  actor: "00000000-0000-4000-8000-000000001001",
  principal: "00000000-0000-4000-8000-000000001002",
  authUser: "00000000-0000-4000-8000-00000000a002",
  operation: "00000000-0000-4000-8000-00000000b001",
  workspace: "00000000-0000-4000-8000-00000000aa11",
} as const;

function receipt(
  commandKind: IdentityOperationReceipt["command_kind"],
  status: IdentityOperationReceipt["status"] = "SUCCEEDED",
): IdentityOperationReceipt {
  return {
    schema_version: "identity-operation-receipt@1.0.0",
    operation_id: ids.operation,
    actor_principal_id: ids.actor,
    target_principal_id: ids.principal,
    workspace_id: null,
    command_kind: commandKind,
    status,
    input_hash: `sha256:${"a".repeat(64)}`,
    result_version: "1",
    reason_code:
      status === "RETRY_REQUIRED"
        ? "IDENTITY_OPERATION_RETRY_REQUIRED"
        : "IDENTITY_OPERATION_SUCCEEDED",
    created_at: "2026-08-14T00:00:00.000Z",
    completed_at: status === "RETRY_REQUIRED" ? null : "2026-08-14T00:00:00.000Z",
  };
}

function targetUser() {
  return {
    schema_version: "admin-user-projection@1.0.0" as const,
    principal_id: ids.principal,
    auth_user_id: ids.authUser,
    email: "user@example.test",
    display_name: "User",
    system_role: "USER" as const,
    status: "ACTIVE" as const,
    authz_epoch: 1,
    active_memberships: 1,
    created_at: "2026-08-14T00:00:00.000Z",
    disabled_at: null,
  };
}

function commandKind(input: unknown): IdentityOperationReceipt["command_kind"] {
  return (input as { readonly command: { readonly kind: IdentityOperationReceipt["command_kind"] } })
    .command.kind;
}

function sideEffectSucceeded(input: unknown): boolean {
  return (input as { readonly succeeded: boolean }).succeeded;
}

function dependencies(
  calls: string[],
  overrides: Partial<IdentityAdminServiceDependencies> = {},
): IdentityAdminServiceDependencies {
  return {
    deploymentId: ids.deployment,
    authority: {
      async applyIdentityCommand(input) {
        const kind = commandKind(input);
        calls.push(`db:${kind}`);
        return { ok: true, value: receipt(kind) };
      },
      async completeIdentitySideEffect(input) {
        calls.push(`complete:${sideEffectSucceeded(input)}`);
        return { ok: true, value: receipt("DISABLE_USER") };
      },
    },
    directory: {
      async listUsers() {
        return { ok: true, value: [targetUser()] };
      },
    },
    auth: {
      async createUser() {
        calls.push("auth:create");
        return { id: ids.authUser };
      },
      async banUser() {
        calls.push("auth:ban");
      },
      async unbanUser() {
        calls.push("auth:unban");
      },
      async setUserPassword() {
        calls.push("auth:password");
      },
      async revokeUserSessions() {
        calls.push("auth:revoke-sessions");
      },
      async cleanupCreatedUser() {
        calls.push("auth:cleanup");
      },
    },
    createOneTimePassword: () => "Da!fixed-password-2026",
    ...overrides,
  };
}

describe("identity admin service", () => {
  it("creates Better Auth state before the app user and returns the password only once", async () => {
    const calls: string[] = [];
    const base = dependencies(calls);
    const service = createIdentityAdminService({
      ...base,
      directory: { async listUsers() {
        return { ok: true, value: [] };
      } },
    });
    const result = await service.createUser(ids.actor, {
      schema_version: "admin-user-create@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "create-user-one",
      email: "user@example.test",
      display_name: "User",
      system_role: "USER",
    });
    expect(calls).toEqual(["auth:create", "db:CREATE_USER"]);
    expect(result).toMatchObject({
      ok: true,
      value: { one_time_password: "Da!fixed-password-2026" },
    });

    const replayCalls: string[] = [];
    const replay = createIdentityAdminService(dependencies(replayCalls));
    await expect(
      replay.createUser(ids.actor, {
        schema_version: "admin-user-create@1.0.0",
        operation_id: ids.principal,
        idempotency_key: "create-user-one",
        email: "user@example.test",
        display_name: "User",
        system_role: "USER",
      }),
    ).resolves.toMatchObject({ ok: true, value: { one_time_password: null } });
    expect(replayCalls).toEqual(["db:CREATE_USER"]);
  });

  it("deletes a just-created auth orphan when the app command fails", async () => {
    const calls: string[] = [];
    const base = dependencies(calls);
    const service = createIdentityAdminService({
      ...base,
      directory: { async listUsers() {
        return { ok: true, value: [] };
      } },
      authority: {
        ...base.authority,
        async applyIdentityCommand() {
          calls.push("db:CREATE_USER");
          return {
            ok: false,
            error: { code: "IDENTITY_OPERATION_CONFLICT", message: "冲突", retryable: false },
          };
        },
      },
    });
    await expect(
      service.createUser(ids.actor, {
        schema_version: "admin-user-create@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "create-user-two",
        email: "user@example.test",
        display_name: "User",
        system_role: "USER",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "IDENTITY_OPERATION_CONFLICT" } });
    expect(calls).toEqual(["auth:create", "db:CREATE_USER", "auth:cleanup"]);
  });

  it("invalidates app authority before disabling auth and finalizes the side effect", async () => {
    const calls: string[] = [];
    const base = dependencies(calls);
    const service = createIdentityAdminService({
      ...base,
      authority: {
        ...base.authority,
        async applyIdentityCommand(input) {
          calls.push(`db:${commandKind(input)}`);
          return { ok: true, value: receipt("DISABLE_USER", "RETRY_REQUIRED") };
        },
      },
    });
    await expect(
      service.actOnUser(ids.actor, {
        schema_version: "admin-user-action@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "disable-user-one",
        principal_id: ids.principal,
        expected_version: 1,
        action: "DISABLE",
        reason: "security review",
      }),
    ).resolves.toMatchObject({ ok: true, value: { one_time_password: null } });
    expect(calls).toEqual([
      "db:DISABLE_USER",
      "auth:ban",
      "auth:revoke-sessions",
      "complete:true",
    ]);
  });

  it("unbans before enabling, and resets passwords after authority invalidation", async () => {
    const enableCalls: string[] = [];
    const enable = createIdentityAdminService(dependencies(enableCalls));
    await enable.actOnUser(ids.actor, {
      schema_version: "admin-user-action@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "enable-user-one",
      principal_id: ids.principal,
      expected_version: 1,
      action: "ENABLE",
      reason: "review complete",
    });
    expect(enableCalls).toEqual(["auth:unban", "db:ENABLE_USER"]);

    const resetCalls: string[] = [];
    const base = dependencies(resetCalls);
    const reset = createIdentityAdminService({
      ...base,
      authority: {
        ...base.authority,
        async applyIdentityCommand(input) {
          resetCalls.push(`db:${commandKind(input)}`);
          return { ok: true, value: receipt("RESET_USER_PASSWORD", "RETRY_REQUIRED") };
        },
      },
    });
    const resetResult = await reset.actOnUser(ids.actor, {
      schema_version: "admin-user-action@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "reset-user-one",
      principal_id: ids.principal,
      expected_version: 1,
      action: "RESET_PASSWORD",
      reason: "credential rotation",
    });
    expect(resetCalls).toEqual([
      "db:RESET_USER_PASSWORD",
      "auth:password",
      "auth:revoke-sessions",
      "complete:true",
    ]);
    expect(resetResult).toMatchObject({
      ok: true,
      value: { one_time_password: "Da!fixed-password-2026" },
    });
  });

  it("maps workspace and member operations onto the existing identity command authority", async () => {
    const calls: string[] = [];
    const service = createIdentityAdminService(dependencies(calls));
    await service.createWorkspace(ids.actor, {
      schema_version: "admin-workspace-create@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "create-workspace-one",
      workspace_id: ids.workspace,
      slug: "workspace-one",
      display_name: "Workspace One",
    });
    await service.actOnWorkspace(ids.actor, {
      schema_version: "admin-workspace-action@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "archive-workspace-one",
      workspace_id: ids.workspace,
      expected_version: 1,
      action: "ARCHIVE",
      reason: "workspace retired",
    });
    await service.actOnMember(ids.actor, ids.workspace, {
      schema_version: "workspace-member-action@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "upsert-member-one",
      principal_id: ids.principal,
      action: "UPSERT",
      role: "ANALYST",
    });
    expect(calls).toEqual([
      "db:CREATE_WORKSPACE",
      "db:ARCHIVE_WORKSPACE",
      "db:UPSERT_WORKSPACE_MEMBER",
    ]);
  });
});
