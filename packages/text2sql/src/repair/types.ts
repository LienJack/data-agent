import {
  artifactReferenceFor,
  artifactReferenceIdentity,
  contentHashSchema,
  type GateReceiptPayload,
  immutableIdSchema,
  type SqlArtifactPayloadContract,
  sqlArtifactSchema,
  TEXT2SQL_GATES,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { PostgresqlCompilerInput } from "../compiler/types.js";

export const BOUNDED_REPAIR_VERSION = "bounded-repair@1.0.0" as const;

export const BOUNDED_REPAIR_LIMITS = Object.freeze({
  max_attempts: 2,
  max_patch_operations_per_attempt: 4,
} as const);

export const REPAIR_PATCH_OPERATION_TYPES = [
  "RESTORE_DIALECT_AND_SQL",
  "RESTORE_PARAMETERS",
  "RESTORE_COMPILER_METADATA",
  "RESTORE_QUERY_HASH",
] as const;

export const repairPatchOperationSchema = z.strictObject({
  operation: z.enum(REPAIR_PATCH_OPERATION_TYPES),
  authority: z.literal("DETERMINISTIC_POSTGRESQL_COMPILATION"),
});

export type RepairPatchOperation = z.infer<typeof repairPatchOperationSchema>;

export const repairFrozenBundleSchema = z
  .strictObject({
    repair_id: immutableIdSchema,
    principal_id: z.string().min(1).max(256),
    query_contract_ref: artifactReferenceFor("QueryContract"),
    grounding_package_ref: artifactReferenceFor("GroundingPackage"),
    semantic_query_ref: artifactReferenceFor("SemanticQuery"),
    logical_plan_ref: artifactReferenceFor("LogicalPlan"),
    root_sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    query_contract_hash: contentHashSchema,
    grounding_package_hash: contentHashSchema,
    semantic_query_hash: contentHashSchema,
    logical_plan_hash: contentHashSchema,
    root_sql_artifact_payload_hash: contentHashSchema,
    grounding_hash: contentHashSchema,
    semantic_signature_hash: contentHashSchema,
    policy_version: versionIdentifierSchema,
    episode_hash: contentHashSchema,
    frozen_bundle_hash: contentHashSchema,
  })
  .superRefine((bundle, ctx) => {
    const scope = bundle.query_contract_ref;
    const references = [
      bundle.grounding_package_ref,
      bundle.semantic_query_ref,
      bundle.logical_plan_ref,
      bundle.root_sql_artifact_ref,
    ];
    if (
      references.some(
        (reference) =>
          reference.app_id !== scope.app_id ||
          reference.tenant_id !== scope.tenant_id ||
          reference.environment !== scope.environment ||
          reference.run_id !== scope.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Repair Frozen Bundle 的全部 Artifact 必须属于同一 Scope/Run。",
      });
    }
    if (bundle.root_sql_artifact_ref.revision !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Repair Episode Root 必须固定为 SqlArtifact Revision 1。",
        path: ["root_sql_artifact_ref", "revision"],
      });
    }
  });

export type RepairFrozenBundle = z.infer<typeof repairFrozenBundleSchema>;

export type RepairFrozenBundleInput = Omit<
  RepairFrozenBundle,
  "episode_hash" | "frozen_bundle_hash"
>;

export const REPAIR_ROUTES = ["REPLAN", "CLARIFY", "HUMAN"] as const;
export type RepairRoute = (typeof REPAIR_ROUTES)[number];

export const REPAIR_TERMINAL_REASON_CODES = [
  "REPAIR_NO_PROGRESS",
  "REPAIR_COMPILER_UNAVAILABLE",
  "REPAIR_SESSION_TERMINATED",
] as const;
export type RepairTerminalReasonCode = (typeof REPAIR_TERMINAL_REASON_CODES)[number];

const fullRevalidationGateTupleSchema = z.tuple([
  z.literal("INTENT"),
  z.literal("SEMANTIC"),
  z.literal("STRUCTURAL"),
  z.literal("POLICY"),
  z.literal("RESOURCE"),
  z.literal("EXECUTION"),
  z.literal("RESULT"),
]);

const repairReceiptObjectSchema = z.strictObject({
  repair_version: z.literal(BOUNDED_REPAIR_VERSION),
  repair_id: immutableIdSchema,
  episode_hash: contentHashSchema,
  frozen_bundle_hash: contentHashSchema,
  attempt: z.number().int().min(1).max(BOUNDED_REPAIR_LIMITS.max_attempts),
  failure_gate_receipt_ref: artifactReferenceFor("GateReceipt"),
  failed_gate: z.enum(TEXT2SQL_GATES),
  failure_code: versionIdentifierSchema,
  parent_sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  parent_candidate_hash: contentHashSchema,
  deterministic_query_hash: contentHashSchema.nullable(),
  child_candidate_hash: contentHashSchema.nullable(),
  patch_script_hash: contentHashSchema,
  patch_operations: z
    .array(repairPatchOperationSchema)
    .max(BOUNDED_REPAIR_LIMITS.max_patch_operations_per_attempt),
  outcome: z.enum(["CANDIDATE", "ROUTED", "TERMINAL"]),
  route: z.enum(REPAIR_ROUTES).nullable(),
  terminal_reason_code: z.enum(REPAIR_TERMINAL_REASON_CODES).nullable(),
  revalidation_state: z.enum(["REQUIRED", "NOT_APPLICABLE"]),
  required_revalidation_gates: fullRevalidationGateTupleSchema,
  previous_trace_hash: contentHashSchema,
  receipt_hash: contentHashSchema,
});

export const repairReceiptSchema = repairReceiptObjectSchema.superRefine((receipt, ctx) => {
  const candidate =
    receipt.outcome === "CANDIDATE" &&
    receipt.route === null &&
    receipt.terminal_reason_code === null &&
    receipt.revalidation_state === "REQUIRED" &&
    receipt.deterministic_query_hash !== null &&
    receipt.child_candidate_hash !== null &&
    receipt.patch_operations.length > 0;
  const routed =
    receipt.outcome === "ROUTED" &&
    receipt.route !== null &&
    receipt.terminal_reason_code === null &&
    receipt.revalidation_state === "NOT_APPLICABLE" &&
    receipt.deterministic_query_hash === null &&
    receipt.child_candidate_hash === null &&
    receipt.patch_operations.length === 0;
  const noProgress =
    receipt.outcome === "TERMINAL" &&
    receipt.route === null &&
    receipt.terminal_reason_code === "REPAIR_NO_PROGRESS" &&
    receipt.revalidation_state === "NOT_APPLICABLE" &&
    receipt.deterministic_query_hash !== null &&
    receipt.child_candidate_hash === null &&
    receipt.patch_operations.length === 0;
  const compilerUnavailable =
    receipt.outcome === "TERMINAL" &&
    receipt.route === null &&
    receipt.terminal_reason_code === "REPAIR_COMPILER_UNAVAILABLE" &&
    receipt.revalidation_state === "NOT_APPLICABLE" &&
    receipt.deterministic_query_hash === null &&
    receipt.child_candidate_hash === null &&
    receipt.patch_operations.length === 0;
  if (!candidate && !routed && !noProgress && !compilerUnavailable) {
    ctx.addIssue({
      code: "custom",
      message: "RepairReceipt 的事件、结果、路由、终态与重验证状态不一致。",
    });
  }
  if (
    artifactReferenceIdentity(receipt.failure_gate_receipt_ref) ===
    artifactReferenceIdentity(receipt.parent_sql_artifact_ref)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "RepairReceipt 的 Gate 与 SqlArtifact Reference 不能混用。",
    });
  }
});

export type RepairReceipt = z.infer<typeof repairReceiptSchema>;

const repairTraceObjectSchema = z.strictObject({
  repair_version: z.literal(BOUNDED_REPAIR_VERSION),
  frozen_bundle: repairFrozenBundleSchema,
  attempt_count: z.number().int().min(0).max(BOUNDED_REPAIR_LIMITS.max_attempts),
  expected_parent_candidate_hash: contentHashSchema,
  attempt_receipt_hashes: z.array(contentHashSchema).max(BOUNDED_REPAIR_LIMITS.max_attempts),
  terminal_reason_code: z.enum(REPAIR_TERMINAL_REASON_CODES).nullable(),
  trace_hash: contentHashSchema,
});

export const repairTraceSchema = repairTraceObjectSchema.superRefine((trace, ctx) => {
  if (trace.attempt_receipt_hashes.length !== trace.attempt_count) {
    ctx.addIssue({
      code: "custom",
      message: "RepairTrace 的 Attempt Receipt 数必须等于 attempt_count。",
      path: ["attempt_receipt_hashes"],
    });
  }
  if (
    trace.attempt_count === BOUNDED_REPAIR_LIMITS.max_attempts &&
    trace.terminal_reason_code === null
  ) {
    ctx.addIssue({
      code: "custom",
      message: "RepairTrace 达到最大 Attempt 后必须进入吸收终态。",
      path: ["terminal_reason_code"],
    });
  }
});

export type RepairTraceData = z.infer<typeof repairTraceSchema>;

declare const repairTraceBrand: unique symbol;
export type RepairTrace = Readonly<RepairTraceData> & {
  readonly [repairTraceBrand]: true;
};

export const repairSessionTransitionSchema = z
  .strictObject({
    receipt: repairReceiptSchema,
    candidate: sqlArtifactSchema.nullable(),
  })
  .superRefine((transition, ctx) => {
    if ((transition.receipt.outcome === "CANDIDATE") !== (transition.candidate !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "只有 Candidate Transition 可以持久化 Candidate Payload。",
        path: ["candidate"],
      });
    }
  });

export type RepairSessionTransition = z.infer<typeof repairSessionTransitionSchema>;

export const repairSessionSnapshotSchema = z.strictObject({
  repair_id: immutableIdSchema,
  episode_hash: contentHashSchema,
  frozen_bundle_hash: contentHashSchema,
  trace_history: z
    .array(repairTraceSchema)
    .min(1)
    .max(BOUNDED_REPAIR_LIMITS.max_attempts + 1),
  transitions: z.array(repairSessionTransitionSchema).max(BOUNDED_REPAIR_LIMITS.max_attempts),
});

export type RepairSessionSnapshot = z.infer<typeof repairSessionSnapshotSchema>;

export type RepairSessionCreateClaim = Readonly<{
  repair_id: string;
  episode_hash: string;
  frozen_bundle_hash: string;
  initial_trace: RepairTraceData;
}>;

export type RepairSessionTransitionClaim = Readonly<{
  repair_id: string;
  episode_hash: string;
  frozen_bundle_hash: string;
  expected_trace_hash: string;
  expected_attempt_count: number;
  next_trace: RepairTraceData;
  transition: RepairSessionTransition;
}>;

declare const trustedRepairAuthorityBrand: unique symbol;
export type TrustedRepairAuthority = Readonly<{
  readonly principal_id: string;
  authorizeFrozenBundle(bundle: RepairFrozenBundle): Promise<SqlArtifactPayloadContract | null>;
  authorizeParent(
    reference: RepairReceipt["parent_sql_artifact_ref"],
    bundle: RepairFrozenBundle,
    expectedParentCandidateHash: string,
    attemptCount: number,
  ): Promise<SqlArtifactPayloadContract | null>;
  resolveFailureGate(
    reference: RepairReceipt["failure_gate_receipt_ref"],
    bundle: RepairFrozenBundle,
    parentReference: RepairReceipt["parent_sql_artifact_ref"],
  ): Promise<GateReceiptPayload | null>;
  compile(
    input: PostgresqlCompilerInput,
  ): Promise<
    | Readonly<{ state: "COMPILED"; sql_artifact: SqlArtifactPayloadContract }>
    | Readonly<{ state: "UNAVAILABLE" }>
  >;
  createSession(claim: RepairSessionCreateClaim): Promise<boolean>;
  commitTransition(claim: RepairSessionTransitionClaim): Promise<boolean>;
  loadSession(
    claim: Readonly<{ repair_id: string; episode_hash: string }>,
  ): Promise<unknown | null>;
  readonly [trustedRepairAuthorityBrand]: true;
}>;

export type CreateBoundedRepairTraceInput = Readonly<{
  authority: TrustedRepairAuthority;
  frozen_bundle: unknown;
}>;

export type AttemptBoundedRepairInput = Readonly<{
  authority: TrustedRepairAuthority;
  compiler_input: PostgresqlCompilerInput;
  current_parent_sql_artifact_ref: unknown;
  failure_gate_receipt_ref: unknown;
  trace: RepairTrace;
}>;

export type LoadCurrentRepairSessionInput = Readonly<{
  authority: TrustedRepairAuthority;
  compiler_input: PostgresqlCompilerInput;
  repair_id: string;
  episode_hash: string;
}>;

export type LoadedRepairSession = Readonly<{
  trace: RepairTrace;
  transitions: readonly RepairSessionTransition[];
}>;

export type BoundedRepairResult =
  | Readonly<{
      state: "CANDIDATE";
      next_state: "NEEDS_FULL_REVALIDATION";
      candidate: SqlArtifactPayloadContract;
      patch_operations: readonly RepairPatchOperation[];
      receipt: RepairReceipt;
      trace: RepairTrace;
    }>
  | Readonly<{
      state: "ROUTED";
      route: RepairRoute;
      reason_code: "REPAIR_GATE_NOT_MECHANICALLY_REPAIRABLE";
      receipt: RepairReceipt;
      trace: RepairTrace;
    }>
  | Readonly<{
      state: "TERMINAL";
      reason_code: RepairTerminalReasonCode;
      receipt: RepairReceipt | null;
      trace: RepairTrace;
    }>
  | Readonly<{
      state: "STALE_HEAD";
      reason_code: "REPAIR_CONCURRENT_TRANSITION";
      reload_required: true;
    }>;
