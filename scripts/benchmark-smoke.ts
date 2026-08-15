import {
  DeterministicProfileAnalysisAgent,
  executeBirdBenchmarkBatch,
  executeInsightBenchBatch,
  loadBirdMiniDevDataset,
  loadInsightBenchDataset,
  PublishedBirdBaselineAgent,
  SubmittedAnswerAgent,
} from "../packages/evals/src/test-center/index.js";

const budget = {
  max_cases: 1,
  max_attempts_per_case: 2,
  max_case_duration_ms: 10_000,
  max_batch_duration_ms: 30_000,
  max_output_tokens_per_attempt: 2_048,
  max_cost_micros: 0,
  concurrency: 1,
} as const;

async function main(): Promise<void> {
  if (process.argv[2] === "insightbench") {
    const dataset = await loadInsightBenchDataset();
    const run = await executeInsightBenchBatch({
      dataset,
      case_ids: dataset.public_cases.map((testCase) => testCase.case_id),
      agent: new DeterministicProfileAnalysisAgent(),
      reflection_enabled: true,
      budget: { ...budget, max_cases: dataset.public_cases.length, max_batch_duration_ms: 120_000 },
      seed: 42,
    });
    if (
      run.scorecard.valid_cases !== dataset.public_cases.length ||
      run.case_runs.some((caseRun) => caseRun.attempts.length === 0)
    ) {
      throw new Error("INSIGHTBENCH_SMOKE_EXECUTION_INCOMPLETE");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          gate: "benchmark:smoke",
          suite_id: "insightbench",
          suite_version: run.manifest.suite_version,
          dataset_digest: run.manifest.dataset_digest,
          first_pass_rate: run.scorecard.first_pass_pass_rate,
          post_reflection_pass_rate: run.scorecard.post_reflection_pass_rate,
          cases: run.case_runs.map((caseRun) => ({
            ordinal: caseRun.ordinal,
            status: caseRun.status,
            attempts: caseRun.attempts.length,
            attempt_scores: caseRun.attempts.map(
              (attempt) => attempt.oracle_feedback.metric_scores?.composite ?? null,
            ),
            normalized_score: caseRun.normalized_score,
          })),
          result: "PASS",
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const dataset = await loadBirdMiniDevDataset();
  const testCase = dataset.public_cases[0];
  if (!testCase) throw new Error("BENCHMARK_SMOKE_CASE_MISSING");

  const passingRun = await executeBirdBenchmarkBatch({
    dataset,
    case_ids: [testCase.case_id],
    agent: new PublishedBirdBaselineAgent(dataset.published_predictions),
    reflection_enabled: false,
    budget,
    seed: 42,
  });
  const failingRun = await executeBirdBenchmarkBatch({
    dataset,
    case_ids: [testCase.case_id],
    agent: new SubmittedAnswerAgent({ [testCase.case_id]: "select 1" }),
    reflection_enabled: false,
    budget,
    seed: 42,
  });

  const passVerdict = passingRun.case_runs[0]?.status;
  const failVerdict = failingRun.case_runs[0]?.status;
  if (passVerdict !== "PASS" || failVerdict !== "FAIL") {
    throw new Error(
      `BENCHMARK_SMOKE_VERDICT_MISMATCH: expected PASS/FAIL, received ${passVerdict}/${failVerdict}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        gate: "benchmark:smoke",
        suite_id: "bird-mini-dev",
        suite_version: passingRun.manifest.suite_version,
        dataset_digest: passingRun.manifest.dataset_digest,
        case_id: testCase.case_id,
        expected_equivalent_verdict: passVerdict,
        expected_mismatch_verdict: failVerdict,
        result: "PASS",
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`FATAL: benchmark:smoke failed: ${String(error)}\n`);
  process.exit(1);
});
