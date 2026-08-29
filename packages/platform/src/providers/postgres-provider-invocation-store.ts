import {
  authorizeCommittedProviderDispatchPermit,
  beginProviderInvocationCommandSchema,
  canonicalImmutableIdSchema,
  commitProviderInvocationCompletedCommandSchema,
  commitProviderInvocationTerminalCommandSchema,
  commitProviderTaskArtifactCommandSchema,
  currentProviderExecutionCertificationRequestSchema,
  currentProviderExecutionCertificationResultSchema,
  loadProviderInvocationCommandSchema,
  loadProviderResponseArtifactCommandSchema,
  loadProviderResponseArtifactResultSchema,
  loadProviderTaskArtifactCommandSchema,
  type ModelExecutionCertificationClaims,
  markProviderInvocationOutcomeUnknownCommandSchema,
  markProviderInvocationResponseObservedCommandSchema,
  markProviderInvocationStartedCommandSchema,
  type PortResult,
  type ProviderDispatchEnvelope,
  type ProviderExecutionProfile,
  providerExecutionProfileListResultSchema,
  type RunWorkLease,
  runWorkLeaseSchema,
  verifyBeginProviderInvocationResult,
  verifyCommitProviderInvocationCompletedResult,
  verifyCommitProviderInvocationTerminalResult,
  verifyCommitProviderTaskArtifactResult,
  verifyLoadProviderInvocationResult,
  verifyLoadProviderTaskArtifactResult,
  verifyMarkProviderInvocationOutcomeUnknownResult,
  verifyMarkProviderInvocationResponseObservedResult,
  verifyMarkProviderInvocationStartedResult,
  verifyModelExecutionCertificationClaims,
  verifyProviderDispatchEnvelopeCandidate,
  verifyProviderResponseArtifactDocument,
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

const conversationRunSelectionInputSchema = z.strictObject({
  conversation_id: canonicalImmutableIdSchema,
  expected_resource_version: z.number().int().positive().safe(),
});

const conversationRunSelectionsSchema = z.strictObject({
  schema_version: z.literal("conversation-run-selections@1.0.0"),
  conversation_id: canonicalImmutableIdSchema,
  conversation_resource_version: z.number().int().positive().safe(),
  model_profile_id: canonicalImmutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  datasource_id: canonicalImmutableIdSchema,
  datasource_resource_version: z.number().int().positive().safe(),
});

export type ConversationRunSelectionInput = z.infer<typeof conversationRunSelectionInputSchema>;
export type ConversationRunSelections = z.infer<typeof conversationRunSelectionsSchema>;

export interface PostgresProviderInvocationStore {
  listExecutionProfiles(
    capability: unknown,
  ): Promise<PortResult<readonly ProviderExecutionProfile[]>>;
  resolveCurrentExecutionCertification(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<ModelExecutionCertificationClaims>>;
  resolveConversationRunSelections(
    capability: unknown,
    input: ConversationRunSelectionInput,
  ): Promise<PortResult<ConversationRunSelections>>;
  begin(capability: unknown, lease: unknown, command: unknown): Promise<PortResult<unknown>>;
  markDispatched(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  markResponseObserved(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  commitTerminal(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  commitCompleted(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  markOutcomeUnknown(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  load(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
  loadResponse(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
  commitTaskArtifact(
    capability: unknown,
    lease: unknown,
    command: unknown,
  ): Promise<PortResult<unknown>>;
  loadTaskArtifact(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
}

export interface PostgresProviderInvocationStoreOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

const databaseMarkers = new Map<string, { readonly retryable: boolean; readonly message: string }>([
  [
    "CONVERSATION_RUN_SELECTION_INPUT_INVALID",
    { retryable: false, message: "Conversation 的执行资源选择请求无效。" },
  ],
  [
    "CONVERSATION_RUN_SELECTION_NOT_FOUND_OR_FORBIDDEN",
    { retryable: false, message: "Conversation 不存在或当前主体无权访问。" },
  ],
  [
    "CONVERSATION_RUN_SELECTION_VERSION_CONFLICT",
    { retryable: true, message: "Conversation 的执行资源选择已变化，请刷新后重试。" },
  ],
  [
    "PROVIDER_PROFILE_NOT_AVAILABLE",
    { retryable: false, message: "Conversation 选择的 Model Profile 当前不可执行。" },
  ],
  [
    "DATASOURCE_NOT_FOUND_OR_DENIED",
    { retryable: false, message: "Conversation 选择的 Datasource 当前不可执行。" },
  ],
  ["PROVIDER_THROTTLED", { retryable: true, message: "Provider 暂时限流。" }],
  [
    "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
    { retryable: false, message: "Provider 调用结果未知，只允许受控 reconcile。" },
  ],
  [
    "PROVIDER_WORKER_LEASE_STALE",
    { retryable: false, message: "Worker Lease 已过期，禁止继续 Provider transition。" },
  ],
  [
    "PROVIDER_INVOCATION_IDEMPOTENCY_CONFLICT",
    { retryable: false, message: "Provider invocation 幂等键已绑定不同请求。" },
  ],
  [
    "PROVIDER_DATA_PROJECTION_RECEIPT_INVALID",
    { retryable: false, message: "Agent Data Projection Receipt 未通过 Authority 验证。" },
  ],
  [
    "PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN",
    { retryable: false, message: "Provider Response Artifact 不存在或无权访问。" },
  ],
  [
    "PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN",
    { retryable: false, message: "Provider Task Artifact 不存在或无权访问。" },
  ],
]);

for (const marker of [
  "PROVIDER_CERTIFICATION_REQUIRED",
  "PROVIDER_CALL_LIMIT_EXCEEDED",
  "PROVIDER_CONNECTION_PROOF_INVALID",
  "PROVIDER_CONTEXT_LIMIT_EXCEEDED",
  "PROVIDER_CONTEXT_RECEIPT_MISMATCH",
  "PROVIDER_CONTEXT_WINDOW_UNVERIFIED",
  "PROVIDER_CREDENTIAL_UNAVAILABLE",
  "PROVIDER_DISPATCH_ENVELOPE_INVALID",
  "PROVIDER_DISPATCH_HASH_MISMATCH",
  "PROVIDER_DISPATCH_MARK_COMMAND_INVALID",
  "PROVIDER_DISPATCH_MARK_CONFLICT",
  "PROVIDER_DISPATCH_MARK_NOT_COMMITTED",
  "PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED",
  "PROVIDER_EFFECTIVE_CONFIG_MISMATCH",
  "PROVIDER_EGRESS_DENIED",
  "PROVIDER_INVOCATION_ALREADY_TERMINAL",
  "PROVIDER_INVOCATION_COMMAND_INVALID",
  "PROVIDER_INVOCATION_COMPLETED_COMMAND_INVALID",
  "PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN",
  "PROVIDER_INVOCATION_KEY_HASH_MISMATCH",
  "PROVIDER_INVOCATION_LOAD_INVALID",
  "PROVIDER_INVOCATION_NOT_DISPATCHED",
  "PROVIDER_INVOCATION_NOT_FOUND_OR_FORBIDDEN",
  "PROVIDER_INVOCATION_TERMINAL_COMMAND_INVALID",
  "PROVIDER_INVOCATION_TERMINAL_CONFLICT",
  "PROVIDER_INVOCATION_TRANSITION_CLOSURE_INVALID",
  "PROVIDER_INVOCATION_TRANSITION_INVALID",
  "PROVIDER_INVOCATION_TRANSITION_TRUTH_INVALID",
  "PROVIDER_INVOCATION_UNKNOWN_COMMAND_INVALID",
  "PROVIDER_OUTPUT_LIMIT_EXCEEDED",
  "PROVIDER_PREDISPATCH_TRUTH_INVALID",
  "PROVIDER_PROFILE_NOT_AVAILABLE",
  "PROVIDER_PROTOCOL_VIOLATION",
  "PROVIDER_REDISPATCH_REQUIRES_RECONCILIATION",
  "PROVIDER_RESPONSE_ARTIFACT_CONFLICT",
  "PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID",
  "PROVIDER_RESPONSE_ARTIFACT_INVALID",
  "PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID",
  "PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID",
  "PROVIDER_RESPONSE_OBSERVED_CONFLICT",
  "PROVIDER_RESPONSE_OBSERVED_MARK_NOT_COMMITTED",
  "PROVIDER_TASK_REFERENCE_INVALID",
  "PROVIDER_TASK_ARTIFACT_COMMAND_INVALID",
  "PROVIDER_TASK_ARTIFACT_CONFLICT",
  "PROVIDER_TASK_ARTIFACT_LOAD_INVALID",
  "PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID",
  "PROVIDER_WORKER_LEASE_INVALID",
  "PROVIDER_WORKER_LEASE_MISMATCH",
  "PROVIDER_WORKER_LEASE_NOT_OWNED",
] as const) {
  databaseMarkers.set(marker, {
    retryable: false,
    message: "Provider Invocation Authority 拒绝了不一致或不可执行的请求。",
  });
}

function mapDatabaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  for (const [marker, details] of databaseMarkers) {
    if (message.includes(marker)) return failure(marker, details.message, details.retryable);
  }
  return null;
}

function exactValue(rows: readonly JsonValueRow[]): unknown {
  const row = rows[0];
  if (rows.length !== 1 || !row || !("value" in row)) {
    throw new PersistenceBoundaryError(
      "PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID",
      "Provider Invocation RPC 必须返回唯一结果。",
      false,
    );
  }
  return row.value;
}

async function verifyRpcResult<T>(verify: () => Promise<T>): Promise<T> {
  try {
    return await verify();
  } catch {
    throw new PersistenceBoundaryError(
      "PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID",
      "Provider Invocation RPC 返回值未通过 hash、scope 与 transition closure 校验。",
      false,
    );
  }
}

function assertLeaseTransitionCorrelation(
  leaseInput: unknown,
  command: {
    readonly scope: {
      readonly app_id: string;
      readonly tenant_id: string;
      readonly environment: string;
      readonly principal_id: string;
    };
    readonly run_id: string;
    readonly attempt_id: string;
    readonly worker_fence: number;
  },
) {
  const lease = runWorkLeaseSchema.parse(leaseInput);
  if (
    lease.scope.app_id !== command.scope.app_id ||
    lease.scope.tenant_id !== command.scope.tenant_id ||
    lease.scope.environment !== command.scope.environment ||
    lease.principal_id !== command.scope.principal_id ||
    lease.run_id !== command.run_id ||
    lease.attempt_id !== command.attempt_id ||
    lease.worker_fence !== command.worker_fence
  ) {
    throw new PersistenceBoundaryError(
      "PROVIDER_WORKER_LEASE_MISMATCH",
      "Provider transition 与 ACTIVE Worker Lease 不一致。",
      false,
    );
  }
  return lease;
}

export function createPostgresProviderInvocationStore(
  options: PostgresProviderInvocationStoreOptions,
): PostgresProviderInvocationStore {
  return {
    async listExecutionProfiles(capabilityInput) {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.list_execution_profiles",
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.list_provider_execution_profiles() as value",
          );
          const parsed = providerExecutionProfileListResultSchema.safeParse(
            exactValue(result.rows),
          );
          if (
            !parsed.success ||
            parsed.data.scope.app_id !== capability.scope.app_id ||
            parsed.data.scope.tenant_id !== capability.scope.tenant_id ||
            parsed.data.scope.environment !== capability.scope.environment ||
            parsed.data.scope.workspace_id !== capability.scope.tenant_id ||
            parsed.data.scope.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "PROVIDER_EXECUTION_PROFILE_LIST_INVALID",
              "PostgreSQL 返回的 Provider Execution Profile 不属于当前 Capability Scope。",
              false,
            );
          }
          return parsed.data.profiles;
        },
      );
    },
    async resolveCurrentExecutionCertification(capabilityInput, inputValue) {
      const command = currentProviderExecutionCertificationRequestSchema.safeParse(inputValue);
      if (!command.success) {
        return failure(
          "PROVIDER_CURRENT_CERTIFICATION_RESOLVE_INVALID",
          "Current Provider Certification 请求不符合严格合同。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.resolve_current_execution_certification",
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.resolve_current_provider_execution_certification($1::jsonb) as value",
            [command.data],
          );
          const document = currentProviderExecutionCertificationResultSchema.parse(
            exactValue(result.rows),
          );
          const claims = await verifyRpcResult(() =>
            verifyModelExecutionCertificationClaims(document.claims),
          );
          if (
            claims.profile_id !== command.data.model_profile_id ||
            claims.model_config_version !== command.data.model_config_version ||
            JSON.stringify(claims.receipt_ref) !==
              JSON.stringify(command.data.certification_receipt_ref) ||
            claims.execution_profile_snapshot.scope.app_id !== capability.scope.app_id ||
            claims.execution_profile_snapshot.scope.tenant_id !== capability.scope.tenant_id ||
            claims.execution_profile_snapshot.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "PROVIDER_CURRENT_CERTIFICATION_DATABASE_CONTRACT_INVALID",
              "Current Provider Certification RPC 返回值未闭合同一 capability/profile/ref。",
              false,
            );
          }
          return claims;
        },
      );
    },
    async resolveConversationRunSelections(capabilityInput, inputValue) {
      const input = conversationRunSelectionInputSchema.safeParse(inputValue);
      if (!input.success) {
        return failure(
          "PROVIDER_CONVERSATION_SELECTION_INVALID",
          "Conversation 资源选择请求不符合严格合同。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.resolve_conversation_selections",
          correlation_id: input.data.conversation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            `select app_data_agent.resolve_conversation_run_selections(
               $1::uuid, $2::bigint
             ) as value`,
            [input.data.conversation_id, input.data.expected_resource_version],
          );
          const parsed = conversationRunSelectionsSchema.safeParse(exactValue(result.rows));
          if (
            !parsed.success ||
            parsed.data.conversation_id !== input.data.conversation_id ||
            parsed.data.conversation_resource_version !== input.data.expected_resource_version
          ) {
            throw new PersistenceBoundaryError(
              "PROVIDER_CONVERSATION_SELECTION_INVALID",
              "PostgreSQL 返回的 Conversation 资源选择与请求不一致。",
              false,
            );
          }
          return parsed.data;
        },
      );
    },
    async begin(capabilityInput, leaseInput, commandInput) {
      const lease = runWorkLeaseSchema.safeParse(leaseInput);
      const command = beginProviderInvocationCommandSchema.safeParse(commandInput);
      if (!lease.success || !command.success) {
        return failure(
          "PROVIDER_INVOCATION_COMMAND_INVALID",
          "Provider begin 输入不符合严格合同。",
        );
      }
      let envelope: ProviderDispatchEnvelope;
      try {
        envelope = await verifyProviderDispatchEnvelopeCandidate(command.data.envelope);
        assertLeaseTransitionCorrelation(lease.data, {
          scope: envelope.scope,
          run_id: envelope.run_id,
          attempt_id: envelope.lease.attempt_id,
          worker_fence: envelope.lease.worker_fence,
        });
        if (
          lease.data.outbox_id !== envelope.lease.outbox_id ||
          lease.data.command_id !== envelope.lease.command_id ||
          lease.data.attempt_no !== envelope.lease.attempt_no ||
          lease.data.worker_id !== envelope.lease.worker_id ||
          lease.data.lease_token !== envelope.lease.lease_token
        ) {
          throw new TypeError("PROVIDER_WORKER_LEASE_MISMATCH");
        }
      } catch {
        return failure(
          "PROVIDER_DISPATCH_ENVELOPE_INVALID",
          "Provider Dispatch Envelope 校验失败。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.begin",
          correlation_id: envelope.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.begin_provider_invocation($1::jsonb, $2::jsonb) as value",
            [lease.data, command.data],
          );
          const parsed = await verifyRpcResult(() =>
            verifyBeginProviderInvocationResult(command.data, exactValue(result.rows)),
          );
          if (parsed.admission === "REJECTED") return parsed;
          if (parsed.admission === "TERMINAL_REPLAY") {
            const originalPermit = await authorizeCommittedProviderDispatchPermit(
              {
                scope: parsed.original_permit.scope,
                run_id: parsed.original_permit.run_id,
                invocation_id: parsed.original_permit.invocation_id,
                dispatch_hash: parsed.original_permit.dispatch_hash,
              },
              { resolve_committed: async () => parsed.original_permit },
            );
            return { ...parsed, original_permit: originalPermit };
          }
          const permit = await authorizeCommittedProviderDispatchPermit(
            {
              scope: envelope.scope,
              run_id: envelope.run_id,
              invocation_id: envelope.invocation_id,
              dispatch_hash: envelope.dispatch_hash,
            },
            { resolve_committed: async () => parsed.permit },
          );
          return { ...parsed, permit };
        },
      );
    },
    async markDispatched(capabilityInput, leaseInput, commandInput) {
      const command = markProviderInvocationStartedCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_DISPATCH_MARK_COMMAND_INVALID",
          "Provider dispatch marker 输入无效。",
        );
      }
      let lease: RunWorkLease;
      try {
        lease = assertLeaseTransitionCorrelation(leaseInput, command.data);
      } catch (error) {
        return error instanceof PersistenceBoundaryError
          ? failure(error.code, error.message, error.retryable)
          : failure("PROVIDER_WORKER_LEASE_INVALID", "Worker Lease 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.mark_dispatched",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.mark_provider_invocation_dispatched($1::jsonb, $2::jsonb) as value",
            [lease, command.data],
          );
          return verifyRpcResult(() =>
            verifyMarkProviderInvocationStartedResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
    async markResponseObserved(capabilityInput, leaseInput, commandInput) {
      const command = markProviderInvocationResponseObservedCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID",
          "Provider response observed marker 输入无效。",
        );
      }
      let lease: RunWorkLease;
      try {
        lease = assertLeaseTransitionCorrelation(leaseInput, command.data);
      } catch (error) {
        return error instanceof PersistenceBoundaryError
          ? failure(error.code, error.message, error.retryable)
          : failure("PROVIDER_WORKER_LEASE_INVALID", "Worker Lease 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.mark_response_observed",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.mark_provider_invocation_response_observed($1::jsonb, $2::jsonb) as value",
            [lease, command.data],
          );
          return verifyRpcResult(() =>
            verifyMarkProviderInvocationResponseObservedResult(
              command.data,
              exactValue(result.rows),
            ),
          );
        },
      );
    },
    async commitTerminal(capabilityInput, leaseInput, commandInput) {
      const command = commitProviderInvocationTerminalCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_INVOCATION_TERMINAL_COMMAND_INVALID",
          "Provider terminal 输入无效。",
        );
      }
      let lease: RunWorkLease;
      try {
        lease = assertLeaseTransitionCorrelation(leaseInput, command.data);
      } catch (error) {
        return error instanceof PersistenceBoundaryError
          ? failure(error.code, error.message, error.retryable)
          : failure("PROVIDER_WORKER_LEASE_INVALID", "Worker Lease 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.commit_terminal",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.commit_provider_invocation_terminal($1::jsonb, $2::jsonb, $3::jsonb) as value",
            [lease, command.data, command.data.usage],
          );
          return verifyRpcResult(() =>
            verifyCommitProviderInvocationTerminalResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
    async commitCompleted(capabilityInput, leaseInput, commandInput) {
      const command = commitProviderInvocationCompletedCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_INVOCATION_COMPLETED_COMMAND_INVALID",
          "Provider completed 输入无效。",
        );
      }
      let lease: RunWorkLease;
      try {
        lease = assertLeaseTransitionCorrelation(leaseInput, command.data);
      } catch (error) {
        return error instanceof PersistenceBoundaryError
          ? failure(error.code, error.message, error.retryable)
          : failure("PROVIDER_WORKER_LEASE_INVALID", "Worker Lease 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.commit_completed",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.commit_provider_invocation_completed($1::jsonb, $2::jsonb) as value",
            [lease, command.data],
          );
          await verifyProviderResponseArtifactDocument(command.data.response_document);
          return verifyRpcResult(() =>
            verifyCommitProviderInvocationCompletedResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
    async markOutcomeUnknown(capabilityInput, leaseInput, commandInput) {
      const command = markProviderInvocationOutcomeUnknownCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_INVOCATION_UNKNOWN_COMMAND_INVALID",
          "Provider unknown 输入无效。",
        );
      }
      let lease: RunWorkLease;
      try {
        lease = assertLeaseTransitionCorrelation(leaseInput, command.data);
      } catch (error) {
        return error instanceof PersistenceBoundaryError
          ? failure(error.code, error.message, error.retryable)
          : failure("PROVIDER_WORKER_LEASE_INVALID", "Worker Lease 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.mark_unknown",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.mark_provider_invocation_outcome_unknown($1::jsonb, $2::jsonb, $3::jsonb) as value",
            [lease, command.data, command.data.usage],
          );
          return verifyRpcResult(() =>
            verifyMarkProviderInvocationOutcomeUnknownResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
    async load(capabilityInput, commandInput) {
      const command = loadProviderInvocationCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure("PROVIDER_INVOCATION_LOAD_INVALID", "Provider load 输入无效。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.load",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.load_provider_invocation($1::jsonb) as value",
            [command.data],
          );
          return verifyRpcResult(() =>
            verifyLoadProviderInvocationResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
    async loadResponse(capabilityInput, commandInput) {
      const command = loadProviderResponseArtifactCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID",
          "Provider response load 输入无效。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.load_response",
          correlation_id: command.data.invocation_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.load_provider_response_artifact($1::jsonb) as value",
            [command.data],
          );
          const parsed = loadProviderResponseArtifactResultSchema.parse(exactValue(result.rows));
          const document = await verifyProviderResponseArtifactDocument(parsed.document);
          if (
            parsed.invocation_id !== command.data.invocation_id ||
            parsed.reference.artifact_id !== command.data.reference.artifact_id ||
            parsed.reference.content_hash !== command.data.reference.content_hash ||
            parsed.reference.app_id !== command.data.scope.app_id ||
            parsed.reference.tenant_id !== command.data.scope.tenant_id ||
            parsed.reference.environment !== command.data.scope.environment ||
            parsed.reference.run_id !== command.data.run_id ||
            document.invocation_id !== command.data.invocation_id
          ) {
            throw new PersistenceBoundaryError(
              "PROVIDER_RESPONSE_ARTIFACT_MISMATCH",
              "Provider Response Artifact 与 load command identity/scope 不一致。",
              false,
            );
          }
          return parsed;
        },
      );
    },
    async commitTaskArtifact(capabilityInput, leaseInput, commandInput) {
      const lease = runWorkLeaseSchema.safeParse(leaseInput);
      const command = commitProviderTaskArtifactCommandSchema.safeParse(commandInput);
      if (!lease.success || !command.success) {
        return failure(
          "PROVIDER_TASK_ARTIFACT_COMMAND_INVALID",
          "Provider Task Artifact commit 输入无效。",
        );
      }
      if (
        lease.data.scope.app_id !== command.data.scope.app_id ||
        lease.data.scope.tenant_id !== command.data.scope.tenant_id ||
        lease.data.scope.environment !== command.data.scope.environment ||
        lease.data.principal_id !== command.data.scope.principal_id ||
        lease.data.run_id !== command.data.run_id
      ) {
        return failure(
          "PROVIDER_WORKER_LEASE_MISMATCH",
          "Provider Task Artifact 与 ACTIVE Worker Lease 不一致。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.commit_task_artifact",
          correlation_id: command.data.run_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.commit_provider_task_artifact($1::jsonb, $2::jsonb) as value",
            [lease.data, command.data],
          );
          const parsed = await verifyRpcResult(() =>
            verifyCommitProviderTaskArtifactResult(command.data, exactValue(result.rows)),
          );
          if (parsed.document.schema_version !== "provider-task-artifact@2.0.0") {
            throw new PersistenceBoundaryError(
              "PROVIDER_TASK_ARTIFACT_COMMAND_MISMATCH",
              "Provider Task Artifact commit 必须返回冻结 Conversation v2 文档。",
              false,
            );
          }
          return parsed;
        },
      );
    },
    async loadTaskArtifact(capabilityInput, commandInput) {
      const command = loadProviderTaskArtifactCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_TASK_ARTIFACT_LOAD_INVALID",
          "Provider Task Artifact load 输入无效。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.load_task_artifact",
          correlation_id: command.data.reference.artifact_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.load_provider_task_artifact($1::jsonb) as value",
            [command.data],
          );
          return verifyRpcResult(() =>
            verifyLoadProviderTaskArtifactResult(command.data, exactValue(result.rows)),
          );
        },
      );
    },
  };
}
