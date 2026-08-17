import {
  artifactReferenceSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AuthoritativeTaskCapability,
  isAuthoritativeTaskCapability,
  type TeamTaskV2,
  teamTaskV2Schema,
} from "./team-orchestrator.js";

const canonicalTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const completionCommandSchema = z.strictObject({
  schema_version: z.literal("task-completion-command@2.0.0"),
  completion_id: immutableIdSchema,
  task_expected_revision: z.number().int().positive(),
  output_ref: artifactReferenceSchema,
  completed_at: canonicalTimestampSchema,
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
});

const taskCompletionDraftSchema = z.strictObject({
  schema_version: z.literal("task-completion-receipt@2.0.0"),
  completion_id: immutableIdSchema,
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive(),
  task_hash: contentHashSchema,
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  profile_id: z.string(),
  profile_hash: contentHashSchema,
  output_ref: artifactReferenceSchema,
  status: z.literal("COMPLETED"),
  completed_at: canonicalTimestampSchema,
  idempotency_key: completionCommandSchema.shape.idempotency_key,
});

export const taskCompletionReceiptSchema = taskCompletionDraftSchema.extend({
  completion_hash: contentHashSchema,
});
export type TaskCompletionReceipt = z.infer<typeof taskCompletionReceiptSchema>;

function assertCapabilityForCompletion(
  task: TeamTaskV2,
  capability: AuthoritativeTaskCapability,
): void {
  if (!isAuthoritativeTaskCapability(capability))
    throw new Error("TASK_CAPABILITY_NOT_AUTHORITATIVE");
  if (
    capability.task_id !== task.task_id ||
    capability.attempt_id !== task.attempt_id ||
    capability.worker_fence !== task.worker_fence ||
    capability.profile_hash !== task.profile_hash ||
    !capability.operation_audiences.includes("TASK_COMPLETE")
  ) {
    throw new Error("TASK_CAPABILITY_CORRELATION_MISMATCH");
  }
}

export async function buildTaskCompletionReceipt(
  taskInput: unknown,
  capability: AuthoritativeTaskCapability,
  commandInput: unknown,
): Promise<TaskCompletionReceipt> {
  const task = teamTaskV2Schema.parse(taskInput);
  assertCapabilityForCompletion(task, capability);
  const command = completionCommandSchema.parse(commandInput);
  if (command.task_expected_revision !== task.task_revision)
    throw new Error("TEAM_TASK_REVISION_CONFLICT");
  if (
    command.output_ref.app_id !== task.scope.app_id ||
    command.output_ref.tenant_id !== task.scope.tenant_id ||
    command.output_ref.environment !== task.scope.environment ||
    command.output_ref.run_id !== task.run_id
  ) {
    throw new Error("TEAM_OUTPUT_SCOPE_MISMATCH");
  }
  if (!task.acceptance.required_artifact_types.includes(command.output_ref.artifact_type)) {
    throw new Error("TEAM_OUTPUT_TYPE_NOT_ALLOWED");
  }
  const draft = taskCompletionDraftSchema.parse({
    schema_version: "task-completion-receipt@2.0.0",
    completion_id: command.completion_id,
    task_id: task.task_id,
    task_revision: task.task_revision,
    task_hash: task.task_hash,
    attempt_id: task.attempt_id,
    worker_fence: task.worker_fence,
    profile_id: task.profile_id,
    profile_hash: task.profile_hash,
    output_ref: command.output_ref,
    status: "COMPLETED",
    completed_at: command.completed_at,
    idempotency_key: command.idempotency_key,
  });
  return deepFreeze(
    taskCompletionReceiptSchema.parse({
      ...draft,
      completion_hash: await sha256ContentHash(draft),
    }),
  );
}

const verifierDimensionSchema = z.enum(["PASS", "FAIL", "UNVERIFIED"]);
const verifierDecisionDraftSchema = z.strictObject({
  schema_version: z.literal("team-verifier-decision@2.0.0"),
  decision_id: immutableIdSchema,
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive(),
  completion_hash: contentHashSchema,
  schema_valid: verifierDimensionSchema,
  scope_valid: verifierDimensionSchema,
  policy_valid: verifierDimensionSchema,
  provenance_valid: verifierDimensionSchema,
  execution_valid: verifierDimensionSchema,
  intent_grounded: verifierDimensionSchema,
  oracle_verified: verifierDimensionSchema,
  semantic_status: z.enum(["VERIFIED", "SEMANTICALLY_UNVERIFIED", "NEEDS_CLARIFICATION"]),
  decided_at: canonicalTimestampSchema,
});

export const verifierDecisionSchema = verifierDecisionDraftSchema.extend({
  decision_hash: contentHashSchema,
});
export type VerifierDecision = z.infer<typeof verifierDecisionSchema>;

export async function buildVerifierDecision(input: unknown): Promise<VerifierDecision> {
  const draft = verifierDecisionDraftSchema.parse(input);
  const dimensions = [
    draft.schema_valid,
    draft.scope_valid,
    draft.policy_valid,
    draft.provenance_valid,
    draft.execution_valid,
    draft.intent_grounded,
    draft.oracle_verified,
  ];
  if (draft.semantic_status === "VERIFIED" && dimensions.some((value) => value !== "PASS")) {
    throw new Error("TEAM_VERIFIER_SEMANTIC_STATUS_INVALID");
  }
  return deepFreeze(
    verifierDecisionSchema.parse({
      ...draft,
      decision_hash: await sha256ContentHash(draft),
    }),
  );
}

const acceptanceDraftSchema = z.strictObject({
  schema_version: z.literal("task-acceptance-receipt@2.0.0"),
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive(),
  task_hash: contentHashSchema,
  completion_id: immutableIdSchema,
  completion_hash: contentHashSchema,
  verifier_decision_id: immutableIdSchema,
  verifier_decision_hash: contentHashSchema,
  coverage_hash: contentHashSchema,
  blocking_obligation_ids: z.array(immutableIdSchema),
  status: z.enum(["ACCEPTED", "REJECTED"]),
  reason: z
    .enum(["VERIFIER_NOT_PASSED", "CONTEXT_COVERAGE_BLOCKED", "OPEN_OBLIGATIONS"])
    .nullable(),
  accepted_at: canonicalTimestampSchema,
});

export const taskAcceptanceReceiptSchema = acceptanceDraftSchema.extend({
  acceptance_hash: contentHashSchema,
});
export type TaskAcceptanceReceipt = z.infer<typeof taskAcceptanceReceiptSchema>;

const dimensions = [
  "schema_valid",
  "scope_valid",
  "policy_valid",
  "provenance_valid",
  "execution_valid",
  "intent_grounded",
  "oracle_verified",
] as const;

export async function decideTaskAcceptance(input: {
  readonly task: unknown;
  readonly completion: unknown;
  readonly verifier: unknown;
  readonly coverage_hash: string;
  readonly coverage_acceptance_blocked: boolean;
  readonly blocking_obligation_ids: readonly string[];
  readonly accepted_at: string;
}): Promise<TaskAcceptanceReceipt> {
  const task = teamTaskV2Schema.parse(input.task);
  const completion = taskCompletionReceiptSchema.parse(input.completion);
  const verifier = verifierDecisionSchema.parse(input.verifier);
  if (
    completion.task_id !== task.task_id ||
    completion.task_revision !== task.task_revision ||
    completion.task_hash !== task.task_hash ||
    verifier.task_id !== task.task_id ||
    verifier.task_revision !== task.task_revision ||
    verifier.completion_hash !== completion.completion_hash
  ) {
    throw new Error("TEAM_ACCEPTANCE_CORRELATION_MISMATCH");
  }
  const obligationIds = [...input.blocking_obligation_ids].sort();
  if (new Set(obligationIds).size !== obligationIds.length)
    throw new Error("TEAM_OBLIGATION_DUPLICATE");
  let reason: z.infer<typeof acceptanceDraftSchema>["reason"] = null;
  if (input.coverage_acceptance_blocked) reason = "CONTEXT_COVERAGE_BLOCKED";
  else if (obligationIds.length > 0) reason = "OPEN_OBLIGATIONS";
  else if (
    verifier.semantic_status !== "VERIFIED" ||
    dimensions.some((dimension) => verifier[dimension] !== "PASS")
  )
    reason = "VERIFIER_NOT_PASSED";
  const draft = acceptanceDraftSchema.parse({
    schema_version: "task-acceptance-receipt@2.0.0",
    task_id: task.task_id,
    task_revision: task.task_revision,
    task_hash: task.task_hash,
    completion_id: completion.completion_id,
    completion_hash: completion.completion_hash,
    verifier_decision_id: verifier.decision_id,
    verifier_decision_hash: verifier.decision_hash,
    coverage_hash: contentHashSchema.parse(input.coverage_hash),
    blocking_obligation_ids: obligationIds,
    status: reason === null ? "ACCEPTED" : "REJECTED",
    reason,
    accepted_at: input.accepted_at,
  });
  return deepFreeze(
    taskAcceptanceReceiptSchema.parse({
      ...draft,
      acceptance_hash: await sha256ContentHash(draft),
    }),
  );
}

export function sameAcceptanceReceipt(left: TaskAcceptanceReceipt, right: TaskAcceptanceReceipt) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export function selectAcceptedTaskOutputRef(input: {
  readonly completion: unknown;
  readonly acceptance: unknown;
}) {
  const completion = taskCompletionReceiptSchema.parse(input.completion);
  const acceptance = taskAcceptanceReceiptSchema.parse(input.acceptance);
  if (
    acceptance.status !== "ACCEPTED" ||
    acceptance.task_id !== completion.task_id ||
    acceptance.task_revision !== completion.task_revision ||
    acceptance.completion_id !== completion.completion_id ||
    acceptance.completion_hash !== completion.completion_hash
  ) {
    throw new Error("TEAM_OUTPUT_NOT_ACCEPTED");
  }
  return deepFreeze(completion.output_ref);
}

const lateTaskResultAuditDraftSchema = z.strictObject({
  schema_version: z.literal("late-task-result-audit@2.0.0"),
  event_id: immutableIdSchema,
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive(),
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  result_hash: contentHashSchema,
  reason: z.enum([
    "CANCELLED",
    "TIMED_OUT",
    "LEASE_EXPIRED",
    "STALE_PROFILE",
    "STALE_FENCE",
    "CHILD_ID_SPOOF",
  ]),
  observed_at: canonicalTimestampSchema,
});

export const lateTaskResultAuditSchema = lateTaskResultAuditDraftSchema.extend({
  event_hash: contentHashSchema,
});
export type LateTaskResultAudit = z.infer<typeof lateTaskResultAuditSchema>;

export async function buildLateTaskResultAudit(input: unknown): Promise<LateTaskResultAudit> {
  const draft = lateTaskResultAuditDraftSchema.parse(input);
  return deepFreeze(
    lateTaskResultAuditSchema.parse({
      ...draft,
      event_hash: await sha256ContentHash(draft),
    }),
  );
}
