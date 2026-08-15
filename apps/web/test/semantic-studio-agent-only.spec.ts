import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const physicalSchemaBrowserSource = readFileSync(
  new URL("../src/components/semantic/physical-schema-browser.tsx", import.meta.url),
  "utf8",
);
const semanticStudioApiSource = readFileSync(
  new URL("../src/lib/semantic-studio-api.ts", import.meta.url),
  "utf8",
);

describe("Semantic Studio Agent-only authoring boundary", () => {
  it("keeps physical evidence read-only and removes operation JSON mutation controls", () => {
    expect(physicalSchemaBrowserSource).not.toContain("operationDrafts");
    expect(physicalSchemaBrowserSource).not.toContain("JSON.parse(");
    expect(physicalSchemaBrowserSource).not.toContain("edited_operations");
    expect(physicalSchemaBrowserSource).toContain("交给 Agent 建模");
    expect(physicalSchemaBrowserSource).toContain(
      'workspacePath(resolveWorkspaceId(), "semantic")',
    );
  });

  it("strictly parses authoring SSE payloads and closes terminal streams", () => {
    expect(semanticStudioApiSource).toContain("semanticStudioStartResultSchema.parse(");
    expect(semanticStudioApiSource).toContain('result.state.run.status !== "RUNNING"');
    expect(semanticStudioApiSource).toContain("source.close();");
  });
});
