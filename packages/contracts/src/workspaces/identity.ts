import { z } from "zod";
import {
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/primitives.js";

export const systemRoleSchema = z.enum(["SUPER_ADMIN", "USER"]);
export const appUserStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export const loginUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/);
export const workspaceRoleSchema = z.enum(["WORKSPACE_ADMIN", "ANALYST", "VIEWER"]);
export const workspaceLifecycleSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const workspaceActionSchema = z.enum([
  "WORKSPACE_CREATE",
  "WORKSPACE_ARCHIVE",
  "WORKSPACE_RESTORE",
  "USER_CREATE",
  "USER_DISABLE",
  "USER_ENABLE",
  "USER_RESET_PASSWORD",
  "MEMBER_MANAGE",
  "DATASOURCE_MANAGE",
  "EXTENSION_MANAGE",
  "AGENT_PROFILE_MANAGE",
  "SEMANTIC_EDIT",
  "SEMANTIC_REVIEW",
  "ANALYSIS_RUN_CREATE",
  "WORKSPACE_RESULT_READ",
  "MODEL_MANAGE",
]);

export const identityScopeSchema = z.strictObject({
  app_id: immutableIdSchema,
  environment: environmentSchema,
});

export const appUserSchema = z.strictObject({
  schema_version: z.literal("app-user@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  auth_user_id: z.string().min(1).max(256),
  username: loginUsernameSchema.nullable(),
  email: z.email().max(320),
  display_name: z.string().min(1).max(128),
  system_role: systemRoleSchema,
  status: appUserStatusSchema,
  authz_epoch: z.number().int().min(1),
  created_at: timestampSchema,
  disabled_at: timestampSchema.nullable(),
});

export const sessionPrincipalSchema = z.strictObject({
  schema_version: z.literal("session-principal@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  auth_user_id: z.string().min(1).max(256),
  system_role: systemRoleSchema,
  authz_epoch: z.number().int().min(1),
  session_id: z.string().min(1).max(256),
  session_expires_at: timestampSchema,
});

export const workspaceSchema = z.strictObject({
  schema_version: z.literal("workspace@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  workspace_id: immutableIdSchema,
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  display_name: z.string().min(1).max(128),
  lifecycle: workspaceLifecycleSchema,
  lifecycle_version: z.number().int().min(1),
  created_at: timestampSchema,
  archived_at: timestampSchema.nullable(),
});

export const workspaceMembershipSchema = z.strictObject({
  schema_version: z.literal("workspace-membership@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  workspace_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  explicit_role: workspaceRoleSchema.nullable(),
  effective_role: workspaceRoleSchema,
  source: z.enum(["EXPLICIT", "SYSTEM_ROLE", "LEGACY"]),
  membership_version: z.number().int().min(1),
  revoked_at: timestampSchema.nullable(),
});

export const workspaceAccessProjectionSchema = z.strictObject({
  schema_version: z.literal("workspace-access@1.0.0"),
  workspace: workspaceSchema,
  principal_id: immutableIdSchema,
  system_role: systemRoleSchema,
  role: workspaceRoleSchema,
  allowed_actions: z.array(workspaceActionSchema).max(32),
});

export const workspaceAuthorityRequestSchema = z.strictObject({
  schema_version: z.literal("workspace-authority-request@1.0.0"),
  deployment_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  requested_action: workspaceActionSchema,
  access: z.enum(["READ", "WRITE"]),
});

export const workspaceIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

const identityCommandEnvelopeSchema = z.strictObject({
  schema_version: z.literal("identity-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  expected_version: z.number().int().min(1).optional(),
});

export const identityCommandSchema = z.discriminatedUnion("kind", [
  identityCommandEnvelopeSchema.extend({
    kind: z.literal("CREATE_USER"),
    email: z.email().max(320),
    display_name: z.string().min(1).max(128),
    system_role: systemRoleSchema,
  }),
  identityCommandEnvelopeSchema.extend({
    kind: z.enum(["DISABLE_USER", "ENABLE_USER", "RESET_USER_PASSWORD"]),
    principal_id: immutableIdSchema,
    reason: z.string().min(1).max(500),
  }),
  identityCommandEnvelopeSchema.extend({
    kind: z.literal("CREATE_WORKSPACE"),
    workspace_id: immutableIdSchema,
    slug: workspaceSchema.shape.slug,
    display_name: workspaceSchema.shape.display_name,
  }),
  identityCommandEnvelopeSchema.extend({
    kind: z.enum(["ARCHIVE_WORKSPACE", "RESTORE_WORKSPACE"]),
    workspace_id: immutableIdSchema,
    reason: z.string().min(1).max(500),
  }),
  identityCommandEnvelopeSchema.extend({
    kind: z.literal("UPSERT_WORKSPACE_MEMBER"),
    workspace_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    role: workspaceRoleSchema,
  }),
  identityCommandEnvelopeSchema.extend({
    kind: z.literal("REVOKE_WORKSPACE_MEMBER"),
    workspace_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    reason: z.string().min(1).max(500),
  }),
]);

export const identityOperationStatusSchema = z.enum([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "RETRY_REQUIRED",
]);

export const identityOperationReceiptSchema = z.strictObject({
  schema_version: z.literal("identity-operation-receipt@1.0.0"),
  operation_id: immutableIdSchema,
  actor_principal_id: immutableIdSchema,
  target_principal_id: immutableIdSchema.nullable(),
  workspace_id: immutableIdSchema.nullable(),
  command_kind: identityCommandSchema.options[0].shape.kind.or(
    z.enum([
      "DISABLE_USER",
      "ENABLE_USER",
      "RESET_USER_PASSWORD",
      "CREATE_WORKSPACE",
      "ARCHIVE_WORKSPACE",
      "RESTORE_WORKSPACE",
      "UPSERT_WORKSPACE_MEMBER",
      "REVOKE_WORKSPACE_MEMBER",
    ]),
  ),
  status: identityOperationStatusSchema,
  input_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  result_version: versionIdentifierSchema,
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

export type SystemRole = z.infer<typeof systemRoleSchema>;
export type AppUserStatus = z.infer<typeof appUserStatusSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceLifecycle = z.infer<typeof workspaceLifecycleSchema>;
export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;
export type AppUser = z.infer<typeof appUserSchema>;
export type SessionPrincipal = z.infer<typeof sessionPrincipalSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;
export type WorkspaceAccessProjection = z.infer<typeof workspaceAccessProjectionSchema>;
export type WorkspaceAuthorityRequest = z.infer<typeof workspaceAuthorityRequestSchema>;
export type IdentityCommand = z.infer<typeof identityCommandSchema>;
export type IdentityOperationReceipt = z.infer<typeof identityOperationReceiptSchema>;

const workspaceRoleActions = Object.freeze({
  WORKSPACE_ADMIN: [
    "MEMBER_MANAGE",
    "DATASOURCE_MANAGE",
    "EXTENSION_MANAGE",
    "AGENT_PROFILE_MANAGE",
    "SEMANTIC_EDIT",
    "SEMANTIC_REVIEW",
    "ANALYSIS_RUN_CREATE",
    "WORKSPACE_RESULT_READ",
  ],
  ANALYST: ["SEMANTIC_EDIT", "SEMANTIC_REVIEW", "ANALYSIS_RUN_CREATE", "WORKSPACE_RESULT_READ"],
  VIEWER: ["WORKSPACE_RESULT_READ"],
} as const satisfies Readonly<Record<WorkspaceRole, readonly WorkspaceAction[]>>);

export function actionsForWorkspaceRole(
  role: WorkspaceRole,
  systemRole: SystemRole,
): readonly WorkspaceAction[] {
  return systemRole === "SUPER_ADMIN" ? workspaceActionSchema.options : workspaceRoleActions[role];
}
