import {
  beginProviderInvocationResultSchema,
  buildProviderResponseArtifactDocument,
  type committedProviderDispatchPermitSchema,
  isAuthoritativeCommittedProviderDispatchPermit,
  loadProviderInvocationResultSchema,
  loadProviderResponseArtifactResultSchema,
  type PortResult,
  providerInvocationPublicProjectionSchema,
  type providerInvocationUsageCandidateSchema,
} from "@data-agent/contracts";
import type { AppCapability, PostgresProviderInvocationStore } from "@data-agent/platform";
import type { z } from "zod";
import type {
  AuditedProviderInvocationStore,
  AuditedProviderTransportResult,
  ProtectedProviderResponseStore,
} from "./audited-model-provider.js";

type Permit = Parameters<AuditedProviderInvocationStore["load"]>[0]["permit"];
type ProviderInvocationUsageCandidate = z.infer<typeof providerInvocationUsageCandidateSchema>;
type PermitReceipt = z.infer<typeof committedProviderDispatchPermitSchema>;

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

function transition(permit: Permit) {
  return {
    intent_id: permit.intent_id,
    invocation_id: permit.invocation_id,
    scope: permit.scope,
    run_id: permit.run_id,
    dispatch_hash: permit.dispatch_hash,
    attempt_id: permit.attempt_id,
    worker_fence: permit.worker_fence,
  } as const;
}

function outcomeTransition(permit: Permit) {
  const { attempt_id: _attemptId, worker_fence: _workerFence, ...outcome } = transition(permit);
  return outcome;
}

function samePermit(left: Permit, right: PermitReceipt): boolean {
  return (
    left.permit_id === right.permit_id &&
    left.permit_hash === right.permit_hash &&
    left.intent_id === right.intent_id &&
    left.invocation_id === right.invocation_id &&
    left.run_id === right.run_id &&
    left.dispatch_hash === right.dispatch_hash &&
    left.attempt_id === right.attempt_id &&
    left.worker_fence === right.worker_fence
  );
}

function unavailableUsage(
  reason:
    | "PROVIDER_DID_NOT_REPORT_USAGE"
    | "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
    | "PROVIDER_PROTOCOL_VIOLATION",
): ProviderInvocationUsageCandidate {
  return {
    schema_version: "provider-invocation-usage-candidate@1.0.0",
    availability: "UNAVAILABLE",
    source: "UNAVAILABLE",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
    provider_call_count: 1,
    capacity_status: "UNAVAILABLE",
    unavailable_reason: reason,
  };
}

function terminalUsage(
  terminal: Exclude<AuditedProviderTransportResult, { kind: "COMPLETED" }>,
): ProviderInvocationUsageCandidate {
  return terminal.usage
    ? {
        schema_version: "provider-invocation-usage-candidate@1.0.0",
        availability: "AVAILABLE",
        source: terminal.usage.source,
        input_tokens: terminal.usage.input_tokens,
        output_tokens: terminal.usage.output_tokens,
        total_tokens: terminal.usage.input_tokens + terminal.usage.output_tokens,
        tool_calls: terminal.usage.tool_calls,
        provider_call_count: 1,
        capacity_status: "WITHIN_LIMIT",
        unavailable_reason: null,
      }
    : unavailableUsage("PROVIDER_DID_NOT_REPORT_USAGE");
}

export function createPostgresAuditedProviderInvocationAdapter(input: {
  readonly store: PostgresProviderInvocationStore;
  readonly capability: AppCapability;
}): Readonly<{
  invocation_store: AuditedProviderInvocationStore;
  response_artifacts: ProtectedProviderResponseStore;
}> {
  const { store, capability } = input;
  const invocationStore: AuditedProviderInvocationStore = {
    async begin({ worker_lease, envelope }) {
      const result = await store.begin(capability, worker_lease, {
        schema_version: "provider-invocation-begin@1.0.0",
        envelope,
      });
      if (result.ok === false) return result;
      const parsed = beginProviderInvocationResultSchema.safeParse(result.value);
      if (!parsed.success) {
        return failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Begin result 无效。");
      }
      if (parsed.data.admission === "REJECTED") {
        return {
          ok: true,
          value: {
            admission: "REJECTED",
            reason_code: parsed.data.rejection_reason,
            projection: parsed.data.projection,
          },
        };
      }
      if (parsed.data.admission === "TERMINAL_REPLAY") {
        const originalPermit = (result.value as { readonly original_permit?: unknown })
          .original_permit;
        if (!isAuthoritativeCommittedProviderDispatchPermit(originalPermit)) {
          return failure(
            "PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED",
            "Terminal replay 未携带 PostgreSQL committed original permit。",
          );
        }
        return {
          ok: true,
          value: {
            admission: "TERMINAL_REPLAY",
            replay_action: parsed.data.replay_action,
            original_permit: originalPermit,
            status: parsed.data.outcome.candidate.status,
            response_artifact_ref: parsed.data.response_artifact_ref,
            response_hash: parsed.data.outcome.candidate.response_hash,
            projection: parsed.data.projection,
          },
        };
      }
      const rawPermit = (result.value as { readonly permit?: unknown }).permit;
      if (!isAuthoritativeCommittedProviderDispatchPermit(rawPermit)) {
        return failure(
          "PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED",
          "Begin result 未携带 PostgreSQL committed permit。",
        );
      }
      return {
        ok: true,
        value: {
          admission: "READY",
          replayed: parsed.data.disposition === "REPLAYED",
          permit: rawPermit,
        },
      };
    },

    async load({ permit }) {
      const result = await store.load(capability, {
        schema_version: "provider-invocation-load@1.0.0",
        scope: permit.scope,
        run_id: permit.run_id,
        invocation_id: permit.invocation_id,
        permit_id: permit.permit_id,
        permit_hash: permit.permit_hash,
        dispatch_hash: permit.dispatch_hash,
        attempt_id: permit.attempt_id,
        worker_fence: permit.worker_fence,
      });
      if (result.ok === false) return result;
      const parsed = loadProviderInvocationResultSchema.safeParse(result.value);
      if (!parsed.success) {
        return failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Load result 无效。");
      }
      if (parsed.data === null) {
        return { ok: true, value: null };
      }
      if (!samePermit(permit, parsed.data.permit)) {
        return failure(
          "PROVIDER_WORKER_LEASE_STALE",
          "Load result 属于不同 Provider attempt permit。",
        );
      }
      if (!parsed.data.outcome) {
        return {
          ok: true,
          value: {
            status: parsed.data.response_observed
              ? ("RESPONSE_OBSERVED" as const)
              : ("DISPATCH_MARKED" as const),
          },
        };
      }
      return {
        ok: true,
        value: {
          status: parsed.data.outcome.candidate.status,
          response_artifact_ref: parsed.data.outcome.candidate.response_artifact_ref,
          response_hash: parsed.data.outcome.candidate.response_hash,
          projection: parsed.data.projection,
        },
      };
    },

    async markDispatched({ worker_lease, permit }) {
      return store.markDispatched(capability, worker_lease, {
        schema_version: "provider-invocation-mark-started@1.0.0",
        ...transition(permit),
      });
    },

    async markResponseObserved({
      worker_lease,
      permit,
      observation_kind,
      response_hash,
      delivery_certainty,
    }) {
      return store.markResponseObserved(capability, worker_lease, {
        schema_version: "provider-invocation-mark-response-observed@1.0.0",
        ...transition(permit),
        observation_kind,
        response_hash,
        delivery_certainty,
      });
    },

    async commitPreflightFailure({ worker_lease, permit, reason_code }) {
      const result = await store.commitTerminal(capability, worker_lease, {
        schema_version: "provider-invocation-commit-terminal@1.0.0",
        ...transition(permit),
        outcome: {
          schema_version: "provider-invocation-outcome-candidate@1.0.0",
          ...outcomeTransition(permit),
          status: "FAILED",
          reason_code,
          response_artifact_ref: null,
          response_hash: null,
          delivery_certainty: "NOT_DISPATCHED",
          transition_from: "INTENT_COMMITTED",
          recovery_action: "NONE",
          provider_call_count: 0,
          retry_after_ms: null,
          reconciliation_of: null,
        },
        usage: {
          schema_version: "provider-invocation-usage-candidate@1.0.0",
          availability: "NOT_APPLICABLE",
          source: "UNAVAILABLE",
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          tool_calls: null,
          provider_call_count: 0,
          capacity_status: "NOT_APPLICABLE",
          unavailable_reason: "PROVIDER_NOT_DISPATCHED",
        },
      });
      if (result.ok === false) return result;
      const parsed = providerInvocationPublicProjectionSchema.safeParse(
        (result.value as { readonly projection?: unknown }).projection,
      );
      return parsed.success
        ? { ok: true, value: { projection: parsed.data } }
        : failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Terminal projection 无效。");
    },

    async commitTerminal({ worker_lease, permit, terminal }) {
      if (
        terminal.kind === "THROTTLED" &&
        (!Number.isSafeInteger(terminal.retry_after_ms) || (terminal.retry_after_ms ?? 0) <= 0)
      ) {
        return failure(
          "PROVIDER_PROTOCOL_VIOLATION",
          "THROTTLED terminal 缺少 Provider 已观察的 retry_after_ms。",
        );
      }
      const result = await store.commitTerminal(capability, worker_lease, {
        schema_version: "provider-invocation-commit-terminal@1.0.0",
        ...transition(permit),
        outcome: {
          schema_version: "provider-invocation-outcome-candidate@1.0.0",
          ...outcomeTransition(permit),
          status: terminal.kind,
          reason_code: terminal.reason_code,
          response_artifact_ref: null,
          response_hash: null,
          delivery_certainty: terminal.delivery_certainty,
          transition_from: "RESPONSE_OBSERVED",
          recovery_action: "NONE",
          provider_call_count: 1,
          retry_after_ms: terminal.kind === "THROTTLED" ? terminal.retry_after_ms : null,
          reconciliation_of: null,
        },
        usage: terminalUsage(terminal),
      });
      if (result.ok === false) return result;
      const parsed = providerInvocationPublicProjectionSchema.safeParse(
        (result.value as { readonly projection?: unknown }).projection,
      );
      return parsed.success
        ? { ok: true, value: { projection: parsed.data } }
        : failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Terminal projection 无效。");
    },

    async markOutcomeUnknown({ worker_lease, permit }) {
      const result = await store.markOutcomeUnknown(capability, worker_lease, {
        schema_version: "provider-invocation-mark-unknown@1.0.0",
        ...transition(permit),
        outcome: {
          schema_version: "provider-invocation-outcome-candidate@1.0.0",
          ...outcomeTransition(permit),
          status: "OUTCOME_UNKNOWN",
          reason_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
          response_artifact_ref: null,
          response_hash: null,
          delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
          transition_from: "RESPONSE_OBSERVED",
          recovery_action: "RECONCILIATION_REQUIRED",
          provider_call_count: 1,
          retry_after_ms: null,
          reconciliation_of: null,
        },
        usage: unavailableUsage("PROVIDER_INVOCATION_OUTCOME_UNKNOWN"),
      });
      if (result.ok === false) return result;
      const parsed = providerInvocationPublicProjectionSchema.safeParse(
        (result.value as { readonly projection?: unknown }).projection,
      );
      return parsed.success
        ? { ok: true, value: { projection: parsed.data } }
        : failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Unknown projection 无效。");
    },

    async commitCompleted({ worker_lease, permit, response, usage }) {
      const document = await buildProviderResponseArtifactDocument({
        schema_version: "provider-response-artifact@1.0.0",
        invocation_id: response.invocation_id,
        output_text: response.output_text,
        tool_calls: response.tool_calls,
      });
      if (document.response_hash !== response.response_hash) {
        return failure("PROVIDER_RESPONSE_HASH_MISMATCH", "Provider response hash 不一致。");
      }
      const usageCandidate: ProviderInvocationUsageCandidate =
        usage.source === "UNAVAILABLE"
          ? unavailableUsage("PROVIDER_DID_NOT_REPORT_USAGE")
          : {
              schema_version: "provider-invocation-usage-candidate@1.0.0",
              availability: "AVAILABLE",
              source: usage.source,
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              total_tokens: usage.input_tokens + usage.output_tokens,
              tool_calls: usage.tool_calls,
              provider_call_count: 1,
              capacity_status: "WITHIN_LIMIT",
              unavailable_reason: null,
            };
      const result = await store.commitCompleted(capability, worker_lease, {
        schema_version: "provider-invocation-commit-completed@1.0.0",
        ...transition(permit),
        response_document: document,
        outcome: {
          schema_version: "provider-invocation-completed-candidate@1.0.0",
          ...outcomeTransition(permit),
          status: "COMPLETED",
          reason_code: null,
          response_hash: document.response_hash,
          delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
          transition_from: "RESPONSE_OBSERVED",
          recovery_action: "NONE",
          provider_call_count: 1,
          retry_after_ms: null,
          reconciliation_of: null,
        },
        usage: usageCandidate,
      });
      if (result.ok === false) return result;
      const parsed = providerInvocationPublicProjectionSchema.safeParse(
        (result.value as { readonly projection?: unknown }).projection,
      );
      return parsed.success
        ? { ok: true, value: { projection: parsed.data } }
        : failure("PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID", "Completed projection 无效。");
    },
  };
  const responseArtifacts: ProtectedProviderResponseStore = {
    async load({ permit, reference }) {
      const result = await store.loadResponse(capability, {
        schema_version: "provider-response-artifact-load@1.0.0",
        scope: permit.scope,
        run_id: permit.run_id,
        invocation_id: permit.invocation_id,
        reference,
      });
      if (result.ok === false) return result;
      const parsed = loadProviderResponseArtifactResultSchema.safeParse(result.value);
      if (!parsed.success) {
        return failure("PROVIDER_RESPONSE_ARTIFACT_MISMATCH", "Response Artifact load 无效。");
      }
      return {
        ok: true,
        value: {
          output_text: parsed.data.document.output_text,
          tool_calls: parsed.data.document.tool_calls,
          response_hash: parsed.data.document.response_hash,
        },
      };
    },
  };
  return Object.freeze({
    invocation_store: invocationStore,
    response_artifacts: responseArtifacts,
  });
}
