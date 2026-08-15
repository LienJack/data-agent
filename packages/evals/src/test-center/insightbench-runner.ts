import { randomUUID } from "node:crypto";
import {
  type BenchmarkEvalAttempt,
  type BenchmarkEvalCaseRun,
  type BenchmarkFrozenManifest,
  type BenchmarkReflectionReceipt,
  type BenchmarkRunBudget,
  benchmarkEvalAttemptSchema,
  benchmarkEvalCaseRunSchema,
  benchmarkFrozenManifestSchema,
  benchmarkReflectionReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { BenchmarkAnalysisAgent } from "./analysis-agent.js";
import type { InsightBenchDataset } from "./insightbench-dataset.js";
import { INSIGHTBENCH_ORACLE_VERSION, InsightBenchRuleOracle } from "./insightbench-oracle.js";
import { INSIGHTBENCH_REPOSITORY_COMMIT } from "./insightbench-source.js";
import { aggregateBenchmarkScorecard } from "./scorecard.js";

const PROMPT_VERSION = "insightbench-public-data@1.0.0";
const WORKFLOW_VERSION = "test-center-analysis-runner@1.0.0";
const EVALUATOR_VERSION = "insightbench-rule-evaluator@1.0.0";
const AGGREGATOR_VERSION = "test-center-aggregator@1.0.0";

export interface InsightBenchBatchExecutionResult {
  readonly manifest: BenchmarkFrozenManifest;
  readonly case_runs: readonly BenchmarkEvalCaseRun[];
  readonly scorecard: Awaited<ReturnType<typeof aggregateBenchmarkScorecard>>;
}

function statusFor(verdict: BenchmarkEvalAttempt["verdict"]): BenchmarkEvalCaseRun["status"] {
  return verdict;
}

async function failedAttempt(input: {
  readonly attempt_id: string;
  readonly case_run_id: string;
  readonly attempt_index: 0 | 1;
  readonly trace_id: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly diagnostic_code: string;
}): Promise<BenchmarkEvalAttempt> {
  const feedbackDraft = {
    oracle_version: INSIGHTBENCH_ORACLE_VERSION,
    failure_type: "INFRA_FAILURE" as const,
    public_message: "分析 Agent 未能产生符合契约的报告。",
    candidate_row_count: null,
    gold_row_count: null,
    candidate_column_count: null,
    gold_column_count: null,
  };
  const feedback = {
    ...feedbackDraft,
    oracle_receipt_hash: await sha256ContentHash(feedbackDraft),
  };
  const draft = {
    attempt_id: input.attempt_id,
    case_run_id: input.case_run_id,
    attempt_index: input.attempt_index,
    answer: null,
    answer_hash: null,
    verdict: "INFRA_FAILURE" as const,
    diagnostic_code: input.diagnostic_code,
    oracle_feedback: feedback,
    usage: { input_tokens: 0, output_tokens: 0, cost_micros: 0, currency: "USD" as const },
    latency_ms: 0,
    trace_id: input.trace_id,
    started_at: input.started_at,
    completed_at: input.completed_at,
  };
  return benchmarkEvalAttemptSchema.parse({
    ...draft,
    attempt_receipt_hash: await sha256ContentHash(draft),
  });
}

function safeDiagnosticCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "ANALYSIS_AGENT_EXECUTION_FAILED";
  try {
    const candidate = Reflect.get(error, "diagnostic_code");
    return typeof candidate === "string" && /^[A-Z][A-Z0-9_]*$/.test(candidate)
      ? candidate
      : "ANALYSIS_AGENT_EXECUTION_FAILED";
  } catch {
    return "ANALYSIS_AGENT_EXECUTION_FAILED";
  }
}

async function executeAttempt(input: {
  readonly attempt_id: string;
  readonly case_run_id: string;
  readonly attempt_index: 0 | 1;
  readonly answer: Awaited<ReturnType<BenchmarkAnalysisAgent["answer"]>>;
  readonly sealed_case: InsightBenchDataset["sealed_cases"][number];
  readonly trace_id: string;
  readonly started_at: string;
  readonly oracle: InsightBenchRuleOracle;
  readonly now: () => Date;
}): Promise<{ readonly attempt: BenchmarkEvalAttempt; readonly score: number }> {
  const answerHash = await sha256ContentHash(input.answer.report);
  const oracleStarted = Date.now();
  const evaluation = await input.oracle.evaluate({
    report: input.answer.report,
    sealed_case: input.sealed_case,
  });
  const draft = {
    attempt_id: input.attempt_id,
    case_run_id: input.case_run_id,
    attempt_index: input.attempt_index,
    answer: input.answer.report,
    answer_hash: answerHash,
    verdict: evaluation.verdict,
    oracle_feedback: evaluation.feedback,
    usage: input.answer.usage,
    latency_ms: input.answer.latency_ms + Math.max(0, Date.now() - oracleStarted),
    trace_id: input.trace_id,
    started_at: input.started_at,
    completed_at: input.now().toISOString(),
  };
  return {
    attempt: benchmarkEvalAttemptSchema.parse({
      ...draft,
      attempt_receipt_hash: await sha256ContentHash(draft),
    }),
    score: evaluation.normalized_score,
  };
}

async function buildReflection(input: {
  readonly case_run_id: string;
  readonly attempt: BenchmarkEvalAttempt;
  readonly reflection: Awaited<ReturnType<BenchmarkAnalysisAgent["reflect"]>>;
  readonly created_at: string;
}): Promise<BenchmarkReflectionReceipt> {
  const draft = {
    reflection_id: randomUUID(),
    case_run_id: input.case_run_id,
    source_attempt_id: input.attempt.attempt_id,
    failure_type: input.attempt.oracle_feedback.failure_type ?? "METRIC_BELOW_THRESHOLD",
    evidence_receipt_hashes: [input.attempt.oracle_feedback.oracle_receipt_hash],
    mutable_scope: ["ANALYSIS_REPORT"] as const,
    preserved_invariants: [
      "题目、公开 CSV、密封参考答案、Oracle 与预算保持不变。",
      "反省只允许修改当前 Case 的分析报告。",
      "Agent 不得读取参考洞察、参考数值或其他题目。",
    ],
    diagnosis_summary: input.reflection.diagnosis_summary,
    proposed_actions: [...input.reflection.proposed_actions],
    confidence: input.reflection.confidence,
    retry_recommendation: input.reflection.retry_recommendation,
    created_at: input.created_at,
  };
  return benchmarkReflectionReceiptSchema.parse({
    ...draft,
    reflection_receipt_hash: await sha256ContentHash(draft),
  });
}

export async function executeInsightBenchBatch(input: {
  readonly dataset: InsightBenchDataset;
  readonly case_ids: readonly string[];
  readonly agent: BenchmarkAnalysisAgent;
  readonly reflection_enabled: boolean;
  readonly budget: BenchmarkRunBudget;
  readonly seed: number;
  readonly batch_run_id?: string;
  readonly oracle?: InsightBenchRuleOracle;
  readonly now?: () => Date;
  readonly cancelled?: () => boolean;
}): Promise<InsightBenchBatchExecutionResult> {
  const now = input.now ?? (() => new Date());
  const batchRunId = input.batch_run_id ?? randomUUID();
  const selectedCases = input.case_ids.map((caseId) => {
    const publicCase = input.dataset.public_cases.find((candidate) => candidate.case_id === caseId);
    const sealedCase = input.dataset.sealed_cases.find(
      (candidate) => candidate.public_case.case_id === caseId,
    );
    const csvText = input.dataset.csv_by_case_id.get(caseId);
    if (!publicCase || !sealedCase || !csvText) throw new Error("BENCHMARK_CASE_NOT_FOUND");
    return { publicCase, sealedCase, csvText };
  });
  if (selectedCases.length === 0 || selectedCases.length > input.budget.max_cases) {
    throw new Error("BENCHMARK_CASE_BUDGET_EXCEEDED");
  }
  if (input.reflection_enabled && input.budget.max_attempts_per_case < 2) {
    throw new Error("BENCHMARK_REFLECTION_BUDGET_INVALID");
  }
  const frozenAt = now().toISOString();
  const manifestDraft = {
    manifest_version: "1.0.0",
    suite_id: "insightbench" as const,
    suite_version: "1.0.0",
    dataset_version: selectedCases[0]?.publicCase.dataset_version ?? "insightbench-hf-fd1a1cad",
    dataset_digest: input.dataset.installed_digest,
    source_commit: INSIGHTBENCH_REPOSITORY_COMMIT,
    oracle_version: INSIGHTBENCH_ORACLE_VERSION,
    agent: input.agent.descriptor,
    prompt_version: PROMPT_VERSION,
    workflow_version: WORKFLOW_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    aggregator_version: AGGREGATOR_VERSION,
    case_ids: selectedCases.map(({ publicCase }) => publicCase.case_id),
    seed: input.seed,
    budget: input.budget,
    frozen_at: frozenAt,
  };
  const manifest = benchmarkFrozenManifestSchema.parse({
    ...manifestDraft,
    manifest_hash: await sha256ContentHash(manifestDraft),
  });
  const oracle = input.oracle ?? new InsightBenchRuleOracle();
  const caseRuns: BenchmarkEvalCaseRun[] = [];

  for (const { publicCase, sealedCase, csvText } of selectedCases) {
    const caseRunId = randomUUID();
    const traceId = randomUUID();
    if (input.cancelled?.()) {
      caseRuns.push(
        benchmarkEvalCaseRunSchema.parse({
          case_run_id: caseRunId,
          batch_run_id: batchRunId,
          case_id: publicCase.case_id,
          ordinal: publicCase.ordinal,
          status: "CANCELLED",
          attempts: [],
          reflection: null,
          normalized_score: null,
          trace_id: traceId,
          started_at: null,
          completed_at: now().toISOString(),
        }),
      );
      continue;
    }
    const startedAt = now().toISOString();
    const firstAttemptId = randomUUID();
    let firstAttempt: BenchmarkEvalAttempt;
    let terminalScore: number | null = null;
    try {
      const answer = await input.agent.answer({
        test_case: publicCase,
        csv_text: csvText,
        seed: input.seed,
        invocation: {
          run_id: batchRunId,
          attempt_id: firstAttemptId,
          attempt_index: 0,
          timeout_ms: input.budget.max_case_duration_ms,
          max_output_tokens: input.budget.max_output_tokens_per_attempt,
        },
      });
      const result = await executeAttempt({
        attempt_id: firstAttemptId,
        case_run_id: caseRunId,
        attempt_index: 0,
        answer,
        sealed_case: sealedCase,
        trace_id: traceId,
        started_at: startedAt,
        oracle,
        now,
      });
      firstAttempt = result.attempt;
      terminalScore = result.score;
    } catch (error) {
      firstAttempt = await failedAttempt({
        attempt_id: firstAttemptId,
        case_run_id: caseRunId,
        attempt_index: 0,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: now().toISOString(),
        diagnostic_code: safeDiagnosticCode(error),
      });
    }
    const attempts = [firstAttempt];
    let reflection: BenchmarkReflectionReceipt | null = null;
    if (
      firstAttempt.verdict === "FAIL" &&
      input.reflection_enabled &&
      input.agent.descriptor.supports_reflection &&
      firstAttempt.answer?.answer_type === "ANALYSIS_REPORT"
    ) {
      const retryAttemptId = randomUUID();
      const reflectionOutput = await input.agent.reflect({
        test_case: publicCase,
        csv_text: csvText,
        prior_report: firstAttempt.answer,
        feedback: firstAttempt.oracle_feedback,
        seed: input.seed,
        invocation: {
          run_id: batchRunId,
          attempt_id: retryAttemptId,
          attempt_index: 1,
          timeout_ms: input.budget.max_case_duration_ms,
          max_output_tokens: input.budget.max_output_tokens_per_attempt,
        },
      });
      reflection = await buildReflection({
        case_run_id: caseRunId,
        attempt: firstAttempt,
        reflection: reflectionOutput,
        created_at: now().toISOString(),
      });
      if (
        reflection.retry_recommendation === "APPROVED" &&
        reflectionOutput.revised_answer &&
        attempts.length < input.budget.max_attempts_per_case
      ) {
        const result = await executeAttempt({
          attempt_id: retryAttemptId,
          case_run_id: caseRunId,
          attempt_index: 1,
          answer: reflectionOutput.revised_answer,
          sealed_case: sealedCase,
          trace_id: traceId,
          started_at: now().toISOString(),
          oracle,
          now,
        });
        attempts.push(result.attempt);
        terminalScore = result.score;
      }
    }
    const terminalAttempt = attempts.at(-1) ?? firstAttempt;
    caseRuns.push(
      benchmarkEvalCaseRunSchema.parse({
        case_run_id: caseRunId,
        batch_run_id: batchRunId,
        case_id: publicCase.case_id,
        ordinal: publicCase.ordinal,
        status: statusFor(terminalAttempt.verdict),
        attempts,
        reflection,
        normalized_score: terminalScore,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: now().toISOString(),
      }),
    );
  }
  const scorecard = await aggregateBenchmarkScorecard({
    batch_run_id: batchRunId,
    suite_id: "insightbench",
    suite_version: manifest.suite_version,
    dataset_version: manifest.dataset_version,
    oracle_version: manifest.oracle_version,
    case_runs: caseRuns,
    cases: selectedCases.map(({ publicCase }) => publicCase),
    generated_at: now().toISOString(),
  });
  return Object.freeze({ manifest, case_runs: Object.freeze(caseRuns), scorecard });
}
