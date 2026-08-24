import { L2ResearchWireError } from "@data-agent/contracts/artifacts";
import { describe, expect, it } from "vitest";
import {
  analysisExecutionFailureCode,
  analysisExecutorInternals,
} from "../../src/analysis/executor.js";

const closure = {
  principal_id: "principal-1",
  lease_principal_id: "principal-1",
  stage_expires_at: "2026-08-24T01:15:00.000Z",
  observed_at: new Date("2026-08-24T01:00:00.000Z"),
  staged_operator_receipt_closure_hash: "operator-hash",
  command_operator_receipt_closure_hash: "operator-hash",
  receipt_operator_receipt_closure_hash: "operator-hash",
  staged_contract_hash: "contract-hash",
  receipt_contract_hash: "contract-hash",
  staged_manifest_hash: "manifest-hash",
  receipt_manifest_hash: "manifest-hash",
  staged_closure_hash: "closure-hash",
  receipt_closure_hash: "closure-hash",
} as const;

describe("analysis authority stage closure", () => {
  it("accepts one current byte-identical stage, receipt and commit closure", () => {
    expect(() =>
      analysisExecutorInternals.assertAnalysisAuthorityStageClosure(closure),
    ).not.toThrow();
  });

  it("rejects an expired durable stage before the authority transaction", () => {
    expect(() =>
      analysisExecutorInternals.assertAnalysisAuthorityStageClosure({
        ...closure,
        observed_at: new Date(closure.stage_expires_at),
      }),
    ).toThrowError("ANALYSIS_AUTHORITY_STAGE_EXPIRED");
  });

  it("reports the exact receipt field that diverges from the staged closure", () => {
    expect(() =>
      analysisExecutorInternals.assertAnalysisAuthorityStageClosure({
        ...closure,
        receipt_manifest_hash: "different-manifest-hash",
      }),
    ).toThrowError("ANALYSIS_AUTHORITY_RECEIPT_MANIFEST_HASH_MISMATCH");
  });

  it("projects the safe L2 wire code instead of a generic analysis failure", () => {
    expect(
      analysisExecutionFailureCode(
        new L2ResearchWireError(
          "L2_WIRE_REFERENCE_CLOSURE_INVALID",
          "sensitive implementation detail",
        ),
      ),
    ).toBe("L2_WIRE_REFERENCE_CLOSURE_INVALID");
  });
});
