import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const semanticStudioApiSource = readFileSync(
  new URL("../src/lib/semantic-studio-api.ts", import.meta.url),
  "utf8",
);

describe("Semantic Studio Agent-only authoring boundary", () => {
  it("removes the legacy physical-schema editor entry instead of retaining an adapter", () => {
    expect(
      existsSync(
        new URL("../src/components/semantic/physical-schema-browser.tsx", import.meta.url),
      ),
    ).toBe(false);
    expect(
      existsSync(new URL("../src/app/semantic/physical-schema/page.tsx", import.meta.url)),
    ).toBe(false);
  });

  it("strictly parses authoring SSE payloads and closes terminal streams", () => {
    expect(semanticStudioApiSource).toContain("semanticStudioStartResultSchema.parse(");
    expect(semanticStudioApiSource).toContain("semanticAuthoringRunSchema");
    expect(semanticStudioApiSource).toContain("semanticAuthoringStateSchema.parse(");
    expect(semanticStudioApiSource).toContain('result.state.run.status !== "RUNNING"');
    expect(semanticStudioApiSource).toContain("source.close();");
  });
});
