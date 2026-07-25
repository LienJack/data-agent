import { z } from "zod";
import {
  type ArtifactReference,
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
} from "../artifacts/envelope.js";
import {
  appScopeSchema,
  deepFreeze,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { benchmarkSuiteSchema } from "../evals/index.js";
import { assertPortEventCorrelation } from "./event-correlation.js";

export const benchmarkAdapterRequestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    adapter_run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    suite: benchmarkSuiteSchema,
    suite_version: versionIdentifierSchema,
    dataset_version: versionIdentifierSchema,
    oracle_version: versionIdentifierSchema,
    case_ref: artifactReferenceFor("EvalCase"),
    eval_run_ref: artifactReferenceFor("EvalRun"),
    budget: z.strictObject({
      timeout_ms: z.number().int().positive().max(3_600_000),
      max_cases: z.number().int().positive(),
      max_bytes: z.number().int().positive(),
    }),
  })
  .superRefine((request, ctx) => {
    if (
      [request.case_ref, request.eval_run_ref].some(
        (reference) =>
          reference.app_id !== request.scope.app_id ||
          reference.tenant_id !== request.scope.tenant_id ||
          reference.environment !== request.scope.environment ||
          reference.run_id !== request.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Benchmark Request 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["case_ref"],
      });
    }
  });

const benchmarkEventBase = {
  schema_version: versionIdentifierSchema,
  adapter_run_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  suite: benchmarkSuiteSchema,
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  oracle_version: versionIdentifierSchema,
  sequence: z.number().int().nonnegative(),
  observed_at: timestampSchema,
} as const;

export const benchmarkAdapterEventSchema = z
  .discriminatedUnion("event_type", [
    z.strictObject({
      ...benchmarkEventBase,
      event_type: z.literal("STARTED"),
    }),
    z.strictObject({
      ...benchmarkEventBase,
      event_type: z.literal("CASE_LOADED"),
      case_ref: artifactReferenceFor("EvalCase"),
    }),
    z.strictObject({
      ...benchmarkEventBase,
      event_type: z.literal("SCORE_CANDIDATE"),
      scorecard_ref: artifactReferenceFor("ScoreCard"),
    }),
    z.strictObject({
      ...benchmarkEventBase,
      event_type: z.literal("COMPLETED"),
      receipt_ref: artifactReferenceFor("BenchmarkAdapterReceipt"),
    }),
    z.strictObject({
      ...benchmarkEventBase,
      event_type: z.literal("FAILED"),
      reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      retryable: z.boolean(),
    }),
  ])
  .superRefine((event, ctx) => {
    let reference: ArtifactReference | undefined;
    switch (event.event_type) {
      case "CASE_LOADED":
        reference = event.case_ref;
        break;
      case "SCORE_CANDIDATE":
        reference = event.scorecard_ref;
        break;
      case "COMPLETED":
        reference = event.receipt_ref;
        break;
      case "STARTED":
      case "FAILED":
        break;
    }
    if (
      reference &&
      (reference.app_id !== event.scope.app_id ||
        reference.tenant_id !== event.scope.tenant_id ||
        reference.environment !== event.scope.environment ||
        reference.run_id !== event.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Benchmark Event 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["event_type"],
      });
    }
  });

export type BenchmarkAdapterRequest = z.infer<typeof benchmarkAdapterRequestSchema>;
export type BenchmarkAdapterEvent = z.infer<typeof benchmarkAdapterEventSchema>;

export function parseBenchmarkAdapterEventForRequest(
  request: BenchmarkAdapterRequest,
  input: unknown,
): BenchmarkAdapterEvent {
  const event = benchmarkAdapterEventSchema.parse(input);
  assertPortEventCorrelation("Benchmark Adapter", request, event, [
    {
      field: "adapter_run_id",
      expected: request.adapter_run_id,
      actual: event.adapter_run_id,
    },
    { field: "suite", expected: request.suite, actual: event.suite },
    {
      field: "suite_version",
      expected: request.suite_version,
      actual: event.suite_version,
    },
    {
      field: "dataset_version",
      expected: request.dataset_version,
      actual: event.dataset_version,
    },
    {
      field: "oracle_version",
      expected: request.oracle_version,
      actual: event.oracle_version,
    },
  ]);
  return event;
}

export const benchmarkAdapterReceiptSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    receipt_ref: artifactReferenceFor("BenchmarkAdapterReceipt"),
    adapter_run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    suite: benchmarkSuiteSchema,
    suite_version: versionIdentifierSchema,
    dataset_version: versionIdentifierSchema,
    oracle_version: versionIdentifierSchema,
    case_ref: artifactReferenceFor("EvalCase"),
    eval_run_ref: artifactReferenceFor("EvalRun"),
    scorecard_ref: artifactReferenceFor("ScoreCard"),
    terminal: z.literal("COMPLETED"),
    reason_code: z.literal("BENCHMARK_COMPLETED"),
    observed_at: timestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (
      [receipt.receipt_ref, receipt.case_ref, receipt.eval_run_ref, receipt.scorecard_ref].some(
        (reference) =>
          reference.app_id !== receipt.scope.app_id ||
          reference.tenant_id !== receipt.scope.tenant_id ||
          reference.environment !== receipt.scope.environment ||
          reference.run_id !== receipt.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Benchmark Receipt 与所有引用必须属于同一 App/Tenant/Environment/Run。",
        path: ["receipt_ref"],
      });
    }
  });

export type BenchmarkAdapterReceipt = z.infer<typeof benchmarkAdapterReceiptSchema>;

export class BenchmarkAdapterReceiptAuthorityError extends Error {
  override readonly name = "BenchmarkAdapterReceiptAuthorityError";
  readonly code = "BENCHMARK_ADAPTER_RECEIPT_NOT_AUTHORITATIVE";
}

declare const authoritativeBenchmarkAdapterReceipt: unique symbol;
const authorizedBenchmarkAdapterReceipts = new WeakSet<object>();

export type AuthoritativeBenchmarkAdapterReceipt = BenchmarkAdapterReceipt & {
  readonly [authoritativeBenchmarkAdapterReceipt]: true;
};

export async function authorizeBenchmarkAdapterReceipt(
  input: unknown,
  verifyCommitted: ArtifactReferenceVerifier,
): Promise<AuthoritativeBenchmarkAdapterReceipt> {
  const receipt = benchmarkAdapterReceiptSchema.parse(input);
  const committed = await Promise.all(
    [receipt.receipt_ref, receipt.case_ref, receipt.eval_run_ref, receipt.scorecard_ref].map(
      verifyCommitted,
    ),
  );
  if (committed.some((verdict) => !verdict)) {
    throw new BenchmarkAdapterReceiptAuthorityError(
      "Benchmark 成功 Receipt 引用了未提交的权威 Artifact。",
    );
  }

  authorizedBenchmarkAdapterReceipts.add(receipt);
  return deepFreeze(receipt) as AuthoritativeBenchmarkAdapterReceipt;
}

export function isAuthoritativeBenchmarkAdapterReceipt(
  value: unknown,
): value is AuthoritativeBenchmarkAdapterReceipt {
  return (
    typeof value === "object" && value !== null && authorizedBenchmarkAdapterReceipts.has(value)
  );
}

export interface BenchmarkSuiteAdapter {
  stream(input: BenchmarkAdapterRequest): AsyncIterable<BenchmarkAdapterEvent>;
}
