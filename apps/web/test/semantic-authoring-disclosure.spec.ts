import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicEventSummary } from "@/lib/semantic-studio-model";

describe("Semantic Agent public process disclosure", () => {
  it("summarizes only the public reasoning payload", () => {
    expect(
      publicEventSummary({
        schema_version: "semantic-authoring-public-event@1.0.0",
        event_id: "10000000-0000-4000-8000-000000000001",
        run_id: "10000000-0000-4000-8000-000000000002",
        sequence: 1,
        occurred_at: "2026-08-18T00:00:00.000Z",
        type: "stage",
        payload: {
          phase: "semantic-turn-1",
          summary: "Selected governed tools",
          status: "COMPLETED",
        },
      }),
    ).toBe("Selected governed tools");
  });

  it("renders reasoning and tool events as native collapsed disclosures", () => {
    const source = readFileSync(
      new URL("../src/components/semantic/authoring/semantic-authoring-trace.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('event.payload.phase.startsWith("semantic-turn-")');
    expect(source).toContain("<details>");
    expect(source).toContain("<summary");
    expect(source).not.toMatch(/reasoning_content|raw_context|system_prompt|secret_ref/i);
  });
});
