import { describe, expect, it } from "vitest";
import { computeTrustedInputTokenUpperBound } from "../../src/providers/trusted-input-token-upper-bound.js";

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
});
