import { randomUUID } from "node:crypto";
import {
  type BenchmarkEvalAttempt,
  type BenchmarkEvalCaseRun,
  type BenchmarkFrozenManifest,
  type BenchmarkReflectionReceipt,
  type BenchmarkRunBudget,
  type BenchmarkTestSuiteId,
  benchmarkEvalAttemptSchema,
  benchmarkEvalCaseRunSchema,
  benchmarkFrozenManifestSchema,
  benchmarkReflectionReceiptSchema,
  type PublicBenchmarkCase,
  type SealedBenchmarkCase,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { BenchmarkEvalAgent } from "./agents.js";
import { aggregateBenchmarkScorecard } from "./scorecard.js";
import { SqliteResultOracle, type SqlResultOracle } from "./sqlite-oracle.js";

const PROMPT_VERSION = "bird-sql-agent@1.3.0";
const WORKFLOW_VERSION = "test-center-case-runner@1.0.0";
const EVALUATOR_VERSION = "bird-sqlite-evaluator@1.0.0";
const AGGREGATOR_VERSION = "test-center-aggregator@1.0.0";
const ORACLE_VERSION = "bird-sqlite-result-equivalence@1.0.0";

export interface BenchmarkBatchExecutionResult {
  readonly manifest: BenchmarkFrozenManifest;
  readonly case_runs: readonly BenchmarkEvalCaseRun[];
  readonly scorecard: Awaited<ReturnType<typeof aggregateBenchmarkScorecard>>;
}

export interface SqlBenchmarkDataset {
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedBenchmarkCase[];
  readonly installed_digest: string;
  readonly database_path?: string;
  readonly database_path_by_case_id?: ReadonlyMap<string, string>;
}

export interface SqlBenchmarkSuiteConfig {
  readonly suite_id: BenchmarkTestSuiteId;
  readonly suite_version: string;
  readonly dataset_version: string;
  readonly source_commit: string;
  readonly oracle_version: string;
  readonly prompt_version: string;
  readonly workflow_version: string;
  readonly evaluator_version: string;
  readonly aggregator_version: string;
}

function statusFor(verdict: BenchmarkEvalAttempt["verdict"]): BenchmarkEvalCaseRun["status"] {
  switch (verdict) {
    case "PASS":
      return "PASS";
    case "FAIL":
      return "FAIL";
    case "INFRA_FAILURE":
      return "INFRA_FAILURE";
    case "INVALID_CASE":
      return "INVALID_CASE";
    case "ORACLE_FAILURE":
      return "ORACLE_FAILURE";
    case "CANCELLED":
      return "CANCELLED";
  }
}

async function failedAttempt(input: {
  readonly case_run_id: string;
  readonly attempt_index: 0 | 1;
  readonly trace_id: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly oracle_version: string;
}): Promise<BenchmarkEvalAttempt> {
  const feedbackDraft = {
    oracle_version: input.oracle_version,
    failure_type: "INFRA_FAILURE" as const,
    public_message: "Agent Adapter 未能产生可判分答案。",
    candidate_row_count: null,
    gold_row_count: null,
    candidate_column_count: null,
    gold_column_count: null,
  };
  const feedback = {
    ...feedbackDraft,
    oracle_receipt_hash: await sha256ContentHash(feedbackDraft),
  };
  const attemptDraft = {
    attempt_id: randomUUID(),
    case_run_id: input.case_run_id,
    attempt_index: input.attempt_index,
    answer: null,
    answer_hash: null,
    verdict: "INFRA_FAILURE" as const,
    oracle_feedback: feedback,
    usage: {
      availability: "UNAVAILABLE" as const,
      input_tokens: null,
      output_tokens: null,
      tool_calls: null,
    },
    latency_ms: 0,
    trace_id: input.trace_id,
    started_at: input.started_at,
    completed_at: input.completed_at,
  };
  return benchmarkEvalAttemptSchema.parse({
    ...attemptDraft,
    attempt_receipt_hash: await sha256ContentHash(attemptDraft),
  });
}

async function executeAttempt(input: {
  readonly case_run_id: string;
  readonly attempt_index: 0 | 1;
  readonly sql: string;
  readonly usage: BenchmarkEvalAttempt["usage"];
  readonly model_latency_ms: number;
  readonly trace_id: string;
  readonly started_at: string;
  readonly database_path: string;
  readonly gold_sql: string;
  readonly oracle: SqlResultOracle;
  readonly now: () => Date;
}): Promise<BenchmarkEvalAttempt> {
  const answer = { answer_type: "SQL" as const, sql: input.sql };
  const answerHash = await sha256ContentHash(answer);
  const oracleStarted = Date.now();
  const evaluation = await input.oracle.evaluate({
    database_path: input.database_path,
    candidate_sql: input.sql,
    gold_sql: input.gold_sql,
  });
  const completedAt = input.now().toISOString();
  const attemptDraft = {
    attempt_id: randomUUID(),
    case_run_id: input.case_run_id,
    attempt_index: input.attempt_index,
    answer,
    answer_hash: answerHash,
    verdict: evaluation.verdict,
    diagnostic_code: evaluation.diagnostic_code,
    oracle_feedback: evaluation.feedback,
    usage: input.usage,
    latency_ms: input.model_latency_ms + Math.max(0, Date.now() - oracleStarted),
    trace_id: input.trace_id,
    started_at: input.started_at,
    completed_at: completedAt,
  };
  return benchmarkEvalAttemptSchema.parse({
    ...attemptDraft,
    attempt_receipt_hash: await sha256ContentHash(attemptDraft),
  });
}

async function buildReflection(input: {
  readonly case_run_id: string;
  readonly attempt: BenchmarkEvalAttempt;
  readonly reflection: Awaited<ReturnType<BenchmarkEvalAgent["reflect"]>>;
  readonly created_at: string;
}): Promise<BenchmarkReflectionReceipt> {
  const failureType = input.attempt.oracle_feedback.failure_type ?? "ORACLE_MISMATCH";
  const draft = {
    reflection_id: randomUUID(),
    case_run_id: input.case_run_id,
    source_attempt_id: input.attempt.attempt_id,
    failure_type: failureType,
    evidence_receipt_hashes: [input.attempt.oracle_feedback.oracle_receipt_hash],
    mutable_scope: ["ANSWER_SQL"] as const,
    preserved_invariants: [
      "题目、数据库快照、Gold、Oracle 与预算保持不变。",
      "反省只允许修改当前 Case 的候选 SQL。",
      "不得读取 Gold SQL、Gold 结果值或其他题目。",
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

export async function executeSqlBenchmarkBatch(input: {
  readonly dataset: SqlBenchmarkDataset;
  readonly suite: SqlBenchmarkSuiteConfig;
  readonly case_ids: readonly string[];
  readonly agent: BenchmarkEvalAgent;
  readonly reflection_enabled: boolean;
  readonly budget: BenchmarkRunBudget;
  readonly seed: number;
  readonly batch_run_id?: string;
  readonly oracle?: SqlResultOracle;
  readonly now?: () => Date;
  readonly cancelled?: () => boolean;
}): Promise<BenchmarkBatchExecutionResult> {
  const now = input.now ?? (() => new Date());
  const batchRunId = input.batch_run_id ?? randomUUID();
  const selectedCases = input.case_ids.map((caseId) => {
    const publicCase = input.dataset.public_cases.find((candidate) => candidate.case_id === caseId);
    const sealedCase = input.dataset.sealed_cases.find(
      (candidate) => candidate.public_case.case_id === caseId,
    );
    if (!publicCase || !sealedCase) throw new Error("BENCHMARK_CASE_NOT_FOUND");
    if (publicCase.suite_version !== input.suite.suite_version) {
      throw new Error("BENCHMARK_CASE_VERSION_MISMATCH");
    }
    return { publicCase, sealedCase };
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
    suite_id: input.suite.suite_id,
    suite_version: input.suite.suite_version,
    dataset_version: input.suite.dataset_version,
    dataset_digest: input.dataset.installed_digest,
    source_commit: input.suite.source_commit,
    oracle_version: input.suite.oracle_version,
    agent: input.agent.descriptor,
    prompt_version: input.suite.prompt_version,
    workflow_version: input.suite.workflow_version,
    evaluator_version: input.suite.evaluator_version,
    aggregator_version: input.suite.aggregator_version,
    case_ids: selectedCases.map(({ publicCase }) => publicCase.case_id),
    seed: input.seed,
    budget: input.budget,
    frozen_at: frozenAt,
  };
  const manifest = benchmarkFrozenManifestSchema.parse({
    ...manifestDraft,
    manifest_hash: await sha256ContentHash(manifestDraft),
  });
  const oracle =
    input.oracle ??
    new SqliteResultOracle({
      timeout_ms: input.budget.max_case_duration_ms,
      oracle_version: input.suite.oracle_version,
    });
  const caseRuns: BenchmarkEvalCaseRun[] = [];

  for (const { publicCase, sealedCase } of selectedCases) {
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
    const databasePath =
      input.dataset.database_path_by_case_id?.get(publicCase.case_id) ??
      input.dataset.database_path;
    if (!databasePath) throw new Error("BENCHMARK_DATABASE_PATH_MISSING");
    let firstAttempt: BenchmarkEvalAttempt;
    try {
      const answer = await input.agent.answer({
        test_case: publicCase,
        seed: input.seed,
        invocation: {
          run_id: batchRunId,
          attempt_id: randomUUID(),
          timeout_ms: input.budget.max_case_duration_ms,
          max_output_tokens: input.budget.max_output_tokens_per_attempt,
        },
      });
      firstAttempt = await executeAttempt({
        case_run_id: caseRunId,
        attempt_index: 0,
        sql: answer.sql,
        usage: answer.usage,
        model_latency_ms: answer.latency_ms,
        trace_id: traceId,
        started_at: startedAt,
        database_path: databasePath,
        gold_sql: sealedCase.gold_sql,
        oracle,
        now,
      });
    } catch {
      const completedAt = now().toISOString();
      firstAttempt = await failedAttempt({
        case_run_id: caseRunId,
        attempt_index: 0,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: completedAt,
        oracle_version: input.suite.oracle_version,
      });
    }
    const attempts = [firstAttempt];
    let reflection: BenchmarkReflectionReceipt | null = null;
    if (
      firstAttempt.verdict === "FAIL" &&
      input.reflection_enabled &&
      input.agent.descriptor.supports_reflection &&
      firstAttempt.answer?.answer_type === "SQL"
    ) {
      let reflectionOutput: Awaited<ReturnType<BenchmarkEvalAgent["reflect"]>> | null = null;
      try {
        reflectionOutput = await input.agent.reflect({
          test_case: publicCase,
          prior_sql: firstAttempt.answer.sql,
          feedback: firstAttempt.oracle_feedback,
          seed: input.seed,
          invocation: {
            run_id: batchRunId,
            attempt_id: randomUUID(),
            timeout_ms: input.budget.max_case_duration_ms,
            max_output_tokens: input.budget.max_output_tokens_per_attempt,
          },
        });
      } catch {
        // A failed optional reflection must not discard the authoritative first attempt.
      }
      if (!reflectionOutput) {
        caseRuns.push(
          benchmarkEvalCaseRunSchema.parse({
            case_run_id: caseRunId,
            batch_run_id: batchRunId,
            case_id: publicCase.case_id,
            ordinal: publicCase.ordinal,
            status: statusFor(firstAttempt.verdict),
            attempts,
            reflection: null,
            normalized_score: 0,
            trace_id: traceId,
            started_at: startedAt,
            completed_at: now().toISOString(),
          }),
        );
        continue;
      }
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
        attempts.push(
          await executeAttempt({
            case_run_id: caseRunId,
            attempt_index: 1,
            sql: reflectionOutput.revised_answer.sql,
            usage: reflectionOutput.revised_answer.usage,
            model_latency_ms: reflectionOutput.revised_answer.latency_ms,
            trace_id: traceId,
            started_at: now().toISOString(),
            database_path: databasePath,
            gold_sql: sealedCase.gold_sql,
            oracle,
            now,
          }),
        );
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
        normalized_score:
          terminalAttempt.verdict === "PASS" ? 100 : terminalAttempt.verdict === "FAIL" ? 0 : null,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: now().toISOString(),
      }),
    );
  }
  const scorecard = await aggregateBenchmarkScorecard({
    batch_run_id: batchRunId,
    suite_id: input.suite.suite_id,
    suite_version: manifest.suite_version,
    dataset_version: manifest.dataset_version,
    oracle_version: manifest.oracle_version,
    case_runs: caseRuns,
    cases: selectedCases.map(({ publicCase }) => publicCase),
    generated_at: now().toISOString(),
  });
  return Object.freeze({
    manifest,
    case_runs: Object.freeze(caseRuns),
    scorecard,
  });
}

export async function executeBirdBenchmarkBatch(
  input: Omit<Parameters<typeof executeSqlBenchmarkBatch>[0], "suite">,
): Promise<BenchmarkBatchExecutionResult> {
  return executeSqlBenchmarkBatch({
    ...input,
    suite: {
      suite_id: "bird-mini-dev",
      suite_version: "1.0.0",
      dataset_version: "bird-mini-dev-v1-2024-06",
      source_commit: "b3d4bcbbae9a96934ad812551eb400c7a3b23c12",
      oracle_version: ORACLE_VERSION,
      prompt_version: PROMPT_VERSION,
      workflow_version: WORKFLOW_VERSION,
      evaluator_version: EVALUATOR_VERSION,
      aggregator_version: AGGREGATOR_VERSION,
    },
  });
}
