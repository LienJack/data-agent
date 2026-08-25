import { createHash } from "node:crypto";
import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  knownArtifactTypeSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  assertDelegationAllowed,
  dataAgentProfileIdSchema,
  getAgentProfileRevision,
  getAgentProfileRevisionExact,
} from "./agent-profiles.js";

const taskBoundsSchema = z.strictObject({
  max_context_bytes: z.number().int().positive().max(65_536),
  max_input_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  max_tool_calls: z.number().int().nonnegative(),
  timeout_ms: z.number().int().positive().max(600_000),
});

const contextEpochRefSchema = z.strictObject({
  epoch_id: immutableIdSchema,
  build_signature: contentHashSchema,
});

const teamTaskDraftSchema = z.strictObject({
  schema_version: z.literal("agent-team-task@2.0.0"),
  task_id: immutableIdSchema,
  parent_task_id: immutableIdSchema.nullable(),
  parent_handoff_id: immutableIdSchema.nullable(),
  depth: z.union([z.literal(0), z.literal(1)]),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  profile_id: dataAgentProfileIdSchema,
  profile_revision: z.number().int().positive(),
  profile_hash: contentHashSchema,
  task_revision: z.number().int().positive(),
  goal_revision: z.number().int().positive(),
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  context_epoch_ref: contextEpochRefSchema.nullable(),
  bounds: taskBoundsSchema,
  acceptance: z.strictObject({
    required_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(8),
    require_all_verifier_dimensions: z.literal(true),
  }),
});

function sameScope(
  scope: AppScope,
  runId: string,
  reference: z.infer<typeof artifactReferenceSchema>,
) {
  return (
    scope.app_id === reference.app_id &&
    scope.tenant_id === reference.tenant_id &&
    scope.environment === reference.environment &&
    runId === reference.run_id
  );
}

function canonicalUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

function syncHash(input: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeJson(input)).digest("hex")}`;
}

export const teamTaskV2Schema = teamTaskDraftSchema
  .extend({ task_hash: contentHashSchema })
  .superRefine((task, ctx) => {
    try {
      getAgentProfileRevisionExact(task.profile_id, task.profile_revision, task.profile_hash);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Task profile revision mismatch.",
        path: ["profile_hash"],
      });
      return;
    }
    if (
      (task.depth === 0 &&
        (task.profile_id !== "data-agent-orchestrator" ||
          task.parent_task_id !== null ||
          task.parent_handoff_id !== null)) ||
      (task.depth === 1 &&
        (task.profile_id === "data-agent-orchestrator" ||
          task.parent_task_id === null ||
          task.parent_handoff_id === null))
    ) {
      ctx.addIssue({ code: "custom", message: "Task lineage/depth is invalid.", path: ["depth"] });
    }
    const identities = task.artifact_refs.map(artifactReferenceIdentity);
    if (!canonicalUnique(identities)) {
      ctx.addIssue({
        code: "custom",
        message: "Task artifact refs must be canonical and unique.",
        path: ["artifact_refs"],
      });
    }
    task.artifact_refs.forEach((reference, index) => {
      if (!sameScope(task.scope, task.run_id, reference)) {
        ctx.addIssue({
          code: "custom",
          message: "Task artifact scope mismatch.",
          path: ["artifact_refs", index],
        });
      }
    });
    if (
      task.context_epoch_ref !== null &&
      task.artifact_refs.filter(
        (reference) => reference.artifact_type === "SensitiveExecutionArtifact",
      ).length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A context epoch requires exactly one private model-view artifact reference.",
        path: ["context_epoch_ref"],
      });
    }
    const { task_hash: actual, ...draft } = task;
    if (syncHash(teamTaskDraftSchema.parse(draft)) !== actual) {
      ctx.addIssue({ code: "custom", message: "Task hash mismatch.", path: ["task_hash"] });
    }
  });

export type TeamTaskV2 = z.infer<typeof teamTaskV2Schema>;

export function buildTeamTaskV2(input: unknown): TeamTaskV2 {
  const draft = teamTaskDraftSchema.parse(input);
  return deepFreeze(teamTaskV2Schema.parse({ ...draft, task_hash: syncHash(draft) }));
}

const canonicalTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const acceptedSiblingOutputAttachmentDraftSchema = z.strictObject({
  schema_version: z.literal("agent-team-accepted-sibling-output-attachment@1.0.0"),
  attachment_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  root_task_id: immutableIdSchema,
  root_task_hash: contentHashSchema,
  producer_task_id: immutableIdSchema,
  producer_task_hash: contentHashSchema,
  producer_profile_id: dataAgentProfileIdSchema,
  producer_tool_call_id: z.string().min(1).max(256),
  consumer_task_id: immutableIdSchema,
  consumer_tool_call_id: z.string().min(1).max(256),
  consumer_profile_id: dataAgentProfileIdSchema,
  consumer_profile_revision: z.number().int().positive(),
  consumer_profile_hash: contentHashSchema,
  artifact_ref: artifactReferenceSchema,
  completion_id: immutableIdSchema,
  completion_hash: contentHashSchema,
  verifier_decision_id: immutableIdSchema,
  verifier_decision_hash: contentHashSchema,
  acceptance_hash: contentHashSchema,
  worker_fence: z.number().int().positive(),
  attached_at: canonicalTimestampSchema,
});

export const acceptedSiblingOutputAttachmentSchema = acceptedSiblingOutputAttachmentDraftSchema
  .extend({ attachment_hash: contentHashSchema })
  .superRefine((attachment, ctx) => {
    if (!sameScope(attachment.scope, attachment.run_id, attachment.artifact_ref)) {
      ctx.addIssue({
        code: "custom",
        message: "Accepted sibling output escaped the attachment scope.",
        path: ["artifact_ref"],
      });
    }
  });

export type AcceptedSiblingOutputAttachment = z.infer<typeof acceptedSiblingOutputAttachmentSchema>;

export async function buildAcceptedSiblingOutputAttachment(
  input: unknown,
): Promise<AcceptedSiblingOutputAttachment> {
  const draft = acceptedSiblingOutputAttachmentDraftSchema.parse(input);
  return deepFreeze(
    acceptedSiblingOutputAttachmentSchema.parse({
      ...draft,
      attachment_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyAcceptedSiblingOutputAttachment(
  input: unknown,
): Promise<AcceptedSiblingOutputAttachment> {
  const attachment = acceptedSiblingOutputAttachmentSchema.parse(input);
  const { attachment_hash: actual, ...draft } = attachment;
  if (
    (await sha256ContentHash(acceptedSiblingOutputAttachmentDraftSchema.parse(draft))) !== actual
  ) {
    throw new Error("ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_HASH_MISMATCH");
  }
  return deepFreeze(attachment);
}

export interface CommittedAcceptedSiblingOutputAttachmentResolver {
  resolve_committed(attachmentId: string): Promise<unknown | null>;
}

const authoritativeAcceptedSiblingAttachments = new WeakSet<object>();
export type AuthoritativeAcceptedSiblingOutputAttachment = AcceptedSiblingOutputAttachment & {
  readonly __acceptedSiblingOutputAttachmentAuthority: never;
};

export async function authorizePersistedAcceptedSiblingOutputAttachment(input: {
  readonly attachment_id: string;
  readonly root_task: unknown;
  readonly producer_task: unknown;
  readonly consumer_task_id: string;
  readonly consumer_tool_call_id: string;
  readonly consumer_profile_id: string;
  readonly consumer_profile_revision: number;
  readonly consumer_profile_hash: string;
  readonly producer_tool_call_id: string;
  readonly artifact_ref: ArtifactReference;
  readonly completion_id: string;
  readonly completion_hash: string;
  readonly verifier_decision_id: string;
  readonly verifier_decision_hash: string;
  readonly acceptance_hash: string;
  readonly resolver: CommittedAcceptedSiblingOutputAttachmentResolver;
}): Promise<AuthoritativeAcceptedSiblingOutputAttachment> {
  const root = teamTaskV2Schema.parse(input.root_task);
  const producer = teamTaskV2Schema.parse(input.producer_task);
  const attachmentId = immutableIdSchema.parse(input.attachment_id);
  const consumerTaskId = immutableIdSchema.parse(input.consumer_task_id);
  getAgentProfileRevisionExact(
    dataAgentProfileIdSchema.parse(input.consumer_profile_id),
    input.consumer_profile_revision,
    contentHashSchema.parse(input.consumer_profile_hash),
  );
  const resolved = await input.resolver.resolve_committed(attachmentId);
  if (resolved === null) throw new Error("ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_NOT_FOUND");
  const attachment = await verifyAcceptedSiblingOutputAttachment(resolved);
  if (
    root.depth !== 0 ||
    producer.depth !== 1 ||
    producer.parent_task_id !== root.task_id ||
    attachment.attachment_id !== attachmentId ||
    attachment.scope.app_id !== root.scope.app_id ||
    attachment.scope.tenant_id !== root.scope.tenant_id ||
    attachment.scope.environment !== root.scope.environment ||
    attachment.run_id !== root.run_id ||
    attachment.root_task_id !== root.task_id ||
    attachment.root_task_hash !== root.task_hash ||
    attachment.producer_task_id !== producer.task_id ||
    attachment.producer_task_hash !== producer.task_hash ||
    attachment.producer_profile_id !== producer.profile_id ||
    attachment.producer_tool_call_id !== input.producer_tool_call_id ||
    attachment.consumer_task_id !== consumerTaskId ||
    attachment.consumer_tool_call_id !== input.consumer_tool_call_id ||
    attachment.consumer_profile_id !== input.consumer_profile_id ||
    attachment.consumer_profile_revision !== input.consumer_profile_revision ||
    attachment.consumer_profile_hash !== input.consumer_profile_hash ||
    artifactReferenceIdentity(attachment.artifact_ref) !==
      artifactReferenceIdentity(input.artifact_ref) ||
    attachment.completion_id !== input.completion_id ||
    attachment.completion_hash !== input.completion_hash ||
    attachment.verifier_decision_id !== input.verifier_decision_id ||
    attachment.verifier_decision_hash !== input.verifier_decision_hash ||
    attachment.acceptance_hash !== input.acceptance_hash ||
    attachment.worker_fence !== root.worker_fence ||
    producer.worker_fence !== root.worker_fence
  ) {
    throw new Error("ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_CORRELATION_MISMATCH");
  }
  authoritativeAcceptedSiblingAttachments.add(attachment);
  return attachment as AuthoritativeAcceptedSiblingOutputAttachment;
}

export function isAuthoritativeAcceptedSiblingOutputAttachment(
  input: unknown,
): input is AuthoritativeAcceptedSiblingOutputAttachment {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeAcceptedSiblingAttachments.has(input)
  );
}

const operationAudienceSchema = z.enum(["HANDOFF_PREPARE", "TASK_COMPLETE", "TOOL_INVOKE"]);

const taskCapabilityDraftSchema = z.strictObject({
  schema_version: z.literal("task-capability-receipt@2.0.0"),
  capability_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  task_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  profile_id: dataAgentProfileIdSchema,
  profile_revision: z.number().int().positive(),
  profile_hash: contentHashSchema,
  artifact_ref_identities: z.array(z.string().min(1)).max(64),
  operation_audiences: z.array(operationAudienceSchema).min(1).max(3),
  issuer: z.strictObject({
    principal_id: immutableIdSchema,
    key_id: versionIdentifierSchema,
  }),
  issued_at: canonicalTimestampSchema,
  expires_at: canonicalTimestampSchema,
  nonce: immutableIdSchema,
  revocation_version: z.number().int().positive(),
});

export const taskCapabilityReceiptSchema = taskCapabilityDraftSchema
  .extend({ capability_hash: contentHashSchema })
  .superRefine((receipt, ctx) => {
    if (
      !canonicalUnique(receipt.artifact_ref_identities) ||
      !canonicalUnique(receipt.operation_audiences)
    ) {
      ctx.addIssue({ code: "custom", message: "Capability sets must be canonical and unique." });
    }
    if (Date.parse(receipt.expires_at) <= Date.parse(receipt.issued_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Capability expiry must follow issue time.",
        path: ["expires_at"],
      });
    }
  });

export type TaskCapabilityReceipt = z.infer<typeof taskCapabilityReceiptSchema>;

export async function buildTaskCapabilityReceipt(input: unknown): Promise<TaskCapabilityReceipt> {
  const draft = taskCapabilityDraftSchema.parse(input);
  return deepFreeze(
    taskCapabilityReceiptSchema.parse({
      ...draft,
      capability_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyTaskCapabilityReceipt(input: unknown): Promise<TaskCapabilityReceipt> {
  const receipt = taskCapabilityReceiptSchema.parse(input);
  const { capability_hash: actual, ...draft } = receipt;
  if ((await sha256ContentHash(taskCapabilityDraftSchema.parse(draft))) !== actual) {
    throw new Error("TASK_CAPABILITY_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export interface CommittedTaskCapabilityResolver {
  resolve_committed(capabilityId: string): Promise<unknown | null>;
}

const authoritativeCapabilities = new WeakSet<object>();
export type AuthoritativeTaskCapability = TaskCapabilityReceipt & {
  readonly __taskCapabilityAuthority: never;
};

function assertCapabilityCorrelation(task: TeamTaskV2, receipt: TaskCapabilityReceipt): void {
  if (
    receipt.scope.app_id !== task.scope.app_id ||
    receipt.scope.tenant_id !== task.scope.tenant_id ||
    receipt.scope.environment !== task.scope.environment ||
    receipt.run_id !== task.run_id ||
    receipt.task_id !== task.task_id ||
    receipt.attempt_id !== task.attempt_id ||
    receipt.worker_fence !== task.worker_fence ||
    receipt.profile_id !== task.profile_id ||
    receipt.profile_revision !== task.profile_revision ||
    receipt.profile_hash !== task.profile_hash ||
    canonicalizeJson(receipt.artifact_ref_identities) !==
      canonicalizeJson(task.artifact_refs.map(artifactReferenceIdentity))
  ) {
    throw new Error("TASK_CAPABILITY_CORRELATION_MISMATCH");
  }
}

export async function authorizePersistedTaskCapability(
  taskInput: unknown,
  capabilityId: string,
  resolver: CommittedTaskCapabilityResolver,
  options: { readonly now: string; readonly audience: z.infer<typeof operationAudienceSchema> },
): Promise<AuthoritativeTaskCapability> {
  const task = teamTaskV2Schema.parse(taskInput);
  const resolved = await resolver.resolve_committed(immutableIdSchema.parse(capabilityId));
  if (resolved === null) throw new Error("TASK_CAPABILITY_NOT_FOUND");
  const receipt = await verifyTaskCapabilityReceipt(resolved);
  assertCapabilityCorrelation(task, receipt);
  const now = Date.parse(canonicalTimestampSchema.parse(options.now));
  if (now < Date.parse(receipt.issued_at) || now >= Date.parse(receipt.expires_at)) {
    throw new Error("TASK_CAPABILITY_EXPIRED");
  }
  if (!receipt.operation_audiences.includes(options.audience)) {
    throw new Error("TASK_CAPABILITY_AUDIENCE_DENIED");
  }
  authoritativeCapabilities.add(receipt);
  return receipt as AuthoritativeTaskCapability;
}

export function isAuthoritativeTaskCapability(
  input: unknown,
): input is AuthoritativeTaskCapability {
  return typeof input === "object" && input !== null && authoritativeCapabilities.has(input);
}

const delegationRequestSchema = z.strictObject({
  schema_version: z.literal("subagent-delegation-request@2.0.0"),
  handoff_id: immutableIdSchema,
  child_task_id: immutableIdSchema,
  child_attempt_id: immutableIdSchema,
  child_profile_id: dataAgentProfileIdSchema,
  child_profile_revision: z.number().int().positive().optional(),
  child_profile_hash: contentHashSchema.optional(),
  parent_expected_revision: z.number().int().positive(),
  objective_hash: contentHashSchema,
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  bounds: taskBoundsSchema,
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
});

export const subagentDelegationCommandSchema = z.strictObject({
  schema_version: z.literal("subagent-delegation-command@2.0.0"),
  parent_task_id: immutableIdSchema,
  parent_expected_revision: z.number().int().positive(),
  parent_task_hash: contentHashSchema,
  capability_id: immutableIdSchema,
  capability_hash: contentHashSchema,
  request_hash: contentHashSchema,
  child_task: teamTaskV2Schema,
  idempotency_key: delegationRequestSchema.shape.idempotency_key,
});

function boundsAreNarrower(
  parent: z.infer<typeof taskBoundsSchema>,
  child: z.infer<typeof taskBoundsSchema>,
) {
  return (
    child.max_context_bytes <= parent.max_context_bytes &&
    child.max_input_tokens <= parent.max_input_tokens &&
    child.max_output_tokens <= parent.max_output_tokens &&
    child.max_tool_calls <= parent.max_tool_calls &&
    child.timeout_ms <= parent.timeout_ms
  );
}

export function createSubagentDelegationCommand(
  parentInput: unknown,
  capability: AuthoritativeTaskCapability,
  requestInput: unknown,
  acceptedSiblingAttachments: readonly AuthoritativeAcceptedSiblingOutputAttachment[] = [],
) {
  const parent = teamTaskV2Schema.parse(parentInput);
  if (!isAuthoritativeTaskCapability(capability))
    throw new Error("TASK_CAPABILITY_NOT_AUTHORITATIVE");
  assertCapabilityCorrelation(parent, capability);
  const request = delegationRequestSchema.parse(requestInput);
  assertDelegationAllowed(parent.profile_id, request.child_profile_id);
  if (parent.depth !== 0) throw new Error("TEAM_RECURSIVE_DELEGATION_DENIED");
  if (request.parent_expected_revision !== parent.task_revision) {
    throw new Error("TEAM_TASK_REVISION_CONFLICT");
  }
  if (!boundsAreNarrower(parent.bounds, request.bounds)) throw new Error("TEAM_BOUNDS_ESCALATION");
  const allowed = new Set(parent.artifact_refs.map(artifactReferenceIdentity));
  for (const attachment of acceptedSiblingAttachments) {
    if (
      !isAuthoritativeAcceptedSiblingOutputAttachment(attachment) ||
      attachment.root_task_id !== parent.task_id ||
      attachment.root_task_hash !== parent.task_hash ||
      attachment.consumer_task_id !== request.child_task_id ||
      attachment.consumer_profile_id !== request.child_profile_id ||
      attachment.worker_fence !== parent.worker_fence
    ) {
      throw new Error("ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_CORRELATION_MISMATCH");
    }
    allowed.add(artifactReferenceIdentity(attachment.artifact_ref));
  }
  if (
    request.artifact_refs.some((reference) => !allowed.has(artifactReferenceIdentity(reference)))
  ) {
    throw new Error("TEAM_ARTIFACT_SCOPE_ESCALATION");
  }
  if (
    (request.child_profile_revision === undefined) !==
    (request.child_profile_hash === undefined)
  ) {
    throw new Error("TEAM_PROFILE_REVISION_BINDING_INVALID");
  }
  const profile =
    request.child_profile_revision && request.child_profile_hash
      ? getAgentProfileRevisionExact(
          request.child_profile_id,
          request.child_profile_revision,
          request.child_profile_hash,
        )
      : getAgentProfileRevision(request.child_profile_id);
  if (
    acceptedSiblingAttachments.some(
      (attachment) =>
        attachment.consumer_profile_revision !== profile.revision ||
        attachment.consumer_profile_hash !== profile.profile_hash,
    )
  ) {
    throw new Error("ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_CORRELATION_MISMATCH");
  }
  const childTask = buildTeamTaskV2({
    schema_version: "agent-team-task@2.0.0",
    task_id: request.child_task_id,
    parent_task_id: parent.task_id,
    parent_handoff_id: request.handoff_id,
    depth: 1,
    scope: parent.scope,
    run_id: parent.run_id,
    profile_id: profile.profile_id,
    profile_revision: profile.revision,
    profile_hash: profile.profile_hash,
    task_revision: 1,
    goal_revision: parent.goal_revision,
    attempt_id: request.child_attempt_id,
    worker_fence: parent.worker_fence,
    artifact_refs: [...request.artifact_refs].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    ),
    context_epoch_ref: null,
    bounds: request.bounds,
    acceptance: {
      required_artifact_types: profile.expected_output_artifact_types,
      require_all_verifier_dimensions: true,
    },
  });
  const requestHash = syncHash(delegationRequestSchema.parse(request));
  return deepFreeze(
    subagentDelegationCommandSchema.parse({
      schema_version: "subagent-delegation-command@2.0.0",
      parent_task_id: parent.task_id,
      parent_expected_revision: request.parent_expected_revision,
      parent_task_hash: parent.task_hash,
      capability_id: capability.capability_id,
      capability_hash: capability.capability_hash,
      request_hash: requestHash,
      child_task: childTask,
      idempotency_key: request.idempotency_key,
    }),
  );
}
