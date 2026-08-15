import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  deterministicAuthoritySchema,
} from "../artifacts/envelope.js";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const benchmarkSuiteSchema = z.enum([
  "insightbench",
  "dab",
  "rcaeval",
  "controlled-attribution",
  "governance",
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
  z.strictObject({
    suite: z.literal("governance"),
    oracle_type: z.literal("GOVERNANCE_SERVICE_QUALITY"),
    expected: z.array(z.string().min(1)).min(1),
  }),
]);

const ORACLE_TYPE_BY_SUITE = {
  insightbench: "ANALYSIS_REPORT_QUALITY",
  dab: "RESULT_EQUIVALENCE",
  rcaeval: "ROOT_CAUSE_RANKING",
  "controlled-attribution": "ATTRIBUTION_MATCH",
  governance: "GOVERNANCE_SERVICE_QUALITY",
} as const;

const evalCaseObjectSchema = z.strictObject({
  case_id: immutableIdSchema,
  suite: benchmarkSuiteSchema,
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  oracle_version: versionIdentifierSchema,
  source_commit: versionIdentifierSchema,
  question: z.string().min(1).max(20_000),
  oracle: benchmarkOracleSchema,
  license: z.string().min(1).max(256),
  case_hash: contentHashSchema,
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

export async function computeEvalCaseHash(input: unknown): Promise<`sha256:${string}`> {
  const evalCase = evalCaseSchema.parse(input);
  const { case_hash: _caseHash, ...material } = evalCase;
  return sha256ContentHash(material);
}

export class EvalCaseIntegrityError extends Error {
  override readonly name = "EvalCaseIntegrityError";
  readonly code = "EVAL_CASE_CONTENT_HASH_MISMATCH";
}

declare const authoritativeEvalCase: unique symbol;
const authorizedEvalCases = new WeakSet<object>();

export type AuthoritativeEvalCase = EvalCase & {
  readonly [authoritativeEvalCase]: true;
};

export async function authorizeEvalCase(input: unknown): Promise<AuthoritativeEvalCase> {
  const evalCase = evalCaseSchema.parse(input);
  if ((await computeEvalCaseHash(evalCase)) !== evalCase.case_hash) {
    throw new EvalCaseIntegrityError("EvalCase Hash 与 Suite/Version/Question/Oracle 不匹配。");
  }
  authorizedEvalCases.add(evalCase);
  return deepFreeze(evalCase) as AuthoritativeEvalCase;
}

export function isAuthoritativeEvalCase(value: unknown): value is AuthoritativeEvalCase {
  return typeof value === "object" && value !== null && authorizedEvalCases.has(value);
}

export const evalRegistryAssignmentSchema = z
  .strictObject({
    assignment_id: immutableIdSchema,
    assignment_version: z.number().int().positive(),
    case_ref: artifactReferenceFor("EvalCase"),
    registry: z.enum(["DEMO", "TUNING", "HOLDOUT"]),
    registry_policy_version: versionIdentifierSchema,
    previous_assignment_ref: artifactReferenceFor("EvalRegistryAssignment").nullable(),
    assignment_hash: contentHashSchema,
    assigned_at: timestampSchema,
    authority: deterministicAuthoritySchema,
  })
  .superRefine((assignment, ctx) => {
    if (assignment.assignment_id !== assignment.case_ref.artifact_id) {
      ctx.addIssue({
        code: "custom",
        message: "Registry Assignment ID 必须由不可变 Case ID 派生，禁止同一 Case 多重分类。",
        path: ["assignment_id"],
      });
    }
    if (assignment.assignment_version === 1 && assignment.previous_assignment_ref !== null) {
      ctx.addIssue({
        code: "custom",
        message: "首个 Registry Assignment 不能声明父 Assignment。",
        path: ["previous_assignment_ref"],
      });
    }
    if (assignment.assignment_version > 1 && !assignment.previous_assignment_ref) {
      ctx.addIssue({
        code: "custom",
        message: "Registry 变更必须引用前一个不可变 Assignment。",
        path: ["previous_assignment_ref"],
      });
    }
    const previous = assignment.previous_assignment_ref;
    if (
      previous &&
      (previous.app_id !== assignment.case_ref.app_id ||
        previous.tenant_id !== assignment.case_ref.tenant_id ||
        previous.environment !== assignment.case_ref.environment ||
        previous.run_id !== assignment.case_ref.run_id ||
        previous.revision !== assignment.assignment_version - 1)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Registry Assignment 的前序引用必须属于同一 Scope 并连续递增。",
        path: ["previous_assignment_ref"],
      });
    }
  });

export async function computeEvalRegistryAssignmentHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const assignment = evalRegistryAssignmentSchema.parse(input);
  const { assignment_hash: _assignmentHash, ...material } = assignment;
  return sha256ContentHash(material);
}

export interface EvalRegistryAuthorityContext {
  verifyCase(reference: ArtifactReference): Promise<boolean>;
  resolveCurrent(caseReference: ArtifactReference): Promise<unknown | null>;
  compareAndSwap(input: {
    readonly case_ref: ArtifactReference;
    readonly expected_current_ref: ArtifactReference | null;
    readonly next_assignment: EvalRegistryAssignment;
  }): Promise<boolean>;
}

export class EvalRegistryAuthorityError extends Error {
  override readonly name = "EvalRegistryAuthorityError";
  readonly code = "EVAL_REGISTRY_ASSIGNMENT_NOT_AUTHORITATIVE";
}

declare const authoritativeEvalRegistryAssignment: unique symbol;
const authorizedEvalRegistryAssignments = new WeakSet<object>();

export type AuthoritativeEvalRegistryAssignment = z.infer<typeof evalRegistryAssignmentSchema> & {
  readonly [authoritativeEvalRegistryAssignment]: true;
};

export function evalRegistryAssignmentReference(
  assignment: z.infer<typeof evalRegistryAssignmentSchema>,
): ArtifactReference {
  return {
    artifact_id: assignment.assignment_id,
    artifact_type: "EvalRegistryAssignment" as const,
    app_id: assignment.case_ref.app_id,
    tenant_id: assignment.case_ref.tenant_id,
    environment: assignment.case_ref.environment,
    run_id: assignment.case_ref.run_id,
    revision: assignment.assignment_version,
    content_hash: assignment.assignment_hash,
  };
}

async function parsePersistedEvalRegistryAssignment(
  input: unknown,
): Promise<EvalRegistryAssignment> {
  const result = evalRegistryAssignmentSchema.safeParse(input);
  if (
    !result.success ||
    (await computeEvalRegistryAssignmentHash(result.data)) !== result.data.assignment_hash
  ) {
    throw new EvalRegistryAuthorityError(
      "持久化 Registry Assignment 的 Schema 或 Content Hash 无效。",
    );
  }
  return result.data;
}

export async function authorizeEvalRegistryAssignment(
  input: unknown,
  authority: EvalRegistryAuthorityContext,
): Promise<AuthoritativeEvalRegistryAssignment> {
  const assignment = evalRegistryAssignmentSchema.parse(input);
  if (!(await authority.verifyCase(assignment.case_ref))) {
    throw new EvalRegistryAuthorityError("Registry Assignment 引用了未提交的 EvalCase。");
  }
  if ((await computeEvalRegistryAssignmentHash(assignment)) !== assignment.assignment_hash) {
    throw new EvalRegistryAuthorityError("Registry Assignment Hash 与规范化内容不匹配。");
  }

  const currentInput = await authority.resolveCurrent(assignment.case_ref);
  const current =
    currentInput === null ? null : await parsePersistedEvalRegistryAssignment(currentInput);
  if (assignment.assignment_version === 1) {
    if (current) {
      throw new EvalRegistryAuthorityError("同一 EvalCase 已存在不可变 Registry Assignment。");
    }
  } else {
    const previousReference = assignment.previous_assignment_ref;
    if (!previousReference) {
      throw new EvalRegistryAuthorityError("Registry Assignment 缺少前序引用。");
    }
    if (
      !current ||
      artifactReferenceIdentity(evalRegistryAssignmentReference(current)) !==
        artifactReferenceIdentity(previousReference) ||
      current.registry !== assignment.registry
    ) {
      throw new EvalRegistryAuthorityError(
        "Registry Assignment 只能在同一分类内升级 Policy，不能把 Case 重标为 Demo/Tuning/Holdout。",
      );
    }
  }

  const committed = await authority.compareAndSwap({
    case_ref: assignment.case_ref,
    expected_current_ref: current ? evalRegistryAssignmentReference(current) : null,
    next_assignment: assignment,
  });
  if (!committed) {
    throw new EvalRegistryAuthorityError(
      "Registry Assignment 持久化 CAS 失败，当前版本已被并发更新。",
    );
  }

  authorizedEvalRegistryAssignments.add(assignment);
  return deepFreeze(assignment) as AuthoritativeEvalRegistryAssignment;
}

export function isAuthoritativeEvalRegistryAssignment(
  value: unknown,
): value is AuthoritativeEvalRegistryAssignment {
  return (
    typeof value === "object" && value !== null && authorizedEvalRegistryAssignments.has(value)
  );
}

export interface EvalRegistryReadAuthorityContext {
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolve(reference: ArtifactReference): Promise<unknown | null>;
}

export async function resolveAuthoritativeEvalRegistryAssignment(
  reference: ArtifactReference,
  authority: EvalRegistryReadAuthorityContext,
): Promise<AuthoritativeEvalRegistryAssignment> {
  if (!(await authority.verifyCommitted(reference))) {
    throw new EvalRegistryAuthorityError(
      "Registry Assignment Reference 尚未由持久化 Authority 提交。",
    );
  }
  const resolvedInput = await authority.resolve(reference);
  if (resolvedInput === null) {
    throw new EvalRegistryAuthorityError("Registry Assignment Reference 无法解析。");
  }
  const resolved = await parsePersistedEvalRegistryAssignment(resolvedInput);
  if (
    artifactReferenceIdentity(evalRegistryAssignmentReference(resolved)) !==
    artifactReferenceIdentity(reference)
  ) {
    throw new EvalRegistryAuthorityError("Registry Assignment 必须匹配完整的已提交 Reference。");
  }

  authorizedEvalRegistryAssignments.add(resolved);
  return deepFreeze(resolved) as AuthoritativeEvalRegistryAssignment;
}

const benchmarkOracleTypeSchema = z.enum([
  "ANALYSIS_REPORT_QUALITY",
  "RESULT_EQUIVALENCE",
  "ROOT_CAUSE_RANKING",
  "ATTRIBUTION_MATCH",
  "GOVERNANCE_SERVICE_QUALITY",
]);

export const evalReplayTupleSchema = z.strictObject({
  state: z.enum(["REPLAYABLE", "LIMITED", "REPLAY_UNAVAILABLE"]),
  source_commit: versionIdentifierSchema,
  data_snapshot_hash: contentHashSchema,
  schema_version: versionIdentifierSchema,
  semantic_version: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
  model_profile_id: immutableIdSchema,
  model_profile_version: versionIdentifierSchema,
  prompt_version: versionIdentifierSchema,
  workflow_version: versionIdentifierSchema,
  evaluator_version: versionIdentifierSchema,
  seed: z.number().int().nonnegative(),
  budget: z.strictObject({
    max_cases: z.number().int().positive(),
    max_duration_ms: z.number().int().positive(),
    max_cost_micros: z.number().int().nonnegative(),
  }),
  trace: z.strictObject({
    trace_id: immutableIdSchema,
    trace_hash: contentHashSchema,
  }),
});

export const evalRunSchema = z
  .strictObject({
    eval_run_id: immutableIdSchema,
    eval_run_version: z.number().int().positive(),
    case_ref: artifactReferenceFor("EvalCase"),
    registry_assignment_ref: artifactReferenceFor("EvalRegistryAssignment"),
    suite: benchmarkSuiteSchema,
    suite_version: versionIdentifierSchema,
    dataset_version: versionIdentifierSchema,
    oracle_version: versionIdentifierSchema,
    oracle_type: benchmarkOracleTypeSchema,
    manifest_version: versionIdentifierSchema,
    replay: evalReplayTupleSchema,
    started_at: timestampSchema,
    completed_at: timestampSchema.nullable(),
    status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
    eval_run_hash: contentHashSchema,
  })
  .superRefine((evalRun, ctx) => {
    if (
      evalRun.case_ref.app_id !== evalRun.registry_assignment_ref.app_id ||
      evalRun.case_ref.tenant_id !== evalRun.registry_assignment_ref.tenant_id ||
      evalRun.case_ref.environment !== evalRun.registry_assignment_ref.environment ||
      evalRun.case_ref.run_id !== evalRun.registry_assignment_ref.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "EvalRun 的 Case 与 Registry Assignment 必须属于同一 Scope。",
        path: ["registry_assignment_ref"],
      });
    }
    if (ORACLE_TYPE_BY_SUITE[evalRun.suite] !== evalRun.oracle_type) {
      ctx.addIssue({
        code: "custom",
        message: "EvalRun 的 Oracle Type 必须属于当前 Benchmark Suite。",
        path: ["oracle_type"],
      });
    }
    if (evalRun.status === "COMPLETED" && !evalRun.completed_at) {
      ctx.addIssue({
        code: "custom",
        message: "COMPLETED EvalRun 必须记录 completed_at。",
        path: ["completed_at"],
      });
    }
  });

export async function computeEvalRunHash(input: unknown): Promise<`sha256:${string}`> {
  const evalRun = evalRunSchema.parse(input);
  const { eval_run_hash: _evalRunHash, ...material } = evalRun;
  return sha256ContentHash(material);
}

export function evalRunReference(evalRun: EvalRun): ArtifactReference {
  return {
    artifact_id: evalRun.eval_run_id,
    artifact_type: "EvalRun",
    app_id: evalRun.case_ref.app_id,
    tenant_id: evalRun.case_ref.tenant_id,
    environment: evalRun.case_ref.environment,
    run_id: evalRun.case_ref.run_id,
    revision: evalRun.eval_run_version,
    content_hash: evalRun.eval_run_hash,
  };
}

export interface EvalRunAuthorityContext {
  verifyCase(reference: ArtifactReference): Promise<boolean>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveRegistryAssignment(reference: ArtifactReference): Promise<unknown | null>;
  resolveCurrentRegistryAssignment(caseReference: ArtifactReference): Promise<unknown | null>;
}

export class EvalRunAuthorityError extends Error {
  override readonly name = "EvalRunAuthorityError";
  readonly code = "EVAL_RUN_NOT_AUTHORITATIVE";
}

declare const authoritativeEvalRun: unique symbol;
const authorizedEvalRuns = new WeakSet<object>();

export type AuthoritativeEvalRun = EvalRun & {
  readonly [authoritativeEvalRun]: true;
};

export async function authorizeEvalRun(
  input: unknown,
  authority: EvalRunAuthorityContext,
): Promise<AuthoritativeEvalRun> {
  const evalRun = evalRunSchema.parse(input);
  if ((await computeEvalRunHash(evalRun)) !== evalRun.eval_run_hash) {
    throw new EvalRunAuthorityError("EvalRun Hash 与完整 Replay Version Tuple 不匹配。");
  }
  if (!(await authority.verifyCommitted(evalRunReference(evalRun)))) {
    throw new EvalRunAuthorityError("EvalRun 尚未由持久化 Authority 提交。");
  }
  if (!(await authority.verifyCase(evalRun.case_ref))) {
    throw new EvalRunAuthorityError("EvalRun 引用了未提交的 EvalCase。");
  }
  const assignment = await authority.resolveRegistryAssignment(evalRun.registry_assignment_ref);
  if (
    !isAuthoritativeEvalRegistryAssignment(assignment) ||
    artifactReferenceIdentity(evalRegistryAssignmentReference(assignment)) !==
      artifactReferenceIdentity(evalRun.registry_assignment_ref) ||
    artifactReferenceIdentity(assignment.case_ref) !== artifactReferenceIdentity(evalRun.case_ref)
  ) {
    throw new EvalRunAuthorityError("EvalRun 必须绑定同一 EvalCase 的权威 Registry Assignment。");
  }
  const currentAssignment = await authority.resolveCurrentRegistryAssignment(evalRun.case_ref);
  if (
    currentAssignment === null ||
    artifactReferenceIdentity(
      evalRegistryAssignmentReference(
        await parsePersistedEvalRegistryAssignment(currentAssignment),
      ),
    ) !== artifactReferenceIdentity(evalRun.registry_assignment_ref)
  ) {
    throw new EvalRunAuthorityError(
      "新 EvalRun 必须绑定 EvalCase 当前生效的 Registry Assignment。",
    );
  }

  authorizedEvalRuns.add(evalRun);
  return deepFreeze(evalRun) as AuthoritativeEvalRun;
}

export function isAuthoritativeEvalRun(value: unknown): value is AuthoritativeEvalRun {
  return typeof value === "object" && value !== null && authorizedEvalRuns.has(value);
}

const oracleVerdictReceiptCommonShape = {
  schema_version: versionIdentifierSchema,
  receipt_ref: artifactReferenceFor("OracleVerdictReceipt"),
  case_ref: artifactReferenceFor("EvalCase"),
  eval_run_ref: artifactReferenceFor("EvalRun"),
  suite_version: versionIdentifierSchema,
  dataset_version: versionIdentifierSchema,
  oracle_version: versionIdentifierSchema,
  deterministic_verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  oracle_result_hash: contentHashSchema,
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
} as const;

export const oracleVerdictReceiptSchema = z
  .discriminatedUnion("suite", [
    z.strictObject({
      ...oracleVerdictReceiptCommonShape,
      suite: z.literal("insightbench"),
      oracle_type: z.literal("ANALYSIS_REPORT_QUALITY"),
    }),
    z.strictObject({
      ...oracleVerdictReceiptCommonShape,
      suite: z.literal("dab"),
      oracle_type: z.literal("RESULT_EQUIVALENCE"),
    }),
    z.strictObject({
      ...oracleVerdictReceiptCommonShape,
      suite: z.literal("rcaeval"),
      oracle_type: z.literal("ROOT_CAUSE_RANKING"),
    }),
    z.strictObject({
      ...oracleVerdictReceiptCommonShape,
      suite: z.literal("controlled-attribution"),
      oracle_type: z.literal("ATTRIBUTION_MATCH"),
    }),
    z.strictObject({
      ...oracleVerdictReceiptCommonShape,
      suite: z.literal("governance"),
      oracle_type: z.literal("GOVERNANCE_SERVICE_QUALITY"),
    }),
  ])
  .superRefine((receipt, ctx) => {
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Oracle Verdict Receipt Reference 必须携带 Receipt Content Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    const scopeAnchor = receipt.case_ref;
    if (
      [receipt.receipt_ref, receipt.eval_run_ref].some(
        (reference) =>
          reference.app_id !== scopeAnchor.app_id ||
          reference.tenant_id !== scopeAnchor.tenant_id ||
          reference.environment !== scopeAnchor.environment ||
          reference.run_id !== scopeAnchor.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Oracle Verdict Receipt、Case 与 EvalRun 必须属于同一 Scope。",
        path: ["receipt_ref"],
      });
    }
  });

export async function computeOracleVerdictReceiptHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = oracleVerdictReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

export function oracleVerdictReceiptReference(receipt: OracleVerdictReceipt): ArtifactReference {
  return receipt.receipt_ref;
}

export interface OracleVerdictAuthorityContext {
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyDeterministicOracle(receipt: OracleVerdictReceipt): Promise<boolean>;
}

export class OracleVerdictAuthorityError extends Error {
  override readonly name = "OracleVerdictAuthorityError";
  readonly code = "ORACLE_VERDICT_RECEIPT_NOT_AUTHORITATIVE";
}

declare const authoritativeOracleVerdictReceipt: unique symbol;
const authorizedOracleVerdictReceipts = new WeakSet<object>();

export type AuthoritativeOracleVerdictReceipt = OracleVerdictReceipt & {
  readonly [authoritativeOracleVerdictReceipt]: true;
};

export async function authorizeOracleVerdictReceipt(
  referenceInput: unknown,
  authority: OracleVerdictAuthorityContext,
): Promise<AuthoritativeOracleVerdictReceipt> {
  const reference = artifactReferenceFor("OracleVerdictReceipt").parse(referenceInput);
  const resolvedInput = await authority.resolveCommitted(reference);
  const resolved = oracleVerdictReceiptSchema.safeParse(resolvedInput);
  if (!resolved.success) {
    throw new OracleVerdictAuthorityError(
      "Oracle Verdict Receipt Reference 无法解析为 Suite-Specific Receipt。",
    );
  }
  const receipt = resolved.data;
  if (artifactReferenceIdentity(receipt.receipt_ref) !== artifactReferenceIdentity(reference)) {
    throw new OracleVerdictAuthorityError(
      "Oracle Verdict Receipt 必须匹配完整的 Content-Addressed Reference。",
    );
  }
  if ((await computeOracleVerdictReceiptHash(receipt)) !== receipt.receipt_hash) {
    throw new OracleVerdictAuthorityError(
      "Oracle Verdict Receipt Hash 与确定性 Verdict 内容不匹配。",
    );
  }
  const committed = await Promise.all(
    [receipt.receipt_ref, receipt.case_ref, receipt.eval_run_ref].map((artifactReference) =>
      authority.verifyCommitted(artifactReference),
    ),
  );
  if (committed.some((verdict) => !verdict)) {
    throw new OracleVerdictAuthorityError(
      "Oracle Verdict Receipt、EvalCase 或 EvalRun 尚未由持久化 Authority 提交。",
    );
  }
  if (!(await authority.verifyDeterministicOracle(receipt))) {
    throw new OracleVerdictAuthorityError("服务端 Oracle Capability 无法复核确定性 Verdict。");
  }

  authorizedOracleVerdictReceipts.add(receipt);
  return deepFreeze(receipt) as AuthoritativeOracleVerdictReceipt;
}

export function isAuthoritativeOracleVerdictReceipt(
  value: unknown,
): value is AuthoritativeOracleVerdictReceipt {
  return typeof value === "object" && value !== null && authorizedOracleVerdictReceipts.has(value);
}

const scoreCardLatencySchema = z.strictObject({
  total_ms: z.number().int().nonnegative(),
  model_ms: z.number().int().nonnegative(),
  execution_ms: z.number().int().nonnegative(),
});

const scoreCardCostSchema = z.strictObject({
  currency: z.literal("USD"),
  amount_micros: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

const scoreCardSafetyCounterSchema = z.strictObject({
  counter_id: versionIdentifierSchema,
  count: z.number().int().nonnegative(),
});

const scoreCardFailureTaxonomySchema = z.strictObject({
  failure_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  count: z.number().int().positive(),
});

export const scoreCardIntervalSchema = z
  .strictObject({
    interval_version: versionIdentifierSchema,
    metric: versionIdentifierSchema,
    confidence_level: z.number().gt(0).lt(1),
    lower: z.number().finite(),
    upper: z.number().finite(),
    sample_size: z.number().int().positive(),
    method: versionIdentifierSchema,
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

export const scoreCardComparisonSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("SINGLE"),
  }),
  z.strictObject({
    mode: z.literal("PAIRED"),
    baseline_eval_run_ref: artifactReferenceFor("EvalRun"),
    candidate_eval_run_ref: artifactReferenceFor("EvalRun"),
    pairing_key: versionIdentifierSchema,
    interval: scoreCardIntervalSchema,
  }),
]);

export const scoreCardSchema = z
  .strictObject({
    scorecard_id: immutableIdSchema,
    scorecard_version: z.number().int().positive(),
    case_ref: artifactReferenceFor("EvalCase"),
    eval_run_ref: artifactReferenceFor("EvalRun"),
    suite: benchmarkSuiteSchema,
    suite_version: versionIdentifierSchema,
    dataset_version: versionIdentifierSchema,
    oracle_version: versionIdentifierSchema,
    oracle_type: benchmarkOracleTypeSchema,
    deterministic_verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
    oracle_verdict_receipt_ref: artifactReferenceFor("OracleVerdictReceipt"),
    comparison: scoreCardComparisonSchema,
    evidence_refs: z.array(
      z.union([
        artifactReferenceFor("ReportReadyCertificate"),
        artifactReferenceFor("QueryEvidence"),
        artifactReferenceFor("ValidationReceipt"),
      ]),
    ),
    latency: scoreCardLatencySchema,
    cost: scoreCardCostSchema,
    safety_counters: z.array(scoreCardSafetyCounterSchema).min(1),
    failure_taxonomy: z.array(scoreCardFailureTaxonomySchema),
    scorecard_hash: contentHashSchema,
    judge_diagnostics: z.record(z.string(), z.json()).optional(),
  })
  .superRefine((scoreCard, ctx) => {
    if (ORACLE_TYPE_BY_SUITE[scoreCard.suite] !== scoreCard.oracle_type) {
      ctx.addIssue({
        code: "custom",
        message: "ScoreCard 的 Oracle Type 必须属于当前 Benchmark Suite。",
        path: ["oracle_type"],
      });
    }
    if (scoreCard.deterministic_verdict === "PASS" && scoreCard.evidence_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "PASS ScoreCard 必须绑定确定性 Evidence。",
        path: ["evidence_refs"],
      });
    }
    if (
      scoreCard.comparison.mode === "PAIRED" &&
      artifactReferenceIdentity(scoreCard.comparison.candidate_eval_run_ref) !==
        artifactReferenceIdentity(scoreCard.eval_run_ref)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "PAIRED ScoreCard 的 Candidate EvalRun 必须等于 ScoreCard EvalRun。",
        path: ["comparison", "candidate_eval_run_ref"],
      });
    }
    if (
      scoreCard.comparison.mode === "PAIRED" &&
      artifactReferenceIdentity(scoreCard.comparison.baseline_eval_run_ref) ===
        artifactReferenceIdentity(scoreCard.comparison.candidate_eval_run_ref)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "PAIRED ScoreCard 的 Baseline 与 Candidate EvalRun 必须不同。",
        path: ["comparison", "baseline_eval_run_ref"],
      });
    }

    const safetyCounterIds = new Set(scoreCard.safety_counters.map(({ counter_id }) => counter_id));
    if (safetyCounterIds.size !== scoreCard.safety_counters.length) {
      ctx.addIssue({
        code: "custom",
        message: "ScoreCard 的 Safety Counter ID 不能重复。",
        path: ["safety_counters"],
      });
    }
    const failureCodes = new Set(
      scoreCard.failure_taxonomy.map(({ failure_code }) => failure_code),
    );
    if (failureCodes.size !== scoreCard.failure_taxonomy.length) {
      ctx.addIssue({
        code: "custom",
        message: "ScoreCard 的 Failure Taxonomy Code 不能重复。",
        path: ["failure_taxonomy"],
      });
    }

    const comparisonReferences =
      scoreCard.comparison.mode === "PAIRED"
        ? [scoreCard.comparison.baseline_eval_run_ref, scoreCard.comparison.candidate_eval_run_ref]
        : [];
    const scopeAnchor = scoreCard.case_ref;
    if (
      [
        scoreCard.eval_run_ref,
        scoreCard.oracle_verdict_receipt_ref,
        ...comparisonReferences,
        ...scoreCard.evidence_refs,
      ].some(
        (reference) =>
          reference.app_id !== scopeAnchor.app_id ||
          reference.tenant_id !== scopeAnchor.tenant_id ||
          reference.environment !== scopeAnchor.environment ||
          reference.run_id !== scopeAnchor.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ScoreCard 的 Run 与 Evidence 必须属于 Case 的同一 Scope。",
        path: ["evidence_refs"],
      });
    }
  });

export async function computeScoreCardHash(input: unknown): Promise<`sha256:${string}`> {
  const scoreCard = scoreCardSchema.parse(input);
  const { scorecard_hash: _scorecardHash, ...material } = scoreCard;
  return sha256ContentHash(material);
}

export interface ScoreCardAuthorityContext {
  resolveEvalRun(reference: ArtifactReference): Promise<unknown | null>;
  resolveRegistryAssignment(reference: ArtifactReference): Promise<unknown | null>;
  resolveOracleVerdictReceipt(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}

export class ScoreCardAuthorityError extends Error {
  override readonly name = "ScoreCardAuthorityError";
  readonly code = "SCORECARD_NOT_AUTHORITATIVE";
}

declare const authoritativeScoreCard: unique symbol;
const authorizedScoreCards = new WeakSet<object>();

export type AuthoritativeScoreCard = ScoreCard & {
  readonly [authoritativeScoreCard]: true;
};

export async function authorizeScoreCard(
  input: unknown,
  authority: ScoreCardAuthorityContext,
): Promise<AuthoritativeScoreCard> {
  const scoreCard = scoreCardSchema.parse(input);
  if ((await computeScoreCardHash(scoreCard)) !== scoreCard.scorecard_hash) {
    throw new ScoreCardAuthorityError("ScoreCard Hash 与规范化内容不匹配。");
  }
  if (!(await authority.verifyCommitted(scoreCardReference(scoreCard)))) {
    throw new ScoreCardAuthorityError("ScoreCard 尚未由持久化 Authority 提交。");
  }
  const evalRun = await authority.resolveEvalRun(scoreCard.eval_run_ref);
  if (!evalRun) {
    throw new ScoreCardAuthorityError("ScoreCard 没有匹配的 EvalRun。");
  }
  if (!isAuthoritativeEvalRun(evalRun)) {
    throw new ScoreCardAuthorityError("ScoreCard 只能消费权威 EvalRun。");
  }
  if (
    artifactReferenceIdentity(evalRunReference(evalRun)) !==
      artifactReferenceIdentity(scoreCard.eval_run_ref) ||
    artifactReferenceIdentity(evalRun.case_ref) !== artifactReferenceIdentity(scoreCard.case_ref) ||
    evalRun.suite !== scoreCard.suite ||
    evalRun.suite_version !== scoreCard.suite_version ||
    evalRun.dataset_version !== scoreCard.dataset_version ||
    evalRun.oracle_version !== scoreCard.oracle_version ||
    evalRun.oracle_type !== scoreCard.oracle_type
  ) {
    throw new ScoreCardAuthorityError("ScoreCard 没有匹配的 EvalRun、Case 或 Oracle Version。");
  }
  const assignment = await authority.resolveRegistryAssignment(evalRun.registry_assignment_ref);
  if (
    !isAuthoritativeEvalRegistryAssignment(assignment) ||
    artifactReferenceIdentity(evalRegistryAssignmentReference(assignment)) !==
      artifactReferenceIdentity(evalRun.registry_assignment_ref) ||
    artifactReferenceIdentity(assignment.case_ref) !== artifactReferenceIdentity(scoreCard.case_ref)
  ) {
    throw new ScoreCardAuthorityError(
      "ScoreCard 必须绑定 EvalRun 使用的权威 Registry Assignment。",
    );
  }
  if (evalRun.status !== "COMPLETED") {
    throw new ScoreCardAuthorityError("ScoreCard 只能消费 COMPLETED EvalRun。");
  }
  const oracleReceipt = await authority.resolveOracleVerdictReceipt(
    scoreCard.oracle_verdict_receipt_ref,
  );
  if (
    !isAuthoritativeOracleVerdictReceipt(oracleReceipt) ||
    artifactReferenceIdentity(oracleVerdictReceiptReference(oracleReceipt)) !==
      artifactReferenceIdentity(scoreCard.oracle_verdict_receipt_ref)
  ) {
    throw new ScoreCardAuthorityError(
      "ScoreCard 只能消费完整 Reference 匹配的权威 Oracle Verdict Receipt。",
    );
  }
  if (
    artifactReferenceIdentity(oracleReceipt.case_ref) !==
      artifactReferenceIdentity(scoreCard.case_ref) ||
    artifactReferenceIdentity(oracleReceipt.eval_run_ref) !==
      artifactReferenceIdentity(scoreCard.eval_run_ref) ||
    oracleReceipt.suite !== scoreCard.suite ||
    oracleReceipt.suite_version !== scoreCard.suite_version ||
    oracleReceipt.dataset_version !== scoreCard.dataset_version ||
    oracleReceipt.oracle_version !== scoreCard.oracle_version ||
    oracleReceipt.oracle_type !== scoreCard.oracle_type ||
    oracleReceipt.deterministic_verdict !== scoreCard.deterministic_verdict
  ) {
    throw new ScoreCardAuthorityError(
      "ScoreCard 与 Oracle Receipt 的 Case、EvalRun、Suite、Version、Oracle 或 Verdict 不匹配。",
    );
  }
  if (scoreCard.comparison.mode === "PAIRED") {
    const baseline = await authority.resolveEvalRun(scoreCard.comparison.baseline_eval_run_ref);
    if (
      !isAuthoritativeEvalRun(baseline) ||
      artifactReferenceIdentity(evalRunReference(baseline)) !==
        artifactReferenceIdentity(scoreCard.comparison.baseline_eval_run_ref)
    ) {
      throw new ScoreCardAuthorityError(
        "PAIRED ScoreCard 只能消费完整 Reference 匹配的权威 Baseline EvalRun。",
      );
    }
    if (
      baseline.status !== "COMPLETED" ||
      artifactReferenceIdentity(baseline.case_ref) !==
        artifactReferenceIdentity(evalRun.case_ref) ||
      baseline.suite !== evalRun.suite ||
      baseline.suite_version !== evalRun.suite_version ||
      baseline.dataset_version !== evalRun.dataset_version ||
      baseline.oracle_version !== evalRun.oracle_version ||
      baseline.oracle_type !== evalRun.oracle_type
    ) {
      throw new ScoreCardAuthorityError(
        "PAIRED ScoreCard 的 Baseline 与 Candidate 必须是同 Case、Suite、Dataset、Oracle 的 COMPLETED EvalRun。",
      );
    }
  }
  const evidenceVerdicts = await Promise.all(
    scoreCard.evidence_refs.map((reference) => authority.verifyCommitted(reference)),
  );
  if (evidenceVerdicts.some((verdict) => !verdict)) {
    throw new ScoreCardAuthorityError("ScoreCard 引用了未提交的 Evidence。");
  }

  authorizedScoreCards.add(scoreCard);
  return deepFreeze(scoreCard) as AuthoritativeScoreCard;
}

export function isAuthoritativeScoreCard(value: unknown): value is AuthoritativeScoreCard {
  return typeof value === "object" && value !== null && authorizedScoreCards.has(value);
}

export function scoreCardReference(scoreCard: ScoreCard): ArtifactReference {
  return {
    artifact_id: scoreCard.scorecard_id,
    artifact_type: "ScoreCard",
    app_id: scoreCard.case_ref.app_id,
    tenant_id: scoreCard.case_ref.tenant_id,
    environment: scoreCard.case_ref.environment,
    run_id: scoreCard.case_ref.run_id,
    revision: scoreCard.scorecard_version,
    content_hash: scoreCard.scorecard_hash,
  };
}

export function scoreCardInputIdentity(scoreCard: ScoreCard): string {
  return [
    artifactReferenceIdentity(scoreCard.case_ref),
    artifactReferenceIdentity(scoreCard.eval_run_ref),
    scoreCard.suite,
    scoreCard.suite_version,
    scoreCard.dataset_version,
    scoreCard.oracle_version,
    scoreCard.oracle_type,
  ].join("|");
}

export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;
export type BenchmarkOracle = z.infer<typeof benchmarkOracleSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalRegistryAssignment = z.infer<typeof evalRegistryAssignmentSchema>;
export type EvalRun = z.infer<typeof evalRunSchema>;
export type OracleVerdictReceipt = z.infer<typeof oracleVerdictReceiptSchema>;
export type ScoreCard = z.infer<typeof scoreCardSchema>;

export const evalReleaseDecisionVerdictSchema = z.enum(["GO", "HOLD", "STOP"]);

export const evalReleaseDecisionConditionSchema = z.strictObject({
  condition_id: versionIdentifierSchema,
  description: z.string().min(1).max(2048),
  condition_type: z.enum([
    "SCORE_THRESHOLD",
    "REGRESSION_CHECK",
    "SAFETY_COUNTER",
    "HOLDOUT_CONTAMINATION",
    "BUNDLE_INTEGRITY",
    "LICENSE_COMPLIANCE",
    "PATH_BOUNDARY",
    "HOOK_VERIFICATION",
  ]),
  status: z.enum(["PASS", "FAIL", "WAIVED"]),
  required_ref: artifactReferenceFor("EvalCase").nullable(),
});

export const evalReleaseDecisionSchema = z
  .strictObject({
    decision_id: immutableIdSchema,
    decision_version: z.number().int().positive(),
    verdict: evalReleaseDecisionVerdictSchema,
    conditions: z.array(evalReleaseDecisionConditionSchema).min(1),
    scorecard_ref: artifactReferenceFor("ScoreCard"),
    safety_counters: z.array(scoreCardSafetyCounterSchema).min(1),
    failure_taxonomy: z.array(scoreCardFailureTaxonomySchema),
    decision_hash: contentHashSchema,
    eval_run_ref: artifactReferenceFor("EvalRun"),
    decided_at: timestampSchema,
    reason: z.string().max(4096).nullable(),
  })
  .superRefine((decision, ctx) => {
    if (decision.verdict === "GO" && decision.conditions.some((c) => c.status === "FAIL")) {
      ctx.addIssue({
        code: "custom",
        message: "GO 决策不能包含 FAIL 状态的条件。",
        path: ["verdict"],
      });
    }
    if (decision.verdict === "STOP" && decision.conditions.every((c) => c.status === "PASS")) {
      ctx.addIssue({
        code: "custom",
        message: "STOP 决策需要至少一个 FAIL 条件。",
        path: ["verdict"],
      });
    }
    if (
      decision.scorecard_ref.app_id !== decision.eval_run_ref.app_id ||
      decision.scorecard_ref.tenant_id !== decision.eval_run_ref.tenant_id ||
      decision.scorecard_ref.environment !== decision.eval_run_ref.environment ||
      decision.scorecard_ref.run_id !== decision.eval_run_ref.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "EvalReleaseDecision 的 ScoreCard 与 EvalRun 必须属于同一 Scope。",
        path: ["scorecard_ref"],
      });
    }
    const safetyCounterIds = new Set(decision.safety_counters.map(({ counter_id }) => counter_id));
    if (safetyCounterIds.size !== decision.safety_counters.length) {
      ctx.addIssue({
        code: "custom",
        message: "EvalReleaseDecision 的 Safety Counter ID 不能重复。",
        path: ["safety_counters"],
      });
    }
    const failureCodes = new Set(decision.failure_taxonomy.map(({ failure_code }) => failure_code));
    if (failureCodes.size !== decision.failure_taxonomy.length) {
      ctx.addIssue({
        code: "custom",
        message: "EvalReleaseDecision 的 Failure Taxonomy Code 不能重复。",
        path: ["failure_taxonomy"],
      });
    }
    const conditionIds = new Set(decision.conditions.map(({ condition_id }) => condition_id));
    if (conditionIds.size !== decision.conditions.length) {
      ctx.addIssue({
        code: "custom",
        message: "EvalReleaseDecision 的 Condition ID 不能重复。",
        path: ["conditions"],
      });
    }
  });

export async function computeEvalReleaseDecisionHash(input: unknown): Promise<`sha256:${string}`> {
  const decision = evalReleaseDecisionSchema.parse(input);
  const { decision_hash: _decisionHash, ...material } = decision;
  return sha256ContentHash(material);
}

export interface EvalReleaseDecisionAuthorityContext {
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveScoreCard(reference: ArtifactReference): Promise<unknown | null>;
  resolveEvalRun(reference: ArtifactReference): Promise<unknown | null>;
  verifyConditionRef(reference: ArtifactReference): Promise<boolean>;
}

export class EvalReleaseDecisionAuthorityError extends Error {
  override readonly name = "EvalReleaseDecisionAuthorityError";
  readonly code = "EVAL_RELEASE_DECISION_NOT_AUTHORITATIVE";
}

declare const authoritativeEvalReleaseDecision: unique symbol;
const authorizedEvalReleaseDecisions = new WeakSet<object>();

export type AuthoritativeEvalReleaseDecision = EvalReleaseDecision & {
  readonly [authoritativeEvalReleaseDecision]: true;
};

export async function authorizeEvalReleaseDecision(
  input: unknown,
  authority: EvalReleaseDecisionAuthorityContext,
): Promise<AuthoritativeEvalReleaseDecision> {
  const decision = evalReleaseDecisionSchema.parse(input);
  if ((await computeEvalReleaseDecisionHash(decision)) !== decision.decision_hash) {
    throw new EvalReleaseDecisionAuthorityError("EvalReleaseDecision Hash 与规范化内容不匹配。");
  }
  if (!(await authority.verifyCommitted(evalReleaseDecisionReference(decision)))) {
    throw new EvalReleaseDecisionAuthorityError(
      "EvalReleaseDecision 尚未由持久化 Authority 提交。",
    );
  }
  const scoreCard = await authority.resolveScoreCard(decision.scorecard_ref);
  if (!isAuthoritativeScoreCard(scoreCard)) {
    throw new EvalReleaseDecisionAuthorityError(
      "EvalReleaseDecision 只能消费完整 Reference 匹配的权威 ScoreCard。",
    );
  }
  if (
    artifactReferenceIdentity(scoreCardReference(scoreCard)) !==
      artifactReferenceIdentity(decision.scorecard_ref) ||
    artifactReferenceIdentity(scoreCard.eval_run_ref) !==
      artifactReferenceIdentity(decision.eval_run_ref)
  ) {
    throw new EvalReleaseDecisionAuthorityError(
      "EvalReleaseDecision 的 ScoreCard 与 EvalRun 必须匹配权威证据。",
    );
  }
  const evalRun = await authority.resolveEvalRun(decision.eval_run_ref);
  if (!isAuthoritativeEvalRun(evalRun)) {
    throw new EvalReleaseDecisionAuthorityError("EvalReleaseDecision 只能消费权威 EvalRun。");
  }
  if (evalRun.status !== "COMPLETED") {
    throw new EvalReleaseDecisionAuthorityError("EvalReleaseDecision 只能消费 COMPLETED EvalRun。");
  }
  const conditionRefs = decision.conditions
    .map((c) => c.required_ref)
    .filter((ref): ref is NonNullable<typeof ref> => ref !== null);
  if (conditionRefs.length > 0) {
    const verdicts = await Promise.all(
      conditionRefs.map((reference) => authority.verifyConditionRef(reference)),
    );
    if (verdicts.some((v) => !v)) {
      throw new EvalReleaseDecisionAuthorityError(
        "EvalReleaseDecision 引用了未提交的 Condition Reference。",
      );
    }
  }

  authorizedEvalReleaseDecisions.add(decision);
  return deepFreeze(decision) as AuthoritativeEvalReleaseDecision;
}

export function isAuthoritativeEvalReleaseDecision(
  value: unknown,
): value is AuthoritativeEvalReleaseDecision {
  return typeof value === "object" && value !== null && authorizedEvalReleaseDecisions.has(value);
}

export function evalReleaseDecisionReference(decision: EvalReleaseDecision): ArtifactReference {
  return {
    artifact_id: decision.decision_id,
    artifact_type: "EvalReleaseDecision",
    app_id: decision.scorecard_ref.app_id,
    tenant_id: decision.scorecard_ref.tenant_id,
    environment: decision.scorecard_ref.environment,
    run_id: decision.scorecard_ref.run_id,
    revision: decision.decision_version,
    content_hash: decision.decision_hash,
  };
}

export function evalReleaseDecisionInputIdentity(decision: EvalReleaseDecision): string {
  return [
    artifactReferenceIdentity(decision.scorecard_ref),
    artifactReferenceIdentity(decision.eval_run_ref),
    decision.verdict,
  ].join("|");
}

export type EvalReleaseDecision = z.infer<typeof evalReleaseDecisionSchema>;
export type EvalReleaseDecisionCondition = z.infer<typeof evalReleaseDecisionConditionSchema>;
export type EvalReleaseDecisionVerdict = z.infer<typeof evalReleaseDecisionVerdictSchema>;
export * from "./manifest.js";

/**
 * Eval Lane 类型 — 用于区分不同评测维度的泳道。
 * 每个 Benchmark Suite 绑定一个固定的 Lane。
 */
export const evalLaneSchema = z.enum([
  "grounding",
  "end-to-end-product",
  "authorization",
  "contribution",
]);

export const LANE_BY_SUITE = {
  insightbench: "grounding",
  dab: "end-to-end-product",
  rcaeval: "grounding",
  "controlled-attribution": "contribution",
  governance: "authorization",
} as const satisfies Record<BenchmarkSuite, EvalLane>;

export type EvalLane = z.infer<typeof evalLaneSchema>;

export * from "./test-center.js";
export * from "./truth-types.js";
