import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn(), username: vi.fn() },
  },
}));

import LoginPage from "@/app/login/page";

describe("login password policy", () => {
  it("does not impose a character-count limit in the login form", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    const passwordInput = html.match(/<input[^>]*name="password"[^>]*>/)?.[0].toLowerCase();

    expect(passwordInput).toBeDefined();
    expect(passwordInput).not.toContain("minlength");
    expect(passwordInput).not.toContain("maxlength");
  });
});
