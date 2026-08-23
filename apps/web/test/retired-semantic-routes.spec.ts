import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const navigationSource = readFileSync(
  new URL("../src/lib/workspace-navigation.ts", import.meta.url),
  "utf8",
);

const retiredEntries = [
  "../src/app/data-link/page.tsx",
  "../src/app/semantic/page.tsx",
  "../src/app/semantic/explorer/page.tsx",
  "../src/app/semantic/physical-schema/page.tsx",
  "../src/app/w/[workspaceId]/data-link/page.tsx",
  "../src/app/w/[workspaceId]/semantic/physical-schema/page.tsx",
  "../src/components/data-link/semantic-editor.tsx",
  "../src/lib/data-link-store.ts",
  "../src/lib/semantic-store.ts",
] as const;

describe("retired semantic V1 and Data Link surfaces", () => {
  it("removes legacy routes and stores so Next returns its default 404", () => {
    for (const entry of retiredEntries) {
      expect(existsSync(new URL(entry, import.meta.url)), entry).toBe(false);
    }
    expect(nextConfigSource).not.toContain('source: "/data-link/:path*"');
    expect(nextConfigSource).not.toContain('source: "/semantic/:path*"');
  });

  it("keeps Studio and Explorer as the only semantic navigation entries", () => {
    expect(navigationSource).not.toContain('label: "数据语义"');
    expect(navigationSource).not.toContain("data-link");
    expect(navigationSource).toContain('key: "semantic"');
    expect(navigationSource).toContain('key: "semantic-explorer"');
  });
});
