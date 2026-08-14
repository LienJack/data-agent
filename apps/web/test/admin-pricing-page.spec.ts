import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/workspace-identity", () => ({
  getCurrentWorkspaceSession: mocks.session,
}));
vi.mock("@/components/settings/pricing-control-panel", () => ({
  PricingControlPanel: () => null,
}));

let PricingAdminPage: typeof import("../src/app/admin/pricing/page").default;

beforeAll(async () => {
  ({ default: PricingAdminPage } = await import("../src/app/admin/pricing/page"));
});

beforeEach(() => {
  mocks.session.mockReset();
  mocks.notFound.mockClear();
  mocks.redirect.mockClear();
});

describe("pricing admin page boundary", () => {
  it("does not render the control plane for a non-super-admin direct URL", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { system_role: "USER" },
    });

    await expect(PricingAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("redirects an unauthenticated direct URL to login", async () => {
    mocks.session.mockResolvedValue({
      ok: false,
      error: { code: "AUTH_SESSION_REQUIRED", message: "请登录。", retryable: false },
    });

    await expect(PricingAdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("renders only after a fresh super-admin session check", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { system_role: "SUPER_ADMIN" },
    });

    const page = await PricingAdminPage();
    expect(page.type).toBe("main");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
