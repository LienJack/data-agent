import { betterAuth } from "better-auth";
import { admin, createAccessControl } from "better-auth/plugins";
import { defaultStatements, userAc } from "better-auth/plugins/admin/access";
import type pg from "pg";

const authAccessControl = createAccessControl(defaultStatements);

/**
 * Better Auth admin capability is deliberately narrower than its default role.
 * Data Agent business authorization still comes from app_users/workspace authority.
 */
export const dataAgentAuthAdminRole = authAccessControl.newRole({
  user: ["create", "list", "set-role", "ban", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
});

export interface DataAgentAuthConfigInput {
  readonly pool: pg.Pool;
  readonly secret: string;
  readonly baseURL?: string;
}

export function createDataAgentAuth(input: DataAgentAuthConfigInput) {
  return betterAuth({
    appName: "Data Agent",
    database: input.pool,
    secret: input.secret,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "data-agent",
      database: { generateId: "uuid" },
    },
    plugins: [
      admin({
        ac: authAccessControl,
        roles: {
          admin: dataAgentAuthAdminRole,
          user: userAc,
        },
        adminRoles: ["admin"],
        defaultRole: "user",
        bannedUserMessage: "账号已停用，请联系超级管理员。",
      }),
    ],
  });
}

export type DataAgentAuth = ReturnType<typeof createDataAgentAuth>;
