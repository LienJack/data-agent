import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
const workspaceAnalysisPageSource = readFileSync(
  new URL("../src/app/w/[workspaceId]/analysis/page.tsx", import.meta.url),
  "utf8",
);
const rootPageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const workspaceSemanticPageSource = readFileSync(
  new URL("../src/app/w/[workspaceId]/semantic/page.tsx", import.meta.url),
  "utf8",
);
const modelProviderRouteSource = readFileSync(
  new URL("../src/app/api/admin/model-providers/route.ts", import.meta.url),
  "utf8",
);

describe("legacy workspace routes", () => {
  it("redirects every legacy business entry to explicit workspace selection", () => {
    for (const source of [
      "/",
      "/qa",
      "/tests",
      "/data-sources",
      "/data-link/:path*",
      "/semantic/:path*",
      "/settings",
    ]) {
      expect(nextConfigSource).toContain(
        `{ source: "${source}", destination: "/workspaces", permanent: false }`,
      );
    }
  });

  it("does not recover workspace identity from browser storage", () => {
    expect(apiClientSource).not.toContain("sessionStorage");
    expect(apiClientSource).toContain("workspaceIdFromPathname(window.location.pathname)");
  });

  it("authorizes the legacy analysis route before redirecting to workspace QA", () => {
    expect(workspaceAnalysisPageSource).toContain("getCurrentWorkspaceSession");
    expect(workspaceAnalysisPageSource).toContain("listSessionWorkspaces");
    expect(workspaceAnalysisPageSource).toContain("resolveSessionWorkspaceCapability");
    expect(workspaceAnalysisPageSource).toContain(
      'allowed_actions.includes("ANALYSIS_RUN_CREATE")',
    );
    expect(workspaceAnalysisPageSource).toContain('redirect(workspacePath(workspaceId, "qa"))');
    expect(workspaceAnalysisPageSource).not.toContain('from "../../../page"');

    const authorizationIndex = workspaceAnalysisPageSource.indexOf("getCurrentWorkspaceSession()");
    const redirectIndex = workspaceAnalysisPageSource.indexOf(
      'redirect(workspacePath(workspaceId, "qa"))',
    );
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(redirectIndex).toBeGreaterThan(authorizationIndex);
  });

  it("keeps the root page from becoming a legacy workbench fallback", () => {
    expect(rootPageSource).toContain('redirect("/workspaces")');
    expect(rootPageSource).not.toContain("submitBoundAnalysisRun");
    expect(rootPageSource).not.toContain("AnalysisReportDocument");
  });

  it("characterizes the active Workspace Semantic and Model Provider paths", () => {
    expect(workspaceSemanticPageSource).toContain("<SemanticStudio");
    expect(workspaceSemanticPageSource).toContain("workspaceId={workspaceId}");
    expect(workspaceSemanticPageSource).not.toContain("redirect(");
    expect(modelProviderRouteSource).toContain("composeModelProviderViews");
    expect(modelProviderRouteSource).toContain("applyProviderConnectionCommand");
    expect(modelProviderRouteSource).not.toContain("api_key:");
  });
});
