import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const connectionList = source("../src/components/data-sources/connection-list.tsx");
const connectionForm = source("../src/components/data-sources/connection-form.tsx");
const settingsTabs = source("../src/components/settings/platform-settings-tabs.tsx");
const members = source("../src/components/workspaces/workspace-members-panel.tsx");
const designSystem = source("../src/app/design-system.css");
const login = source("../src/app/login/page.tsx");
const layout = source("../src/app/layout.tsx");

describe("Apple blue operations and administration surfaces", () => {
  it("keeps configured connections in a scannable operational directory", () => {
    expect(connectionList).toContain('aria-label="已配置的数据源连接"');
    expect(connectionList).toContain("连接目录");
    expect(connectionList).not.toContain("xl:grid-cols-3");
    expect(connectionList).toContain("surface-reading");
  });

  it("treats new connections as contextual configuration", () => {
    expect(connectionForm).toContain("New connection");
    expect(connectionForm).toContain("surface-reading");
    expect(connectionForm).toContain("Secret Provider");
    expect(connectionForm).not.toContain("bg-green-900/20");
  });

  it("uses a desktop settings rail and shared member directory materials", () => {
    expect(settingsTabs).toContain("lg:grid-cols-[220px_minmax(0,1fr)]");
    expect(settingsTabs).toContain("lg:flex-col");
    expect(members).toContain("surface-reading");
    expect(members).toContain("skeleton-shimmer");
    expect(members).not.toContain("animate-pulse");
  });

  it("keeps the product on a white and blue appearance", () => {
    expect(designSystem).not.toContain(':root[data-theme="dark"]');
    expect(designSystem).not.toContain("@media (prefers-color-scheme: dark)");
    expect(layout).not.toContain("data-agent-theme");
    expect(login).toContain("bg-[#eef3ff]");
    expect(login).not.toContain("bg-[#0b1437]");
    expect(login).toContain("bg-[var(--color-bg-canvas)]");
    expect(login).toContain("bg-[var(--color-bg-primary)]");
  });
});
