import { describe, expect, it } from "vitest";
import { MastraExecutionError } from "../src/mastra/errors.js";
import { modelProtocolDiagnostic } from "../src/mastra/protocol-diagnostic.js";

describe("raw-free model protocol diagnostic", () => {
  it("projects a stable stage and structural schema issues without values or unknown keys", () => {
    const diagnostic = modelProtocolDiagnostic(
      new MastraExecutionError(
        "MODEL_STREAM_PROTOCOL_VIOLATION",
        false,
        "secret prompt/response",
        "RESPONSE_SCHEMA_MISMATCH",
        [{ code: "invalid_type", path: ["sections", 0, "customer-secret"] }],
      ),
    );
    expect(diagnostic).toEqual({
      stage: "RESPONSE_SCHEMA_MISMATCH",
      issues: [{ code: "invalid_type", path: ["sections", 0, "$field"] }],
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|prompt|response/);
  });

  it("caps all dimensions and redacts unregistered issue codes and indexes", () => {
    const diagnostic = modelProtocolDiagnostic(
      new MastraExecutionError(
        "MODEL_STREAM_PROTOCOL_VIOLATION",
        false,
        "private",
        "INVALID_CHUNK",
        Array.from({ length: 20 }, () => ({
          code: "secret",
          path: ["usage", 999, ...Array(20).fill("private-field")],
        })),
      ),
    );
    expect(diagnostic?.issues).toHaveLength(8);
    expect(diagnostic?.issues[0]).toEqual({
      code: "unknown",
      path: ["usage", "$field", ...Array(10).fill("$field")],
    });
  });

  it("does not trust lookalike errors or unrelated failures", () => {
    expect(
      modelProtocolDiagnostic({
        code: "MODEL_STREAM_PROTOCOL_VIOLATION",
        protocol_stage: "INVALID_CHUNK",
      }),
    ).toBeNull();
    expect(
      modelProtocolDiagnostic(new MastraExecutionError("MODEL_PROVIDER_TIMEOUT", true, "private")),
    ).toBeNull();
  });

  it("does not echo a forged runtime stage", () => {
    const error = new MastraExecutionError("MODEL_STREAM_PROTOCOL_VIOLATION", false, "private");
    Object.defineProperty(error, "protocol_stage", { value: "SECRET" });
    expect(modelProtocolDiagnostic(error)).toEqual({ stage: "UNKNOWN", issues: [] });
  });

  it("cannot replace terminal failure when a diagnostic getter throws", () => {
    const error = new MastraExecutionError("MODEL_STREAM_PROTOCOL_VIOLATION", false, "private");
    Object.defineProperty(error, "protocol_issues", {
      get() {
        throw new Error("secret");
      },
    });
    expect(modelProtocolDiagnostic(error)).toEqual({ stage: "UNKNOWN", issues: [] });
  });
});
