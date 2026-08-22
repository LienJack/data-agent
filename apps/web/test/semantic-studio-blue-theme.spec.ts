import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studioFiles = [
  "context-preview-workbench.tsx",
  "context-preview.tsx",
  "direct-semantic-editor.tsx",
  "semantic-agent-composer.tsx",
  "semantic-graph-canvas.tsx",
  "semantic-inspector.tsx",
  "semantic-node-list.tsx",
  "semantic-studio.tsx",
] as const;

const studioSource = studioFiles
  .map((file) =>
    readFileSync(new URL(`../src/components/semantic/studio/${file}`, import.meta.url), "utf8"),
  )
  .join("\n");

describe("Semantic Studio Apple blue theme", () => {
  it("removes the former green visual authority without changing status colors", () => {
    expect(studioSource).not.toMatch(
      /#(?:356b5a|285b4b|315f50|2f6b58|507d70|244f43|d7ddd9|f8faf8|f3f5f3|f7f9f7)/i,
    );
    expect(studioSource).toContain("var(--color-accent)");
    expect(studioSource).toContain("bg-amber-100");
    expect(studioSource).toContain("border-sky-200");
  });

  it("uses shared floating, reading, control and selection materials", () => {
    expect(studioSource).toContain("surface-floating-strong");
    expect(studioSource).toContain("surface-reading");
    expect(studioSource).toContain("control-pressable");
    expect(studioSource).toContain("rounded-[var(--radius-panel)]");
    expect(studioSource).toContain("#3f63e8");
  });
});
