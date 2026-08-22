import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginSource = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const pickerSource = readFileSync(
  new URL("../src/app/workspaces/page.tsx", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(
  new URL("../src/components/workspaces/workspace-home.tsx", import.meta.url),
  "utf8",
);
const journeySource = readFileSync(
  new URL("../src/components/workspaces/greenfield-journey-panel.tsx", import.meta.url),
  "utf8",
);

describe("Apple blue entry and workspace surfaces", () => {
  it("uses a governed dark identity field and accessible login states", () => {
    expect(loginSource).toContain("bg-[#0b1437]");
    expect(loginSource).toContain('role="alert"');
    expect(loginSource).toContain('autoComplete="current-password"');
    expect(loginSource).toContain("disabled:cursor-wait");
  });

  it("renders workspaces as a scannable list instead of a generic card grid", () => {
    expect(pickerSource).toContain("divide-y divide-[var(--color-border-default)]");
    expect(pickerSource).toContain('aria-label="可访问的工作空间"');
    expect(pickerSource).not.toContain("md:grid-cols-2");
    expect(pickerSource).toContain("redirect(`/w/");
    expect(pickerSource).toContain("workspaces.value[0]?.workspace.workspace_id");
  });

  it("keeps real role navigation prominent and journey detail progressive", () => {
    expect(homeSource).toContain("WorkspaceNavIcon");
    expect(homeSource).toContain('aria-label={t("workspace.roleNavigation")}');
    expect(homeSource).toContain("primaryAction.href");
    expect(journeySource).toContain("<details");
    expect(journeySource).toContain('aria-current={active ? "step" : undefined}');
  });
});
