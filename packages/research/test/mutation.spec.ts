import { describe, expect, it } from "vitest";
import { runControlledProtocolKernel } from "../src/server.js";
import {
  controlledBaseEvaluation,
  controlledMutationCases,
  controlledPairCases,
} from "./controlled.js";

const CONTROLLED_MATRIX_TIMEOUT_MS = 120_000;

async function evaluateControlledMutations() {
  const cases = await controlledMutationCases();
  const evaluations = [];
  for (const testCase of cases) {
    evaluations.push({
      testCase,
      result: await runControlledProtocolKernel(testCase.kernel_input),
    });
  }
  return evaluations;
}

let controlledMutationEvaluations: ReturnType<typeof evaluateControlledMutations> | undefined;

function cachedControlledMutationEvaluations() {
  controlledMutationEvaluations ??= evaluateControlledMutations();
  return controlledMutationEvaluations;
}

function recursivelyHasKey(value: unknown, predicate: (key: string) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => recursivelyHasKey(item, predicate));
  }
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) => predicate(key) || recursivelyHasKey(child, predicate),
  );
}

function isOracleKey(key: string): boolean {
  return (
    key === "expected" ||
    key.startsWith("expected_") ||
    [
      "mutation_id",
      "public_terminal",
      "certificate_issued",
      "grant_issued",
      "partial_preconditions",
      "proof",
      "finalization",
      "candidate_path",
    ].includes(key) ||
    key.includes("certificate") ||
    key.includes("grant")
  );
}

describe("RQ092 controlled mutation matrix", () => {
  it("基线通过真实五层生产内核，仍只产生 ReportReady Candidate", async () => {
    const result = await controlledBaseEvaluation();
    expect(result.stop_decision_candidate).toBe("STOP_READY");
    expect(result.kernel_outcome).toEqual({
      kind: "REPORT_READY_CANDIDATE",
      reason_code: "OBLIGATION_SATISFIED",
      report_ready_candidate_eligible: true,
    });
    expect(result.kernel_trace).toEqual([
      "OBSERVATION",
      "COVERAGE",
      "STOP",
      "REPORTING",
      "READINESS",
    ]);
    expect(result.artifact_candidates.report_ready).toBeDefined();
    expect(
      recursivelyHasKey(result, (key) =>
        ["public_terminal", "current_readiness", "grant_issued"].includes(key),
      ),
    ).toBe(false);
  });

  it(
    "14 项 mutation 均通过同一 production runner 得到 oracle reason，且不提交终态",
    async () => {
      const evaluations = await cachedControlledMutationEvaluations();
      expect(evaluations).toHaveLength(14);
      for (const { testCase, result } of evaluations) {
        expect(
          recursivelyHasKey(testCase.kernel_input, isOracleKey),
          `${testCase.case_id} kernel_input 泄漏 oracle 字段`,
        ).toBe(false);
        expect(
          result.kernel_trace,
          `${testCase.case_id} 必须实际调用 Observation/Coverage/Stop`,
        ).toEqual(expect.arrayContaining(["OBSERVATION", "COVERAGE", "STOP"]));
        expect(result.kernel_outcome.reason_code, testCase.case_id).toBe(
          testCase.oracle.domain_reason_code,
        );
        expect(
          recursivelyHasKey(result, (key) =>
            ["public_terminal", "current_readiness", "grant_issued"].includes(key),
          ),
          testCase.case_id,
        ).toBe(false);

        if (testCase.oracle.partial_preconditions !== null) {
          expect(result.stop_decision_candidate, testCase.case_id).toBe("STOP_PARTIAL");
          expect(result.kernel_outcome, testCase.case_id).toMatchObject({
            kind: "RESEARCH_STOP_CANDIDATE",
            terminal_candidate: {
              terminal: "PARTIAL",
              commitment: "NOT_COMMITTED",
            },
          });
        }
        if (
          [
            "supervisor-certificate-bypass",
            "certificate-tamper",
            "certificate-semantic-hash-tamper",
            "current-ready-revocation-race",
          ].includes(testCase.case_id)
        ) {
          expect(result.kernel_trace, testCase.case_id).toEqual(
            expect.arrayContaining(["REPORTING", "READINESS"]),
          );
        }
      }
    },
    CONTROLLED_MATRIX_TIMEOUT_MS,
  );

  it(
    "16 个 partial→continue/replan pair 使用同一 production runner 且不伪造 Public Terminal",
    async () => {
      const pairs = await controlledPairCases();
      const mutationResults = new Map(
        (await cachedControlledMutationEvaluations()).map(({ testCase, result }) => [
          testCase.case_id,
          result,
        ]),
      );
      const pairResults = new Map(
        await Promise.all(
          pairs.map(
            async (testCase) =>
              [testCase.case_id, await runControlledProtocolKernel(testCase.kernel_input)] as const,
          ),
        ),
      );
      expect(pairs).toHaveLength(16);
      for (const testCase of pairs) {
        expect(
          recursivelyHasKey(testCase.kernel_input, isOracleKey),
          `${testCase.case_id} kernel_input 泄漏 oracle 字段`,
        ).toBe(false);
        const result = pairResults.get(testCase.case_id);
        if (!result) {
          throw new Error(`${testCase.case_id} 缺少 production runner 结果。`);
        }
        expect(result.stop_decision_candidate, testCase.case_id).toBe(testCase.oracle.decision);
        expect(result.kernel_outcome.reason_code, testCase.case_id).toBe(
          testCase.oracle.reason_code,
        );
        expect(result.kernel_trace, testCase.case_id).toEqual(["OBSERVATION", "COVERAGE", "STOP"]);
        expect(testCase.oracle.committed_public_terminal).toBeNull();
        const stop = result.artifact_candidates.stop;
        const coverage = result.artifact_candidates.coverage;
        if (!stop || !coverage) {
          throw new Error(`${testCase.case_id} 缺少 Stop/Coverage Candidate。`);
        }
        const baseMutationId = testCase.case_id.replace(/--(?:continue|replan)$/, "");
        const baseCoverage = mutationResults.get(baseMutationId)?.artifact_candidates.coverage;
        if (!baseCoverage) {
          throw new Error(`${testCase.case_id} 缺少对应业务扰动 Coverage。`);
        }
        expect(coverage.coverage_input_hash, testCase.case_id).toBe(
          baseCoverage.coverage_input_hash,
        );
        expect(
          coverage.obligations.map(({ state, reason_codes }) => ({
            state,
            reason_codes,
          })),
          testCase.case_id,
        ).toEqual(
          baseCoverage.obligations.map(({ state, reason_codes }) => ({
            state,
            reason_codes,
          })),
        );
        expect(testCase.oracle.hard_budget_cap).toBe(false);
        expect(testCase.oracle.deliverable_supported_subset).toBe(true);
        expect(stop.supported_subset.claim_refs.length).toBeGreaterThan(0);
        if (testCase.oracle.decision === "CONTINUE") {
          expect(
            stop.candidate_queries.filter(
              ({ admissibility }) => admissibility === "EXECUTABLE_NOW",
            ),
          ).toHaveLength(testCase.oracle.budget_executable_query_count);
          expect(testCase.oracle.executable_replan_count).toBe(0);
        } else {
          if (stop.decision !== "REPLAN") {
            throw new Error(`${testCase.case_id} 未产生 REPLAN Candidate。`);
          }
          expect(
            stop.candidate_queries.filter(
              ({ admissibility }) => admissibility === "WAITING_EXTERNAL_CAPABILITY",
            ),
          ).toHaveLength(testCase.oracle.waiting_query_count);
          expect(
            stop.candidate_queries.filter(
              ({ admissibility }) => admissibility === "BUDGET_BLOCKED",
            ),
          ).toHaveLength(testCase.oracle.budget_blocked_query_count);
          expect(stop.candidate_set.unresolved_obligation_refs).toHaveLength(
            testCase.oracle.open_obligation_count,
          );
          expect(stop.replan_assessment).toMatchObject({
            trigger: testCase.oracle.replan_trigger,
            executable_with_remaining_budget: testCase.oracle.executable_with_remaining_budget,
          });
        }
        expect(
          recursivelyHasKey(result, (key) =>
            ["public_terminal", "current_readiness", "grant_issued"].includes(key),
          ),
        ).toBe(false);
      }
    },
    CONTROLLED_MATRIX_TIMEOUT_MS,
  );
});
