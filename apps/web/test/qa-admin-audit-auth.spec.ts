import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authorize = vi.hoisted(() => vi.fn());

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: authorize,
  workspaceErrorResponse: (error: { readonly code: string }) =>
    Response.json({ error }, { status: 401 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getQaAdminAuditRepository: () => ({ readDirectory: vi.fn() }),
}));

let authorizeQaAdminAuditRequest: typeof import("../src/lib/qa-admin-audit").authorizeQaAdminAuditRequest;
let issueQaAdminCursor: typeof import("../src/lib/qa-admin-audit").issueQaAdminCursor;
let verifyQaAdminCursor: typeof import("../src/lib/qa-admin-audit").verifyQaAdminCursor;

beforeAll(async () => {
  ({ authorizeQaAdminAuditRequest, issueQaAdminCursor, verifyQaAdminCursor } = await import(
    "../src/lib/qa-admin-audit"
  ));
});

beforeEach(() => vi.clearAllMocks());

describe("Q&A admin audit authorization", () => {
  it("admits only an OWNER capability", async () => {
    authorize.mockResolvedValue({
      ok: true,
      value: {
        session: { principal_id: "20000000-0000-4000-8000-000000000001" },
        capability: { role: "OWNER" },
      },
    });
    const result = await authorizeQaAdminAuditRequest(
      new NextRequest("http://localhost"),
      "20000000-0000-4000-8000-000000000002",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects analyst and viewer capabilities without returning the repository", async () => {
    authorize.mockResolvedValue({
      ok: true,
      value: {
        session: { principal_id: "20000000-0000-4000-8000-000000000001" },
        capability: { role: "ANALYST" },
      },
    });
    const result = await authorizeQaAdminAuditRequest(
      new NextRequest("http://localhost"),
      "20000000-0000-4000-8000-000000000002",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "QA_ADMIN_ACCESS_DENIED" },
      });
    }
  });
});

describe("Q&A admin cursor", () => {
  it("binds an opaque cursor to the actor, scope and filters", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-secret-with-at-least-32-characters");
    const cursor = issueQaAdminCursor("actor:a|workspace:w|filter:active", "25", 1_000);
    expect(verifyQaAdminCursor(cursor, "actor:a|workspace:w|filter:active", 1_001)).toBe("25");
    expect(verifyQaAdminCursor(cursor, "actor:b|workspace:w|filter:active", 1_001)).toBeNull();
    expect(
      verifyQaAdminCursor(`${cursor}tampered`, "actor:a|workspace:w|filter:active", 1_001),
    ).toBeNull();
    expect(verifyQaAdminCursor(cursor, "actor:a|workspace:w|filter:active", 901_001)).toBeNull();
    vi.unstubAllEnvs();
  });
});
