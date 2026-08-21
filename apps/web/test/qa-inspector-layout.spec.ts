import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeInspectorColumns, computeQAShellHeight } from "@/lib/qa-inspector-layout";

const css = readFileSync(new URL("../src/app/design-system.css", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/qa/qa-inspector.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../src/app/qa/page.tsx", import.meta.url), "utf8");

describe("QA Inspector concession layout", () => {
  it("shows a full-width content sheet at 390px", () => {
    expect(css).toMatch(
      /\.qa-inspector\s*\{[\s\S]*display:\s*flex;[\s\S]*width:\s*100%\s*!important;/,
    );
    expect(css).toContain("grid-row: 2");
    expect(css).toMatch(/\.qa-page-frame[\s\S]*grid-template-rows:\s*44px minmax\(0, 1fr\) auto/);
  });

  it("auto-hides at 800px to protect the center answer", () => {
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 959px\)[\s\S]*\.qa-inspector\s*\{[\s\S]*display:\s*none;/,
    );
  });

  it("is visible and resizable at 1440px without conflicting Tailwind display classes", () => {
    expect(css).toMatch(
      /@media \(min-width: 960px\)[\s\S]*\.qa-inspector\s*\{[\s\S]*display:\s*flex;[\s\S]*width:\s*var\(--qa-inspector-width\)/,
    );
    expect(component).not.toMatch(/md:hidden|min-\[960px\]:flex/);
    expect(component).toContain("<hr");
    expect(component).toContain('aria-orientation="vertical"');
  });

  it("uses the Harness concession chain for actual container width", () => {
    expect(computeInspectorColumns(1280, 360, true)).toEqual({ center: 920, details: 360 });
    expect(computeInspectorColumns(1000, 360, true)).toEqual({ center: 640, details: 360 });
    expect(computeInspectorColumns(959, 360, true)).toEqual({ center: 959, details: 0 });
    expect(computeInspectorColumns(900, 520, false)).toEqual({ center: 900, details: 0 });
  });

  it("bounds the page and Inspector to the visible workspace shell", () => {
    expect(computeQAShellHeight(1000, false)).toBe(948);
    expect(computeQAShellHeight(844, true)).toBe(728);
    expect(css).toMatch(
      /\.qa-page-frame\s*\{[\s\S]*height:\s*calc\(100dvh - 52px - 64px\);[\s\S]*overflow:\s*hidden;/,
    );
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*\.qa-page-frame\s*\{[\s\S]*height:\s*calc\(100dvh - 52px\);/,
    );
    expect(page).not.toContain('className="qa-page-frame h-full');
    expect(page).toContain("row-start-2 min-h-0 overflow-hidden");
  });
});
