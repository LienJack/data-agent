import {
  authorizeCommittedProviderDispatchPermit,
  buildCommittedProviderDispatchPermitReceipt,
  buildProviderDispatchEnvelopeCandidate,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createPersistedModelProviderTransport,
  normalizeAuditedProviderTerminalEvent,
} from "../../src/providers/persisted-model-provider-transport.js";

const id = (suffix: string) => `86000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = {
  app_id: id("1"),
  tenant_id: id("2"),
  environment: "test",
  workspace_id: id("2"),
  principal_id: id("3"),
} as const;

async function authority() {
  const envelope = await buildProviderDispatchEnvelopeCandidate({
    schema_version: "provider-dispatch-envelope@1.0.0",
    invocation_id: id("4"),
    idempotency_key: "u3-transport-0001",
    scope,
    run_id: id("5"),
    logical_call_id: id("4"),
    task_ref: {
      artifact_id: id("6"),
      artifact_type: "ResearchBrief",
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      run_id: id("5"),
      revision: 1,
      content_hash: hash("a"),
    },
    effective_config_ref: { config_id: id("7"), config_revision: 1, config_hash: hash("b") },
    context_receipt_ref: { receipt_id: id("8"), receipt_hash: hash("c") },
    lease: {
      outbox_id: id("9"),
      command_id: id("10"),
      attempt_id: id("11"),
      attempt_no: 1,
      worker_id: "worker-u3",
      lease_token: 2,
      worker_fence: 3,
    },
    model_profile: {
      profile_id: id("12"),
      model_config_version: 7,
      resource_hash: hash("d"),
      profile_version: "model-profile@7",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      adapter_version: "model-provider-adapter@1.0.0",
    },
    certification: {
      receipt_ref: {
        artifact_id: id("13"),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id("14"),
        revision: 1,
        content_hash: hash("e"),
      },
      execution_profile_hash: hash("f"),
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      certified_context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 8_000,
        max_output_tokens: 2_000,
      },
    },
    connection: {
      kind: "SYSTEM_DEPLOYMENT",
      deployment_id: id("15"),
      deployment_revision: 1,
      deployment_hash: hash("1"),
    },
    request_policy: {
      response_schema_version: "answer@1.0.0",
      tool_allowlist: [],
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 1_000,
        max_output_tokens: 200,
        max_tool_calls: 0,
        provider_call_limit: 1,
      },
    },
    projection: {
      projection_version: "agent-data-projection@2.0.0",
      receipt_ref: {
        artifact_id: id("4"),
        artifact_type: "AgentDataProjectionReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id("5"),
        revision: 1,
        content_hash: hash("2"),
      },
      payload_hash: hash("3"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 10,
      reserved_output_tokens: 200,
      effective_context_ceiling_tokens: 8_000,
      effective_output_ceiling_tokens: 2_000,
      capacity_status: "WITHIN_LIMIT",
      taint_hash: hash("4"),
    },
  });
  const permitReceipt = await buildCommittedProviderDispatchPermitReceipt({
    schema_version: "provider-dispatch-permit@1.0.0",
    permit_id: id("16"),
    intent_id: id("17"),
    invocation_id: envelope.invocation_id,
    scope,
    run_id: envelope.run_id,
    dispatch_hash: envelope.dispatch_hash,
    context_receipt_ref: envelope.context_receipt_ref,
    lease: envelope.lease,
    attempt_id: envelope.lease.attempt_id,
    worker_fence: envelope.lease.worker_fence,
    committed_at: "2026-08-16T00:00:00.000Z",
  });
  const permit = await authorizeCommittedProviderDispatchPermit(
    {
      scope,
      run_id: envelope.run_id,
      invocation_id: envelope.invocation_id,
      dispatch_hash: envelope.dispatch_hash,
    },
    { resolve_committed: async () => permitReceipt },
  );
  return { envelope, permit };
}

describe("persisted ModelProvider transport", () => {
  it("maps bridge 429 and missing-credential events to the stable U3 terminal vocabulary", () => {
    const base = {
      schema_version: "model-provider-request@1.0.0",
      request_id: id("4"),
      attempt_id: id("11"),
      scope: {
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
      },
      run_id: id("5"),
      provider: "deepseek" as const,
      profile_id: id("12"),
      profile_version: "model-profile@7",
      model_id: "deepseek-v4-flash",
      sequence: 1,
      observed_at: "2026-08-16T00:00:01.000Z",
    };

    expect(
      normalizeAuditedProviderTerminalEvent({
        ...base,
        event_type: "THROTTLED",
        reason_code: "MODEL_PROVIDER_THROTTLED",
        retryable: true,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
        retry_after_ms: 2_500,
      }),
    ).toEqual({
      kind: "THROTTLED",
      reason_code: "PROVIDER_THROTTLED",
      retryable: true,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      retry_after_ms: 2_500,
    });
    expect(
      normalizeAuditedProviderTerminalEvent({
        ...base,
        event_type: "FAILED",
        reason_code: "MODEL_RESPONSE_EMPTY",
        retryable: false,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      }),
    ).toEqual({
      kind: "FAILED",
      reason_code: "PROVIDER_PROTOCOL_VIOLATION",
      retryable: false,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    });
    expect(
      normalizeAuditedProviderTerminalEvent({
        ...base,
        event_type: "FAILED",
        reason_code: "MODEL_PROVIDER_CREDENTIAL_UNAVAILABLE",
        retryable: false,
        delivery_certainty: "NOT_DISPATCHED",
      }),
    ).toEqual({
      kind: "FAILED",
      reason_code: "PROVIDER_CREDENTIAL_UNAVAILABLE",
      retryable: false,
      delivery_certainty: "NOT_DISPATCHED",
    });
  });

  it("does not create a Provider port when the committed projection resolver returns null", async () => {
    const create = vi.fn();
    const transport = createPersistedModelProviderTransport({
      model_provider_factory: { create },
      profile_resolver: async () => null,
    });
    const { envelope, permit } = await authority();
    const request = {
      schema_version: "model-provider-request@1.0.0",
      request_id: envelope.invocation_id,
      attempt_id: envelope.lease.attempt_id,
      scope: {
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
      },
      run_id: envelope.run_id,
      provider: "deepseek",
      profile_id: envelope.model_profile.profile_id,
      profile_version: envelope.model_profile.profile_version,
      model_id: envelope.model_profile.model_id,
      task_ref: envelope.task_ref,
      context_refs: [],
      messages: [{ role: "user", content: "private" }],
      tool_allowlist: [],
      response_schema_version: envelope.request_policy.response_schema_version,
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 1_000,
        max_output_tokens: 200,
        max_tool_calls: 0,
      },
    } as const;
    const signal = new AbortController().signal;
    const prepared = await transport.prepare({ envelope, payload: request, signal });
    if (!prepared.ok) throw new Error(prepared.error.code);

    const result = await transport.dispatch({
      signal,
      envelope,
      permit,
      prepared: prepared.value.prepared,
      projection_resolver: { resolve_committed: async () => null },
      mark_dispatched: vi.fn(),
    });

    expect(result).toMatchObject({
      kind: "FAILED",
      reason_code: "PROVIDER_LOCAL_PREPARATION_FAILED",
      delivery_certainty: "NOT_DISPATCHED",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
