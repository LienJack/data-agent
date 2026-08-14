import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("Better Auth boundary", () => {
  it("removes impersonation from the only configured auth admin role", async () => {
    const { dataAgentAuthAdminRole } = await import("../src/lib/auth-config");
    expect(dataAgentAuthAdminRole.authorize({ user: ["create", "set-password", "ban"] })).toEqual({
      success: true,
    });
    expect(dataAgentAuthAdminRole.authorize({ user: ["impersonate"] })).toMatchObject({
      success: false,
    });
  });

  it("fails closed without a database URL and a strong secret", async () => {
    const originalDatabase = process.env.DATABASE_URL;
    const originalAuthDatabase = process.env.AUTH_DATABASE_URL;
    const originalSecret = process.env.BETTER_AUTH_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    try {
      const { getDataAgentAuth } = await import("../src/lib/auth");
      expect(() => getDataAgentAuth()).toThrowError(
        expect.objectContaining({ code: "AUTH_RUNTIME_NOT_CONFIGURED" }),
      );
    } finally {
      if (originalDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabase;
      if (originalAuthDatabase === undefined) delete process.env.AUTH_DATABASE_URL;
      else process.env.AUTH_DATABASE_URL = originalAuthDatabase;
      if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });
});

describe("public auth route", () => {
  it("rejects sign-up and all Better Auth admin endpoints before runtime initialization", async () => {
    const route = await import("../src/app/api/auth/[...all]/route");
    const signUp = await route.POST(
      new Request("http://localhost/api/auth/sign-up/email", { method: "POST" }),
    );
    expect(signUp.status).toBe(403);
    await expect(signUp.json()).resolves.toMatchObject({
      error: { code: "AUTH_SIGNUP_DISABLED" },
    });

    const impersonation = await route.POST(
      new Request("http://localhost/api/auth/admin/impersonate-user", { method: "POST" }),
    );
    expect(impersonation.status).toBe(404);
  });
});
