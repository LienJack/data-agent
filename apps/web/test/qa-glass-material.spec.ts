import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("../src/app/design-system.css");
const chromeSources = [
  "../src/app/qa/page.tsx",
  "../src/components/layout/workspace-shell.tsx",
  "../src/components/layout/sidebar.tsx",
  "../src/components/layout/workspace-topbar.tsx",
  "../src/components/layout/mobile-workspace-nav.tsx",
  "../src/components/qa/chat-input.tsx",
  "../src/components/qa/qa-inspector.tsx",
  "../src/components/qa/conversation-directory.tsx",
  "../src/components/qa/conversation-activity-stream.tsx",
].map(source);

describe("Q&A Apple glass material contract", () => {
  it("owns the six required material tokens and four semantic surfaces", () => {
    for (const token of [
      "--glass-fill",
      "--glass-fill-strong",
      "--glass-border-inner",
      "--glass-shadow-tint",
      "--glass-blur",
      "--glass-saturate",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    for (const className of [
      ".glass-surface",
      ".glass-surface-strong",
      ".glass-overlay",
      ".reading-surface",
    ]) {
      expect(css).toContain(className);
    }
    expect(css).toContain("backdrop-filter: blur(var(--glass-blur))");
    expect(css).toContain("inset 0 1px 0 var(--glass-border-inner)");
  });

  it("has deterministic opaque, reduced-transparency, reduced-motion, and print fallbacks", () => {
    expect(css).toContain("@supports not ((backdrop-filter: blur(1px))");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media print");
    expect(css).toMatch(
      /\.qa-running-pulse::after,[\s\S]*\.skeleton-shimmer::after[\s\S]*animation: none/,
    );
  });

  it("maps chrome to semantic classes without scattered blur or saturate utilities", () => {
    const joined = chromeSources.join("\n");
    expect(joined).toContain("glass-surface");
    expect(joined).toContain("glass-surface-strong");
    expect(joined).toContain("glass-overlay");
    expect(joined).toContain("reading-surface");
    expect(joined).not.toMatch(/backdrop-blur(?:-|\[)/);
    expect(joined).not.toMatch(/backdrop-saturate(?:-|\[)/);
  });

  it("keeps the composer in its grid row and the Inspector on the concession class", () => {
    const page = chromeSources[0] ?? "";
    const inspector = chromeSources[6] ?? "";
    expect(page).toContain('className="col-start-1 row-start-3"');
    expect(page).not.toContain("fixed bottom-0");
    expect(inspector).toContain("qa-inspector glass-surface-strong");
  });
});
