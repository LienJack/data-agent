import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const physicalSchemaBrowserSource = readFileSync(
  new URL("../src/components/semantic/physical-schema-browser.tsx", import.meta.url),
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
});
