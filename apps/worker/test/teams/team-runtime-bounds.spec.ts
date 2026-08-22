import { describe, expect, it } from "vitest";
import { deriveTeamRuntimeTaskBounds } from "../../src/teams/team-runtime-bounds.js";

describe("team runtime bounds", () => {
  it("uses one bounded parent ceiling for Root admission and persisted team tasks", () => {
    expect(
      deriveTeamRuntimeTaskBounds({
        execution_safety_policy: { max_elapsed_ms: 900_000, max_tool_calls: 100 },
        context_policy: { max_context_tokens: 100_000 },
      }),
    ).toEqual({
      max_context_bytes: 65_536,
      max_input_tokens: 32_768,
      max_output_tokens: 4_096,
      max_tool_calls: 32,
      timeout_ms: 600_000,
    });
  });

  it("preserves stricter effective-config limits", () => {
    expect(
      deriveTeamRuntimeTaskBounds({
        execution_safety_policy: { max_elapsed_ms: 30_000, max_tool_calls: 4 },
        context_policy: { max_context_tokens: 2_048 },
      }),
    ).toMatchObject({
      max_input_tokens: 2_048,
      max_tool_calls: 4,
      timeout_ms: 30_000,
    });
  });
});
