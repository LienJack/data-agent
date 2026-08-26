import { describe, expect, it } from "vitest";
import { classifyFalcon24RunFailureCode } from "../../src/evals/falcon24-acceptance-execution-policy.js";

describe("Falcon24 strict acceptance execution policy", () => {
  it("localizes every failure into the frozen ordered lifecycle", () => {
    expect(classifyFalcon24RunFailureCode("TEXT2SQL_QUERY_FAILED")).toBe("SQL_DATA_PREPARATION");
    expect(classifyFalcon24RunFailureCode("STATISTICAL_OPERATOR_FAILED")).toBe("GOVERNED_OPERATOR");
    expect(classifyFalcon24RunFailureCode("FALCON24_ORACLE_FAILED")).toBe("ORACLE");
    expect(classifyFalcon24RunFailureCode("RESOLUTION_TRACE_ARTIFACT_CORRUPT")).toBe("PUBLISHER");
    expect(classifyFalcon24RunFailureCode("FALCON24_SANDBOX_RECLAMATION_FAILED")).toBe(
      "SANDBOX_RECLAMATION",
    );
    expect(classifyFalcon24RunFailureCode("RUN_ATTEMPT_BUDGET_EXHAUSTED")).toBe("ROOT_ROUTING");
  });
});
