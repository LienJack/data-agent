import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  type PortResult,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const JOB_KINDS = [
  "SCHEMA_SCAN",
  "RELATIONSHIP_INDEX",
  "ARTIFACT_EXPORT",
  "SEMANTIC_INDUCTION",
  "METRIC_IMPORT",
  "DATALINK_REBUILD",
] as const;

export const jobKindSchema = z.enum(JOB_KINDS);
export const jobStatusSchema = z.enum([
  "QUEUED",
  "LEASED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "RETRY_WAIT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);
export const jobTerminalStatusSchema = z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"]);
export const jobCancelPolicySchema = z.enum(["COOPERATIVE", "NOT_SUPPORTED"]);
export const jobDispositionSchema = z.enum(["CREATED", "REPLAYED"]);
export const jobRuntimeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
export const jobIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
export const jobErrorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);
export const jobTimestampSchema = timestampSchema.refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  "Job Timestamp 必须是 PostgreSQL 签发的 UTC 毫秒格式。",
);
export const jobLeaseDurationMsSchema = z.number().int().min(5_000).max(900_000);
export const jobRetryDelayMsSchema = z.number().int().min(1_000).max(86_400_000);

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

function referenceScopeMatches(reference: ArtifactReference, scope: AppScope): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment
  );
}

function assertCanonicalReferences(
  references: readonly ArtifactReference[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const identities = references.map(artifactReferenceIdentity);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "Job Resource References 不得重复。", path });
  }
  const sorted = [...identities].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (identities.some((identity, index) => identity !== sorted[index])) {
    context.addIssue({
      code: "custom",
      message: "Job Resource References 必须按完整内容身份规范排序。",
      path,
    });
  }
}

export const jobInputSchema = z
  .strictObject({
    schema_version: z.literal("job-input@1.0.0"),
    kind: jobKindSchema,
    resource_refs: z.array(artifactReferenceSchema).max(64),
    parameters: z.record(z.string().min(1).max(128), z.json()),
  })
  .superRefine((input, context) => {
    assertCanonicalReferences(input.resource_refs, context, ["resource_refs"]);
  });

const jobSubmissionDraftSchema = z
  .strictObject({
    schema_version: z.literal("job-submit@1.0.0"),
    scope: appScopeSchema,
    kind: jobKindSchema,
    idempotency_key: jobIdempotencyKeySchema,
    input: jobInputSchema,
    priority: z.number().int().min(0).max(100),
    max_attempts: z.number().int().min(1).max(10),
    cancel_policy: jobCancelPolicySchema,
  })
  .superRefine((command, context) => {
    if (command.input.kind !== command.kind) {
      context.addIssue({
        code: "custom",
        message: "Job Input Kind 必须与提交 Kind 一致。",
        path: ["input", "kind"],
      });
    }
    command.input.resource_refs.forEach((reference, index) => {
      if (!referenceScopeMatches(reference, command.scope)) {
        context.addIssue({
          code: "custom",
          message: "Job Resource Reference 必须属于同一 App/Tenant/Environment。",
          path: ["input", "resource_refs", index],
        });
      }
    });
  });

export const jobSubmissionCommandSchema = z
  .strictObject({
    ...jobSubmissionDraftSchema.shape,
    request_hash: contentHashSchema,
  })
  .superRefine((command, context) => {
    if (command.input.kind !== command.kind) {
      context.addIssue({
        code: "custom",
        message: "Job Input Kind 必须与提交 Kind 一致。",
        path: ["input", "kind"],
      });
    }
    command.input.resource_refs.forEach((reference, index) => {
      if (!referenceScopeMatches(reference, command.scope)) {
        context.addIssue({
          code: "custom",
          message: "Job Resource Reference 必须属于同一 App/Tenant/Environment。",
          path: ["input", "resource_refs", index],
        });
      }
    });
  });

export async function computeJobRequestHash(
  input: JobSubmissionCommand | JobSubmissionCommandDraft,
) {
  const draft = jobSubmissionDraftSchema.parse({
    schema_version: input.schema_version,
    scope: input.scope,
    kind: input.kind,
    idempotency_key: input.idempotency_key,
    input: input.input,
    priority: input.priority,
    max_attempts: input.max_attempts,
    cancel_policy: input.cancel_policy,
  });
  return sha256ContentHash(draft);
}

export async function buildJobSubmissionCommand(
  input: JobSubmissionCommandDraft,
): Promise<JobSubmissionCommand> {
  const draft = jobSubmissionDraftSchema.parse(input);
  return deepFreeze(
    jobSubmissionCommandSchema.parse({
      ...draft,
      request_hash: await computeJobRequestHash(draft),
    }),
  );
}

export async function verifyJobSubmissionCommand(input: unknown): Promise<JobSubmissionCommand> {
  const parsed = jobSubmissionCommandSchema.parse(input);
  if ((await computeJobRequestHash(parsed)) !== parsed.request_hash) {
    throw new TypeError("JOB_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

const jobWorkLeaseDraftSchema = z
  .strictObject({
    schema_version: z.literal("job-work-lease@1.0.0"),
    scope: appScopeSchema,
    principal_id: immutableIdSchema,
    job_id: immutableIdSchema,
    kind: jobKindSchema,
    request_hash: contentHashSchema,
    input: jobInputSchema,
    attempt_id: immutableIdSchema,
    attempt_no: positiveSafeIntegerSchema,
    delivery_attempt_no: positiveSafeIntegerSchema,
    worker_id: jobRuntimeIdentifierSchema,
    lease_token: positiveSafeIntegerSchema,
    worker_fence: positiveSafeIntegerSchema,
    lease_duration_ms: jobLeaseDurationMsSchema,
    expires_at: jobTimestampSchema,
    handler_revision: versionIdentifierSchema,
  })
  .superRefine((lease, context) => {
    if (lease.input.kind !== lease.kind) {
      context.addIssue({ code: "custom", message: "Lease Input Kind 不一致。", path: ["input"] });
    }
    lease.input.resource_refs.forEach((reference, index) => {
      if (!referenceScopeMatches(reference, lease.scope)) {
        context.addIssue({
          code: "custom",
          message: "Lease Resource Reference 跨 Scope。",
          path: ["input", "resource_refs", index],
        });
      }
    });
  });

export const jobWorkLeaseSchema = z
  .strictObject({ ...jobWorkLeaseDraftSchema.shape, lease_hash: contentHashSchema })
  .superRefine((lease, context) => {
    if (lease.input.kind !== lease.kind) {
      context.addIssue({ code: "custom", message: "Lease Input Kind 不一致。", path: ["input"] });
    }
    lease.input.resource_refs.forEach((reference, index) => {
      if (!referenceScopeMatches(reference, lease.scope)) {
        context.addIssue({
          code: "custom",
          message: "Lease Resource Reference 跨 Scope。",
          path: ["input", "resource_refs", index],
        });
      }
    });
  });

export async function computeJobWorkLeaseHash(input: JobWorkLease | JobWorkLeaseDraft) {
  return sha256ContentHash(
    jobWorkLeaseDraftSchema.parse({
      schema_version: input.schema_version,
      scope: input.scope,
      principal_id: input.principal_id,
      job_id: input.job_id,
      kind: input.kind,
      request_hash: input.request_hash,
      input: input.input,
      attempt_id: input.attempt_id,
      attempt_no: input.attempt_no,
      delivery_attempt_no: input.delivery_attempt_no,
      worker_id: input.worker_id,
      lease_token: input.lease_token,
      worker_fence: input.worker_fence,
      lease_duration_ms: input.lease_duration_ms,
      expires_at: input.expires_at,
      handler_revision: input.handler_revision,
    }),
  );
}

export async function buildJobWorkLease(input: JobWorkLeaseDraft): Promise<JobWorkLease> {
  const draft = jobWorkLeaseDraftSchema.parse(input);
  return deepFreeze(
    jobWorkLeaseSchema.parse({ ...draft, lease_hash: await computeJobWorkLeaseHash(draft) }),
  );
}

export async function verifyJobWorkLease(input: unknown): Promise<JobWorkLease> {
  const parsed = jobWorkLeaseSchema.parse(input);
  if ((await computeJobWorkLeaseHash(parsed)) !== parsed.lease_hash) {
    throw new TypeError("JOB_WORK_LEASE_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

const jobOutputReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("job-output-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    principal_id: immutableIdSchema,
    job_id: immutableIdSchema,
    kind: jobKindSchema,
    request_hash: contentHashSchema,
    attempt_id: immutableIdSchema,
    worker_fence: positiveSafeIntegerSchema,
    terminal: jobTerminalStatusSchema,
    output_refs: z.array(artifactReferenceSchema).max(64),
    error_code: jobErrorCodeSchema.nullable(),
    committed_at: jobTimestampSchema,
  })
  .superRefine((receipt, context) => {
    assertCanonicalReferences(receipt.output_refs, context, ["output_refs"]);
    receipt.output_refs.forEach((reference, index) => {
      if (!referenceScopeMatches(reference, receipt.scope)) {
        context.addIssue({
          code: "custom",
          message: "Job Output Reference 必须属于同一 Scope。",
          path: ["output_refs", index],
        });
      }
    });
    if (receipt.terminal === "SUCCEEDED") {
      if (receipt.error_code !== null || receipt.output_refs.length === 0) {
        context.addIssue({
          code: "custom",
          message: "SUCCEEDED 必须有输出且不能有 Error Code。",
          path: ["terminal"],
        });
      }
    } else if (receipt.error_code === null || receipt.output_refs.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "非成功 Job 终态必须有 Error Code 且不能携带成功输出。",
        path: ["terminal"],
      });
    }
  });

function outputReceiptDraft(input: JobOutputReceipt | JobOutputReceiptDraft) {
  return {
    schema_version: input.schema_version,
    receipt_id: input.receipt_id,
    scope: input.scope,
    principal_id: input.principal_id,
    job_id: input.job_id,
    kind: input.kind,
    request_hash: input.request_hash,
    attempt_id: input.attempt_id,
    worker_fence: input.worker_fence,
    terminal: input.terminal,
    output_refs: input.output_refs,
    error_code: input.error_code,
    committed_at: input.committed_at,
  };
}

export const jobOutputReceiptSchema = z
  .strictObject({
    ...jobOutputReceiptDraftSchema.shape,
    receipt_hash: contentHashSchema,
  })
  .superRefine((receipt, context) => {
    const closure = jobOutputReceiptDraftSchema.safeParse(outputReceiptDraft(receipt));
    if (!closure.success) {
      for (const issue of closure.error.issues) {
        context.addIssue({ code: "custom", message: issue.message, path: issue.path });
      }
    }
  });

export async function computeJobOutputReceiptHash(input: JobOutputReceipt | JobOutputReceiptDraft) {
  const draft = jobOutputReceiptDraftSchema.parse(outputReceiptDraft(input));
  return sha256ContentHash(draft);
}

export async function buildJobOutputReceipt(
  input: JobOutputReceiptDraft,
): Promise<JobOutputReceipt> {
  const draft = jobOutputReceiptDraftSchema.parse(input);
  return deepFreeze(
    jobOutputReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeJobOutputReceiptHash(draft),
    }),
  );
}

export async function verifyJobOutputReceipt(input: unknown): Promise<JobOutputReceipt> {
  const parsed = jobOutputReceiptSchema.parse(input);
  if ((await computeJobOutputReceiptHash(parsed)) !== parsed.receipt_hash) {
    throw new TypeError("JOB_OUTPUT_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

const jobSubmissionReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("job-submission-receipt@1.0.0"),
  disposition: jobDispositionSchema,
  scope: appScopeSchema,
  principal_id: immutableIdSchema,
  job_id: immutableIdSchema,
  kind: jobKindSchema,
  request_hash: contentHashSchema,
  status: z.literal("QUEUED"),
  accepted_at: jobTimestampSchema,
});

export const jobSubmissionReceiptSchema = z.strictObject({
  ...jobSubmissionReceiptDraftSchema.shape,
  receipt_hash: contentHashSchema,
});

export async function computeJobSubmissionReceiptHash(
  input: JobSubmissionReceipt | JobSubmissionReceiptDraft,
) {
  return sha256ContentHash(
    jobSubmissionReceiptDraftSchema.parse({
      schema_version: input.schema_version,
      disposition: input.disposition,
      scope: input.scope,
      principal_id: input.principal_id,
      job_id: input.job_id,
      kind: input.kind,
      request_hash: input.request_hash,
      status: input.status,
      accepted_at: input.accepted_at,
    }),
  );
}

export async function buildJobSubmissionReceipt(
  input: JobSubmissionReceiptDraft,
): Promise<JobSubmissionReceipt> {
  const draft = jobSubmissionReceiptDraftSchema.parse(input);
  return deepFreeze(
    jobSubmissionReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeJobSubmissionReceiptHash(draft),
    }),
  );
}

export async function verifyJobSubmissionReceipt(input: unknown): Promise<JobSubmissionReceipt> {
  const parsed = jobSubmissionReceiptSchema.parse(input);
  if ((await computeJobSubmissionReceiptHash(parsed)) !== parsed.receipt_hash) {
    throw new TypeError("JOB_SUBMISSION_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const jobRecordSchema = z.strictObject({
  schema_version: z.literal("job-record@1.0.0"),
  scope: appScopeSchema,
  principal_id: immutableIdSchema,
  job_id: immutableIdSchema,
  kind: jobKindSchema,
  request_hash: contentHashSchema,
  status: jobStatusSchema,
  priority: z.number().int().min(0).max(100),
  max_attempts: z.number().int().min(1).max(10),
  attempt_count: nonNegativeSafeIntegerSchema,
  worker_fence: nonNegativeSafeIntegerSchema,
  cancel_policy: jobCancelPolicySchema,
  output_receipt: jobOutputReceiptSchema.nullable(),
  terminal_error_code: jobErrorCodeSchema.nullable(),
  created_at: jobTimestampSchema,
  updated_at: jobTimestampSchema,
});

export const jobHandlerBindingSchema = z.strictObject({
  kind: jobKindSchema,
  handler_revision: versionIdentifierSchema,
});

const workerHeartbeatDraftSchema = z
  .strictObject({
    schema_version: z.literal("job-worker-heartbeat@1.0.0"),
    heartbeat_id: immutableIdSchema,
    scope: appScopeSchema,
    worker_id: jobRuntimeIdentifierSchema,
    handlers: z.array(jobHandlerBindingSchema).min(1).max(JOB_KINDS.length),
    capacity: z.number().int().min(1).max(64),
    observed_at: jobTimestampSchema,
    expires_at: jobTimestampSchema,
  })
  .superRefine((heartbeat, context) => {
    const kinds = heartbeat.handlers.map(({ kind }) => kind);
    if (new Set(kinds).size !== kinds.length) {
      context.addIssue({ code: "custom", message: "Handler Kind 不得重复。", path: ["handlers"] });
    }
    const sorted = [...kinds].sort();
    if (kinds.some((kind, index) => kind !== sorted[index])) {
      context.addIssue({
        code: "custom",
        message: "Handler 必须按 Kind 排序。",
        path: ["handlers"],
      });
    }
    if (Date.parse(heartbeat.expires_at) <= Date.parse(heartbeat.observed_at)) {
      context.addIssue({
        code: "custom",
        message: "Heartbeat expiry 必须晚于观察时间。",
        path: ["expires_at"],
      });
    }
  });

function workerHeartbeatDraft(input: JobWorkerHeartbeat | JobWorkerHeartbeatDraft) {
  return {
    schema_version: input.schema_version,
    heartbeat_id: input.heartbeat_id,
    scope: input.scope,
    worker_id: input.worker_id,
    handlers: input.handlers,
    capacity: input.capacity,
    observed_at: input.observed_at,
    expires_at: input.expires_at,
  };
}

export const jobWorkerHeartbeatSchema = z
  .strictObject({
    ...workerHeartbeatDraftSchema.shape,
    heartbeat_hash: contentHashSchema,
  })
  .superRefine((heartbeat, context) => {
    const closure = workerHeartbeatDraftSchema.safeParse(workerHeartbeatDraft(heartbeat));
    if (!closure.success) {
      for (const issue of closure.error.issues) {
        context.addIssue({ code: "custom", message: issue.message, path: issue.path });
      }
    }
  });

export async function computeJobWorkerHeartbeatHash(
  input: JobWorkerHeartbeat | JobWorkerHeartbeatDraft,
) {
  return sha256ContentHash(workerHeartbeatDraftSchema.parse(workerHeartbeatDraft(input)));
}

export async function buildJobWorkerHeartbeat(
  input: JobWorkerHeartbeatDraft,
): Promise<JobWorkerHeartbeat> {
  const draft = workerHeartbeatDraftSchema.parse(input);
  return deepFreeze(
    jobWorkerHeartbeatSchema.parse({
      ...draft,
      heartbeat_hash: await computeJobWorkerHeartbeatHash(draft),
    }),
  );
}

export async function verifyJobWorkerHeartbeat(input: unknown): Promise<JobWorkerHeartbeat> {
  const parsed = jobWorkerHeartbeatSchema.parse(input);
  if ((await computeJobWorkerHeartbeatHash(parsed)) !== parsed.heartbeat_hash) {
    throw new TypeError("JOB_WORKER_HEARTBEAT_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const capabilityReadinessStatusSchema = z.enum(["READY", "NOT_READY", "DEGRADED"]);
export const capabilityReadinessReasonSchema = z.enum([
  "CAPABILITY_READY",
  "HANDLER_NOT_REGISTERED",
  "HANDLER_REVISION_MISMATCH",
  "WORKER_HEARTBEAT_STALE",
  "DEPENDENCY_UNAVAILABLE",
  "OUTPUT_RECEIPT_REQUIRED",
]);

const capabilityReadinessDraftSchema = z
  .strictObject({
    schema_version: z.literal("capability-readiness-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    capability: jobKindSchema,
    status: capabilityReadinessStatusSchema,
    reason_code: capabilityReadinessReasonSchema,
    handler_revision: versionIdentifierSchema.nullable(),
    handler_registered: z.boolean(),
    worker_heartbeat_fresh: z.boolean(),
    dependencies_ready: z.boolean(),
    output_receipt_required: z.boolean(),
    output_receipt_available: z.boolean(),
    evaluated_at: jobTimestampSchema,
    valid_until: jobTimestampSchema,
  })
  .superRefine((receipt, context) => {
    const allReady =
      receipt.handler_registered &&
      receipt.handler_revision !== null &&
      receipt.worker_heartbeat_fresh &&
      receipt.dependencies_ready &&
      (!receipt.output_receipt_required || receipt.output_receipt_available);
    if (receipt.status === "READY") {
      if (!allReady || receipt.reason_code !== "CAPABILITY_READY") {
        context.addIssue({
          code: "custom",
          message: "CAPABILITY_READINESS_CLOSURE_INVALID",
          path: ["status"],
        });
      }
    } else if (receipt.reason_code === "CAPABILITY_READY" || allReady) {
      context.addIssue({
        code: "custom",
        message: "CAPABILITY_READINESS_CLOSURE_INVALID",
        path: ["reason_code"],
      });
    }
    if (Date.parse(receipt.valid_until) <= Date.parse(receipt.evaluated_at)) {
      context.addIssue({
        code: "custom",
        message: "Capability Readiness TTL 无效。",
        path: ["valid_until"],
      });
    }
  });

function readinessDraft(input: CapabilityReadinessReceipt | CapabilityReadinessReceiptDraft) {
  return {
    schema_version: input.schema_version,
    receipt_id: input.receipt_id,
    scope: input.scope,
    capability: input.capability,
    status: input.status,
    reason_code: input.reason_code,
    handler_revision: input.handler_revision,
    handler_registered: input.handler_registered,
    worker_heartbeat_fresh: input.worker_heartbeat_fresh,
    dependencies_ready: input.dependencies_ready,
    output_receipt_required: input.output_receipt_required,
    output_receipt_available: input.output_receipt_available,
    evaluated_at: input.evaluated_at,
    valid_until: input.valid_until,
  };
}

export const capabilityReadinessReceiptSchema = z
  .strictObject({
    ...capabilityReadinessDraftSchema.shape,
    receipt_hash: contentHashSchema,
  })
  .superRefine((receipt, context) => {
    const closure = capabilityReadinessDraftSchema.safeParse(readinessDraft(receipt));
    if (!closure.success) {
      for (const issue of closure.error.issues) {
        context.addIssue({ code: "custom", message: issue.message, path: issue.path });
      }
    }
  });

export async function computeCapabilityReadinessReceiptHash(
  input: CapabilityReadinessReceipt | CapabilityReadinessReceiptDraft,
) {
  return sha256ContentHash(capabilityReadinessDraftSchema.parse(readinessDraft(input)));
}

export async function buildCapabilityReadinessReceipt(
  input: CapabilityReadinessReceiptDraft,
): Promise<CapabilityReadinessReceipt> {
  const draft = capabilityReadinessDraftSchema.parse(input);
  return deepFreeze(
    capabilityReadinessReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeCapabilityReadinessReceiptHash(draft),
    }),
  );
}

export async function verifyCapabilityReadinessReceipt(
  input: unknown,
): Promise<CapabilityReadinessReceipt> {
  const parsed = capabilityReadinessReceiptSchema.parse(input);
  if ((await computeCapabilityReadinessReceiptHash(parsed)) !== parsed.receipt_hash) {
    throw new TypeError("CAPABILITY_READINESS_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ["LEASED", "CANCEL_REQUESTED", "CANCELLED"],
  LEASED: ["RUNNING", "RETRY_WAIT", "CANCEL_REQUESTED", "FAILED", "DEAD_LETTER"],
  RUNNING: ["SUCCEEDED", "FAILED", "RETRY_WAIT", "CANCEL_REQUESTED", "DEAD_LETTER"],
  CANCEL_REQUESTED: ["CANCELLED", "FAILED", "DEAD_LETTER"],
  RETRY_WAIT: ["LEASED", "CANCEL_REQUESTED", "CANCELLED", "DEAD_LETTER"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  DEAD_LETTER: [],
};

export function assertJobStatusTransition(from: JobStatus, to: JobStatus): void {
  const parsedFrom = jobStatusSchema.parse(from);
  const parsedTo = jobStatusSchema.parse(to);
  if (!JOB_TRANSITIONS[parsedFrom].includes(parsedTo)) {
    throw new TypeError("JOB_STATUS_TRANSITION_INVALID");
  }
}

export interface JobQueuePort {
  enqueue(command: JobSubmissionCommand): Promise<PortResult<JobSubmissionReceipt>>;
  claim(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
    readonly handlers: readonly JobHandlerBinding[];
  }): Promise<PortResult<JobWorkLease | null>>;
  start(input: { readonly lease: JobWorkLease }): Promise<PortResult<{ readonly started: true }>>;
  heartbeat(input: {
    readonly lease: JobWorkLease;
  }): Promise<PortResult<{ readonly expires_at: string; readonly cancel_requested: boolean }>>;
  succeed(input: {
    readonly lease: JobWorkLease;
    readonly output_refs: readonly ArtifactReference[];
  }): Promise<PortResult<JobOutputReceipt>>;
  fail(input: {
    readonly lease: JobWorkLease;
    readonly error_code: string;
    readonly retryable: boolean;
    readonly retry_delay_ms: number | null;
  }): Promise<PortResult<JobOutputReceipt | null>>;
  acknowledgeCancel(input: {
    readonly lease: JobWorkLease;
    readonly error_code: string;
  }): Promise<PortResult<JobOutputReceipt>>;
  requestCancel(input: {
    readonly scope: AppScope;
    readonly job_id: string;
    readonly idempotency_key: string;
  }): Promise<PortResult<JobRecord>>;
  get(input: {
    readonly scope: AppScope;
    readonly job_id: string;
  }): Promise<PortResult<JobRecord | null>>;
  list(input: {
    readonly scope: AppScope;
    readonly after_job_id?: string;
    readonly limit?: number;
  }): Promise<PortResult<readonly JobRecord[]>>;
  publishHeartbeat(input: JobWorkerHeartbeat): Promise<PortResult<JobWorkerHeartbeat>>;
  listReadiness(input: {
    readonly scope: AppScope;
  }): Promise<PortResult<readonly CapabilityReadinessReceipt[]>>;
}

export type JobKind = z.infer<typeof jobKindSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobInput = z.infer<typeof jobInputSchema>;
export type JobSubmissionCommandDraft = z.infer<typeof jobSubmissionDraftSchema>;
export type JobSubmissionCommand = z.infer<typeof jobSubmissionCommandSchema>;
export type JobSubmissionReceiptDraft = z.infer<typeof jobSubmissionReceiptDraftSchema>;
export type JobSubmissionReceipt = z.infer<typeof jobSubmissionReceiptSchema>;
export type JobWorkLeaseDraft = z.infer<typeof jobWorkLeaseDraftSchema>;
export type JobWorkLease = z.infer<typeof jobWorkLeaseSchema>;
export type JobOutputReceiptDraft = z.infer<typeof jobOutputReceiptDraftSchema>;
export type JobOutputReceipt = z.infer<typeof jobOutputReceiptSchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
export type JobHandlerBinding = z.infer<typeof jobHandlerBindingSchema>;
export type JobWorkerHeartbeatDraft = z.infer<typeof workerHeartbeatDraftSchema>;
export type JobWorkerHeartbeat = z.infer<typeof jobWorkerHeartbeatSchema>;
export type CapabilityReadinessReceiptDraft = z.infer<typeof capabilityReadinessDraftSchema>;
export type CapabilityReadinessReceipt = z.infer<typeof capabilityReadinessReceiptSchema>;
