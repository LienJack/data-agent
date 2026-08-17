import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
const workspaceAnalysisPageSource = readFileSync(
  new URL("../src/app/w/[workspaceId]/analysis/page.tsx", import.meta.url),
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

  it("maps workspace analysis to the attribution workbench instead of QA", () => {
    expect(workspaceAnalysisPageSource).toContain('from "../../../page"');
    expect(workspaceAnalysisPageSource).not.toContain('from "../../../qa/page"');
  });
});
