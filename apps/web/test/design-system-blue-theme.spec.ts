import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const designSystem = source("../src/app/design-system.css");
const globals = source("../src/app/globals.css");
const sidebar = source("../src/components/layout/sidebar.tsx");

describe("Data Agent Blue design system", () => {
  it("owns one accessible blue accent palette and compatibility aliases", () => {
    expect(designSystem).toContain("--color-accent: #3f63e8");
    expect(designSystem).toContain("--color-accent-hover: #315bd8");
    expect(designSystem).toContain("--color-accent-pressed: #2647a8");
    expect(designSystem).toContain("--color-accent-soft: #eef2ff");
    expect(designSystem).toContain("--color-info: var(--color-accent)");
    expect(globals).not.toMatch(/--color-accent:\s*#/);
  });

  it("provides the three material levels and deterministic accessibility fallbacks", () => {
    for (const className of [
      ".surface-reading",
      ".surface-floating",
      ".surface-floating-strong",
      ".surface-control",
    ]) {
      expect(designSystem).toContain(className);
    }
    expect(designSystem).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(designSystem).toContain("@media (prefers-reduced-motion: reduce)");
    expect(designSystem).toContain("@media (prefers-contrast: more)");
  });

  it("keeps typography and radius optical instead of globally flattening utilities", () => {
    expect(designSystem).toContain("letter-spacing: -0.035em");
    expect(designSystem).not.toContain('[class*="tracking-"]');
    expect(designSystem).not.toMatch(/\.rounded-xl,\s*\n\.rounded-2xl/);
    expect(designSystem).toContain("--radius-control: 10px");
    expect(designSystem).toContain("--radius-panel: 18px");
  });

  it("loads conversation history only while the Q&A contextual surface is active", () => {
    expect(sidebar).toContain("const isQaSurface");
    expect(sidebar).toContain("if (isQaSurface) void loadConversations()");
    expect(sidebar).toContain("!collapsed && qaItem && isQaSurface");
  });
});
