import {
  type ContextReceiptBinding,
  canonicalImmutableIdSchema,
  contextReceiptBindingSchema,
  type EffectiveConfigRunCommandEnvelope,
  type EffectiveRunConfigReceiptCandidate,
  type EffectiveRunConfigReference,
  effectiveConfigConversationReferenceSchema,
  effectiveConfigRunCommandEnvelopeSchema,
  effectiveConfigRunLeasePayloadSchema,
  effectiveRunConfigReceiptCandidateSchema,
  effectiveRunConfigReferenceSchema,
  environmentSchema,
  type PortResult,
  type RunConfigRequest,
  type RunConfigResolutionReceiptCandidate,
  type RunWorkLease,
  runConfigResolutionReceiptCandidateSchema,
  runWorkLeaseSchema,
  verifyAgentDispatchAdmissionResult,
  verifyContextReceiptBindingCandidate,
  verifyEffectiveRunConfigReceiptCandidate,
  verifyRunConfigRequestCandidate,
  verifyRunConfigResolutionReceiptCandidate,
  verifyWorkspaceDefaultsCasUpdateCommand,
  verifyWorkspaceDefaultsRevision,
  type WorkspaceDefaultsCasUpdateCommand,
  type WorkspaceDefaultsReadResult,
  type WorkspaceDefaultsSelectionCandidate,
  type WorkspaceDefaultsUpdateResult,
  type WorkspaceDefaultsValue,
  workspaceDefaultsReadResultSchema,
  workspaceDefaultsUpdateResultSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonValueRow {
  readonly value: unknown;
}

const effectiveConfigLookupSchema = z.strictObject({
  run_id: canonicalImmutableIdSchema,
  config_ref: effectiveRunConfigReferenceSchema,
  conversation_ref: effectiveConfigConversationReferenceSchema,
});
const effectiveConfigRunWorkLeaseSchema = runWorkLeaseSchema
  .safeExtend({
    scope: z.strictObject({
      app_id: canonicalImmutableIdSchema,
      tenant_id: canonicalImmutableIdSchema,
      environment: environmentSchema,
    }),
    principal_id: canonicalImmutableIdSchema,
    outbox_id: canonicalImmutableIdSchema,
    run_id: canonicalImmutableIdSchema,
    command_id: canonicalImmutableIdSchema,
    command_kind: z.enum(["START_DATA_AGENT_TEAM", "START_L2_RESEARCH"]),
    attempt_id: canonicalImmutableIdSchema,
    payload: effectiveConfigRunLeasePayloadSchema,
  })
  .superRefine((lease, ctx) => {
    if (lease.command_kind !== lease.payload.kind) {
      ctx.addIssue({
        code: "custom",
        message: "Worker lease command kind must match its Effective Config payload.",
        path: ["payload", "kind"],
      });
    }
  });
const workerRevalidationInputSchema = z.strictObject({
  context_receipt_id: canonicalImmutableIdSchema,
  lease: effectiveConfigRunWorkLeaseSchema,
});
const workerConsumptionResultSchema = z.strictObject({
  schema_version: z.literal("effective-config-worker-consumption@1.0.0"),
  replayed: z.boolean(),
  context_receipt: contextReceiptBindingSchema,
  effective_config: effectiveRunConfigReceiptCandidateSchema,
});
const questionAcceptanceResultSchema = z.strictObject({
  resolution: z.unknown(),
  effective_config: z.unknown().nullable(),
});

export type EffectiveConfigLookup = z.infer<typeof effectiveConfigLookupSchema>;
export type EffectiveConfigWorkerAuthorityInput = Readonly<
  z.infer<typeof workerRevalidationInputSchema> & {
    /** Human capability establishes the principal-scoped transaction; it is not Worker authority. */
    principal_capability: unknown;
  }
>;
export type EffectiveConfigWorkerConsumption = Readonly<{
  schema_version: "effective-config-worker-consumption@1.0.0";
  replayed: boolean;
  context_receipt: ContextReceiptBinding;
  effective_config: EffectiveRunConfigReceiptCandidate;
}>;
export type EffectiveConfigResolutionInput =
  | Readonly<{
      request: Extract<RunConfigRequest, { operation: "QUESTION_RUN" }>;
      command: EffectiveConfigRunCommandEnvelope;
    }>
  | Readonly<{
      request: Extract<RunConfigRequest, { operation: "SEMANTIC_BOOTSTRAP_JOB" }>;
      command?: never;
    }>;

export interface PostgresEffectiveConfigResolver {
  resolveAndAccept(
    capability: unknown,
    input: EffectiveConfigResolutionInput,
  ): Promise<PortResult<RunConfigResolutionReceiptCandidate>>;
  getEffectiveConfig(
    capability: unknown,
    input: EffectiveConfigLookup,
  ): Promise<PortResult<EffectiveRunConfigReceiptCandidate>>;
  /**
   * @internal Worker-only adapter. PostgreSQL must prove the exact ACTIVE RunWorkLease/fence;
   * the principal capability alone can never authorize consumption.
   */
  revalidateForWorker(
    workerAuthority: EffectiveConfigWorkerAuthorityInput,
  ): Promise<PortResult<EffectiveConfigWorkerConsumption>>;
  getWorkspaceDefaults(
    capability: unknown,
  ): Promise<PortResult<WorkspaceDefaultsReadResult | null>>;
  updateWorkspaceDefaults(
    capability: unknown,
    command: WorkspaceDefaultsCasUpdateCommand,
  ): Promise<PortResult<WorkspaceDefaultsUpdateResult>>;
}

export interface PostgresEffectiveConfigResolverOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

const databaseMarkers = new Map<string, { readonly retryable: boolean; readonly message: string }>([
  [
    "DA_BACKEND_ROLE_REQUIRED",
    { retryable: false, message: "当前数据库角色不能调用 Effective Config Authority。" },
  ],
  [
    "EFFECTIVE_CONFIG_REQUEST_INVALID",
    { retryable: false, message: "Effective Config 请求不符合权威解析契约。" },
  ],
  [
    "EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH",
    { retryable: false, message: "Effective Config 请求跨越了当前 Workspace。" },
  ],
  [
    "EFFECTIVE_CONFIG_RESOLUTION_INVALID",
    { retryable: false, message: "Effective Config Resolution 不符合权威合同。" },
  ],
  [
    "EFFECTIVE_CONFIG_RESOURCE_DUPLICATE",
    { retryable: false, message: "Effective Config 资源被多个选择渠道重复绑定。" },
  ],
  [
    "EFFECTIVE_CONFIG_OVERRIDE_INVALID",
    { retryable: false, message: "Effective Config Override 不符合收窄策略。" },
  ],
  [
    "EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID",
    { retryable: false, message: "Effective Config 资源版本无效。" },
  ],
  [
    "EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT",
    { retryable: false, message: "Effective Config 资源引用发生冲突。" },
  ],
  [
    "EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT",
    { retryable: false, message: "幂等键已绑定到不同的 Effective Config 请求。" },
  ],
  [
    "EFFECTIVE_CONFIG_REFERENCE_INVALID",
    { retryable: false, message: "Effective Config Reference 无效。" },
  ],
  [
    "EFFECTIVE_CONFIG_RECEIPT_NOT_FOUND_OR_FORBIDDEN",
    { retryable: false, message: "Effective Config Receipt 不存在或当前主体无权访问。" },
  ],
  [
    "EFFECTIVE_CONFIG_RECEIPT_TAMPERED",
    { retryable: false, message: "Effective Config Receipt 完整性校验失败。" },
  ],
  [
    "EFFECTIVE_CONFIG_RECEIPT_REVOKED",
    { retryable: false, message: "Effective Config Receipt 已失效或撤权。" },
  ],
  [
    "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
    { retryable: false, message: "Worker Effective Config 消费请求无效。" },
  ],
  [
    "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_CONFLICT",
    { retryable: false, message: "Worker Effective Config 消费幂等冲突。" },
  ],
  [
    "EFFECTIVE_CONFIG_WORKER_FENCE_STALE",
    { retryable: true, message: "Worker Fence 已过期，必须重新取得 Lease。" },
  ],
  [
    "EFFECTIVE_CONFIG_WORKER_LEASE_STALE",
    { retryable: true, message: "Worker Lease 已失效，必须重新取得 Lease。" },
  ],
  [
    "CONVERSATION_NOT_FOUND_OR_DENIED",
    { retryable: false, message: "Conversation 不存在或当前主体无权访问。" },
  ],
  [
    "CONVERSATION_RESOURCE_VERSION_CONFLICT",
    { retryable: true, message: "Conversation 已更新，请使用最新 resource version 重试。" },
  ],
  [
    "CONVERSATION_RESOURCE_MISMATCH",
    { retryable: false, message: "Conversation 与本次 Run 的资源选择不一致。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_INPUT_INVALID",
    { retryable: false, message: "Workspace Defaults CAS 请求不符合严格合同。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_SCOPE_MISMATCH",
    { retryable: false, message: "Workspace Defaults CAS 请求跨越了当前 Workspace。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_ADMIN_REQUIRED",
    { retryable: false, message: "只有 Workspace Owner 可以更新 Defaults。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_IDEMPOTENCY_CONFLICT",
    { retryable: false, message: "幂等键已绑定到不同的 Workspace Defaults 请求。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT",
    { retryable: true, message: "Workspace Defaults 已更新，请使用最新 revision 重试。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE",
    { retryable: false, message: "Workspace Defaults 选择的资源不存在或不可用。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH",
    { retryable: true, message: "Workspace Defaults 资源版本已变化，请刷新后重试。" },
  ],
  [
    "WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH",
    { retryable: false, message: "Workspace Defaults 资源绑定不符合权威合同。" },
  ],
]);

function mapDatabaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  for (const [marker, details] of databaseMarkers) {
    if (message.includes(marker)) {
      return failure(marker, details.message, details.retryable);
    }
  }
  return null;
}

function invalidRequest(error: unknown): PortResult<never> {
  const message = error instanceof Error ? error.message : "";
  return message.includes("RUN_CONFIG_REQUEST_HASH_MISMATCH")
    ? failure("EFFECTIVE_CONFIG_REQUEST_HASH_MISMATCH", "Run Config Request 的内容哈希不匹配。")
    : failure("EFFECTIVE_CONFIG_REQUEST_INVALID", "Run Config Request 不符合严格合同。");
}

function exactValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config RPC 必须返回恰好一行。",
      false,
    );
  }
  return rows[0]?.value;
}

function sameReference(
  left: EffectiveRunConfigReference,
  right: EffectiveRunConfigReference,
): boolean {
  return (
    left.config_id === right.config_id &&
    left.config_revision === right.config_revision &&
    left.config_hash === right.config_hash
  );
}

function sameVersionedResource(
  left: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
  right: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
): boolean {
  return (
    left.resource_id === right.resource_id &&
    left.resource_revision === right.resource_revision &&
    left.resource_hash === right.resource_hash
  );
}

function canonicalAvailableResourceReferences(
  receipt: EffectiveRunConfigReceiptCandidate,
): ReadonlyArray<{ resource_id: string; resource_revision: number; resource_hash: string }> {
  const sorted = receipt.resource_bindings
    .flatMap((binding) =>
      binding.availability === "AVAILABLE" && binding.effective_resource
        ? [binding.effective_resource]
        : [],
    )
    .toSorted((left, right) => {
      if (left.resource_id !== right.resource_id) {
        return left.resource_id < right.resource_id ? -1 : 1;
      }
      if (left.resource_revision !== right.resource_revision) {
        return left.resource_revision - right.resource_revision;
      }
      return left.resource_hash < right.resource_hash
        ? -1
        : left.resource_hash > right.resource_hash
          ? 1
          : 0;
    });
  return sorted.filter((resource, index) => {
    const previous = sorted[index - 1];
    if (!previous || previous.resource_id !== resource.resource_id) return true;
    if (sameVersionedResource(previous, resource)) return false;
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config 包含同 ID 的冲突 Resource Revision。",
      false,
    );
  });
}

function assertScope(
  value: EffectiveRunConfigReceiptCandidate["scope"],
  capability: Readonly<{
    scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>;
    principal: string;
  }>,
): void {
  if (
    value.app_id !== capability.scope.app_id ||
    value.tenant_id !== capability.scope.tenant_id ||
    value.workspace_id !== capability.scope.tenant_id ||
    value.environment !== capability.scope.environment ||
    value.principal_id !== capability.principal
  ) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config RPC 返回了跨 Scope Receipt。",
      false,
    );
  }
}

function assertWorkspaceScope(
  value: Readonly<{
    app_id: string;
    tenant_id: string;
    environment: string;
    workspace_id: string;
  }>,
  capability: Readonly<{
    scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>;
  }>,
): void {
  if (
    value.app_id !== capability.scope.app_id ||
    value.tenant_id !== capability.scope.tenant_id ||
    value.workspace_id !== capability.scope.tenant_id ||
    value.environment !== capability.scope.environment
  ) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Workspace Defaults RPC 返回了跨 Scope Revision。",
      false,
    );
  }
}

function assertDefaultsSelectionCorrelation(
  selection: WorkspaceDefaultsSelectionCandidate,
  resolved: WorkspaceDefaultsValue,
): void {
  const sameSelection = (
    requested: Readonly<{ resource_id: string; expected_revision: number }> | null,
    effective: Readonly<{ resource_id: string; resource_revision: number }> | null | undefined,
  ) =>
    requested === null
      ? effective === null
      : effective != null &&
        requested.resource_id === effective.resource_id &&
        requested.expected_revision === effective.resource_revision;
  for (const field of [
    "model",
    "datasource",
    "semantic_release",
    "schema_snapshot",
    "context_policy",
    "egress_policy",
    "execution_safety_policy",
  ] as const) {
    if (!sameSelection(selection[field], resolved[field])) {
      throw new PersistenceBoundaryError(
        "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
        "Workspace Defaults Revision 与 client selection intent 不一致。",
        false,
      );
    }
  }
  for (const field of ["files", "knowledge", "mcp_servers", "skills"] as const) {
    if (
      selection[field].length !== resolved[field].length ||
      selection[field].some((requested, index) => !sameSelection(requested, resolved[field][index]))
    ) {
      throw new PersistenceBoundaryError(
        "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
        "Workspace Defaults Revision 与 client collection selection intent 不一致。",
        false,
      );
    }
  }
}

function assertLeaseAuthority(
  lease: RunWorkLease,
  capability: Readonly<{
    scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>;
    principal: string;
  }>,
): void {
  if (
    lease.scope.app_id !== capability.scope.app_id ||
    lease.scope.tenant_id !== capability.scope.tenant_id ||
    lease.scope.environment !== capability.scope.environment ||
    lease.principal_id !== capability.principal ||
    lease.command_kind !== lease.payload.kind
  ) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
      "Run Work Lease 与当前 Authority 或 Effective Config operation 不一致。",
      false,
    );
  }
}

type ControlledOptionalResource = Readonly<{
  resource_kind: "FILE" | "KNOWLEDGE" | "MCP_SERVER" | "SKILL";
  mention_id: string | null;
  resource_id: string;
  resource_revision: number;
  source: "OVERRIDE" | "MENTION";
}>;

function controlledOptionalResources(request: RunConfigRequest): ControlledOptionalResource[] {
  const controlled: ControlledOptionalResource[] = [];
  for (const [field, resourceKind] of [
    ["files", "FILE"],
    ["knowledge", "KNOWLEDGE"],
    ["mcp_servers", "MCP_SERVER"],
    ["skills", "SKILL"],
  ] as const) {
    const selection = request.overrides[field];
    if (selection.mode === "RESOURCE_IDS") {
      controlled.push(
        ...selection.resources.map((resource) => ({
          resource_kind: resourceKind,
          mention_id: null,
          resource_id: resource.resource_id,
          resource_revision: resource.expected_revision,
          source: "OVERRIDE" as const,
        })),
      );
    }
  }
  controlled.push(
    ...request.mentions.map((mention) => ({
      resource_kind: mention.resource_kind,
      mention_id: mention.mention_id,
      resource_id: mention.resource_id,
      resource_revision: mention.expected_revision,
      source: "MENTION" as const,
    })),
  );
  return controlled;
}

function assertControlledOptionalBindings(
  resolution: RunConfigResolutionReceiptCandidate,
  request: RunConfigRequest,
): void {
  const optionalBindings = resolution.resource_bindings.filter(
    (binding) =>
      binding.resource_kind === "FILE" ||
      binding.resource_kind === "KNOWLEDGE" ||
      binding.resource_kind === "MCP_SERVER" ||
      binding.resource_kind === "SKILL",
  );
  let exact = true;
  for (const [field, resourceKind] of [
    ["files", "FILE"],
    ["knowledge", "KNOWLEDGE"],
    ["mcp_servers", "MCP_SERVER"],
    ["skills", "SKILL"],
  ] as const) {
    const selection = request.overrides[field];
    const evaluation = resolution.optional_selection_evaluations.find(
      (candidate) => candidate.resource_kind === resourceKind,
    );
    const nonMentionBindings = optionalBindings.filter(
      (binding) => binding.resource_kind === resourceKind && binding.source !== "MENTION",
    );
    exact &&=
      evaluation !== undefined &&
      evaluation.selection_mode === selection.mode &&
      evaluation.binding_count === nonMentionBindings.length;
    if (selection.mode === "EXPLICIT_NONE") {
      exact &&= nonMentionBindings.length === 0 && evaluation?.defaults_ref === null;
    } else if (selection.mode === "INHERIT_DEFAULT") {
      exact &&=
        nonMentionBindings.every((binding) => binding.source === "DEFAULT") &&
        evaluation?.defaults_ref?.defaults_id === request.defaults_ref.defaults_id &&
        evaluation.defaults_ref.defaults_revision === request.defaults_ref.defaults_revision &&
        evaluation.defaults_ref.defaults_hash === request.defaults_ref.defaults_hash;
    } else {
      exact &&=
        evaluation?.defaults_ref === null &&
        nonMentionBindings.length === selection.resources.length &&
        selection.resources.every((requested) =>
          nonMentionBindings.some(
            (binding) =>
              binding.source === "OVERRIDE" &&
              binding.mention_id === null &&
              binding.requested_resource_id === requested.resource_id &&
              binding.requested_revision === requested.expected_revision &&
              (binding.availability === "UNAVAILABLE" ||
                (binding.effective_resource?.resource_id === requested.resource_id &&
                  binding.effective_resource.resource_revision === requested.expected_revision)),
          ),
        );
    }
  }
  const mentionBindings = optionalBindings.filter((binding) => binding.source === "MENTION");
  exact &&=
    mentionBindings.length === request.mentions.length &&
    request.mentions.every((mention) =>
      mentionBindings.some(
        (binding) =>
          binding.resource_kind === mention.resource_kind &&
          binding.mention_id === mention.mention_id &&
          binding.requested_resource_id === mention.resource_id &&
          binding.requested_revision === mention.expected_revision &&
          (binding.availability === "UNAVAILABLE" ||
            (binding.effective_resource?.resource_id === mention.resource_id &&
              binding.effective_resource.resource_revision === mention.expected_revision)),
      ),
    );
  if (!exact) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Optional resource bindings 与显式 Override/Mention 请求不一致。",
      false,
    );
  }
}

function assertMandatorySingletonSelection(
  resolution: RunConfigResolutionReceiptCandidate,
  selection: RunConfigRequest["overrides"]["model"],
  resourceKind: "MODEL_PROFILE" | "DATASOURCE",
): void {
  const bindings = resolution.resource_bindings.filter(
    (binding) => binding.resource_kind === resourceKind,
  );
  const binding = bindings[0];
  let exact = bindings.length <= 1;
  if (selection.mode === "RESOURCE_IDS") {
    const requested = selection.resources[0];
    exact =
      bindings.length === 1 &&
      requested !== undefined &&
      binding?.source === "OVERRIDE" &&
      binding.mention_id === null &&
      binding.requested_resource_id === requested.resource_id &&
      binding.requested_revision === requested.expected_revision;
  } else if (selection.mode === "EXPLICIT_NONE") {
    exact =
      bindings.length === 1 &&
      binding?.source === "OVERRIDE" &&
      binding.mention_id === null &&
      binding.requested_resource_id === null &&
      binding.requested_revision === null &&
      binding.availability === "UNAVAILABLE" &&
      binding.unavailable_reason === "EXPLICITLY_CLEARED";
  } else {
    exact =
      exact &&
      (!binding || binding.source === "DEFAULT") &&
      (resolution.admission === "BLOCKED" || binding !== undefined);
  }
  if (!exact) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      `${resourceKind} binding 与 singleton selection 不一致。`,
      false,
    );
  }
}

function assertResolutionCorrelation(
  resolution: RunConfigResolutionReceiptCandidate,
  request: RunConfigRequest,
  capability: Readonly<{
    scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>;
    principal: string;
  }>,
): void {
  assertScope(resolution.scope, capability);
  const identityMatches =
    resolution.operation === "QUESTION_RUN" && request.operation === "QUESTION_RUN"
      ? resolution.run_id === request.run_id &&
        resolution.conversation_ref.conversation_id === request.conversation_ref.conversation_id &&
        resolution.conversation_ref.expected_resource_version ===
          request.conversation_ref.expected_resource_version
      : resolution.operation === "SEMANTIC_BOOTSTRAP_JOB" &&
        request.operation === "SEMANTIC_BOOTSTRAP_JOB" &&
        resolution.job_id === request.job_id &&
        resolution.trigger_question_run_id === request.trigger_question_run_id;
  if (
    !identityMatches ||
    request.workspace_id !== capability.scope.tenant_id ||
    resolution.request_hash !== request.request_hash ||
    resolution.defaults_ref.defaults_id !== request.defaults_ref.defaults_id ||
    resolution.defaults_ref.defaults_revision !== request.defaults_ref.defaults_revision ||
    resolution.defaults_ref.defaults_hash !== request.defaults_ref.defaults_hash
  ) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config Resolution 与请求不一致。",
      false,
    );
  }
  if (resolution.operation === "QUESTION_RUN" && request.operation === "QUESTION_RUN") {
    assertMandatorySingletonSelection(resolution, request.overrides.model, "MODEL_PROFILE");
    assertMandatorySingletonSelection(resolution, request.overrides.datasource, "DATASOURCE");
    assertControlledOptionalBindings(resolution, request);
  }
  if (
    resolution.operation === "SEMANTIC_BOOTSTRAP_JOB" &&
    request.operation === "SEMANTIC_BOOTSTRAP_JOB"
  ) {
    assertMandatorySingletonSelection(resolution, request.overrides.datasource, "DATASOURCE");
    assertControlledOptionalBindings(resolution, request);
  }
  if (
    resolution.operation === "SEMANTIC_BOOTSTRAP_JOB" &&
    resolution.admission === "READY" &&
    request.operation === "SEMANTIC_BOOTSTRAP_JOB"
  ) {
    const controlledRequests = controlledOptionalResources(request).filter(
      (resource) => resource.resource_kind === "FILE" || resource.resource_kind === "KNOWLEDGE",
    );
    const controlledBindings = resolution.bootstrap_job_config.resource_bindings.filter(
      (binding) =>
        (binding.resource_kind === "FILE" || binding.resource_kind === "KNOWLEDGE") &&
        (binding.source === "OVERRIDE" || binding.source === "MENTION"),
    );
    const exactControlledSources =
      controlledBindings.length === controlledRequests.length &&
      resolution.bootstrap_job_config.source_resources.length === controlledRequests.length &&
      controlledRequests.every((expected) => {
        const binding = controlledBindings.find(
          (candidate) =>
            candidate.resource_kind === expected.resource_kind &&
            candidate.source === expected.source &&
            candidate.mention_id === expected.mention_id &&
            candidate.requested_resource_id === expected.resource_id &&
            candidate.requested_revision === expected.resource_revision &&
            candidate.availability === "AVAILABLE" &&
            candidate.effective_resource?.resource_id === expected.resource_id &&
            candidate.effective_resource.resource_revision === expected.resource_revision,
        );
        if (!binding?.effective_resource) return false;
        return resolution.bootstrap_job_config.source_resources.some(
          (source) =>
            source.resource_kind === expected.resource_kind &&
            source.mention_id === expected.mention_id &&
            source.resource_id === binding.effective_resource?.resource_id &&
            source.resource_revision === binding.effective_resource.resource_revision &&
            source.resource_hash === binding.effective_resource.resource_hash,
        );
      });
    if (!exactControlledSources) {
      throw new PersistenceBoundaryError(
        "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
        "Bootstrap source authority 与显式 Override/Mention 请求不一致。",
        false,
      );
    }
  }
}

function assertReceiptCorrelation(
  receipt: EffectiveRunConfigReceiptCandidate,
  lookup: Readonly<{
    run_id: string;
    config_ref: EffectiveRunConfigReference;
    conversation_ref?: EffectiveConfigLookup["conversation_ref"];
  }>,
  capability: Readonly<{
    scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>;
    principal: string;
  }>,
): void {
  assertScope(receipt.scope, capability);
  const receiptReference: EffectiveRunConfigReference = {
    config_id: receipt.config_id,
    config_revision: receipt.config_revision,
    config_hash: receipt.config_hash,
  };
  if (receipt.run_id !== lookup.run_id || !sameReference(receiptReference, lookup.config_ref)) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config Receipt 与 Run/Reference 不一致。",
      false,
    );
  }
  if (
    lookup.conversation_ref &&
    (receipt.conversation_binding.conversation_id !== lookup.conversation_ref.conversation_id ||
      receipt.conversation_binding.resource_version !==
        lookup.conversation_ref.expected_resource_version)
  ) {
    throw new PersistenceBoundaryError(
      "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
      "Effective Config Receipt 与 Conversation Authority 不一致。",
      false,
    );
  }
}

export function createPostgresEffectiveConfigResolver(
  options: PostgresEffectiveConfigResolverOptions,
): PostgresEffectiveConfigResolver {
  return {
    async resolveAndAccept(capabilityInput, input) {
      let request: RunConfigRequest;
      try {
        request = await verifyRunConfigRequestCandidate(input.request);
      } catch (error) {
        return invalidRequest(error);
      }
      const command =
        request.operation === "QUESTION_RUN"
          ? effectiveConfigRunCommandEnvelopeSchema.safeParse(input.command)
          : null;
      if (request.operation === "QUESTION_RUN" && !command?.success) {
        return failure("EFFECTIVE_CONFIG_REQUEST_INVALID", "Run command envelope 不符合严格合同。");
      }
      if (
        request.operation === "QUESTION_RUN" &&
        command?.success &&
        command.data.dispatch_admission
      ) {
        try {
          const dispatch = await verifyAgentDispatchAdmissionResult(
            command.data.dispatch_admission,
          );
          if (dispatch.kind !== "EXECUTE" || dispatch.plan.run_id !== request.run_id) {
            return failure(
              "AGENT_DISPATCH_RECEIPT_MISMATCH",
              "Agent Dispatch receipt 与 Run identity 不一致。",
            );
          }
          const shadow = command.data.shadow_dispatch_plan;
          if (
            (dispatch.binding.shadow_dispatch_plan_ref === null) !== (shadow == null) ||
            (shadow &&
              (shadow.plan_id !== dispatch.binding.shadow_dispatch_plan_ref?.plan_id ||
                shadow.plan_hash !== dispatch.binding.shadow_dispatch_plan_ref.plan_hash))
          ) {
            return failure(
              "AGENT_DISPATCH_RECEIPT_MISMATCH",
              "Shadow Dispatch Plan 与冻结 binding 不一致。",
            );
          }
        } catch {
          return failure(
            "AGENT_DISPATCH_RECEIPT_MISMATCH",
            "Agent Dispatch receipt 未通过内容寻址校验。",
          );
        }
      }
      if (request.operation === "SEMANTIC_BOOTSTRAP_JOB" && input.command !== undefined) {
        return failure(
          "EFFECTIVE_CONFIG_REQUEST_INVALID",
          "Semantic Bootstrap 不能携带 QUESTION Run command envelope。",
        );
      }
      if (
        request.operation === "QUESTION_RUN" &&
        command?.success &&
        (command.data.run_id !== request.run_id ||
          command.data.idempotency_key !== request.idempotency_key)
      ) {
        return failure(
          "EFFECTIVE_CONFIG_REQUEST_INVALID",
          "Run command envelope 与 Run Config Request 不一致。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: request.operation === "QUESTION_RUN" ? ["OWNER", "ANALYST"] : ["OWNER"],
          operation_name: "effective_config.resolve_and_accept",
          correlation_id: request.operation === "QUESTION_RUN" ? request.run_id : request.job_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          const result =
            request.operation === "QUESTION_RUN" && command?.success
              ? await client.query<JsonValueRow>(
                  `select app_data_agent.accept_question_run_with_effective_config(
                     $1::jsonb, $2::jsonb
                   ) as value`,
                  [command.data, request],
                )
              : await client.query<JsonValueRow>(
                  `select app_data_agent.resolve_semantic_bootstrap_job_config(
                     $1::jsonb
                   ) as value`,
                  [request],
                );
          try {
            const rawValue = exactValue(result.rows);
            const acceptance =
              request.operation === "QUESTION_RUN"
                ? questionAcceptanceResultSchema.parse(rawValue)
                : null;
            const resolution = await verifyRunConfigResolutionReceiptCandidate(
              acceptance?.resolution ?? rawValue,
            );
            assertResolutionCorrelation(resolution, request, capability);
            if (
              request.operation === "QUESTION_RUN" &&
              command?.success &&
              (resolution.resolution_id !== command.data.event_id ||
                (resolution.operation === "QUESTION_RUN" &&
                  resolution.admission === "READY" &&
                  resolution.effective_config_ref.config_id !== command.data.command_id))
            ) {
              throw new PersistenceBoundaryError(
                "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                "Effective Config Resolution 与原子 Run acceptance identity 不一致。",
                false,
              );
            }
            if (request.operation === "QUESTION_RUN" && resolution.operation === "QUESTION_RUN") {
              if (resolution.admission === "READY") {
                if (acceptance?.effective_config === null) {
                  throw new PersistenceBoundaryError(
                    "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                    "QUESTION READY acceptance 必须返回已持久化 Effective Config Receipt。",
                    false,
                  );
                }
                const effectiveConfig = await verifyEffectiveRunConfigReceiptCandidate(
                  acceptance?.effective_config,
                );
                assertReceiptCorrelation(
                  effectiveConfig,
                  {
                    run_id: request.run_id,
                    config_ref: resolution.effective_config_ref,
                    conversation_ref: request.conversation_ref,
                  },
                  capability,
                );
                if (
                  effectiveConfig.request_hash !== resolution.request_hash ||
                  JSON.stringify(effectiveConfig.defaults_ref) !==
                    JSON.stringify(resolution.defaults_ref) ||
                  JSON.stringify(effectiveConfig.authority_binding) !==
                    JSON.stringify(resolution.authority_binding) ||
                  JSON.stringify(effectiveConfig.optional_selection_evaluations) !==
                    JSON.stringify(resolution.optional_selection_evaluations)
                ) {
                  throw new PersistenceBoundaryError(
                    "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                    "QUESTION READY Resolution 与 Effective Config Authority 不一致。",
                    false,
                  );
                }
              } else if (acceptance?.effective_config !== null) {
                throw new PersistenceBoundaryError(
                  "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                  "非 READY QUESTION Resolution 不能返回 Effective Config Receipt。",
                  false,
                );
              }
            }
            return runConfigResolutionReceiptCandidateSchema.parse(resolution);
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
              "Effective Config RPC 返回了无效或哈希不匹配的 Resolution Receipt。",
              false,
            );
          }
        },
      );
    },

    async getEffectiveConfig(capabilityInput, input) {
      const parsed = effectiveConfigLookupSchema.safeParse(input);
      if (!parsed.success) {
        return failure("EFFECTIVE_CONFIG_REFERENCE_INVALID", "Effective Config Reference 无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "effective_config.load",
          correlation_id: parsed.data.run_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select app_data_agent.load_effective_run_config(
               $1::uuid, $2::bigint, $3::text, $4::uuid
             ) as value`,
            [
              parsed.data.config_ref.config_id,
              parsed.data.config_ref.config_revision,
              parsed.data.config_ref.config_hash,
              parsed.data.run_id,
            ],
          );
          try {
            const receipt = await verifyEffectiveRunConfigReceiptCandidate(exactValue(result.rows));
            assertReceiptCorrelation(receipt, parsed.data, capability);
            return receipt;
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
              "PostgreSQL 返回了无效或哈希不匹配的 Effective Config Receipt。",
              false,
            );
          }
        },
      );
    },

    async revalidateForWorker(workerAuthority) {
      const parsed = workerRevalidationInputSchema.safeParse({
        context_receipt_id: workerAuthority.context_receipt_id,
        lease: workerAuthority.lease,
      });
      if (!parsed.success) {
        return failure(
          "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
          "Worker Effective Config 消费请求无效。",
        );
      }
      const lease = parsed.data.lease;
      const configRef = lease.payload.effective_config_ref;
      const lookup = { run_id: lease.run_id, config_ref: configRef };
      return withAppTransaction(
        options.pool,
        options.authorizer,
        workerAuthority.principal_capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "effective_config.worker_revalidate",
          correlation_id: lease.run_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertLeaseAuthority(lease, capability);
          const result = await client.query<JsonValueRow>(
            `select app_data_agent.consume_worker_effective_run_config(
               $1::uuid, $2::uuid, $3::bigint, $4::text,
               $5::uuid, $6::text, $7::uuid, $8::text,
               $9::bigint, $10::bigint, $11::uuid, $12::uuid
             ) as value`,
            [
              parsed.data.context_receipt_id,
              configRef.config_id,
              configRef.config_revision,
              configRef.config_hash,
              lease.run_id,
              lease.worker_id,
              lease.attempt_id,
              lease.worker_id,
              lease.lease_token,
              lease.worker_fence,
              lease.outbox_id,
              lease.command_id,
            ],
          );
          try {
            const candidate = workerConsumptionResultSchema.parse(exactValue(result.rows));
            const effectiveConfig = await verifyEffectiveRunConfigReceiptCandidate(
              candidate.effective_config,
            );
            const contextReceipt = await verifyContextReceiptBindingCandidate(
              candidate.context_receipt,
            );
            assertReceiptCorrelation(effectiveConfig, lookup, capability);
            assertScope(contextReceipt.scope, capability);
            if (
              contextReceipt.consumer !== "WORKER_START" ||
              contextReceipt.consumer_id !== lease.worker_id ||
              contextReceipt.outbox_id !== lease.outbox_id ||
              contextReceipt.command_id !== lease.command_id ||
              contextReceipt.attempt_id !== lease.attempt_id ||
              contextReceipt.lease_token !== lease.lease_token ||
              contextReceipt.worker_fence !== lease.worker_fence ||
              contextReceipt.receipt_id !== parsed.data.context_receipt_id ||
              contextReceipt.run_id !== lease.run_id ||
              !sameReference(contextReceipt.config_ref, configRef) ||
              !sameVersionedResource(
                contextReceipt.semantic_release,
                effectiveConfig.semantic_release,
              ) ||
              contextReceipt.semantic_release.datasource_id !==
                effectiveConfig.semantic_release.datasource_id ||
              contextReceipt.semantic_release.semantic_generation !==
                effectiveConfig.semantic_release.semantic_generation ||
              contextReceipt.semantic_release.publication_status !==
                effectiveConfig.semantic_release.publication_status ||
              !sameVersionedResource(
                contextReceipt.schema_snapshot,
                effectiveConfig.schema_snapshot,
              ) ||
              contextReceipt.schema_snapshot.datasource_id !==
                effectiveConfig.schema_snapshot.datasource_id ||
              contextReceipt.schema_snapshot.semantic_release_id !==
                effectiveConfig.schema_snapshot.semantic_release_id ||
              contextReceipt.schema_snapshot.semantic_generation !==
                effectiveConfig.schema_snapshot.semantic_generation ||
              !sameVersionedResource(
                contextReceipt.context_policy,
                effectiveConfig.context_policy,
              ) ||
              contextReceipt.provider !== effectiveConfig.model.provider ||
              JSON.stringify(contextReceipt.audiences) !==
                JSON.stringify(effectiveConfig.effective_egress.allowed_audiences) ||
              contextReceipt.classification !== effectiveConfig.effective_egress.classification ||
              JSON.stringify(contextReceipt.resource_refs) !==
                JSON.stringify(canonicalAvailableResourceReferences(effectiveConfig))
            ) {
              throw new PersistenceBoundaryError(
                "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                "Worker Context Receipt 与请求不一致。",
                false,
              );
            }
            return {
              schema_version: candidate.schema_version,
              replayed: candidate.replayed,
              context_receipt: contextReceipt,
              effective_config: effectiveConfig,
            };
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
              "Worker Effective Config RPC 返回了无效或哈希不匹配的 Receipt。",
              false,
            );
          }
        },
      );
    },

    async getWorkspaceDefaults(capabilityInput) {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "workspace_defaults.get",
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.get_workspace_run_defaults() as value",
          );
          const value = exactValue(result.rows);
          if (value === null) return null;
          try {
            const parsed = workspaceDefaultsReadResultSchema.parse(value);
            const revision = await verifyWorkspaceDefaultsRevision(parsed.revision);
            assertWorkspaceScope(revision.scope, capability);
            return workspaceDefaultsReadResultSchema.parse({
              revision,
              defaults_ref: parsed.defaults_ref,
            });
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
              "Workspace Defaults RPC 返回了无效或哈希不匹配的 Revision。",
              false,
            );
          }
        },
      );
    },

    async updateWorkspaceDefaults(capabilityInput, commandInput) {
      let command: WorkspaceDefaultsCasUpdateCommand;
      try {
        command = await verifyWorkspaceDefaultsCasUpdateCommand(commandInput);
      } catch (error) {
        return failure(
          "WORKSPACE_RUN_DEFAULTS_INPUT_INVALID",
          error instanceof Error &&
            error.message.includes("WORKSPACE_DEFAULTS_REQUEST_HASH_MISMATCH")
            ? "Workspace Defaults CAS request hash 不匹配。"
            : "Workspace Defaults CAS 请求不符合严格合同。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "workspace_defaults.update",
          correlation_id: command.operation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (command.workspace_id !== capability.scope.tenant_id) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_RUN_DEFAULTS_SCOPE_MISMATCH",
              "Workspace Defaults CAS 请求跨越了当前 Workspace。",
              false,
            );
          }
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.update_workspace_run_defaults($1::jsonb) as value",
            [command],
          );
          try {
            const parsed = workspaceDefaultsUpdateResultSchema.parse(exactValue(result.rows));
            const revision = await verifyWorkspaceDefaultsRevision(parsed.revision);
            assertWorkspaceScope(revision.scope, capability);
            if (
              revision.created_by_principal_id !== capability.principal ||
              revision.defaults_revision !== command.expected_defaults_revision + 1 ||
              (command.expected_defaults_revision === 0 &&
                revision.defaults_id !== command.operation_id) ||
              parsed.request_hash !== command.request_hash
            ) {
              throw new PersistenceBoundaryError(
                "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
                "Workspace Defaults update result 与 CAS command 不一致。",
                false,
              );
            }
            assertDefaultsSelectionCorrelation(command.defaults, revision.defaults);
            return workspaceDefaultsUpdateResultSchema.parse({
              ...parsed,
              revision,
            });
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID",
              "Workspace Defaults update RPC 返回了无效或哈希不匹配的 Revision。",
              false,
            );
          }
        },
      );
    },
  };
}
