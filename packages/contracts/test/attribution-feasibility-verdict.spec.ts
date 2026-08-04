import { describe, expect, it } from "vitest";
import {
  attributionFeasibilityVerdictSchema,
  type AttributionFeasibilityVerdict,
  type AttributionFeasibilityVerdictValue,
  attributionFeasibilityVerdictValueSchema,
  oracleCheckResultSchema,
  type OracleCheckResult,
  mutationCheckResultSchema,
  type MutationCheckResult,
  holdoutCheckResultSchema,
  type HoldoutCheckResult,
  computeVerdictHash,
  determineAttributionFeasibilityVerdict,
} from "../src/index.js";

// ─── Test constants ────────────────────────────────────────────────────────────

const testUUID = "00000000-0000-4000-8000-000000000001";
const testUUID2 = "00000000-0000-4000-8000-000000000002";
const testTimestamp = "2026-08-04T00:00:00.000Z";

// ─── Factory functions ─────────────────────────────────────────────────────────

function makeOracleCheckResult(overrides?: Partial<OracleCheckResult>): OracleCheckResult {
  return {
    check_type: "ORACLE",
    status: "PASS",
    pattern_match_count: 3,
    pattern_total_count: 3,
    evidence_match_count: 5,
    evidence_total_count: 5,
    closure_verdict: "PASS",
    details: [
      { pattern_id: "promotion-discount", status: "PASS", message: "Pattern matched" },
      { pattern_id: "late-refunds", status: "PASS", message: "Pattern matched" },
      { pattern_id: "base-revenue", status: "PASS", message: "Pattern matched" },
    ],
    ...overrides,
  };
}

function makeMutationCheckResult(overrides?: Partial<MutationCheckResult>): MutationCheckResult {
  return {
    check_type: "MUTATION",
    status: "PASS",
    mutation_count: 3,
    detected_count: 3,
    undetected_count: 0,
    detection_rate: 1.0,
    details: [
      {
        mutation_id: "mut-001",
        mutation_type: "VALUE_CHANGE",
        expected_response: "HOLD",
        actual_response: "HOLD",
        status: "PASS",
        message: "Mutation detected",
      },
      {
        mutation_id: "mut-002",
        mutation_type: "ROW_DELETION",
        expected_response: "HOLD",
        actual_response: "HOLD",
        status: "PASS",
        message: "Mutation detected",
      },
      {
        mutation_id: "mut-003",
        mutation_type: "AGGREGATE_SHIFT",
        expected_response: "PASS",
        actual_response: "PASS",
        status: "PASS",
        message: "Mutation detected",
      },
    ],
    ...overrides,
  };
}

function makeHoldoutCheckResult(overrides?: Partial<HoldoutCheckResult>): HoldoutCheckResult {
  return {
    check_type: "HOLDOUT",
    status: "PASS",
    holdout_count: 2,
    holdout_pass_count: 2,
    holdout_fail_count: 0,
    details: [
      { dataset_id: "retail-revenue-v1-dataset", split: "DEMO", status: "PASS", message: "Demo data OK" },
      { dataset_id: "retail-revenue-v1-dataset", split: "HOLDOUT", status: "PASS", message: "Holdout data OK" },
    ],
    ...overrides,
  };
}

function makeFeasibilityVerdict(
  overrides?: Partial<AttributionFeasibilityVerdict>,
): AttributionFeasibilityVerdict {
  return {
    protocol_version: "attribution-feasibility-verdict@1",
    verdict_id: testUUID,
    kernel_evidence_ref: testUUID2,
    truth_contract_ref: "retail-revenue-v1",
    verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION",
    oracle_check: makeOracleCheckResult(),
    mutation_check: makeMutationCheckResult(),
    holdout_check: makeHoldoutCheckResult(),
    summary: "All checks passed. The kernel evidence is feasible for published integration.",
    reason_codes: ["ALL_CHECKS_PASSED"],
    evaluated_at: testTimestamp,
    evaluator_version: "attribution-feasibility-evaluator@1",
    verdict_hash: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("U7 Attribution Feasibility Verdict", () => {
  describe("Verdict Schema", () => {
    it("creates a valid FEASIBLE_FOR_PUBLISHED_INTEGRATION verdict", () => {
      const verdict = makeFeasibilityVerdict();
      const parsed = attributionFeasibilityVerdictSchema.safeParse(verdict);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.verdict).toBe("FEASIBLE_FOR_PUBLISHED_INTEGRATION");
        expect(parsed.data.protocol_version).toBe("attribution-feasibility-verdict@1");
      }
    });

    it("creates a valid NARROW_SCOPE verdict", () => {
      const verdict = makeFeasibilityVerdict({
        verdict: "NARROW_SCOPE",
        reason_codes: ["ORACLE_CHECK_PARTIAL"],
      });
      const parsed = attributionFeasibilityVerdictSchema.safeParse(verdict);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.verdict).toBe("NARROW_SCOPE");
      }
    });

    it("creates a valid EXPAND_IR verdict", () => {
      const verdict = makeFeasibilityVerdict({
        verdict: "EXPAND_IR",
        reason_codes: ["HOLDOUT_CHECK_FAILED"],
      });
      const parsed = attributionFeasibilityVerdictSchema.safeParse(verdict);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.verdict).toBe("EXPAND_IR");
      }
    });

    it("creates a valid STOP verdict", () => {
      const verdict = makeFeasibilityVerdict({
        verdict: "STOP",
        reason_codes: ["ORACLE_CHECK_FAILED"],
      });
      const parsed = attributionFeasibilityVerdictSchema.safeParse(verdict);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.verdict).toBe("STOP");
      }
    });

    it("rejects invalid verdict value", () => {
      const parsed = attributionFeasibilityVerdictValueSchema.safeParse("INVALID");
      expect(parsed.success).toBe(false);
    });

    it("rejects verdict with missing kernel_evidence_ref", () => {
      const invalid = { ...makeFeasibilityVerdict(), kernel_evidence_ref: "" };
      const parsed = attributionFeasibilityVerdictSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects verdict with empty reason_codes", () => {
      const invalid = { ...makeFeasibilityVerdict(), reason_codes: [] };
      const parsed = attributionFeasibilityVerdictSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Oracle Check Schema", () => {
    it("creates a valid PASS oracle check", () => {
      const check = makeOracleCheckResult();
      const parsed = oracleCheckResultSchema.safeParse(check);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("PASS");
        expect(parsed.data.pattern_match_count).toBe(3);
        expect(parsed.data.closure_verdict).toBe("PASS");
      }
    });

    it("rejects oracle check with negative pattern_match_count", () => {
      const invalid = { ...makeOracleCheckResult(), pattern_match_count: -1 };
      const parsed = oracleCheckResultSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects oracle check with empty details", () => {
      const invalid = { ...makeOracleCheckResult(), details: [] };
      const parsed = oracleCheckResultSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Mutation Check Schema", () => {
    it("creates a valid PASS mutation check", () => {
      const check = makeMutationCheckResult();
      const parsed = mutationCheckResultSchema.safeParse(check);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("PASS");
        expect(parsed.data.detection_rate).toBe(1.0);
      }
    });

    it("rejects mutation check with detection_rate > 1", () => {
      const invalid = { ...makeMutationCheckResult(), detection_rate: 1.5 };
      const parsed = mutationCheckResultSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects mutation check with negative mutation_count", () => {
      const invalid = { ...makeMutationCheckResult(), mutation_count: -1 };
      const parsed = mutationCheckResultSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Holdout Check Schema", () => {
    it("creates a valid PASS holdout check", () => {
      const check = makeHoldoutCheckResult();
      const parsed = holdoutCheckResultSchema.safeParse(check);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("PASS");
        expect(parsed.data.holdout_pass_count).toBe(2);
      }
    });

    it("accepts SKIP status for holdout check", () => {
      const check = makeHoldoutCheckResult({ status: "SKIP", holdout_count: 0 });
      const parsed = holdoutCheckResultSchema.safeParse(check);
      expect(parsed.success).toBe(true);
    });
  });

  describe("determineAttributionFeasibilityVerdict", () => {
    it("returns FEASIBLE_FOR_PUBLISHED_INTEGRATION when all checks pass", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult();

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("FEASIBLE_FOR_PUBLISHED_INTEGRATION");
      expect(verdict.reason_codes).toContain("ALL_CHECKS_PASSED");
    });

    it("returns STOP when oracle check fails", () => {
      const oracle = makeOracleCheckResult({ status: "FAIL" });
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult();

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("STOP");
      expect(verdict.reason_codes).toContain("ORACLE_CHECK_FAILED");
    });

    it("returns STOP when mutation check fails", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult({ status: "FAIL" });
      const holdout = makeHoldoutCheckResult();

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("STOP");
      expect(verdict.reason_codes).toContain("MUTATION_CHECK_FAILED");
    });

    it("returns NARROW_SCOPE when oracle check is partial", () => {
      const oracle = makeOracleCheckResult({ status: "PARTIAL", pattern_match_count: 2 });
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult();

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("NARROW_SCOPE");
      expect(verdict.reason_codes).toContain("ORACLE_CHECK_PARTIAL");
    });

    it("returns NARROW_SCOPE when mutation check is partial", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult({ status: "PARTIAL", detected_count: 2 });
      const holdout = makeHoldoutCheckResult();

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("NARROW_SCOPE");
      expect(verdict.reason_codes).toContain("MUTATION_CHECK_PARTIAL");
    });

    it("returns EXPAND_IR when holdout check fails", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult({ status: "FAIL", holdout_fail_count: 1 });

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("EXPAND_IR");
      expect(verdict.reason_codes).toContain("HOLDOUT_CHECK_FAILED");
    });

    it("returns EXPAND_IR when holdout check is partial", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult({ status: "PARTIAL" });

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("EXPAND_IR");
      expect(verdict.reason_codes).toContain("HOLDOUT_CHECK_PARTIAL");
    });

    it("returns STOP when oracle partial and holdout fail", () => {
      const oracle = makeOracleCheckResult({ status: "PARTIAL" });
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult({ status: "FAIL" });

      const verdict = determineAttributionFeasibilityVerdict(
        testUUID2,
        "retail-revenue-v1",
        oracle,
        mutation,
        holdout,
      );

      expect(verdict.verdict).toBe("STOP");
      expect(verdict.reason_codes).toContain("ORACLE_PARTIAL_AND_HOLDOUT_FAILED");
    });
  });

  describe("computeVerdictHash", () => {
    it("produces consistent hash for same inputs", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult();

      const hash1 = computeVerdictHash({ verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION", oracle_check: oracle, mutation_check: mutation, holdout_check: holdout });
      const hash2 = computeVerdictHash({ verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION", oracle_check: oracle, mutation_check: mutation, holdout_check: holdout });

      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different verdicts", () => {
      const oracle = makeOracleCheckResult();
      const mutation = makeMutationCheckResult();
      const holdout = makeHoldoutCheckResult();

      const hash1 = computeVerdictHash({ verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION", oracle_check: oracle, mutation_check: mutation, holdout_check: holdout });
      const hash2 = computeVerdictHash({ verdict: "STOP", oracle_check: oracle, mutation_check: mutation, holdout_check: holdout });

      expect(hash1).not.toBe(hash2);
    });
  });
});
