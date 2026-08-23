import { randomUUID } from "node:crypto";
import {
  type BenchmarkEvalCaseRun,
  type BenchmarkFrozenManifest,
  type BenchmarkOracleFeedback,
  type BenchmarkReflectionReceipt,
  type BenchmarkRunBudget,
  benchmarkEvalAttemptSchema,
  benchmarkEvalCaseRunSchema,
  benchmarkFrozenManifestSchema,
  benchmarkOracleFeedbackSchema,
  benchmarkReflectionReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { BladeDataset } from "./blade-dataset.js";
import type { BenchmarkMultipleChoiceAgent } from "./model-multiple-choice-agent.js";
import { aggregateBenchmarkScorecard } from "./scorecard.js";

const ORACLE_VERSION = "blade-exact-choice@1.0.0";
const PROMPT_VERSION = "blade-multiple-choice@1.2.0";
const WORKFLOW_VERSION = "test-center-multiple-choice-runner@1.1.0";
const EVALUATOR_VERSION = "blade-exact-choice-evaluator@1.0.0";

function safeDiagnosticCode(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = Reflect.get(error, "diagnostic_code");
    if (typeof candidate === "string" && /^[A-Z][A-Z0-9_]*$/u.test(candidate)) return candidate;
  }
  return "MULTIPLE_CHOICE_AGENT_FAILED";
}

async function feedback(pass: boolean): Promise<BenchmarkOracleFeedback> {
  const material = {
    oracle_version: ORACLE_VERSION,
    failure_type: pass ? null : ("METRIC_BELOW_THRESHOLD" as const),
    public_message: pass
      ? "候选选项与封存答案一致。"
      : "候选选项与封存答案不一致；请重新检查 MOST/LEAST 方向和变量操作化语义。",
    candidate_row_count: null,
    gold_row_count: null,
    candidate_column_count: null,
    gold_column_count: null,
    metric_scores: { exact_choice: pass ? 1 : 0 },
  };
  return benchmarkOracleFeedbackSchema.parse({
    ...material,
    oracle_receipt_hash: await sha256ContentHash(material),
  });
}

async function infraFeedback(): Promise<BenchmarkOracleFeedback> {
  const material = {
    oracle_version: ORACLE_VERSION,
    failure_type: "INFRA_FAILURE" as const,
    public_message: "认证模型 Agent 未能生成符合契约的选择题答案。",
    candidate_row_count: null,
    gold_row_count: null,
    candidate_column_count: null,
    gold_column_count: null,
  };
  return benchmarkOracleFeedbackSchema.parse({
    ...material,
    oracle_receipt_hash: await sha256ContentHash(material),
  });
}

async function manifest(input: {
  readonly dataset: BladeDataset;
  readonly case_ids: readonly string[];
  readonly agent: BenchmarkMultipleChoiceAgent;
  readonly seed: number;
  readonly budget: BenchmarkRunBudget;
  readonly frozen_at: string;
}): Promise<BenchmarkFrozenManifest> {
  const draft = {
    manifest_version: "1.0.0",
    suite_id: "blade" as const,
    suite_version: "1.0.0",
    dataset_version: "blade-mcq-smoke-v1",
    dataset_digest: input.dataset.installed_digest,
    source_commit: "6118fa8d5007b91aa8c91c518182db82446a4547",
    oracle_version: ORACLE_VERSION,
    agent: input.agent.descriptor,
    prompt_version: PROMPT_VERSION,
    workflow_version: WORKFLOW_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    aggregator_version: "test-center-aggregator@1.0.0",
    case_ids: [...input.case_ids],
    seed: input.seed,
    budget: input.budget,
    frozen_at: input.frozen_at,
  };
  return benchmarkFrozenManifestSchema.parse({
    ...draft,
    manifest_hash: await sha256ContentHash(draft),
  });
}

export async function executeMultipleChoiceBenchmarkBatch(input: {
  readonly dataset: BladeDataset;
  readonly case_ids: readonly string[];
  readonly agent: BenchmarkMultipleChoiceAgent;
  readonly budget: BenchmarkRunBudget;
  readonly reflection_enabled: boolean;
  readonly seed: number;
  readonly batch_run_id?: string;
  readonly now?: () => Date;
}) {
  if (input.case_ids.length === 0 || input.case_ids.length > input.budget.max_cases) {
    throw new Error("BENCHMARK_CASE_SELECTION_INVALID");
  }
  const byId = new Map(input.dataset.public_cases.map((testCase) => [testCase.case_id, testCase]));
  const sealedById = new Map(
    input.dataset.sealed_cases.map((testCase) => [testCase.public_case.case_id, testCase]),
  );
  const selected = input.case_ids.map((caseId) => {
    const publicCase = byId.get(caseId);
    const sealedCase = sealedById.get(caseId);
    if (!publicCase || !sealedCase) throw new Error("BENCHMARK_CASE_NOT_FOUND");
    return { publicCase, sealedCase };
  });
  const now = input.now ?? (() => new Date());
  const batchRunId = input.batch_run_id ?? randomUUID();
  const frozenAt = now().toISOString();
  const frozenManifest = await manifest({
    dataset: input.dataset,
    case_ids: input.case_ids,
    agent: input.agent,
    seed: input.seed,
    budget: input.budget,
    frozen_at: frozenAt,
  });
  const caseRuns: BenchmarkEvalCaseRun[] = [];
  for (const [ordinal, item] of selected.entries()) {
    const caseRunId = randomUUID();
    const attemptId = randomUUID();
    const traceId = randomUUID();
    const startedAt = now().toISOString();
    try {
      const generated = await input.agent.answer({
        test_case: item.publicCase,
        seed: input.seed + ordinal,
        invocation: {
          run_id: batchRunId,
          attempt_id: attemptId,
          timeout_ms: input.budget.max_case_duration_ms,
          max_output_tokens: input.budget.max_output_tokens_per_attempt,
        },
      });
      const firstPass = generated.answer.choice === item.sealedCase.correct_choice;
      const oracleFeedback = await feedback(firstPass);
      const answerHash = await sha256ContentHash(generated.answer);
      const attemptDraft = {
        attempt_id: attemptId,
        case_run_id: caseRunId,
        attempt_index: 0,
        answer: generated.answer,
        answer_hash: answerHash,
        verdict: firstPass ? ("PASS" as const) : ("FAIL" as const),
        diagnostic_code: null,
        oracle_feedback: oracleFeedback,
        usage: generated.usage,
        latency_ms: generated.latency_ms,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: now().toISOString(),
      };
      const firstAttempt = benchmarkEvalAttemptSchema.parse({
        ...attemptDraft,
        attempt_receipt_hash: await sha256ContentHash(attemptDraft),
      });
      const attempts = [firstAttempt];
      let finalPass = firstPass;
      let finalStatus: "PASS" | "FAIL" | "INFRA_FAILURE" = firstPass ? "PASS" : "FAIL";
      let reflection: BenchmarkReflectionReceipt | null = null;
      if (!firstPass && input.reflection_enabled && input.budget.max_attempts_per_case > 1) {
        const reflectionDraft = {
          reflection_id: randomUUID(),
          case_run_id: caseRunId,
          source_attempt_id: firstAttempt.attempt_id,
          failure_type: "METRIC_BELOW_THRESHOLD" as const,
          evidence_receipt_hashes: [oracleFeedback.oracle_receipt_hash],
          mutable_scope: ["MULTIPLE_CHOICE"] as const,
          preserved_invariants: [
            "Public question, research context, option texts, dataset version, and sealed answer remain immutable.",
          ],
          diagnosis_summary:
            "Exact-choice Oracle confirmed only that the prior choice was wrong; the correct choice remains sealed.",
          proposed_actions: [
            "Exclude the prior choice and independently compare the remaining options against MOST/LEAST direction and analytic role.",
          ],
          confidence: 1,
          retry_recommendation: "APPROVED" as const,
          created_at: now().toISOString(),
        };
        reflection = benchmarkReflectionReceiptSchema.parse({
          ...reflectionDraft,
          reflection_receipt_hash: await sha256ContentHash(reflectionDraft),
        });
        const retryAttemptId = randomUUID();
        const retryStartedAt = now().toISOString();
        try {
          const retried = await input.agent.answer({
            test_case: item.publicCase,
            seed: input.seed + ordinal + 10_000,
            excluded_choices: [generated.answer.choice],
            invocation: {
              run_id: batchRunId,
              attempt_id: retryAttemptId,
              timeout_ms: input.budget.max_case_duration_ms,
              max_output_tokens: input.budget.max_output_tokens_per_attempt,
            },
          });
          finalPass = retried.answer.choice === item.sealedCase.correct_choice;
          finalStatus = finalPass ? "PASS" : "FAIL";
          const retryFeedback = await feedback(finalPass);
          const retryDraft = {
            attempt_id: retryAttemptId,
            case_run_id: caseRunId,
            attempt_index: 1,
            answer: retried.answer,
            answer_hash: await sha256ContentHash(retried.answer),
            verdict: finalPass ? ("PASS" as const) : ("FAIL" as const),
            diagnostic_code: null,
            oracle_feedback: retryFeedback,
            usage: retried.usage,
            latency_ms: retried.latency_ms,
            trace_id: traceId,
            started_at: retryStartedAt,
            completed_at: now().toISOString(),
          };
          attempts.push(
            benchmarkEvalAttemptSchema.parse({
              ...retryDraft,
              attempt_receipt_hash: await sha256ContentHash(retryDraft),
            }),
          );
        } catch (error) {
          finalStatus = "INFRA_FAILURE";
          const retryFeedback = await infraFeedback();
          const retryDraft = {
            attempt_id: retryAttemptId,
            case_run_id: caseRunId,
            attempt_index: 1,
            answer: null,
            answer_hash: null,
            verdict: "INFRA_FAILURE" as const,
            diagnostic_code: safeDiagnosticCode(error),
            oracle_feedback: retryFeedback,
            usage: {
              availability: "UNAVAILABLE" as const,
              input_tokens: null,
              output_tokens: null,
              tool_calls: null,
            },
            latency_ms: 0,
            trace_id: traceId,
            started_at: retryStartedAt,
            completed_at: now().toISOString(),
          };
          attempts.push(
            benchmarkEvalAttemptSchema.parse({
              ...retryDraft,
              attempt_receipt_hash: await sha256ContentHash(retryDraft),
            }),
          );
        }
      }
      caseRuns.push(
        benchmarkEvalCaseRunSchema.parse({
          case_run_id: caseRunId,
          batch_run_id: batchRunId,
          case_id: item.publicCase.case_id,
          ordinal,
          status: finalStatus,
          attempts,
          reflection,
          normalized_score: finalStatus === "INFRA_FAILURE" ? null : finalPass ? 100 : 0,
          trace_id: traceId,
          started_at: startedAt,
          completed_at: attempts.at(-1)?.completed_at ?? firstAttempt.completed_at,
        }),
      );
    } catch (error) {
      const oracleFeedback = await infraFeedback();
      const attemptDraft = {
        attempt_id: attemptId,
        case_run_id: caseRunId,
        attempt_index: 0,
        answer: null,
        answer_hash: null,
        verdict: "INFRA_FAILURE" as const,
        diagnostic_code: safeDiagnosticCode(error),
        oracle_feedback: oracleFeedback,
        usage: {
          availability: "UNAVAILABLE" as const,
          input_tokens: null,
          output_tokens: null,
          tool_calls: null,
        },
        latency_ms: 0,
        trace_id: traceId,
        started_at: startedAt,
        completed_at: now().toISOString(),
      };
      const attempt = benchmarkEvalAttemptSchema.parse({
        ...attemptDraft,
        attempt_receipt_hash: await sha256ContentHash(attemptDraft),
      });
      caseRuns.push(
        benchmarkEvalCaseRunSchema.parse({
          case_run_id: caseRunId,
          batch_run_id: batchRunId,
          case_id: item.publicCase.case_id,
          ordinal,
          status: "INFRA_FAILURE",
          attempts: [attempt],
          reflection: null,
          normalized_score: null,
          trace_id: traceId,
          started_at: startedAt,
          completed_at: attempt.completed_at,
        }),
      );
    }
  }
  const scorecard = await aggregateBenchmarkScorecard({
    batch_run_id: batchRunId,
    suite_id: "blade",
    suite_version: "1.0.0",
    dataset_version: "blade-mcq-smoke-v1",
    oracle_version: ORACLE_VERSION,
    case_runs: caseRuns,
    cases: selected.map((item) => item.publicCase),
  });
  return { manifest: frozenManifest, case_runs: Object.freeze(caseRuns), scorecard };
}
