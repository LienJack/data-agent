import { randomUUID } from "node:crypto";
import type {
  BenchmarkBatchScorecard,
  BenchmarkEvalCaseRun,
  BenchmarkFailureType,
  PublicBenchmarkCase,
} from "@data-agent/contracts";
import { benchmarkBatchScorecardSchema, sha256ContentHash } from "@data-agent/contracts";

const AGGREGATOR_VERSION = "test-center-aggregator@1.0.0";

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function terminalAttempt(caseRun: BenchmarkEvalCaseRun) {
  return caseRun.attempts.at(-1) ?? null;
}

function firstAttempt(caseRun: BenchmarkEvalCaseRun) {
  return caseRun.attempts[0] ?? null;
}

function failureTypes(caseRun: BenchmarkEvalCaseRun): readonly BenchmarkFailureType[] {
  return caseRun.attempts.flatMap((attempt) =>
    attempt.oracle_feedback.failure_type ? [attempt.oracle_feedback.failure_type] : [],
  );
}

function scoreSlice(
  sliceType: "difficulty" | "database" | "capability",
  sliceValue: string,
  caseRuns: readonly BenchmarkEvalCaseRun[],
) {
  const valid = caseRuns.filter((caseRun) =>
    caseRun.attempts.some((attempt) => attempt.verdict === "PASS" || attempt.verdict === "FAIL"),
  );
  const firstPass = valid.filter((caseRun) => firstAttempt(caseRun)?.verdict === "PASS").length;
  const finalPass = valid.filter((caseRun) => terminalAttempt(caseRun)?.verdict === "PASS").length;
  return {
    slice_type: sliceType,
    slice_value: sliceValue,
    valid_cases: valid.length,
    first_pass_passed: firstPass,
    final_passed: finalPass,
    first_pass_pass_rate: rate(firstPass, valid.length),
    post_reflection_pass_rate: rate(finalPass, valid.length),
  };
}

export async function aggregateBenchmarkScorecard(input: {
  readonly batch_run_id: string;
  readonly suite_id: BenchmarkBatchScorecard["suite_id"];
  readonly suite_version: string;
  readonly dataset_version: string;
  readonly oracle_version: string;
  readonly case_runs: readonly BenchmarkEvalCaseRun[];
  readonly cases: readonly PublicBenchmarkCase[];
  readonly generated_at?: string;
  readonly scorecard_id?: string;
}): Promise<BenchmarkBatchScorecard> {
  const validCases = input.case_runs.filter((caseRun) =>
    caseRun.attempts.some((attempt) => attempt.verdict === "PASS" || attempt.verdict === "FAIL"),
  );
  const firstPassPassed = validCases.filter(
    (caseRun) => firstAttempt(caseRun)?.verdict === "PASS",
  ).length;
  const finalPassed = validCases.filter(
    (caseRun) => terminalAttempt(caseRun)?.verdict === "PASS",
  ).length;
  const initiallyFailed = validCases.filter((caseRun) => firstAttempt(caseRun)?.verdict === "FAIL");
  const recovered = initiallyFailed.filter(
    (caseRun) => terminalAttempt(caseRun)?.verdict === "PASS",
  ).length;
  const initiallyPassed = validCases.filter((caseRun) => firstAttempt(caseRun)?.verdict === "PASS");
  const regressed = initiallyPassed.filter(
    (caseRun) => terminalAttempt(caseRun)?.verdict !== "PASS",
  ).length;
  const allAttempts = input.case_runs.flatMap((caseRun) => caseRun.attempts);
  const failureCounts = new Map<BenchmarkFailureType, number>();
  for (const caseRun of input.case_runs) {
    for (const failureType of failureTypes(caseRun)) {
      failureCounts.set(failureType, (failureCounts.get(failureType) ?? 0) + 1);
    }
  }
  const casesById = new Map(input.cases.map((testCase) => [testCase.case_id, testCase]));
  const slices: Array<ReturnType<typeof scoreSlice>> = [];
  const sliceDefinitions = new Map<
    string,
    { type: "difficulty" | "database" | "capability"; value: string }
  >();
  for (const caseRun of input.case_runs) {
    const testCase = casesById.get(caseRun.case_id);
    if (!testCase) continue;
    sliceDefinitions.set(`difficulty:${testCase.difficulty}`, {
      type: "difficulty",
      value: testCase.difficulty,
    });
    sliceDefinitions.set(`database:${testCase.database_id}`, {
      type: "database",
      value: testCase.database_id,
    });
    for (const capability of testCase.capabilities) {
      sliceDefinitions.set(`capability:${capability}`, { type: "capability", value: capability });
    }
  }
  for (const definition of [...sliceDefinitions.values()].sort((left, right) =>
    `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
  )) {
    const matching = input.case_runs.filter((caseRun) => {
      const testCase = casesById.get(caseRun.case_id);
      if (!testCase) return false;
      if (definition.type === "difficulty") return testCase.difficulty === definition.value;
      if (definition.type === "database") return testCase.database_id === definition.value;
      return testCase.capabilities.includes(
        definition.value as PublicBenchmarkCase["capabilities"][number],
      );
    });
    slices.push(scoreSlice(definition.type, definition.value, matching));
  }

  const draft = {
    scorecard_id: input.scorecard_id ?? randomUUID(),
    scorecard_version: 1,
    batch_run_id: input.batch_run_id,
    suite_id: input.suite_id,
    suite_version: input.suite_version,
    dataset_version: input.dataset_version,
    oracle_version: input.oracle_version,
    aggregator_version: AGGREGATOR_VERSION,
    total_cases: input.case_runs.length,
    valid_cases: validCases.length,
    first_pass_passed: firstPassPassed,
    final_passed: finalPassed,
    recovered_cases: recovered,
    regressed_cases: regressed,
    agent_failed_cases: validCases.filter((caseRun) => terminalAttempt(caseRun)?.verdict === "FAIL")
      .length,
    infra_failed_cases: input.case_runs.filter((caseRun) => caseRun.status === "INFRA_FAILURE")
      .length,
    invalid_cases: input.case_runs.filter((caseRun) => caseRun.status === "INVALID_CASE").length,
    first_pass_pass_rate: rate(firstPassPassed, validCases.length),
    post_reflection_pass_rate: rate(finalPassed, validCases.length),
    recovery_rate: rate(recovered, initiallyFailed.length),
    regression_rate: rate(regressed, initiallyPassed.length),
    total_latency_ms: allAttempts.reduce((sum, attempt) => sum + attempt.latency_ms, 0),
    total_input_tokens: allAttempts.reduce((sum, attempt) => sum + attempt.usage.input_tokens, 0),
    total_output_tokens: allAttempts.reduce((sum, attempt) => sum + attempt.usage.output_tokens, 0),
    total_cost_micros: allAttempts.reduce((sum, attempt) => sum + attempt.usage.cost_micros, 0),
    failure_taxonomy: [...failureCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([failure_type, count]) => ({ failure_type, count })),
    slices,
    generated_at: input.generated_at ?? new Date().toISOString(),
  };
  return benchmarkBatchScorecardSchema.parse({
    ...draft,
    scorecard_hash: await sha256ContentHash(draft),
  });
}
