import { z } from "zod";

/**
 * Shared schemas for the evals package.
 * Extracted to break the circular dependency between index.ts and manifest.ts.
 */

export const benchmarkSuiteSchema = z.enum([
  "insightbench",
  "dab",
  "rcaeval",
  "controlled-attribution",
]);

export const benchmarkOracleSchema = z.discriminatedUnion("suite", [
  z.strictObject({
    suite: z.literal("insightbench"),
    oracle_type: z.literal("ANALYSIS_REPORT_QUALITY"),
    expected: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    suite: z.literal("dab"),
    oracle_type: z.literal("RESULT_EQUIVALENCE"),
    expected: z.json(),
  }),
  z.strictObject({
    suite: z.literal("rcaeval"),
    oracle_type: z.literal("ROOT_CAUSE_RANKING"),
    expected: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    suite: z.literal("controlled-attribution"),
    oracle_type: z.literal("ATTRIBUTION_MATCH"),
    expected: z.array(z.string().min(1)).min(1),
  }),
]);

export const ORACLE_TYPE_BY_SUITE = {
  insightbench: "ANALYSIS_REPORT_QUALITY",
  dab: "RESULT_EQUIVALENCE",
  rcaeval: "ROOT_CAUSE_RANKING",
  "controlled-attribution": "ATTRIBUTION_MATCH",
} as const;

const evalCaseObjectSchema = z.strictObject({
  case_id: z.string().min(1).max(256),
  suite: benchmarkSuiteSchema,
  suite_version: z.string().min(1).max(64),
  dataset_version: z.string().min(1).max(64),
  oracle_version: z.string().min(1).max(64),
  source_commit: z.string().min(1).max(64),
  question: z.string().min(1).max(20_000),
  oracle: benchmarkOracleSchema,
  license: z.string().min(1).max(256),
  case_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const evalCaseSchema = evalCaseObjectSchema.superRefine((evalCase, ctx) => {
  if (evalCase.suite !== evalCase.oracle.suite) {
    ctx.addIssue({
      code: "custom",
      message: "EvalCase 与 Oracle 必须属于同一 Benchmark Suite。",
      path: ["oracle", "suite"],
    });
  }
});

export const scoreCardSafetyCounterSchema = z.strictObject({
  counter_id: z.string().min(1).max(128),
  counter_type: z.enum(["CONTAMINATION", "HALLUCINATION", "INJECTION", "LEAKAGE", "OTHER"]),
  triggered: z.boolean(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  description: z.string().min(1).max(2048),
});

export const scoreCardFailureTaxonomySchema = z.strictObject({
  failure_code: z.string().min(1).max(128),
  failure_type: z.enum([
    "SQL_EXECUTION",
    "SEMANTIC_MISMATCH",
    "GROUNDING_ERROR",
    "GATE_REJECTION",
    "BUDGET_EXCEEDED",
    "TIMEOUT",
    "ORACLE_MISMATCH",
    "SAFETY_VIOLATION",
    "OTHER",
  ]),
  count: z.number().int().nonnegative(),
  description: z.string().min(1).max(2048),
});

export const scoreCardLatencySchema = z.strictObject({
  total_ms: z.number().int().nonnegative(),
  p50_ms: z.number().int().nonnegative(),
  p95_ms: z.number().int().nonnegative(),
  p99_ms: z.number().int().nonnegative(),
});

export const scoreCardCostSchema = z.strictObject({
  total_micros: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  provider: z.string().min(1).max(128).nullable(),
});

export const scoreCardIntervalSchema = z
  .strictObject({
    confidence_level: z.number().gt(0).lt(1),
    lower: z.number().finite(),
    upper: z.number().finite(),
    sample_size: z.number().int().positive(),
    method: z.string().min(1).max(64),
  })
  .superRefine((interval, ctx) => {
    if (interval.lower > interval.upper) {
      ctx.addIssue({
        code: "custom",
        message: "ScoreCard Interval 的 Lower 不能大于 Upper。",
        path: ["lower"],
      });
    }
  });

export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;
export type BenchmarkOracle = z.infer<typeof benchmarkOracleSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
