import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "@/lib/layout-store";

describe("Workspace layout store", () => {
  beforeEach(() => useLayoutStore.setState({ sidebarCollapsed: false }));

  it("keeps layout-only sidebar state independent from workspace business state", () => {
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);

    useLayoutStore.getState().setSidebarCollapsed(false);
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
  });
});
