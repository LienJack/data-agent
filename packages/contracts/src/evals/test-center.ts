import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

/**
 * Public benchmark identities are deliberately separate from the historical
 * BenchmarkSuite enum. A public suite only joins the authoritative Eval
 * artifact protocol after its importer and oracle are both production-ready.
 */
export const benchmarkTestSuiteIdSchema = z.enum([
  "bird-mini-dev",
  "dr-spider",
  "insightbench",
  "bird-critic",
  "dab",
  "blade",
  "datascibench",
  "scienceagentbench",
  "spreadsheetbench-2",
  "agenticdatabench-ecommerce",
  "ecommerce-production",
]);

export const benchmarkDatasetStatusSchema = z.enum([
  "NOT_DOWNLOADED",
  "DOWNLOADING",
  "READY",
  "LICENSE_BLOCKED",
  "ACCESS_GATED",
  "INVALID",
  "UPDATE_AVAILABLE",
]);

export const benchmarkCapabilitySchema = z.enum([
  "TEXT_TO_SQL",
  "SQL_ROBUSTNESS",
  "ANALYSIS_REPORT",
  "SQL_REPAIR",
  "DATA_AGENT_END_TO_END",
  "MULTIPLE_CHOICE",
  "PYTHON_ANALYSIS",
]);

export const benchmarkOracleKindSchema = z.enum([
  "SQL_RESULT_EQUIVALENCE",
  "PAIRED_SQL_ROBUSTNESS",
  "RULE_METRICS_WITH_JUDGE",
  "SQL_TEST_CASES",
  "EXTERNAL_VALIDATOR",
  "EXACT_CHOICE",
  "ARTIFACT_RULES",
]);

export const benchmarkLicenseSchema = z.strictObject({
  spdx_id: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  attribution_required: z.boolean(),
  redistribution_allowed: z.boolean(),
  source_url: z.url(),
});

export const benchmarkSourceSchema = z.strictObject({
  repository_url: z.url(),
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  dataset_version: versionIdentifierSchema,
  download_url: z.url().nullable(),
  archive_sha256: contentHashSchema.nullable(),
  archive_bytes: z.number().int().positive().nullable(),
});

export const benchmarkCatalogEntrySchema = z
  .strictObject({
    suite_id: benchmarkTestSuiteIdSchema,
    suite_version: versionIdentifierSchema,
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(2_048),
    source: benchmarkSourceSchema,
    license: benchmarkLicenseSchema,
    capabilities: z.array(benchmarkCapabilitySchema).min(1).max(16),
    oracle_kind: benchmarkOracleKindSchema,
    oracle_version: versionIdentifierSchema,
    case_count: z.number().int().nonnegative(),
    smoke_case_count: z.number().int().nonnegative(),
    dataset_status: benchmarkDatasetStatusSchema,
    status_reason: z.string().min(1).max(1_024).nullable(),
    previewable: z.boolean(),
    runnable: z.boolean(),
    supports_reflection: z.boolean(),
    installed_digest: contentHashSchema.nullable(),
    updated_at: timestampSchema,
  })
  .superRefine((suite, ctx) => {
    if (suite.smoke_case_count > suite.case_count) {
      ctx.addIssue({
        code: "custom",
        path: ["smoke_case_count"],
        message: "Smoke Case 数量不能超过题库总题数。",
      });
    }
    if (suite.runnable !== (suite.dataset_status === "READY")) {
      ctx.addIssue({
        code: "custom",
        path: ["runnable"],
        message: "只有摘要和许可证均已验证的 READY 数据集可以运行。",
      });
    }
    if (suite.runnable && !suite.previewable) {
      ctx.addIssue({
        code: "custom",
        path: ["previewable"],
        message: "可运行题库必须同时允许预览公开题面。",
      });
    }
    if (suite.dataset_status !== "READY" && suite.installed_digest !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["installed_digest"],
        message: "未就绪的数据集不能声明已安装摘要。",
      });
    }
  });

export const benchmarkCaseDifficultySchema = z.enum(["simple", "moderate", "challenging"]);
export const benchmarkRegistrySchema = z.enum(["DEMO", "TUNING", "HOLDOUT"]);

export const benchmarkColumnSchema = z.strictObject({
  name: z.string().min(1).max(128),
  data_type: z.string().min(1).max(128),
  nullable: z.boolean(),
  primary_key: z.boolean(),
});

export const benchmarkTableSchema = z.strictObject({
  name: z.string().min(1).max(128),
  columns: z.array(benchmarkColumnSchema).min(1).max(256),
});

/** This is the only case shape allowed across the browser/agent boundary. */
export const publicBenchmarkCaseSchema = z.strictObject({
  case_id: immutableIdSchema,
  suite_id: benchmarkTestSuiteIdSchema,
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  ordinal: z.number().int().nonnegative(),
  database_id: z.string().min(1).max(128),
  question: z.string().min(1).max(20_000),
  evidence: z.string().min(1).max(20_000).nullable(),
  difficulty: benchmarkCaseDifficultySchema,
  capabilities: z.array(benchmarkCapabilitySchema).min(1).max(16),
  registry: benchmarkRegistrySchema,
  schema: z.array(benchmarkTableSchema).max(256),
  public_case_hash: contentHashSchema,
});

/** Server-only case material. Never serialize this shape from a public route. */
export const sealedBenchmarkCaseSchema = z.strictObject({
  public_case: publicBenchmarkCaseSchema,
  database_relative_path: z.string().min(1).max(1_024),
  gold_sql: z.string().min(1).max(100_000),
  sealed_case_hash: contentHashSchema,
});

/** Server-only InsightBench reference material. It must never cross a public route. */
export const sealedInsightBenchmarkCaseSchema = z.strictObject({
  public_case: publicBenchmarkCaseSchema,
  data_relative_path: z.string().min(1).max(1_024),
  reference_summary: z.string().min(1).max(100_000),
  reference_insights: z.array(z.string().min(1).max(20_000)).min(1).max(128),
  reference_values: z.array(z.string().min(1).max(1_024)).max(1_024),
  sealed_case_hash: contentHashSchema,
});

/** Server-only exact-choice truth. The correct choice must never cross a public route. */
export const sealedMultipleChoiceBenchmarkCaseSchema = z.strictObject({
  public_case: publicBenchmarkCaseSchema,
  correct_choice: z.enum(["A", "B", "C", "D"]),
  sealed_case_hash: contentHashSchema,
});

export const benchmarkAgentKindSchema = z.enum([
  "PUBLISHED_BASELINE",
  "OPENAI_SQL_BASELINE",
  "SUBMITTED_ANSWER",
  "DETERMINISTIC_ANALYSIS_BASELINE",
  "CERTIFIED_MODEL_ANALYSIS",
  "CERTIFIED_MODEL_SQL",
  "CERTIFIED_MODEL_MULTIPLE_CHOICE",
]);

/** Stable identities shared by API routing, runners, and the browser client. */
export const PUBLISHED_BASELINE_AGENT_ID = "b4854ba6-a9ad-5038-9c36-a0300f30de7f";
export const SUBMITTED_ANSWER_AGENT_ID = "8bb0cb75-1209-51b7-a668-017155d4f486";
export const PROFILE_ANALYSIS_AGENT_ID = "455edddc-3cf8-4dcd-9292-b4fa10a04865";
export const CERTIFIED_MODEL_ANALYSIS_AGENT_ID = "5be0a3c2-48e5-4d75-a7fa-180a5dccbc51";
export const CERTIFIED_MODEL_SQL_AGENT_ID = "3dd97ccd-170f-5f8a-a734-38a2ff0b886e";
export const CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID = "f1a4546a-7619-56a7-9d55-e49ddda3cd11";

export const benchmarkAgentDescriptorSchema = z.strictObject({
  agent_id: immutableIdSchema,
  agent_version: versionIdentifierSchema,
  display_name: z.string().min(1).max(128),
  kind: benchmarkAgentKindSchema,
  provider: z.string().min(1).max(128).nullable(),
  model_id: z.string().min(1).max(256).nullable(),
  available: z.boolean(),
  unavailable_reason: z.string().min(1).max(1_024).nullable(),
  supports_reflection: z.boolean(),
});

export const benchmarkRunBudgetSchema = z.strictObject({
  max_cases: z.number().int().positive().max(100),
  max_attempts_per_case: z.number().int().min(1).max(2),
  max_case_duration_ms: z.number().int().positive().max(600_000),
  max_batch_duration_ms: z.number().int().positive().max(3_600_000),
  max_output_tokens_per_attempt: z.number().int().positive().max(32_768),
  max_cost_micros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  concurrency: z.number().int().positive().max(8),
});

export const createBenchmarkRunInputSchema = z
  .strictObject({
    suite_id: benchmarkTestSuiteIdSchema,
    suite_version: versionIdentifierSchema,
    case_ids: z.array(immutableIdSchema).min(1).max(100),
    agent_id: immutableIdSchema,
    reflection_enabled: z.boolean(),
    seed: z.number().int().nonnegative().max(2_147_483_647),
    budget: benchmarkRunBudgetSchema,
    submitted_answers: z.record(immutableIdSchema, z.string().min(1).max(100_000)).optional(),
  })
  .superRefine((input, ctx) => {
    if (new Set(input.case_ids).size !== input.case_ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["case_ids"],
        message: "同一批次不能重复选择题目。",
      });
    }
    if (input.case_ids.length > input.budget.max_cases) {
      ctx.addIssue({
        code: "custom",
        path: ["budget", "max_cases"],
        message: "冻结预算不足以覆盖所选题目。",
      });
    }
    const submittedIds = Object.keys(input.submitted_answers ?? {});
    if (submittedIds.some((caseId) => !input.case_ids.includes(caseId))) {
      ctx.addIssue({
        code: "custom",
        path: ["submitted_answers"],
        message: "提交答案不能包含批次之外的题目。",
      });
    }
  });

export const benchmarkFrozenManifestSchema = z.strictObject({
  manifest_version: versionIdentifierSchema,
  suite_id: benchmarkTestSuiteIdSchema,
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  dataset_digest: contentHashSchema,
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  oracle_version: versionIdentifierSchema,
  agent: benchmarkAgentDescriptorSchema,
  prompt_version: versionIdentifierSchema,
  workflow_version: versionIdentifierSchema,
  evaluator_version: versionIdentifierSchema,
  aggregator_version: versionIdentifierSchema,
  case_ids: z.array(immutableIdSchema).min(1).max(100),
  seed: z.number().int().nonnegative(),
  budget: benchmarkRunBudgetSchema,
  frozen_at: timestampSchema,
  manifest_hash: contentHashSchema,
});

export const benchmarkAttemptVerdictSchema = z.enum([
  "PASS",
  "FAIL",
  "INFRA_FAILURE",
  "INVALID_CASE",
  "ORACLE_FAILURE",
  "CANCELLED",
]);

export const benchmarkFailureTypeSchema = z.enum([
  "SQL_EXECUTION",
  "ORACLE_MISMATCH",
  "TIMEOUT",
  "SAFETY_VIOLATION",
  "INVALID_CASE",
  "INFRA_FAILURE",
  "ORACLE_FAILURE",
  "REFLECTION_UNAVAILABLE",
  "METRIC_BELOW_THRESHOLD",
]);

export const benchmarkSqlAnswerSchema = z.strictObject({
  answer_type: z.literal("SQL"),
  sql: z.string().min(1).max(100_000),
});

export const benchmarkAnalysisInsightSchema = z.strictObject({
  title: z.string().min(1).max(512),
  finding: z.string().min(1).max(4_096),
  evidence: z.string().min(1).max(4_096),
  recommendation: z.string().min(1).max(4_096),
});

export const benchmarkAnalysisReportSchema = z.strictObject({
  answer_type: z.literal("ANALYSIS_REPORT"),
  summary: z.string().min(1).max(20_000),
  insights: z.array(benchmarkAnalysisInsightSchema).min(1).max(64),
});

export const benchmarkMultipleChoiceAnswerSchema = z.strictObject({
  answer_type: z.literal("MULTIPLE_CHOICE"),
  choice: z.enum(["A", "B", "C", "D"]),
  rationale: z.string().min(1).max(4_096),
});

export const benchmarkAnswerSchema = z.discriminatedUnion("answer_type", [
  benchmarkSqlAnswerSchema,
  benchmarkAnalysisReportSchema,
  benchmarkMultipleChoiceAnswerSchema,
]);

export const benchmarkUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_micros: z.number().int().nonnegative(),
  currency: z.literal("USD"),
});

export const benchmarkOracleFeedbackSchema = z.strictObject({
  oracle_version: versionIdentifierSchema,
  failure_type: benchmarkFailureTypeSchema.nullable(),
  public_message: z.string().min(1).max(2_048),
  candidate_row_count: z.number().int().nonnegative().nullable(),
  gold_row_count: z.number().int().nonnegative().nullable(),
  candidate_column_count: z.number().int().nonnegative().nullable(),
  gold_column_count: z.number().int().nonnegative().nullable(),
  metric_scores: z.record(z.string().min(1).max(128), z.number().min(0).max(1)).optional(),
  oracle_receipt_hash: contentHashSchema,
});

export const benchmarkEvalAttemptSchema = z.strictObject({
  attempt_id: immutableIdSchema,
  case_run_id: immutableIdSchema,
  attempt_index: z.number().int().min(0).max(1),
  answer: benchmarkAnswerSchema.nullable(),
  answer_hash: contentHashSchema.nullable(),
  verdict: benchmarkAttemptVerdictSchema,
  /** Stable, non-secret infrastructure diagnostic; never contains upstream error text. */
  diagnostic_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .nullable()
    .optional(),
  oracle_feedback: benchmarkOracleFeedbackSchema,
  usage: benchmarkUsageSchema,
  latency_ms: z.number().int().nonnegative(),
  trace_id: immutableIdSchema,
  started_at: timestampSchema,
  completed_at: timestampSchema,
  attempt_receipt_hash: contentHashSchema,
});

export const benchmarkReflectionReceiptSchema = z.strictObject({
  reflection_id: immutableIdSchema,
  case_run_id: immutableIdSchema,
  source_attempt_id: immutableIdSchema,
  failure_type: benchmarkFailureTypeSchema,
  evidence_receipt_hashes: z.array(contentHashSchema).min(1).max(16),
  mutable_scope: z.union([
    z.tuple([z.literal("ANSWER_SQL")]),
    z.tuple([z.literal("ANALYSIS_REPORT")]),
    z.tuple([z.literal("MULTIPLE_CHOICE")]),
  ]),
  preserved_invariants: z.array(z.string().min(1).max(512)).min(1).max(16),
  diagnosis_summary: z.string().min(1).max(2_048),
  proposed_actions: z.array(z.string().min(1).max(1_024)).min(1).max(16),
  confidence: z.number().min(0).max(1),
  retry_recommendation: z.enum(["APPROVED", "REJECTED"]),
  created_at: timestampSchema,
  reflection_receipt_hash: contentHashSchema,
});

export const benchmarkCaseRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASS",
  "FAIL",
  "INFRA_FAILURE",
  "INVALID_CASE",
  "ORACLE_FAILURE",
  "CANCELLED",
]);

export const benchmarkEvalCaseRunSchema = z.strictObject({
  case_run_id: immutableIdSchema,
  batch_run_id: immutableIdSchema,
  case_id: immutableIdSchema,
  ordinal: z.number().int().nonnegative(),
  status: benchmarkCaseRunStatusSchema,
  attempts: z.array(benchmarkEvalAttemptSchema).max(2),
  reflection: benchmarkReflectionReceiptSchema.nullable(),
  normalized_score: z.number().min(0).max(100).nullable(),
  trace_id: immutableIdSchema,
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
});

export const benchmarkBatchRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "FAILED",
]);

export const benchmarkFailureCountSchema = z.strictObject({
  failure_type: benchmarkFailureTypeSchema,
  count: z.number().int().nonnegative(),
});

export const benchmarkScoreSliceSchema = z.strictObject({
  slice_type: z.enum(["difficulty", "database", "capability"]),
  slice_value: z.string().min(1).max(128),
  valid_cases: z.number().int().nonnegative(),
  first_pass_passed: z.number().int().nonnegative(),
  final_passed: z.number().int().nonnegative(),
  first_pass_pass_rate: z.number().min(0).max(1).nullable(),
  post_reflection_pass_rate: z.number().min(0).max(1).nullable(),
});

export const benchmarkBatchScorecardSchema = z.strictObject({
  scorecard_id: immutableIdSchema,
  scorecard_version: z.number().int().positive(),
  batch_run_id: immutableIdSchema,
  suite_id: benchmarkTestSuiteIdSchema,
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  oracle_version: versionIdentifierSchema,
  aggregator_version: versionIdentifierSchema,
  total_cases: z.number().int().nonnegative(),
  valid_cases: z.number().int().nonnegative(),
  first_pass_passed: z.number().int().nonnegative(),
  final_passed: z.number().int().nonnegative(),
  recovered_cases: z.number().int().nonnegative(),
  regressed_cases: z.number().int().nonnegative(),
  agent_failed_cases: z.number().int().nonnegative(),
  infra_failed_cases: z.number().int().nonnegative(),
  invalid_cases: z.number().int().nonnegative(),
  first_pass_pass_rate: z.number().min(0).max(1).nullable(),
  post_reflection_pass_rate: z.number().min(0).max(1).nullable(),
  recovery_rate: z.number().min(0).max(1).nullable(),
  regression_rate: z.number().min(0).max(1).nullable(),
  total_latency_ms: z.number().int().nonnegative(),
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_cost_micros: z.number().int().nonnegative(),
  failure_taxonomy: z.array(benchmarkFailureCountSchema).max(32),
  slices: z.array(benchmarkScoreSliceSchema).max(256),
  generated_at: timestampSchema,
  scorecard_hash: contentHashSchema,
});

export const benchmarkEvalBatchRunSchema = z.strictObject({
  batch_run_id: immutableIdSchema,
  status: benchmarkBatchRunStatusSchema,
  manifest: benchmarkFrozenManifestSchema,
  reflection_enabled: z.boolean(),
  total_cases: z.number().int().positive(),
  completed_cases: z.number().int().nonnegative(),
  passed_cases: z.number().int().nonnegative(),
  failed_cases: z.number().int().nonnegative(),
  infra_failed_cases: z.number().int().nonnegative(),
  cancelled_cases: z.number().int().nonnegative(),
  event_cursor: z.number().int().nonnegative(),
  case_runs: z.array(benchmarkEvalCaseRunSchema).max(100),
  scorecard: benchmarkBatchScorecardSchema.nullable(),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
});

const benchmarkEventBase = {
  batch_run_id: immutableIdSchema,
  sequence: z.number().int().positive(),
  observed_at: timestampSchema,
} as const;

export const benchmarkEvalEventSchema = z.discriminatedUnion("event_type", [
  z.strictObject({ ...benchmarkEventBase, event_type: z.literal("BATCH_ACCEPTED") }),
  z.strictObject({ ...benchmarkEventBase, event_type: z.literal("BATCH_STARTED") }),
  z.strictObject({
    ...benchmarkEventBase,
    event_type: z.literal("CASE_STARTED"),
    case_run_id: immutableIdSchema,
    case_id: immutableIdSchema,
  }),
  z.strictObject({
    ...benchmarkEventBase,
    event_type: z.literal("ATTEMPT_COMPLETED"),
    case_run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    attempt_index: z.number().int().min(0).max(1),
    verdict: benchmarkAttemptVerdictSchema,
  }),
  z.strictObject({
    ...benchmarkEventBase,
    event_type: z.literal("REFLECTION_COMPLETED"),
    case_run_id: immutableIdSchema,
    reflection_id: immutableIdSchema,
    retry_recommendation: z.enum(["APPROVED", "REJECTED"]),
  }),
  z.strictObject({
    ...benchmarkEventBase,
    event_type: z.literal("CASE_COMPLETED"),
    case_run_id: immutableIdSchema,
    case_id: immutableIdSchema,
    status: benchmarkCaseRunStatusSchema,
  }),
  z.strictObject({ ...benchmarkEventBase, event_type: z.literal("BATCH_CANCEL_REQUESTED") }),
  z.strictObject({ ...benchmarkEventBase, event_type: z.literal("BATCH_COMPLETED") }),
  z.strictObject({ ...benchmarkEventBase, event_type: z.literal("BATCH_CANCELLED") }),
  z.strictObject({
    ...benchmarkEventBase,
    event_type: z.literal("BATCH_FAILED"),
    failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/),
  }),
]);

export type BenchmarkTestSuiteId = z.infer<typeof benchmarkTestSuiteIdSchema>;
export type BenchmarkDatasetStatus = z.infer<typeof benchmarkDatasetStatusSchema>;
export type BenchmarkCatalogEntry = z.infer<typeof benchmarkCatalogEntrySchema>;
export type PublicBenchmarkCase = z.infer<typeof publicBenchmarkCaseSchema>;
export type SealedBenchmarkCase = z.infer<typeof sealedBenchmarkCaseSchema>;
export type SealedInsightBenchmarkCase = z.infer<typeof sealedInsightBenchmarkCaseSchema>;
export type SealedMultipleChoiceBenchmarkCase = z.infer<
  typeof sealedMultipleChoiceBenchmarkCaseSchema
>;
export type BenchmarkAgentDescriptor = z.infer<typeof benchmarkAgentDescriptorSchema>;
export type BenchmarkAnalysisReport = z.infer<typeof benchmarkAnalysisReportSchema>;
export type BenchmarkMultipleChoiceAnswer = z.infer<typeof benchmarkMultipleChoiceAnswerSchema>;
export type BenchmarkAnswer = z.infer<typeof benchmarkAnswerSchema>;
export type CreateBenchmarkRunInput = z.infer<typeof createBenchmarkRunInputSchema>;
export type BenchmarkFrozenManifest = z.infer<typeof benchmarkFrozenManifestSchema>;
export type BenchmarkEvalAttempt = z.infer<typeof benchmarkEvalAttemptSchema>;
export type BenchmarkReflectionReceipt = z.infer<typeof benchmarkReflectionReceiptSchema>;
export type BenchmarkEvalCaseRun = z.infer<typeof benchmarkEvalCaseRunSchema>;
export type BenchmarkEvalBatchRun = z.infer<typeof benchmarkEvalBatchRunSchema>;
export type BenchmarkBatchScorecard = z.infer<typeof benchmarkBatchScorecardSchema>;
export type BenchmarkEvalEvent = z.infer<typeof benchmarkEvalEventSchema>;
export type BenchmarkAttemptVerdict = z.infer<typeof benchmarkAttemptVerdictSchema>;
export type BenchmarkFailureType = z.infer<typeof benchmarkFailureTypeSchema>;
export type BenchmarkRunBudget = z.infer<typeof benchmarkRunBudgetSchema>;
export type BenchmarkUsage = z.infer<typeof benchmarkUsageSchema>;
export type BenchmarkOracleFeedback = z.infer<typeof benchmarkOracleFeedbackSchema>;
