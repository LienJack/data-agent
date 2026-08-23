import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceSession } from "@/lib/workspace-identity";

const deploymentId = "00000000-0000-4000-8000-00000000de01";
const authUserId = "00000000-0000-4000-8000-00000000a001";
const principalId = "00000000-0000-4000-8000-000000001001";

describe("workspace session principal resolver", () => {
  it("maps Better Auth user id through the server-side PostgreSQL authority", async () => {
    const result = await resolveWorkspaceSession(new Headers({ cookie: "session=opaque" }), {
      deploymentId,
      async getAuthSession() {
        return {
          session: { id: "session-1", expiresAt: new Date("2026-08-15T00:00:00.000Z") },
          user: { id: authUserId, role: "admin" },
        };
      },
      async resolvePrincipal(input) {
        expect(input).toEqual({ deployment_id: deploymentId, auth_user_id: authUserId });
        return {
          ok: true,
          value: {
            app_id: "00000000-0000-4000-8000-00000000da01",
            environment: "test",
            principal_id: principalId,
            auth_user_id: authUserId,
            system_role: "SUPER_ADMIN",
            authz_epoch: "3",
          },
        };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        principal_id: principalId,
        auth_user_id: authUserId,
        system_role: "SUPER_ADMIN",
        authz_epoch: 3,
      },
    });
  });

  it("fails closed without a session and ignores caller role claims", async () => {
    const missing = await resolveWorkspaceSession(new Headers(), {
      deploymentId,
      async getAuthSession() {
        return null;
      },
      async resolvePrincipal() {
        throw new Error("must not resolve");
      },
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "AUTH_SESSION_REQUIRED" } });

    const forged = await resolveWorkspaceSession(new Headers(), {
      deploymentId,
      async getAuthSession() {
        return {
          session: { id: "session-1", expiresAt: new Date("2026-08-15T00:00:00.000Z") },
          user: { id: authUserId, role: "SUPER_ADMIN", principal_id: "forged" },
        };
      },
      async resolvePrincipal() {
        return {
          ok: true,
          value: {
            app_id: "00000000-0000-4000-8000-00000000da01",
            environment: "test",
            principal_id: principalId,
            auth_user_id: authUserId,
            system_role: "USER",
            authz_epoch: "1",
          },
        };
      },
    });
    expect(forged).toMatchObject({
      ok: true,
      value: { principal_id: principalId, system_role: "USER" },
    });
  });
});
