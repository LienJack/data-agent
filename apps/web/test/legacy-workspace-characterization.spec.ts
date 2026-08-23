import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("workspace-scoped business authority", () => {
  it("retires unscoped datasource and conversation routes", async () => {
    const datasourceRoute = await import("../src/app/api/datasources/route");
    const conversationRoute = await import("../src/app/api/qa/conversations/route");

    for (const response of [
      datasourceRoute.GET(),
      datasourceRoute.POST(),
      conversationRoute.GET(),
      conversationRoute.POST(),
    ]) {
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "WORKSPACE_ROUTE_REQUIRED" },
      });
    }
  });

  it("contains no process-global Map authority, default workspace, or client-forged role", () => {
    const paths = [
      "../src/lib/api-client.ts",
      "../src/lib/qa-store.ts",
      "../src/app/api/workspaces/[workspaceId]/datasources/route.ts",
      "../../../packages/platform/src/persistence/workspace-data-repository.ts",
    ];
    const source = paths
      .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/workspaceId\s*=\s*["']default["']/);
    expect(source).not.toMatch(/NEXT_PUBLIC_DEV_USER_(?:ID|ROLE)/);
    expect(source).not.toMatch(/new Map\s*</);
    expect(source).not.toMatch(/__qaConversations|__datasourceCredentialRefConnections/);
  });

  it("keeps audited management actions inside the product interface", () => {
    const paths = [
      "../src/components/settings/operations-admin-panel.tsx",
      "../src/components/workspaces/workspace-members-panel.tsx",
    ];

    for (const path of paths) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
      expect(source).not.toMatch(/window\.(?:prompt|confirm|alert)\s*\(/);
      expect(source).toContain("<ReasonDialog");
    }
  });
});
