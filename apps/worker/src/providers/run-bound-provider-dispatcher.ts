import {
  agentDataProjectionReceiptReferenceSchema,
  buildProviderDispatchEnvelopeCandidate,
  computeModelProviderPayloadHash,
  type EffectiveRunConfigReceiptCandidate,
  type PortResult,
  type ProviderExecutionProfile,
} from "@data-agent/contracts";
import type { RunBoundProviderDispatcher } from "../runs/run-execution-context.js";
import type {
  AgentDataProjectionReceiptAuthority,
  AuditedModelProvider,
  AuditedModelProviderResult,
} from "./audited-model-provider.js";
import type { PostgresAgentDataProjectionReceiptStore } from "./postgres-agent-data-projection-receipt-store.js";
import type { ProviderTaskArtifactAuthority } from "./postgres-provider-task-artifact.js";
import {
  createGovernedAgentDataProjectionReceipt,
  inspectProviderTaskProjection,
} from "./provider-data-projector.internal.js";
import {
  computeTrustedInputTokenUpperBound,
  U3_MODEL_SYSTEM_INSTRUCTIONS,
} from "./trusted-input-token-upper-bound.js";

export interface ProviderExecutionProfileAuthority {
  list(): Promise<PortResult<readonly ProviderExecutionProfile[]>>;
}

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

function sameEffectiveModel(
  profile: ProviderExecutionProfile,
  config: EffectiveRunConfigReceiptCandidate,
): profile is Extract<ProviderExecutionProfile, { readiness: "AVAILABLE" }> {
  return (
    profile.readiness === "AVAILABLE" &&
    profile.model_profile_id === config.model.resource_id &&
    profile.model_config_version === config.model.resource_revision &&
    profile.resource_hash === config.model.resource_hash &&
    profile.profile_version === config.model.profile_version &&
    profile.provider === config.model.provider &&
    profile.model_id === config.model.model_id
  );
}

export function createRunBoundProviderDispatcher(input: {
  readonly task_artifacts: ProviderTaskArtifactAuthority;
  readonly execution_profiles: ProviderExecutionProfileAuthority;
  readonly projection_store: PostgresAgentDataProjectionReceiptStore;
  readonly create_audited_provider: (
    projectionAuthority: AgentDataProjectionReceiptAuthority,
  ) => AuditedModelProvider;
  readonly allowed_providers: readonly string[];
  readonly allowed_connection_kinds: readonly Extract<
    ProviderExecutionProfile,
    { readonly readiness: "AVAILABLE" }
  >["connection"]["kind"][];
  readonly system_deployment_id: string;
  readonly required_recovery_capabilities: readonly string[];
  readonly response_schema_version: string;
  readonly response_schema_bytes: number;
}): RunBoundProviderDispatcher {
  return Object.freeze({
    async invoke({
      lease,
      effective_config: config,
      context_receipt: context,
      logical_call_id,
      signal,
    }: Parameters<RunBoundProviderDispatcher["invoke"]>[0]): Promise<
      PortResult<AuditedModelProviderResult>
    > {
      if (signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider profile 解析前 Run 已中止。");
      }
      if (
        config.run_id !== lease.run_id ||
        context.run_id !== lease.run_id ||
        context.receipt_id !== lease.attempt_id ||
        context.outbox_id !== lease.outbox_id ||
        context.command_id !== lease.command_id ||
        context.attempt_id !== lease.attempt_id ||
        context.lease_token !== lease.lease_token ||
        context.worker_fence !== lease.worker_fence ||
        context.config_ref.config_id !== config.config_id ||
        context.config_ref.config_revision !== config.config_revision ||
        context.config_ref.config_hash !== config.config_hash
      ) {
        return failure(
          "PROVIDER_CONTEXT_RECEIPT_MISMATCH",
          "Run-bound Provider coordinator 收到不一致的 U2 Context Authority。",
        );
      }

      const profiles = await input.execution_profiles.list();
      if (!profiles.ok) return { ok: false, error: profiles.error };
      if (signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider task 解析前 Run 已中止。");
      }
      const profile = profiles.value.find((candidate) => sameEffectiveModel(candidate, config));
      if (!profile || !sameEffectiveModel(profile, config)) {
        return failure(
          "PROVIDER_PROFILE_NOT_AVAILABLE",
          "U2 Effective Model 没有 exact AVAILABLE execution profile。",
        );
      }
      if (!input.allowed_providers.includes(profile.provider)) {
        return failure("PROVIDER_EGRESS_DENIED", "当前 Worker deployment 不允许该 Provider 出网。");
      }
      if (!input.allowed_connection_kinds.includes(profile.connection.kind)) {
        return failure(
          "PROVIDER_CONNECTION_PROOF_INVALID",
          "当前 Worker deployment 不接受该 execution profile 的连接 Authority。",
        );
      }
      if (
        profile.recovery_capabilities.length !== input.required_recovery_capabilities.length ||
        profile.recovery_capabilities.some(
          (capability, index) => capability !== input.required_recovery_capabilities[index],
        )
      ) {
        return failure(
          "PROVIDER_RECOVERY_CAPABILITY_UNSUPPORTED",
          "当前 Provider 没有已接线且经认证的恢复能力路径。",
        );
      }
      if (
        profile.connection.kind === "SYSTEM_DEPLOYMENT" &&
        profile.connection.deployment_id !== input.system_deployment_id
      ) {
        return failure(
          "PROVIDER_CONNECTION_PROOF_INVALID",
          "Execution certification 的 deployment 与当前 Worker Authority 不一致。",
        );
      }

      const task = await input.task_artifacts.commit({
        worker_lease: lease,
        conversation_binding: config.conversation_binding,
      });
      if (!task.ok) return { ok: false, error: task.error };
      if (signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider projection 提交前 Run 已中止。");
      }
      const providerScope = {
        ...lease.scope,
        workspace_id: lease.scope.tenant_id,
        principal_id: lease.principal_id,
      } as const;
      const inspected = inspectProviderTaskProjection({
        question: task.value.document.question,
        allowed_audiences: config.effective_egress.allowed_audiences,
      });
      if (!inspected.ok) return { ok: false, error: inspected.error };
      const messages = inspected.value.messages;
      const trustedInputTokenUpperBound = computeTrustedInputTokenUpperBound({
        instructions: U3_MODEL_SYSTEM_INSTRUCTIONS,
        messages,
        tool_names: [],
        response_schema_version: input.response_schema_version,
        canonical_schema_bytes: input.response_schema_bytes,
      });
      const effectiveContextCeiling = Math.min(
        config.context_policy.max_context_tokens,
        profile.effective_context_ceiling_tokens,
      );
      const effectiveOutputCeiling = Math.min(
        profile.effective_output_ceiling_tokens,
        Math.max(0, effectiveContextCeiling - trustedInputTokenUpperBound),
      );
      const capacityStatus = effectiveOutputCeiling < 1 ? "EXCEEDED" : "WITHIN_LIMIT";
      const maxOutputTokens = Math.min(2_048, Math.max(1, effectiveOutputCeiling));
      const request = {
        schema_version: "model-provider-request@1.0.0",
        request_id: logical_call_id,
        attempt_id: lease.attempt_id,
        scope: lease.scope,
        run_id: lease.run_id,
        provider: profile.provider,
        profile_id: profile.model_profile_id,
        profile_version: profile.profile_version,
        model_id: profile.model_id,
        model_config_version: profile.model_config_version,
        execution_profile_hash: profile.execution_profile_hash,
        recovery_capabilities: profile.recovery_capabilities,
        connection: profile.connection,
        token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
        trusted_input_token_upper_bound: trustedInputTokenUpperBound,
        task_ref: task.value.reference,
        context_refs: [],
        messages,
        tool_allowlist: [],
        response_schema_version: input.response_schema_version,
        budget: {
          timeout_ms: Math.min(config.execution_safety_policy.max_elapsed_ms, 600_000),
          max_input_tokens: effectiveContextCeiling,
          max_output_tokens: maxOutputTokens,
          max_tool_calls: 0,
        },
      } as const;
      const payloadHash = await computeModelProviderPayloadHash(request);
      const governedProjection = await createGovernedAgentDataProjectionReceipt({
        inspected: inspected.value,
        scope: lease.scope,
        run_id: lease.run_id,
        request_id: logical_call_id,
        principal_id: lease.principal_id,
        model_execution_profile_hash: profile.execution_profile_hash,
        task_ref: task.value.reference,
        classification: config.effective_egress.classification,
        payload_hash: payloadHash,
        token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
        trusted_input_token_upper_bound: trustedInputTokenUpperBound,
      });
      if (!governedProjection.ok) return { ok: false, error: governedProjection.error };
      const projectionReceipt = governedProjection.value;
      const taintHash = projectionReceipt.taint.taint_hash;
      const projectionReference = {
        artifact_id: projectionReceipt.receipt_id,
        artifact_type: "AgentDataProjectionReceipt" as const,
        ...lease.scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: projectionReceipt.receipt_hash,
      };
      const envelope = await buildProviderDispatchEnvelopeCandidate({
        schema_version: "provider-dispatch-envelope@1.0.0",
        invocation_id: logical_call_id,
        idempotency_key: `provider:${lease.run_id}:${logical_call_id}`,
        scope: providerScope,
        run_id: lease.run_id,
        logical_call_id,
        task_ref: task.value.reference,
        effective_config_ref: {
          config_id: config.config_id,
          config_revision: config.config_revision,
          config_hash: config.config_hash,
        },
        context_receipt_ref: {
          receipt_id: context.receipt_id,
          receipt_hash: context.receipt_hash,
        },
        lease: {
          outbox_id: lease.outbox_id,
          command_id: lease.command_id,
          attempt_id: lease.attempt_id,
          attempt_no: lease.attempt_no,
          worker_id: lease.worker_id,
          lease_token: lease.lease_token,
          worker_fence: lease.worker_fence,
        },
        model_profile: {
          profile_id: profile.model_profile_id,
          model_config_version: profile.model_config_version,
          resource_hash: profile.resource_hash,
          profile_version: profile.profile_version,
          provider: profile.provider,
          model_id: profile.model_id,
          adapter_version: profile.adapter_version,
        },
        certification: {
          receipt_ref: profile.certification_receipt_ref,
          execution_profile_hash: profile.execution_profile_hash,
          recovery_capabilities: profile.recovery_capabilities,
          certified_context_window: {
            verification_status: "VERIFIED",
            max_context_tokens: profile.effective_context_ceiling_tokens,
            max_output_tokens: profile.effective_output_ceiling_tokens,
          },
        },
        connection: profile.connection,
        request_policy: {
          response_schema_version: input.response_schema_version,
          tool_allowlist: [],
          budget: {
            ...request.budget,
            provider_call_limit: 1,
          },
        },
        projection: {
          projection_version: "agent-data-projection@2.0.0",
          receipt_ref: projectionReference,
          payload_hash: payloadHash,
          token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
          trusted_input_token_upper_bound: trustedInputTokenUpperBound,
          reserved_output_tokens: maxOutputTokens,
          effective_context_ceiling_tokens: effectiveContextCeiling,
          effective_output_ceiling_tokens: effectiveOutputCeiling,
          capacity_status: capacityStatus,
          taint_hash: taintHash,
        },
      });
      const projectionAuthority: AgentDataProjectionReceiptAuthority = Object.freeze({
        commit: async ({
          worker_lease: workerLease,
          envelope: requestedEnvelope,
        }: Parameters<AgentDataProjectionReceiptAuthority["commit"]>[0]): ReturnType<
          AgentDataProjectionReceiptAuthority["commit"]
        > => {
          if (
            workerLease.attempt_id !== lease.attempt_id ||
            requestedEnvelope.invocation_id !== logical_call_id ||
            requestedEnvelope.projection.receipt_ref.content_hash !== projectionReceipt.receipt_hash
          ) {
            return failure(
              "PROVIDER_DATA_PROJECTION_RECEIPT_INVALID",
              "Projection commit 请求与 run-bound coordinator 不一致。",
            );
          }
          const committed = await input.projection_store.commit(lease, projectionReceipt);
          if (!committed.ok) return { ok: false, error: committed.error };
          const committedReference = agentDataProjectionReceiptReferenceSchema.safeParse(
            committed.value,
          );
          if (!committedReference.success) {
            return failure(
              "PROVIDER_DATA_PROJECTION_RECEIPT_INVALID",
              "Projection Store 返回了错误 Artifact type。",
            );
          }
          return {
            ok: true,
            value: {
              reference: committedReference.data,
              resolver: input.projection_store.committedResolverForLease(lease),
            },
          };
        },
      });
      const provider = input.create_audited_provider(projectionAuthority);
      const result: PortResult<AuditedModelProviderResult> = await provider.invoke({
        worker_lease: lease,
        envelope,
        payload: request,
        signal,
      });
      return result;
    },
  });
}
