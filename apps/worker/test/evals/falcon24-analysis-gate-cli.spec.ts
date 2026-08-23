import { describe, expect, it } from "vitest";
import { classifyFalcon24AnalysisGateFailure } from "../../src/evals/falcon24-analysis-gate-cli.js";

describe("Falcon24 analysis gate CLI", () => {
  it("projects safe reason codes without leaking paths or database diagnostics", () => {
    expect(
      classifyFalcon24AnalysisGateFailure(
        Object.assign(new Error("no file at /private/workspace/actual-runs.json"), {
          code: "ENOENT",
        }),
      ),
    ).toBe("FALCON24_ANALYSIS_RUNS_MISSING");
    expect(
      classifyFalcon24AnalysisGateFailure(
        new Error("connection failed for postgresql://secret@localhost/database"),
      ),
    ).toBe("FALCON24_ANALYSIS_GATE_FAILED");
    expect(classifyFalcon24AnalysisGateFailure(new Error("FALCON24_DATABASE_URL_MISSING"))).toBe(
      "FALCON24_DATABASE_URL_MISSING",
    );
  });
});
