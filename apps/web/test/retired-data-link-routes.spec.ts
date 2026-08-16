import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => navigation);

import retiredGlobalEditorDetailPage from "../src/app/data-link/editor/[id]/page";
import retiredGlobalEditorPage from "../src/app/data-link/editor/page";
import retiredGlobalModelDetailPage from "../src/app/data-link/models/[id]/page";
import retiredGlobalDataLinkPage from "../src/app/data-link/page";
import retiredEditorDetailPage from "../src/app/w/[workspaceId]/data-link/editor/[id]/page";
import retiredEditorPage from "../src/app/w/[workspaceId]/data-link/editor/page";
import retiredModelDetailPage from "../src/app/w/[workspaceId]/data-link/models/[id]/page";
import retiredDataLinkPage from "../src/app/w/[workspaceId]/data-link/page";

const workspaceId = "9e0ed5ae-7ab6-4896-b7eb-868e202f3725";

beforeEach(() => {
  navigation.redirect.mockClear();
});

describe("retired Data Link semantic routes", () => {
  it.each([
    retiredDataLinkPage,
    retiredEditorPage,
    retiredEditorDetailPage,
    retiredModelDetailPage,
  ])("redirects the old workspace entry to the unified ontology studio", async (page) => {
    await expect(page({ params: Promise.resolve({ workspaceId }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirect).toHaveBeenCalledWith(`/w/${workspaceId}/semantic`);
  });

  it.each([
    retiredGlobalDataLinkPage,
    retiredGlobalEditorPage,
    retiredGlobalEditorDetailPage,
    retiredGlobalModelDetailPage,
  ])("keeps unscoped legacy URLs outside any inferred workspace", (page) => {
    expect(() => page()).toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenCalledWith("/workspaces");
  });

  it("documents the old adapter as retired and removes its navigation entry", () => {
    const deprecationNotice = readFileSync(
      new URL("../src/components/data-link/DEPRECATED.md", import.meta.url),
      "utf8",
    );
    const navigationSource = readFileSync(
      new URL("../src/lib/workspace-navigation.ts", import.meta.url),
      "utf8",
    );

    expect(deprecationNotice).toContain("Data Link 语义视图已退役");
    expect(deprecationNotice).toContain("不得从新页面导入");
    expect(deprecationNotice).toContain("不得停用 `/api/semantic/*`");
    expect(navigationSource).not.toContain('label: "数据语义"');
  });
});
