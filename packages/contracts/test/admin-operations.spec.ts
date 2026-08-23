import { describe, expect, it } from "vitest";
import {
  adminUserActionInputSchema,
  adminUserProjectionSchema,
  operationsHealthProjectionSchema,
  workspaceMemberActionInputSchema,
} from "../src/index.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("admin operations contracts", () => {
  it("strictly decodes the global user projection", () => {
    const user = {
      schema_version: "admin-user-projection@1.0.0",
      principal_id: id,
      auth_user_id: id,
      username: "admin",
      email: "admin@example.test",
      display_name: "Admin",
      system_role: "SUPER_ADMIN",
      status: "ACTIVE",
      authz_epoch: 2,
      active_memberships: 3,
      created_at: "2026-08-14T00:00:00.000Z",
      disabled_at: null,
    } as const;
    expect(adminUserProjectionSchema.parse(user)).toEqual(user);
    expect(adminUserProjectionSchema.safeParse({ ...user, password_hash: "secret" }).success).toBe(
      false,
    );
  });

  it("requires optimistic versions for account lifecycle actions", () => {
    expect(
      adminUserActionInputSchema.safeParse({
        schema_version: "admin-user-action@1.0.0",
        operation_id: id,
        idempotency_key: "disable-user:1",
        principal_id: id,
        action: "DISABLE",
        reason: "offboarding",
      }).success,
    ).toBe(false);
  });

  it("requires a role for upsert and a reason for revoke at the service boundary", () => {
    const base = {
      schema_version: "workspace-member-action@1.0.0",
      operation_id: id,
      idempotency_key: "member-action:1",
      principal_id: id,
    } as const;
    const upsert = workspaceMemberActionInputSchema.parse({
      ...base,
      action: "UPSERT",
      role: "ANALYST",
    });
    expect(upsert).toMatchObject({ action: "UPSERT", role: "ANALYST" });
    expect(
      workspaceMemberActionInputSchema.parse({ ...base, action: "REVOKE", reason: "left" }),
    ).toBeDefined();
    expect(workspaceMemberActionInputSchema.safeParse({ ...base, action: "UPSERT" }).success).toBe(
      false,
    );
    expect(workspaceMemberActionInputSchema.safeParse({ ...base, action: "REVOKE" }).success).toBe(
      false,
    );
  });

  it("keeps the identity side-effect gate strict", () => {
    const at = "2026-08-14T00:00:00.000Z";
    const health = operationsHealthProjectionSchema.parse({
      schema_version: "operations-health@1.0.0",
      generated_at: at,
      gates: [
        {
          key: "IDENTITY_SIDE_EFFECTS",
          status: "PASS",
          count: 0,
          reason_code: "IDENTITY_SIDE_EFFECTS_CLEAR",
          last_observed_at: null,
        },
      ],
    });
    expect(health.gates).toHaveLength(1);
    expect(
      operationsHealthProjectionSchema.safeParse({ ...health, billing_mode: "SHADOW" }).success,
    ).toBe(false);
  });
});
