import "server-only";

import { randomBytes } from "node:crypto";
import {
  type AdminUserActionInput,
  adminUserActionInputSchema,
  type CreateAdminUserInput,
  createAdminUserInputSchema,
  type CreateAdminWorkspaceInput,
  createAdminWorkspaceInputSchema,
  type IdentityCommand,
  type IdentityOperationReceipt,
  type WorkspaceMemberActionInput,
  workspaceMemberActionInputSchema,
  type AdminWorkspaceActionInput,
  adminWorkspaceActionInputSchema,
} from "@data-agent/contracts";
import type { BoundaryResult } from "@data-agent/platform";
import { getDataAgentAuth, getDataAgentAuthPool } from "./auth";
import {
  getOperationsAdminRepository,
  getWorkspaceAuthority,
  getWorkspaceDeploymentId,
} from "./workspace-identity";

type IdentityAuthority = Pick<
  ReturnType<typeof getWorkspaceAuthority>,
  "applyIdentityCommand" | "completeIdentitySideEffect"
>;
type OperationsDirectory = Pick<ReturnType<typeof getOperationsAdminRepository>, "listUsers">;

interface AuthAdminAdapter {
  createUser(input: {
    readonly email: string;
    readonly password: string;
    readonly name: string;
    readonly role: "admin" | "user";
  }): Promise<{ readonly id: string }>;
  banUser(userId: string, reason: string): Promise<void>;
  unbanUser(userId: string): Promise<void>;
  setUserPassword(userId: string, password: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  cleanupCreatedUser(userId: string): Promise<void>;
}

export interface IdentityAdminServiceDependencies {
  readonly deploymentId: string;
  readonly authority: IdentityAuthority;
  readonly directory: OperationsDirectory;
  readonly auth: AuthAdminAdapter;
  readonly createOneTimePassword?: () => string;
}

export type IdentityAdminMutationResult = Readonly<{
  receipt: IdentityOperationReceipt;
  one_time_password: string | null;
}>;

function failure<T>(code: string, message: string, retryable = false): BoundaryResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function oneTimePassword(): string {
  return `Da!${randomBytes(18).toString("base64url")}`;
}

function identityInput(
  deploymentId: string,
  actorPrincipalId: string,
  authUserId: string | null,
  command: IdentityCommand,
) {
  return {
    deployment_id: deploymentId,
    actor_principal_id: actorPrincipalId,
    auth_user_id: authUserId,
    command,
  };
}

export function createIdentityAdminService(dependencies: IdentityAdminServiceDependencies) {
  const createPassword = dependencies.createOneTimePassword ?? oneTimePassword;

  async function findTargetUser(actorPrincipalId: string, principalId: string) {
    const listed = await dependencies.directory.listUsers({
      deployment_id: dependencies.deploymentId,
      principal_id: actorPrincipalId,
    });
    if (!listed.ok) return listed;
    const target = listed.value.find((user) => user.principal_id === principalId);
    return target
      ? ({ ok: true, value: target } as const)
      : failure<never>("ADMIN_USER_NOT_FOUND", "目标用户不存在。");
  }

  async function completeSideEffect(
    actorPrincipalId: string,
    operationId: string,
    succeeded: boolean,
  ): Promise<BoundaryResult<IdentityOperationReceipt>> {
    return dependencies.authority.completeIdentitySideEffect({
      deployment_id: dependencies.deploymentId,
      actor_principal_id: actorPrincipalId,
      operation_id: operationId,
      succeeded,
      reason_code: succeeded
        ? "IDENTITY_AUTH_SIDE_EFFECT_SUCCEEDED"
        : "IDENTITY_AUTH_SIDE_EFFECT_FAILED",
    });
  }

  return Object.freeze({
    async createUser(
      actorPrincipalId: string,
      input: CreateAdminUserInput,
    ): Promise<BoundaryResult<IdentityAdminMutationResult>> {
      const parsed = createAdminUserInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("ADMIN_USER_CREATE_INVALID", "新建用户命令不符合严格契约。");
      }

      const existing = await findTargetUser(actorPrincipalId, parsed.data.operation_id);
      if (existing.ok) {
        const replay = await dependencies.authority.applyIdentityCommand(
          identityInput(
            dependencies.deploymentId,
            actorPrincipalId,
            existing.value.auth_user_id,
            {
              schema_version: "identity-command@1.0.0",
              operation_id: parsed.data.operation_id,
              idempotency_key: parsed.data.idempotency_key,
              kind: "CREATE_USER",
              email: parsed.data.email,
              display_name: parsed.data.display_name,
              system_role: parsed.data.system_role,
            },
          ),
        );
        return replay.ok
          ? { ok: true, value: { receipt: replay.value, one_time_password: null } }
          : replay;
      }
      if (existing.error.code !== "ADMIN_USER_NOT_FOUND") return existing;

      const password = createPassword();
      let created: { readonly id: string };
      try {
        created = await dependencies.auth.createUser({
          email: parsed.data.email,
          password,
          name: parsed.data.display_name,
          role: parsed.data.system_role === "SUPER_ADMIN" ? "admin" : "user",
        });
      } catch {
        return failure("AUTH_USER_CREATE_FAILED", "认证用户创建失败。", true);
      }

      const applied = await dependencies.authority.applyIdentityCommand(
        identityInput(dependencies.deploymentId, actorPrincipalId, created.id, {
          schema_version: "identity-command@1.0.0",
          operation_id: parsed.data.operation_id,
          idempotency_key: parsed.data.idempotency_key,
          kind: "CREATE_USER",
          email: parsed.data.email,
          display_name: parsed.data.display_name,
          system_role: parsed.data.system_role,
        }),
      );
      if (!applied.ok) {
        try {
          await dependencies.auth.cleanupCreatedUser(created.id);
        } catch {
          return failure(
            "IDENTITY_CREATE_COMPENSATION_FAILED",
            "应用用户创建失败，且认证孤儿清理失败，需要管理员处理。",
            true,
          );
        }
        return applied;
      }
      return { ok: true, value: { receipt: applied.value, one_time_password: password } };
    },

    async actOnUser(
      actorPrincipalId: string,
      input: AdminUserActionInput,
    ): Promise<BoundaryResult<IdentityAdminMutationResult>> {
      const parsed = adminUserActionInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("ADMIN_USER_ACTION_INVALID", "用户操作不符合严格契约。");
      }
      const target = await findTargetUser(actorPrincipalId, parsed.data.principal_id);
      if (!target.ok) return target;
      const command: IdentityCommand = {
        schema_version: "identity-command@1.0.0",
        operation_id: parsed.data.operation_id,
        idempotency_key: parsed.data.idempotency_key,
        expected_version: parsed.data.expected_version,
        kind:
          parsed.data.action === "DISABLE"
            ? "DISABLE_USER"
            : parsed.data.action === "ENABLE"
              ? "ENABLE_USER"
              : "RESET_USER_PASSWORD",
        principal_id: parsed.data.principal_id,
        reason: parsed.data.reason,
      };

      if (parsed.data.action === "ENABLE") {
        try {
          await dependencies.auth.unbanUser(target.value.auth_user_id);
        } catch {
          return failure("AUTH_USER_ENABLE_FAILED", "认证用户启用失败。", true);
        }
        const applied = await dependencies.authority.applyIdentityCommand(
          identityInput(dependencies.deploymentId, actorPrincipalId, null, command),
        );
        if (!applied.ok) {
          await dependencies.auth
            .banUser(target.value.auth_user_id, "application enable failed")
            .catch(() => undefined);
          return applied;
        }
        return { ok: true, value: { receipt: applied.value, one_time_password: null } };
      }

      const applied = await dependencies.authority.applyIdentityCommand(
        identityInput(dependencies.deploymentId, actorPrincipalId, null, command),
      );
      if (!applied.ok) return applied;
      if (applied.value.status !== "RETRY_REQUIRED") {
        return { ok: true, value: { receipt: applied.value, one_time_password: null } };
      }

      const password = parsed.data.action === "RESET_PASSWORD" ? createPassword() : null;
      try {
        if (parsed.data.action === "DISABLE") {
          await dependencies.auth.banUser(target.value.auth_user_id, parsed.data.reason);
        } else if (password) {
          await dependencies.auth.setUserPassword(target.value.auth_user_id, password);
        }
        await dependencies.auth.revokeUserSessions(target.value.auth_user_id);
      } catch {
        const completed = await completeSideEffect(
          actorPrincipalId,
          parsed.data.operation_id,
          false,
        );
        return completed.ok
          ? { ok: true, value: { receipt: completed.value, one_time_password: null } }
          : completed;
      }
      const completed = await completeSideEffect(actorPrincipalId, parsed.data.operation_id, true);
      return completed.ok
        ? { ok: true, value: { receipt: completed.value, one_time_password: password } }
        : completed;
    },

    async createWorkspace(actorPrincipalId: string, input: CreateAdminWorkspaceInput) {
      const parsed = createAdminWorkspaceInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure<IdentityOperationReceipt>(
          "ADMIN_WORKSPACE_CREATE_INVALID",
          "新建工作空间命令不符合严格契约。",
        );
      }
      return dependencies.authority.applyIdentityCommand(
        identityInput(dependencies.deploymentId, actorPrincipalId, null, {
          schema_version: "identity-command@1.0.0",
          operation_id: parsed.data.operation_id,
          idempotency_key: parsed.data.idempotency_key,
          kind: "CREATE_WORKSPACE",
          workspace_id: parsed.data.workspace_id,
          slug: parsed.data.slug,
          display_name: parsed.data.display_name,
        }),
      );
    },

    async actOnWorkspace(actorPrincipalId: string, input: AdminWorkspaceActionInput) {
      const parsed = adminWorkspaceActionInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure<IdentityOperationReceipt>(
          "ADMIN_WORKSPACE_ACTION_INVALID",
          "工作空间操作不符合严格契约。",
        );
      }
      return dependencies.authority.applyIdentityCommand(
        identityInput(dependencies.deploymentId, actorPrincipalId, null, {
          schema_version: "identity-command@1.0.0",
          operation_id: parsed.data.operation_id,
          idempotency_key: parsed.data.idempotency_key,
          expected_version: parsed.data.expected_version,
          kind: parsed.data.action === "ARCHIVE" ? "ARCHIVE_WORKSPACE" : "RESTORE_WORKSPACE",
          workspace_id: parsed.data.workspace_id,
          reason: parsed.data.reason,
        }),
      );
    },

    async actOnMember(
      actorPrincipalId: string,
      workspaceId: string,
      input: WorkspaceMemberActionInput,
    ) {
      const parsed = workspaceMemberActionInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure<IdentityOperationReceipt>(
          "WORKSPACE_MEMBER_ACTION_INVALID",
          "成员操作不符合严格契约。",
        );
      }
      const command: IdentityCommand =
        parsed.data.action === "UPSERT"
          ? {
              schema_version: "identity-command@1.0.0",
              operation_id: parsed.data.operation_id,
              idempotency_key: parsed.data.idempotency_key,
              kind: "UPSERT_WORKSPACE_MEMBER",
              workspace_id: workspaceId,
              principal_id: parsed.data.principal_id,
              role: parsed.data.role,
            }
          : {
              schema_version: "identity-command@1.0.0",
              operation_id: parsed.data.operation_id,
              idempotency_key: parsed.data.idempotency_key,
              kind: "REVOKE_WORKSPACE_MEMBER",
              workspace_id: workspaceId,
              principal_id: parsed.data.principal_id,
              reason: parsed.data.reason,
            };
      return dependencies.authority.applyIdentityCommand(
        identityInput(dependencies.deploymentId, actorPrincipalId, null, command),
      );
    },
  });
}

async function cleanupCreatedAuthUser(userId: string): Promise<void> {
  const client = await getDataAgentAuthPool().connect();
  try {
    await client.query("begin");
    await client.query('delete from data_agent_auth."session" where "userId" = $1', [userId]);
    await client.query('delete from data_agent_auth."account" where "userId" = $1', [userId]);
    await client.query('delete from data_agent_auth."user" where "id" = $1', [userId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function getIdentityAdminService(requestHeaders: Headers) {
  const auth = getDataAgentAuth().api;
  return createIdentityAdminService({
    deploymentId: getWorkspaceDeploymentId(),
    authority: getWorkspaceAuthority(),
    directory: getOperationsAdminRepository(),
    auth: {
      async createUser(input) {
        const result = await auth.createUser({ headers: requestHeaders, body: input });
        return { id: result.user.id };
      },
      async banUser(userId, reason) {
        await auth.banUser({ headers: requestHeaders, body: { userId, banReason: reason } });
      },
      async unbanUser(userId) {
        await auth.unbanUser({ headers: requestHeaders, body: { userId } });
      },
      async setUserPassword(userId, password) {
        await auth.setUserPassword({
          headers: requestHeaders,
          body: { userId, newPassword: password },
        });
      },
      async revokeUserSessions(userId) {
        await auth.revokeUserSessions({ headers: requestHeaders, body: { userId } });
      },
      cleanupCreatedUser: cleanupCreatedAuthUser,
    },
  });
}
