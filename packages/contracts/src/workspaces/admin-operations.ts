import { z } from "zod";
import { immutableIdSchema, timestampSchema } from "../common/primitives.js";
import {
  appUserStatusSchema,
  systemRoleSchema,
  workspaceIdempotencyKeySchema,
  workspaceLifecycleSchema,
  workspaceRoleSchema,
} from "./identity.js";

export const adminUserProjectionSchema = z.strictObject({
  schema_version: z.literal("admin-user-projection@1.0.0"),
  principal_id: immutableIdSchema,
  auth_user_id: immutableIdSchema,
  email: z.email().max(320),
  display_name: z.string().min(1).max(128),
  system_role: systemRoleSchema,
  status: appUserStatusSchema,
  authz_epoch: z.number().int().min(1),
  active_memberships: z.number().int().min(0),
  created_at: timestampSchema,
  disabled_at: timestampSchema.nullable(),
});

export const adminWorkspaceProjectionSchema = z.strictObject({
  schema_version: z.literal("admin-workspace-projection@1.0.0"),
  workspace_id: immutableIdSchema,
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  display_name: z.string().min(1).max(128),
  lifecycle: workspaceLifecycleSchema,
  lifecycle_version: z.number().int().min(1),
  active_members: z.number().int().min(0),
  total_members: z.number().int().min(0),
  created_at: timestampSchema,
  archived_at: timestampSchema.nullable(),
});

export const adminWorkspaceMemberProjectionSchema = z.strictObject({
  schema_version: z.literal("admin-workspace-member-projection@1.0.0"),
  workspace_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  email: z.email().max(320),
  display_name: z.string().min(1).max(128),
  system_role: systemRoleSchema,
  user_status: appUserStatusSchema,
  role: workspaceRoleSchema,
  source: z.enum(["EXPLICIT", "SYSTEM_ROLE", "LEGACY"]),
  membership_version: z.number().int().min(1),
  revoked_at: timestampSchema.nullable(),
});

export const operationsHealthGateSchema = z.strictObject({
  key: z.enum([
    "IDENTITY_SIDE_EFFECTS",
    "PRICING_SYNC",
    "PRICING_REVIEW",
    "BILLING_REVIEW",
    "BALANCE_INTEGRITY",
    "SHADOW_RECONCILIATION",
  ]),
  status: z.enum(["PASS", "WARNING", "BLOCKED"]),
  count: z.number().int().min(0),
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  last_observed_at: timestampSchema.nullable(),
});

export const operationsHealthProjectionSchema = z.strictObject({
  schema_version: z.literal("operations-health@1.0.0"),
  generated_at: timestampSchema,
  billing_mode: z.enum(["SHADOW", "ENFORCED"]),
  billing_epoch: z.number().int().min(1),
  gates: z.array(operationsHealthGateSchema).length(6),
});

export const createAdminUserInputSchema = z.strictObject({
  schema_version: z.literal("admin-user-create@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  email: z.email().max(320),
  display_name: z.string().trim().min(1).max(128),
  system_role: systemRoleSchema,
});

export const adminUserActionInputSchema = z.strictObject({
  schema_version: z.literal("admin-user-action@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  principal_id: immutableIdSchema,
  expected_version: z.number().int().min(1),
  action: z.enum(["DISABLE", "ENABLE", "RESET_PASSWORD"]),
  reason: z.string().trim().min(1).max(500),
});

export const createAdminWorkspaceInputSchema = z.strictObject({
  schema_version: z.literal("admin-workspace-create@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  workspace_id: immutableIdSchema,
  slug: adminWorkspaceProjectionSchema.shape.slug,
  display_name: adminWorkspaceProjectionSchema.shape.display_name,
});

export const adminWorkspaceActionInputSchema = z.strictObject({
  schema_version: z.literal("admin-workspace-action@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  workspace_id: immutableIdSchema,
  expected_version: z.number().int().min(1),
  action: z.enum(["ARCHIVE", "RESTORE"]),
  reason: z.string().trim().min(1).max(500),
});

const workspaceMemberActionBaseSchema = z.strictObject({
  schema_version: z.literal("workspace-member-action@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  principal_id: immutableIdSchema,
});

export const workspaceMemberActionInputSchema = z.discriminatedUnion("action", [
  workspaceMemberActionBaseSchema.extend({
    action: z.literal("UPSERT"),
    role: workspaceRoleSchema,
  }),
  workspaceMemberActionBaseSchema.extend({
    action: z.literal("REVOKE"),
    reason: z.string().trim().min(1).max(500),
  }),
]);

export type AdminUserProjection = z.infer<typeof adminUserProjectionSchema>;
export type AdminWorkspaceProjection = z.infer<typeof adminWorkspaceProjectionSchema>;
export type AdminWorkspaceMemberProjection = z.infer<typeof adminWorkspaceMemberProjectionSchema>;
export type OperationsHealthGate = z.infer<typeof operationsHealthGateSchema>;
export type OperationsHealthProjection = z.infer<typeof operationsHealthProjectionSchema>;
export type CreateAdminUserInput = z.infer<typeof createAdminUserInputSchema>;
export type AdminUserActionInput = z.infer<typeof adminUserActionInputSchema>;
export type CreateAdminWorkspaceInput = z.infer<typeof createAdminWorkspaceInputSchema>;
export type AdminWorkspaceActionInput = z.infer<typeof adminWorkspaceActionInputSchema>;
export type WorkspaceMemberActionInput = z.infer<typeof workspaceMemberActionInputSchema>;
