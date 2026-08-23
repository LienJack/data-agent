import { describe, expect, it } from "vitest";
import {
  computeTrustedInputTokenUpperBound,
  computeTrustedInputTokenUpperBoundForRequestMessages,
} from "../../src/providers/trusted-input-token-upper-bound.js";

describe("trusted Provider input token upper bound", () => {
  it("uses the deterministic UTF-8 byte bound rather than a chars/4 estimate", () => {
    const input = {
      instructions: "仅处理已授权请求。",
      messages: [{ role: "user", content: "查询华南区净收入" }],
      tool_names: [],
      response_schema_version: "qa-answer@1.0.0",
      canonical_schema_bytes: 8_192,
    } as const;

    const first = computeTrustedInputTokenUpperBound(input);
    const replay = computeTrustedInputTokenUpperBound(input);

    expect(first).toBe(replay);
    expect(first).toBeGreaterThan(Buffer.byteLength(input.messages[0].content, "utf8"));
    expect(first).toBeGreaterThan(input.messages[0].content.length / 4);
    expect(first).toBeGreaterThan(8_192);
  });

  it("counts a request system instruction exactly once, matching runtime projection", () => {
    const systemInstruction = "You are the governed Root Agent.";
    const userMessage = { role: "user" as const, content: "一共有多少张表" };
    const common = {
      tool_names: ["delegate_to_subagent@1"],
      response_schema_version: "root-agent-final-answer@1.0.0",
      canonical_schema_bytes: 2_048,
    } as const;

    const requestBound = computeTrustedInputTokenUpperBoundForRequestMessages({
      messages: [{ role: "system", content: systemInstruction }, userMessage],
      ...common,
    });
    const runtimeProjectedBound = computeTrustedInputTokenUpperBound({
      instructions: systemInstruction,
      messages: [userMessage],
      ...common,
    });

    expect(requestBound).toBe(runtimeProjectedBound);
  });
});
