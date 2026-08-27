import { describe, expect, it } from "vitest";
import { artifactReferenceIdentity } from "../src/artifacts/envelope.js";
import {
  buildAgentDataProjectionReceiptV2Candidate,
  verifyAgentDataProjectionReceiptV2Candidate,
} from "../src/artifacts/research/system.js";
import { knownArtifactTypeSchema } from "../src/artifacts/types.js";
import {
  authorizePersistedModelProviderInvocation,
  computeModelProviderPayloadHash,
  createDirectModelProviderInvocation,
  isAuthoritativeModelProviderInvocation,
  verifyPersistedModelProviderProjectionClosure,
} from "../src/ports/model-provider.js";
import {
  authorizeAvailableExecutionModelProfile,
  buildModelExecutionCertificationClaims,
  computeModelExecutionProfileHash,
  configureAvailableModelProfile,
  isAvailableModelProfile,
  modelExecutionProfileSchema,
  projectModelExecutionProfileSnapshot,
} from "../src/providers/index.js";
import {
  authorizeCommittedProviderDispatchPermit,
  buildCommittedProviderDispatchPermitReceipt,
  buildProviderDispatchEnvelopeCandidate,
  buildProviderInvocationDispatchMarkerReceipt,
  buildProviderInvocationIntentReceipt,
  buildProviderInvocationOutcomeReceipt,
  buildProviderInvocationResponseObservedMarkerReceipt,
  buildProviderInvocationUsageReceipt,
  buildProviderResponseArtifactDocument,
  buildProviderStaleMarkerRecoveryReceiptDocument,
  buildProviderTaskArtifactDocument,
  commitProviderTaskArtifactCommandSchema,
  computeProviderStaleMarkerInactiveObservationHash,
  decideProviderInvocationTakeover,
  decideStaleProviderMarkerRecoveryAction,
  isAuthoritativeCommittedProviderDispatchPermit,
  loadProviderInvocationCommandSchema,
  loadProviderInvocationResultSchema,
  loadProviderTaskArtifactResultSchema,
  projectProviderInvocationStableSpec,
  providerInvocationInternalStateSchema,
  providerInvocationOutcomeCandidateSchema,
  providerInvocationReasonCodeSchema,
  providerInvocationRecoveryCapabilitiesSchema,
  providerInvocationUsageReceiptCandidateSchema,
  reconcileProviderInvocationUnknownCommandSchema,
  recoverStaleProviderInvocationMarkerCommandSchema,
  verifyBeginProviderInvocationResult,
  verifyCommitProviderInvocationCompletedResult,
  verifyCommitProviderTaskArtifactResult,
  verifyLoadProviderInvocationResult,
  verifyMarkProviderInvocationResponseObservedResult,
  verifyProviderDispatchEnvelopeCandidate,
  verifyProviderInvocationResponseObservedMarkerReceipt,
  verifyRecoverStaleProviderInvocationMarkerResult,
} from "../src/providers/provider-invocation.js";

const ids = {
  app: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  principal: "10000000-0000-4000-8000-000000000003",
  run: "10000000-0000-4000-8000-000000000004",
  invocation: "10000000-0000-4000-8000-000000000005",
  logicalCall: "10000000-0000-4000-8000-000000000006",
  task: "10000000-0000-4000-8000-000000000007",
  config: "10000000-0000-4000-8000-000000000008",
  context: "10000000-0000-4000-8000-000000000009",
  outbox: "10000000-0000-4000-8000-000000000010",
  command: "10000000-0000-4000-8000-000000000011",
  attempt: "10000000-0000-4000-8000-000000000012",
  profile: "10000000-0000-4000-8000-000000000013",
  certification: "10000000-0000-4000-8000-000000000014",
  deployment: "10000000-0000-4000-8000-000000000015",
  intent: "10000000-0000-4000-8000-000000000016",
  permit: "10000000-0000-4000-8000-000000000017",
  outcome: "10000000-0000-4000-8000-000000000018",
  usage: "10000000-0000-4000-8000-000000000019",
  response: "10000000-0000-4000-8000-000000000020",
  projection: "10000000-0000-4000-8000-000000000021",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "test",
  workspace_id: ids.workspace,
  principal_id: ids.principal,
} as const;

function envelopeDraft() {
  return {
    schema_version: "provider-dispatch-envelope@1.0.0",
    invocation_id: ids.invocation,
    idempotency_key: "provider-invocation-0001",
    scope,
    run_id: ids.run,
    logical_call_id: ids.logicalCall,
    task_ref: {
      artifact_id: ids.task,
      artifact_type: "ResearchBrief",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hash("a"),
    },
    effective_config_ref: { config_id: ids.config, config_revision: 2, config_hash: hash("b") },
    context_receipt_ref: { receipt_id: ids.context, receipt_hash: hash("c") },
    lease: {
      outbox_id: ids.outbox,
      command_id: ids.command,
      attempt_id: ids.attempt,
      attempt_no: 1,
      worker_id: "worker-u3",
      lease_token: 3,
      worker_fence: 4,
    },
    model_profile: {
      profile_id: ids.profile,
      model_config_version: 7,
      resource_hash: hash("d"),
      profile_version: "model-profile@7",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      adapter_version: "model-provider-adapter@1.0.0",
    },
    certification: {
      receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
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
      deployment_id: ids.deployment,
      deployment_revision: 3,
      deployment_hash: hash("1"),
    },
    request_policy: {
      response_schema_version: "text2sql-answer@1.0.0",
      tool_allowlist: ["semantic-query@1.0.0"],
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 8_000,
        max_output_tokens: 2_000,
        max_tool_calls: 2,
        provider_call_limit: 1,
      },
    },
    projection: {
      projection_version: "agent-data-projection@2.0.0",
      receipt_ref: {
        artifact_id: ids.invocation,
        artifact_type: "AgentDataProjectionReceipt",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: hash("4"),
      },
      payload_hash: hash("2"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 321,
      reserved_output_tokens: 2_000,
      effective_context_ceiling_tokens: 8_000,
      effective_output_ceiling_tokens: 2_000,
      capacity_status: "WITHIN_LIMIT",
      taint_hash: hash("3"),
    },
  } as const;
}

async function committedAttemptFixture() {
  const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
  const intent = await buildProviderInvocationIntentReceipt({
    schema_version: "provider-invocation-intent@1.0.0",
    intent_id: ids.intent,
    invocation_spec: projectProviderInvocationStableSpec(envelope),
    invocation_key_hash: envelope.invocation_key_hash,
    state: "INTENT_COMMITTED",
    committed_at: "2026-08-16T00:00:00.000Z",
  });
  const permit = await buildCommittedProviderDispatchPermitReceipt({
    schema_version: "provider-dispatch-permit@1.0.0",
    permit_id: ids.permit,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    dispatch_hash: envelope.dispatch_hash,
    context_receipt_ref: envelope.context_receipt_ref,
    lease: envelope.lease,
    attempt_id: ids.attempt,
    worker_fence: envelope.lease.worker_fence,
    committed_at: "2026-08-16T00:00:00.000Z",
  });
  const marker = await buildProviderInvocationDispatchMarkerReceipt({
    schema_version: "provider-invocation-dispatch-marker@1.0.0",
    marker_id: ids.logicalCall,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    dispatch_hash: envelope.dispatch_hash,
    state: "DISPATCH_MARKED",
    dispatch_marked_at: "2026-08-16T00:00:01.000Z",
  });
  const startedProjection = {
    schema_version: "provider-invocation-public@1.0.0",
    invocation_id: ids.invocation,
    run_id: ids.run,
    provider: "deepseek",
    model_profile_id: ids.profile,
    model_config_version: 7,
    profile_version: "model-profile@7",
    model_id: "deepseek-v4-flash",
    certification_receipt_ref: envelope.certification.receipt_ref,
    attempt_id: ids.attempt,
    attempt_no: 1,
    recovery_action: null,
    status: "STARTED",
    reason_code: null,
    dispatch_hash: envelope.dispatch_hash,
    response_hash: null,
    usage_availability: null,
    usage_source: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
    provider_call_count: 1,
    retry_after_ms: null,
    latency_ms: null,
    receipt_deep_link: `/w/${ids.workspace}/runs/${ids.run}/provider-invocations/${ids.invocation}`,
    terminal_at: null,
  } as const;
  return { envelope, intent, permit, marker, startedProjection };
}

async function completedTerminalFixture() {
  const authority = await committedAttemptFixture();
  const response = await buildProviderResponseArtifactDocument({
    schema_version: "provider-response-artifact@1.0.0",
    invocation_id: ids.invocation,
    output_text: "protected replay",
    tool_calls: [],
  });
  const responseArtifactRef = {
    artifact_id: ids.response,
    artifact_type: "ProviderResponseArtifact",
    app_id: ids.app,
    tenant_id: ids.workspace,
    environment: "test",
    run_id: ids.run,
    revision: 1,
    content_hash: response.content_hash,
  } as const;
  const terminalAt = "2026-08-16T00:00:02.000Z";
  const outcome = await buildProviderInvocationOutcomeReceipt({
    schema_version: "provider-invocation-outcome@1.0.0",
    outcome_id: ids.outcome,
    candidate: {
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: authority.envelope.dispatch_hash,
      status: "COMPLETED",
      reason_code: null,
      response_artifact_ref: responseArtifactRef,
      response_hash: response.response_hash,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: null,
    },
    dispatch_marked_at: authority.marker.dispatch_marked_at,
    terminal_at: terminalAt,
    latency_ms: 1_000,
  });
  const usage = await buildProviderInvocationUsageReceipt({
    schema_version: "provider-invocation-usage@1.0.0",
    usage_receipt_id: ids.usage,
    outcome_id: ids.outcome,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    observed_at: terminalAt,
    availability: "AVAILABLE",
    source: "PROVIDER_REPORTED",
    input_tokens: 3,
    output_tokens: 2,
    total_tokens: 5,
    tool_calls: 0,
    provider_call_count: 1,
    capacity_status: "WITHIN_LIMIT",
    unavailable_reason: null,
  });
  const projection = {
    ...authority.startedProjection,
    recovery_action: "NONE",
    status: "COMPLETED",
    response_hash: response.response_hash,
    usage_availability: "AVAILABLE",
    usage_source: "PROVIDER_REPORTED",
    input_tokens: 3,
    output_tokens: 2,
    total_tokens: 5,
    tool_calls: 0,
    retry_after_ms: null,
    latency_ms: 1_000,
    terminal_at: terminalAt,
  } as const;
  return { ...authority, outcome, usage, projection, responseArtifactRef };
}

async function nonCompletedTerminalFixture(status: "FAILED" | "THROTTLED" | "OUTCOME_UNKNOWN") {
  const authority = await committedAttemptFixture();
  const terminalAt = "2026-08-16T00:00:02.000Z";
  const reasonCode =
    status === "FAILED"
      ? "PROVIDER_INVOCATION_FAILED"
      : status === "THROTTLED"
        ? "PROVIDER_THROTTLED"
        : "PROVIDER_INVOCATION_OUTCOME_UNKNOWN";
  const recoveryAction =
    status === "FAILED"
      ? "NONE"
      : status === "THROTTLED"
        ? "SAFE_RETRY"
        : "RECONCILIATION_REQUIRED";
  const outcome = await buildProviderInvocationOutcomeReceipt({
    schema_version: "provider-invocation-outcome@1.0.0",
    outcome_id: ids.outcome,
    candidate: {
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: authority.envelope.dispatch_hash,
      status,
      reason_code: reasonCode,
      response_artifact_ref: null,
      response_hash: null,
      delivery_certainty:
        status === "OUTCOME_UNKNOWN" ? "DISPATCHED_OUTCOME_UNKNOWN" : "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: recoveryAction,
      provider_call_count: 1,
      retry_after_ms: status === "THROTTLED" ? 2_500 : null,
      reconciliation_of: null,
    },
    dispatch_marked_at: authority.marker.dispatch_marked_at,
    terminal_at: terminalAt,
    latency_ms: 1_000,
  });
  const unavailableReason =
    status === "OUTCOME_UNKNOWN"
      ? "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
      : "PROVIDER_DID_NOT_REPORT_USAGE";
  const usage = await buildProviderInvocationUsageReceipt({
    schema_version: "provider-invocation-usage@1.0.0",
    usage_receipt_id: ids.usage,
    outcome_id: ids.outcome,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    observed_at: terminalAt,
    availability: "UNAVAILABLE",
    source: "UNAVAILABLE",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
    provider_call_count: 1,
    capacity_status: "UNAVAILABLE",
    unavailable_reason: unavailableReason,
  });
  const projection = {
    ...authority.startedProjection,
    recovery_action: recoveryAction,
    status,
    reason_code: reasonCode,
    response_hash: null,
    usage_availability: "UNAVAILABLE",
    usage_source: "UNAVAILABLE",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
    retry_after_ms: status === "THROTTLED" ? 2_500 : null,
    latency_ms: 1_000,
    terminal_at: terminalAt,
  } as const;
  const replayAction =
    status === "FAILED"
      ? "NEW_LOGICAL_INVOCATION_REQUIRED"
      : status === "THROTTLED"
        ? "NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY"
        : "RECONCILIATION_REQUIRED";
  return { ...authority, outcome, usage, projection, replayAction };
}

async function availableExecutionProfileFixture(input: {
  readonly profile_id: string;
  readonly certification_id: string;
  readonly deployment_id: string;
  readonly max_context_tokens?: number;
}) {
  const certificationReference = {
    artifact_id: input.certification_id,
    artifact_type: "ModelCertificationReceipt",
    app_id: ids.app,
    tenant_id: ids.workspace,
    environment: "test",
    run_id: ids.context,
    revision: 1,
    content_hash: hash("0"),
  } as const;
  const profileDraft = modelExecutionProfileSchema.parse({
    profile_id: input.profile_id,
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    provider: "deepseek",
    model_id: "deepseek-v4-flash",
    model_config_version: 7,
    profile_version: "model-profile@7",
    adapter_version: "model-provider-adapter@1.0.0",
    recovery_capabilities: ["INVOCATION_RECONCILIATION"],
    connection: {
      kind: "SYSTEM_DEPLOYMENT",
      deployment_id: input.deployment_id,
      deployment_revision: 3,
      deployment_hash: hash("1"),
    },
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: {
      context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: input.max_context_tokens ?? 8_000,
        max_output_tokens: 2_000,
      },
      region_privacy: { verification_status: "UNVERIFIED" },
      fallback_compatibility: { verification_status: "UNVERIFIED" },
    },
    certification_status: "AVAILABLE",
    certification_receipt_ref: certificationReference,
    certified_model_id: "deepseek-v4-flash",
  });
  const executionProfileHash = await computeModelExecutionProfileHash(profileDraft);
  const claims = await buildModelExecutionCertificationClaims({
    schema_version: "model-execution-certification@1.0.0",
    receipt_ref: {
      artifact_id: input.certification_id,
      artifact_type: "ModelCertificationReceipt",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.context,
      revision: 1,
    },
    profile_id: input.profile_id,
    model_config_version: 7,
    provider: "deepseek",
    model_id: "deepseek-v4-flash",
    profile_version: "model-profile@7",
    adapter_version: "model-provider-adapter@1.0.0",
    execution_profile_hash: executionProfileHash,
    execution_profile_snapshot: projectModelExecutionProfileSnapshot(profileDraft),
    recovery_capabilities: ["INVOCATION_RECONCILIATION"],
    connection: profileDraft.connection,
    certification_basis: { kind: "CREDENTIAL_SMOKE", probe_hash: hash("9") },
    verdict: "PASS",
  });
  const profile = await authorizeAvailableExecutionModelProfile(
    { ...profileDraft, certification_receipt_ref: claims.receipt_ref },
    {
      resolve: async () => claims,
      verifyCommitted: async () => true,
    },
  );
  return { profile, executionProfileHash, claims };
}

async function persistedInvocationFixture() {
  const available = await availableExecutionProfileFixture({
    profile_id: ids.profile,
    certification_id: ids.certification,
    deployment_id: ids.deployment,
  });
  const draft = envelopeDraft();
  const request = {
    schema_version: "model-provider-request@1.0.0",
    request_id: ids.invocation,
    attempt_id: ids.attempt,
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    run_id: ids.run,
    provider: "deepseek",
    profile_id: ids.profile,
    profile_version: "model-profile@7",
    model_id: "deepseek-v4-flash",
    model_config_version: 7,
    execution_profile_hash: available.executionProfileHash,
    recovery_capabilities: ["INVOCATION_RECONCILIATION"],
    connection: available.profile.connection,
    token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
    trusted_input_token_upper_bound: 321,
    task_ref: draft.task_ref,
    context_refs: [],
    messages: [{ role: "user", content: "question" }],
    tool_allowlist: ["semantic-query@1.0.0"],
    response_schema_version: "text2sql-answer@1.0.0",
    budget: {
      timeout_ms: 30_000,
      max_input_tokens: 8_000,
      max_output_tokens: 2_000,
      max_tool_calls: 2,
    },
  } as const;
  const payloadHash = await computeModelProviderPayloadHash(request);
  const projectionReceipt = await buildAgentDataProjectionReceiptV2Candidate({
    artifact_type: "AgentDataProjectionReceipt",
    protocol_version: "agent-data-projection@2.0.0",
    receipt_id: ids.invocation,
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    run_id: ids.run,
    request_id: ids.invocation,
    principal_id: ids.principal,
    model_execution_profile_hash: available.executionProfileHash,
    input_refs: [draft.task_ref],
    approved_fields: ["question"],
    classification: "INTERNAL",
    payload_hash: payloadHash,
    token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
    trusted_input_token_upper_bound: 321,
    redaction: { count: 0, policy_version: "redaction@1.0.0" },
    dlp: { status: "PASS", policy_version: "dlp@1.0.0" },
    taint: { policy_version: "taint@1.0.0", taint_hash: hash("3") },
  });
  const envelope = await buildProviderDispatchEnvelopeCandidate({
    ...draft,
    certification: {
      receipt_ref: available.claims.receipt_ref,
      execution_profile_hash: available.executionProfileHash,
      recovery_capabilities: available.profile.recovery_capabilities,
      certified_context_window: available.profile.operational_constraints.context_window,
    },
    connection: available.profile.connection,
    projection: {
      ...draft.projection,
      receipt_ref: {
        ...draft.projection.receipt_ref,
        content_hash: projectionReceipt.receipt_hash,
      },
      payload_hash: payloadHash,
      taint_hash: projectionReceipt.taint.taint_hash,
    },
  });
  const permitReceipt = await buildCommittedProviderDispatchPermitReceipt({
    schema_version: "provider-dispatch-permit@1.0.0",
    permit_id: ids.permit,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
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
      run_id: ids.run,
      invocation_id: ids.invocation,
      dispatch_hash: envelope.dispatch_hash,
    },
    { resolve_committed: async () => permitReceipt },
  );
  return { available, request, projectionReceipt, envelope, permit };
}

describe("U3 provider invocation contracts", () => {
  it("admits a configured model profile without a certification receipt", () => {
    const profile = configureAvailableModelProfile({
      profile_id: ids.profile,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      profile_version: "model-profile@1",
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      certification_status: "CONFIGURED",
    });
    expect(isAvailableModelProfile(profile)).toBe(true);
    expect(profile.certification_receipt_ref).toBeUndefined();
  });

  it("creates a direct invocation without certification or a persisted permit", () => {
    const request = createDirectModelProviderInvocation({
      schema_version: "direct-model-request@1.0.0",
      request_id: ids.invocation,
      attempt_id: ids.attempt,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      provider: "deepseek",
      profile_id: ids.profile,
      profile_version: "model-profile@1",
      model_id: "deepseek-v4-flash",
      task_ref: {
        artifact_id: ids.task,
        artifact_type: "ProviderTaskArtifact",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: hash("1"),
      },
      context_refs: [],
      messages: [{ role: "user", content: "question" }],
      tool_allowlist: [],
      response_schema_version: "answer@1.0.0",
      sampling: { temperature: 0 },
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 8_000,
        max_output_tokens: 2_000,
        max_tool_calls: 0,
      },
    });
    expect(isAuthoritativeModelProviderInvocation(request)).toBe(true);
    expect(request.sampling).toEqual({ temperature: 0 });
    expect(request).not.toHaveProperty("certification_receipt_ref");
  });

  it("recognizes RESPONSE_OBSERVED as a durable internal state", () => {
    expect(providerInvocationInternalStateSchema.parse("RESPONSE_OBSERVED")).toBe(
      "RESPONSE_OBSERVED",
    );
  });

  it("hashes a raw-free RESPONSE_OBSERVED marker and rejects tampering", async () => {
    const authority = await committedAttemptFixture();
    const marker = await buildProviderInvocationResponseObservedMarkerReceipt({
      schema_version: "provider-invocation-response-observed-marker@1.0.0",
      marker_id: ids.projection,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: authority.envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
      state: "RESPONSE_OBSERVED",
      observation_kind: "COMPLETED",
      response_hash: hash("9"),
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      response_observed_at: "2026-08-16T00:00:01.500Z",
    });

    await expect(verifyProviderInvocationResponseObservedMarkerReceipt(marker)).resolves.toEqual(
      marker,
    );
    await expect(
      verifyProviderInvocationResponseObservedMarkerReceipt({
        ...marker,
        response_observed_at: "2026-08-16T00:00:01.600Z",
      }),
    ).rejects.toThrow("PROVIDER_INVOCATION_RESPONSE_OBSERVED_MARKER_HASH_MISMATCH");
    await expect(
      verifyProviderInvocationResponseObservedMarkerReceipt({
        ...marker,
        attempt_id: "10000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow("PROVIDER_INVOCATION_RESPONSE_OBSERVED_MARKER_HASH_MISMATCH");

    const command = {
      schema_version: "provider-invocation-mark-response-observed@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: authority.envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
      observation_kind: "COMPLETED",
      response_hash: hash("9"),
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    } as const;
    await expect(
      verifyMarkProviderInvocationResponseObservedResult(command, {
        schema_version: "provider-invocation-mark-response-observed-result@1.0.0",
        disposition: "CREATED",
        intent: authority.intent,
        permit: authority.permit,
        marker,
        projection: authority.startedProjection,
      }),
    ).resolves.toMatchObject({ marker });

    const { marker_hash: _markerHash, ...markerDraft } = marker;
    const substitutedAttemptMarker = await buildProviderInvocationResponseObservedMarkerReceipt({
      ...markerDraft,
      attempt_id: "10000000-0000-4000-8000-000000000099",
    });
    await expect(
      verifyMarkProviderInvocationResponseObservedResult(command, {
        schema_version: "provider-invocation-mark-response-observed-result@1.0.0",
        disposition: "CREATED",
        intent: authority.intent,
        permit: authority.permit,
        marker: substitutedAttemptMarker,
        projection: authority.startedProjection,
      }),
    ).rejects.toThrow();
  });
  it("accepts the frozen preflight reason codes used by rejected durable outcomes", () => {
    expect(
      [
        "PROVIDER_PROFILE_NOT_AVAILABLE",
        "PROVIDER_CERTIFICATION_REQUIRED",
        "PROVIDER_CONTEXT_WINDOW_UNVERIFIED",
        "PROVIDER_CONTEXT_LIMIT_EXCEEDED",
        "PROVIDER_OUTPUT_LIMIT_EXCEEDED",
        "PROVIDER_CALL_LIMIT_EXCEEDED",
        "PROVIDER_EGRESS_DENIED",
        "PROVIDER_DISPATCH_ENVELOPE_INVALID",
        "PROVIDER_CONTEXT_RECEIPT_MISMATCH",
        "PROVIDER_WORKER_LEASE_STALE",
      ].map((reason) => providerInvocationReasonCodeSchema.parse(reason)),
    ).toHaveLength(10);
    expect(() => providerInvocationReasonCodeSchema.parse("PROVIDER_CAPACITY_EXCEEDED")).toThrow();
  });

  it("parses a durable pre-dispatch rejection with the same stable reason in outcome and projection", async () => {
    const authority = await committedAttemptFixture();
    const terminalAt = "2026-08-16T00:00:01.000Z";
    const reasonCode = "PROVIDER_CONTEXT_LIMIT_EXCEEDED" as const;
    const outcome = await buildProviderInvocationOutcomeReceipt({
      schema_version: "provider-invocation-outcome@1.0.0",
      outcome_id: ids.outcome,
      candidate: {
        schema_version: "provider-invocation-outcome-candidate@1.0.0",
        intent_id: ids.intent,
        invocation_id: ids.invocation,
        scope,
        run_id: ids.run,
        dispatch_hash: authority.envelope.dispatch_hash,
        status: "FAILED",
        reason_code: reasonCode,
        response_artifact_ref: null,
        response_hash: null,
        delivery_certainty: "NOT_DISPATCHED",
        transition_from: "INTENT_COMMITTED",
        recovery_action: "NONE",
        provider_call_count: 0,
        retry_after_ms: null,
        reconciliation_of: null,
      },
      dispatch_marked_at: null,
      terminal_at: terminalAt,
      latency_ms: 0,
    });
    const usage = await buildProviderInvocationUsageReceipt({
      schema_version: "provider-invocation-usage@1.0.0",
      usage_receipt_id: ids.usage,
      outcome_id: ids.outcome,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      observed_at: terminalAt,
      availability: "NOT_APPLICABLE",
      source: "UNAVAILABLE",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      tool_calls: null,
      provider_call_count: 0,
      capacity_status: "NOT_APPLICABLE",
      unavailable_reason: "PROVIDER_NOT_DISPATCHED",
    });
    const projection = {
      ...authority.startedProjection,
      recovery_action: "NONE",
      status: "FAILED",
      reason_code: reasonCode,
      response_hash: null,
      usage_availability: "NOT_APPLICABLE",
      usage_source: "UNAVAILABLE",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      tool_calls: null,
      provider_call_count: 0,
      retry_after_ms: null,
      latency_ms: 0,
      terminal_at: terminalAt,
    } as const;

    await expect(
      verifyBeginProviderInvocationResult(
        { schema_version: "provider-invocation-begin@1.0.0", envelope: authority.envelope },
        {
          schema_version: "provider-invocation-begin-result@1.0.0",
          admission: "REJECTED",
          disposition: "CREATED",
          rejection_reason: reasonCode,
          intent: authority.intent,
          permit: null,
          outcome,
          usage,
          projection,
        },
      ),
    ).resolves.toMatchObject({ admission: "REJECTED", rejection_reason: reasonCode });
  });

  it("hashes an over-limit dispatch candidate so PostgreSQL can commit a zero-call rejection", async () => {
    const draft = envelopeDraft();
    const exceeded = await buildProviderDispatchEnvelopeCandidate({
      ...draft,
      request_policy: {
        ...draft.request_policy,
        budget: { ...draft.request_policy.budget, max_output_tokens: 1 },
      },
      projection: {
        ...draft.projection,
        trusted_input_token_upper_bound: 8_000,
        reserved_output_tokens: 1,
        effective_output_ceiling_tokens: 0,
        capacity_status: "EXCEEDED",
      },
    });

    await expect(verifyProviderDispatchEnvelopeCandidate(exceeded)).resolves.toEqual(exceeded);
    await expect(
      buildProviderDispatchEnvelopeCandidate({
        ...draft,
        request_policy: {
          ...draft.request_policy,
          budget: { ...draft.request_policy.budget, max_output_tokens: 1 },
        },
        projection: {
          ...draft.projection,
          trusted_input_token_upper_bound: 8_000,
          reserved_output_tokens: 1,
          effective_output_ceiling_tokens: 0,
          capacity_status: "WITHIN_LIMIT",
        },
      }),
    ).rejects.toThrow();
  });

  it("builds a pricing-free committed projection/taint receipt v2", async () => {
    const receipt = await buildAgentDataProjectionReceiptV2Candidate({
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@2.0.0",
      receipt_id: ids.invocation,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      request_id: ids.invocation,
      principal_id: ids.principal,
      model_execution_profile_hash: hash("f"),
      input_refs: [envelopeDraft().task_ref],
      approved_fields: ["question", "semantic_context"],
      classification: "INTERNAL",
      payload_hash: hash("2"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 321,
      redaction: { count: 0, policy_version: "redaction@1.0.0" },
      dlp: { status: "PASS", policy_version: "dlp@1.0.0" },
      taint: { policy_version: "taint@1.0.0", taint_hash: hash("3") },
    });
    await expect(verifyAgentDataProjectionReceiptV2Candidate(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyAgentDataProjectionReceiptV2Candidate({
        ...receipt,
        payload_hash: hash("8"),
      }),
    ).rejects.toThrow("AGENT_DATA_PROJECTION_RECEIPT_HASH_MISMATCH");
    expect(JSON.stringify(receipt)).not.toMatch(/pricing|cost|billing|reservation/i);
  });

  it("uses only the deterministic input-token upper-bound field in U3 receipts", async () => {
    const draft = {
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@2.0.0",
      receipt_id: ids.invocation,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      request_id: ids.invocation,
      principal_id: ids.principal,
      model_execution_profile_hash: hash("f"),
      input_refs: [envelopeDraft().task_ref],
      approved_fields: ["question"],
      classification: "INTERNAL",
      payload_hash: hash("2"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 321,
      redaction: { count: 0, policy_version: "redaction@1.0.0" },
      dlp: { status: "PASS", policy_version: "dlp@1.0.0" },
      taint: { policy_version: "taint@1.0.0", taint_hash: hash("3") },
    } as const;
    await expect(buildAgentDataProjectionReceiptV2Candidate(draft)).resolves.toMatchObject({
      trusted_input_token_upper_bound: 321,
    });
    await expect(
      buildAgentDataProjectionReceiptV2Candidate({
        ...draft,
        trusted_actual_input_tokens: 321,
      }),
    ).rejects.toThrow();
  });

  it("accepts a task ref that is not lexically first while rejecting duplicate request refs", async () => {
    const draft = envelopeDraft();
    const lowerContext = {
      ...draft.task_ref,
      artifact_id: ids.invocation,
      artifact_type: "QuestionFrame" as const,
      content_hash: hash("5"),
    };
    const higherContext = {
      ...draft.task_ref,
      artifact_id: ids.context,
      artifact_type: "SemanticSourceBundle" as const,
      content_hash: hash("9"),
    };
    const inputRefs = [lowerContext, draft.task_ref, higherContext].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    );
    const receipt = await buildAgentDataProjectionReceiptV2Candidate({
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@2.0.0",
      receipt_id: ids.invocation,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      request_id: ids.invocation,
      principal_id: ids.principal,
      model_execution_profile_hash: hash("f"),
      input_refs: inputRefs,
      approved_fields: ["question"],
      classification: "INTERNAL",
      payload_hash: hash("2"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 321,
      redaction: { count: 0, policy_version: "redaction@1.0.0" },
      dlp: { status: "PASS", policy_version: "dlp@1.0.0" },
      taint: { policy_version: "taint@1.0.0", taint_hash: hash("3") },
    });
    const request = {
      schema_version: "model-provider-request@1.0.0",
      request_id: ids.invocation,
      attempt_id: ids.attempt,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      provider: "deepseek",
      profile_id: ids.profile,
      profile_version: "model-profile@7",
      model_id: "deepseek-v4-flash",
      task_ref: draft.task_ref,
      context_refs: [higherContext, lowerContext],
      messages: [{ role: "user", content: "question" }],
      tool_allowlist: [],
      response_schema_version: "answer@1.0.0",
      budget: {
        timeout_ms: 1_000,
        max_input_tokens: 1_000,
        max_output_tokens: 100,
        max_tool_calls: 0,
      },
    } as const;
    const projectionReference = {
      ...envelopeDraft().projection.receipt_ref,
      content_hash: receipt.receipt_hash,
    };
    const committedResolver = {
      resolve_committed: async (reference: typeof projectionReference) =>
        artifactReferenceIdentity(reference) === artifactReferenceIdentity(projectionReference)
          ? receipt
          : null,
    };
    await expect(
      verifyPersistedModelProviderProjectionClosure(
        request,
        projectionReference,
        committedResolver,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifyPersistedModelProviderProjectionClosure(request, projectionReference, receipt as never),
    ).rejects.toThrow("committed projection resolver");
    await expect(
      verifyPersistedModelProviderProjectionClosure(
        {
          ...request,
          context_refs: [higherContext, lowerContext, draft.task_ref],
        },
        projectionReference,
        committedResolver,
      ),
    ).rejects.toThrow("完整、唯一且规范闭合");
  });

  it("rejects an independently authorized execution profile substituted by the persisted resolver", async () => {
    const fixture = await persistedInvocationFixture();
    const substituted = await availableExecutionProfileFixture({
      profile_id: ids.response,
      certification_id: ids.projection,
      deployment_id: ids.logicalCall,
      max_context_tokens: 9_000,
    });
    const projectionResolver = {
      resolve_committed: async () => fixture.projectionReceipt,
    };

    await expect(
      authorizePersistedModelProviderInvocation(
        fixture.request,
        fixture.envelope,
        projectionResolver,
        fixture.permit,
        async () => fixture.available.profile,
      ),
    ).resolves.toBeDefined();
    await expect(
      authorizePersistedModelProviderInvocation(
        fixture.request,
        fixture.envelope,
        projectionResolver,
        fixture.permit,
        async () => substituted.profile,
      ),
    ).rejects.toThrow("PROVIDER_TRANSPORT_PROFILE_IDENTITY_MISMATCH");
  });

  it("hashes the complete canonical dispatch envelope and rejects tampering", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    await expect(verifyProviderDispatchEnvelopeCandidate(envelope)).resolves.toEqual(envelope);
    await expect(
      verifyProviderDispatchEnvelopeCandidate({
        ...envelope,
        model_profile: { ...envelope.model_profile, resource_hash: hash("0") },
      }),
    ).rejects.toThrow("PROVIDER_INVOCATION_KEY_HASH_MISMATCH");
    await expect(
      verifyProviderDispatchEnvelopeCandidate({
        ...envelope,
        lease: { ...envelope.lease, worker_fence: 99 },
      }),
    ).rejects.toThrow("PROVIDER_DISPATCH_HASH_MISMATCH");
  });

  it("keeps invocation identity stable across lease takeover while dispatch hash changes", async () => {
    const first = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const takeover = await buildProviderDispatchEnvelopeCandidate({
      ...envelopeDraft(),
      context_receipt_ref: {
        receipt_id: ids.permit,
        receipt_hash: hash("7"),
      },
      lease: {
        ...envelopeDraft().lease,
        attempt_id: ids.permit,
        attempt_no: 2,
        lease_token: 4,
        worker_fence: 5,
      },
    });
    expect(takeover.invocation_key_hash).toBe(first.invocation_key_hash);
    expect(takeover.dispatch_hash).not.toBe(first.dispatch_hash);
    const changedProjection = await buildProviderDispatchEnvelopeCandidate({
      ...envelopeDraft(),
      projection: {
        ...envelopeDraft().projection,
        receipt_ref: {
          ...envelopeDraft().projection.receipt_ref,
          content_hash: hash("6"),
        },
        payload_hash: hash("7"),
        taint_hash: hash("8"),
      },
    });
    expect(changedProjection.invocation_key_hash).not.toBe(first.invocation_key_hash);
  });

  it("replays a completed stable intent through its original terminal permit without authorizing the takeover permit", async () => {
    const terminal = await completedTerminalFixture();
    const takeoverEnvelope = await buildProviderDispatchEnvelopeCandidate({
      ...envelopeDraft(),
      context_receipt_ref: { receipt_id: ids.response, receipt_hash: hash("7") },
      lease: {
        ...envelopeDraft().lease,
        attempt_id: ids.response,
        attempt_no: 2,
        lease_token: 5,
        worker_fence: 6,
      },
    });
    const command = {
      schema_version: "provider-invocation-begin@1.0.0",
      envelope: takeoverEnvelope,
    } as const;
    const replay = {
      schema_version: "provider-invocation-begin-result@1.0.0",
      admission: "TERMINAL_REPLAY",
      disposition: "REPLAYED",
      replay_action: "RETURN_RECORDED",
      intent: terminal.intent,
      original_permit: terminal.permit,
      outcome: terminal.outcome,
      usage: terminal.usage,
      projection: terminal.projection,
      response_artifact_ref: terminal.responseArtifactRef,
    } as const;

    await expect(verifyBeginProviderInvocationResult(command, replay)).resolves.toEqual(replay);
    await expect(
      verifyBeginProviderInvocationResult(command, {
        ...replay,
        replay_action: "NEW_LOGICAL_INVOCATION_REQUIRED",
      }),
    ).rejects.toThrow();
    await expect(
      verifyBeginProviderInvocationResult(command, {
        ...replay,
        response_artifact_ref: null,
      }),
    ).rejects.toThrow();

    const differentStableIntent = await buildProviderDispatchEnvelopeCandidate({
      ...envelopeDraft(),
      logical_call_id: ids.response,
    });
    await expect(
      verifyBeginProviderInvocationResult({ ...command, envelope: differentStableIntent }, replay),
    ).rejects.toThrow("PROVIDER_INVOCATION_BEGIN_INTENT_MISMATCH");
  });

  it.each(["FAILED", "THROTTLED", "OUTCOME_UNKNOWN"] as const)(
    "maps recorded %s to its only safe terminal replay action",
    async (status) => {
      const terminal = await nonCompletedTerminalFixture(status);
      const takeoverEnvelope = await buildProviderDispatchEnvelopeCandidate({
        ...envelopeDraft(),
        context_receipt_ref: { receipt_id: ids.response, receipt_hash: hash("7") },
        lease: {
          ...envelopeDraft().lease,
          attempt_id: ids.response,
          attempt_no: 2,
          lease_token: 5,
          worker_fence: 6,
        },
      });
      const result = {
        schema_version: "provider-invocation-begin-result@1.0.0",
        admission: "TERMINAL_REPLAY",
        disposition: "REPLAYED",
        replay_action: terminal.replayAction,
        intent: terminal.intent,
        original_permit: terminal.permit,
        outcome: terminal.outcome,
        usage: terminal.usage,
        projection: terminal.projection,
        response_artifact_ref: null,
      } as const;

      await expect(
        verifyBeginProviderInvocationResult(
          { schema_version: "provider-invocation-begin@1.0.0", envelope: takeoverEnvelope },
          result,
        ),
      ).resolves.toEqual(result);
      await expect(
        verifyBeginProviderInvocationResult(
          { schema_version: "provider-invocation-begin@1.0.0", envelope: takeoverEnvelope },
          { ...result, replay_action: "RETURN_RECORDED" },
        ),
      ).rejects.toThrow();
    },
  );

  it("requires canonical recovery capabilities and allows certification from a separate same-scope run", async () => {
    expect(
      providerInvocationRecoveryCapabilitiesSchema.safeParse([
        "AT_LEAST_ONCE_ONLY",
        "INVOCATION_STATUS_QUERY",
      ]).success,
    ).toBe(false);
    expect(
      providerInvocationRecoveryCapabilitiesSchema.safeParse([
        "IDEMPOTENT_REQUEST",
        "INVOCATION_STATUS_QUERY",
      ]).success,
    ).toBe(true);
    const draft = envelopeDraft();
    await expect(
      buildProviderDispatchEnvelopeCandidate({
        ...draft,
        certification: {
          ...draft.certification,
          receipt_ref: { ...draft.certification.receipt_ref, run_id: ids.intent },
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      buildProviderDispatchEnvelopeCandidate({
        ...draft,
        certification: {
          ...draft.certification,
          receipt_ref: { ...draft.certification.receipt_ref, tenant_id: ids.principal },
        },
      }),
    ).rejects.toThrow();
  });

  it("does not authorize a caller-created persistent permit", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const persisted = await buildCommittedProviderDispatchPermitReceipt({
      schema_version: "provider-dispatch-permit@1.0.0",
      permit_id: ids.permit,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      context_receipt_ref: envelope.context_receipt_ref,
      lease: envelope.lease,
      attempt_id: ids.attempt,
      worker_fence: 4,
      committed_at: "2026-08-16T00:00:00.000Z",
    });
    expect(isAuthoritativeCommittedProviderDispatchPermit(persisted)).toBe(false);
    const permit = await authorizeCommittedProviderDispatchPermit(
      {
        scope,
        run_id: ids.run,
        invocation_id: ids.invocation,
        dispatch_hash: envelope.dispatch_hash,
      },
      { resolve_committed: async () => persisted },
    );
    expect(isAuthoritativeCommittedProviderDispatchPermit(permit)).toBe(true);
    expect(isAuthoritativeCommittedProviderDispatchPermit({ ...permit })).toBe(false);
  });

  it("closes AVAILABLE, NOT_APPLICABLE and UNAVAILABLE usage truth tables", () => {
    const base = {
      schema_version: "provider-invocation-usage@1.0.0",
      usage_receipt_id: ids.usage,
      outcome_id: ids.outcome,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      observed_at: "2026-08-16T00:00:02.000Z",
    } as const;
    expect(
      providerInvocationUsageReceiptCandidateSchema.safeParse({
        ...base,
        availability: "AVAILABLE",
        source: "PROVIDER_REPORTED",
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5,
        tool_calls: 0,
        provider_call_count: 1,
        capacity_status: "WITHIN_LIMIT",
        unavailable_reason: null,
      }).success,
    ).toBe(true);
    expect(
      providerInvocationUsageReceiptCandidateSchema.safeParse({
        ...base,
        availability: "NOT_APPLICABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        provider_call_count: 0,
        capacity_status: "NOT_APPLICABLE",
        unavailable_reason: "PROVIDER_NOT_DISPATCHED",
      }).success,
    ).toBe(true);
    expect(
      providerInvocationUsageReceiptCandidateSchema.safeParse({
        ...base,
        availability: "UNAVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        provider_call_count: 1,
        capacity_status: "UNAVAILABLE",
        unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
      }).success,
    ).toBe(true);
    expect(
      providerInvocationUsageReceiptCandidateSchema.safeParse({
        ...base,
        availability: "AVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        provider_call_count: 1,
        capacity_status: "UNAVAILABLE",
        unavailable_reason: null,
      }).success,
    ).toBe(false);
  });

  it("requires COMPLETED to bind an exact same-run protected response artifact", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const response = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "protected answer",
      tool_calls: [],
    });
    const responseHash = response.response_hash;
    const completed = {
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      status: "COMPLETED",
      reason_code: null,
      response_artifact_ref: {
        artifact_id: ids.response,
        artifact_type: "ProviderResponseArtifact",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: response.content_hash,
      },
      response_hash: responseHash,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: null,
    } as const;
    expect(providerInvocationOutcomeCandidateSchema.safeParse(completed).success).toBe(true);
    expect(
      providerInvocationOutcomeCandidateSchema.safeParse({
        ...completed,
        response_hash: hash("8"),
      }).success,
    ).toBe(true);
    expect(
      providerInvocationOutcomeCandidateSchema.safeParse({
        ...completed,
        response_artifact_ref: { ...completed.response_artifact_ref, run_id: ids.intent },
      }).success,
    ).toBe(false);
  });

  it("separates response hash from invocation-bound protected artifact content hash", async () => {
    const first = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "same",
      tool_calls: [],
    });
    const second = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.permit,
      output_text: "same",
      tool_calls: [],
    });
    expect(second.response_hash).toBe(first.response_hash);
    expect(second.content_hash).not.toBe(first.content_hash);
  });

  it("hashes DB-owned intent/outcome/usage receipts", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const intent = await buildProviderInvocationIntentReceipt({
      schema_version: "provider-invocation-intent@1.0.0",
      intent_id: ids.intent,
      invocation_spec: projectProviderInvocationStableSpec(envelope),
      invocation_key_hash: envelope.invocation_key_hash,
      state: "INTENT_COMMITTED",
      committed_at: "2026-08-16T00:00:00.000Z",
    });
    expect(intent.intent_hash).toMatch(/^sha256:/);
    const response = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "protected",
      tool_calls: [],
    });
    const outcomeCandidate = providerInvocationOutcomeCandidateSchema.parse({
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      status: "COMPLETED",
      reason_code: null,
      response_artifact_ref: {
        artifact_id: ids.response,
        artifact_type: "ProviderResponseArtifact",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: response.content_hash,
      },
      response_hash: response.response_hash,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: null,
    });
    const outcome = await buildProviderInvocationOutcomeReceipt({
      schema_version: "provider-invocation-outcome@1.0.0",
      outcome_id: ids.outcome,
      candidate: outcomeCandidate,
      dispatch_marked_at: "2026-08-16T00:00:01.000Z",
      terminal_at: "2026-08-16T00:00:02.000Z",
      latency_ms: 1_000,
    });
    const usage = await buildProviderInvocationUsageReceipt({
      schema_version: "provider-invocation-usage@1.0.0",
      usage_receipt_id: ids.usage,
      outcome_id: ids.outcome,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      observed_at: "2026-08-16T00:00:02.000Z",
      availability: "AVAILABLE",
      source: "PROVIDER_REPORTED",
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      tool_calls: 0,
      provider_call_count: 1,
      capacity_status: "WITHIN_LIMIT",
      unavailable_reason: null,
    });
    expect(outcome.outcome_hash).toMatch(/^sha256:/);
    expect(usage.usage_hash).toMatch(/^sha256:/);
  });

  it("rejects spliced terminal model, attempt, dispatch, scope and command identities", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const intent = await buildProviderInvocationIntentReceipt({
      schema_version: "provider-invocation-intent@1.0.0",
      intent_id: ids.intent,
      invocation_spec: projectProviderInvocationStableSpec(envelope),
      invocation_key_hash: envelope.invocation_key_hash,
      state: "INTENT_COMMITTED",
      committed_at: "2026-08-16T00:00:00.000Z",
    });
    const permit = await buildCommittedProviderDispatchPermitReceipt({
      schema_version: "provider-dispatch-permit@1.0.0",
      permit_id: ids.permit,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      context_receipt_ref: envelope.context_receipt_ref,
      lease: envelope.lease,
      attempt_id: ids.attempt,
      worker_fence: 4,
      committed_at: "2026-08-16T00:00:00.000Z",
    });
    const response = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "protected",
      tool_calls: [],
    });
    const responseRef = {
      artifact_id: ids.response,
      artifact_type: "ProviderResponseArtifact",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: response.content_hash,
    } as const;
    const candidate = {
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      status: "COMPLETED",
      reason_code: null,
      response_artifact_ref: responseRef,
      response_hash: response.response_hash,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: null,
    } as const;
    const outcome = await buildProviderInvocationOutcomeReceipt({
      schema_version: "provider-invocation-outcome@1.0.0",
      outcome_id: ids.outcome,
      candidate,
      dispatch_marked_at: "2026-08-16T00:00:01.000Z",
      terminal_at: "2026-08-16T00:00:02.000Z",
      latency_ms: 1_000,
    });
    const usage = await buildProviderInvocationUsageReceipt({
      schema_version: "provider-invocation-usage@1.0.0",
      usage_receipt_id: ids.usage,
      outcome_id: ids.outcome,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      observed_at: "2026-08-16T00:00:02.000Z",
      availability: "AVAILABLE",
      source: "PROVIDER_REPORTED",
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      tool_calls: 0,
      provider_call_count: 1,
      capacity_status: "WITHIN_LIMIT",
      unavailable_reason: null,
    });
    const projection = {
      schema_version: "provider-invocation-public@1.0.0",
      invocation_id: ids.invocation,
      run_id: ids.run,
      provider: "deepseek",
      model_profile_id: ids.profile,
      model_config_version: 7,
      profile_version: "model-profile@7",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: envelope.certification.receipt_ref,
      attempt_id: ids.attempt,
      attempt_no: 1,
      recovery_action: "NONE",
      status: "COMPLETED",
      reason_code: null,
      dispatch_hash: envelope.dispatch_hash,
      response_hash: response.response_hash,
      usage_availability: "AVAILABLE",
      usage_source: "PROVIDER_REPORTED",
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      tool_calls: 0,
      provider_call_count: 1,
      retry_after_ms: null,
      latency_ms: 1_000,
      receipt_deep_link: `/w/${ids.workspace}/runs/${ids.run}/provider-invocations/${ids.invocation}`,
      terminal_at: "2026-08-16T00:00:02.000Z",
    } as const;
    const { response_artifact_ref: _responseArtifactRef, ...candidateWithoutArtifactRef } =
      candidate;
    const command = {
      schema_version: "provider-invocation-commit-completed@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
      response_document: response,
      outcome: {
        ...candidateWithoutArtifactRef,
        schema_version: "provider-invocation-completed-candidate@1.0.0",
      },
      usage: {
        schema_version: "provider-invocation-usage-candidate@1.0.0",
        availability: "AVAILABLE",
        source: "PROVIDER_REPORTED",
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5,
        tool_calls: 0,
        provider_call_count: 1,
        capacity_status: "WITHIN_LIMIT",
        unavailable_reason: null,
      },
    };
    const result = {
      schema_version: "provider-invocation-commit-completed-result@1.0.0",
      disposition: "CREATED",
      intent,
      permit,
      response_artifact_ref: responseRef,
      outcome,
      usage,
      projection,
    };
    await expect(verifyCommitProviderInvocationCompletedResult(command, result)).resolves.toEqual(
      result,
    );
    for (const changed of [
      { ...result, projection: { ...projection, provider: "openai" } },
      { ...result, projection: { ...projection, attempt_id: ids.permit } },
      { ...result, projection: { ...projection, dispatch_hash: hash("9") } },
      { ...result, permit: { ...permit, scope: { ...scope, principal_id: ids.task } } },
    ]) {
      await expect(
        verifyCommitProviderInvocationCompletedResult(command, changed),
      ).rejects.toThrow();
    }
    await expect(
      verifyCommitProviderInvocationCompletedResult(
        { ...command, scope: { ...scope, principal_id: ids.task } },
        result,
      ),
    ).rejects.toThrow();
  });

  it("rejects pricing metadata from the technical execution profile", async () => {
    const profile = modelExecutionProfileSchema.parse({
      profile_id: ids.profile,
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      model_config_version: 7,
      profile_version: "model-profile@7",
      adapter_version: "model-provider-adapter@1.0.0",
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      connection: envelopeDraft().connection,
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 8_000,
          max_output_tokens: 2_000,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["cn"],
          privacy_tags: [],
        },
        fallback_compatibility: { verification_status: "UNVERIFIED" },
      },
      certification_status: "UNVERIFIED",
    });
    const changedPricing = {
      ...profile,
      operational_constraints: {
        ...profile.operational_constraints,
        pricing: {
          verification_status: "VERIFIED" as const,
          currency: "USD",
          input_microunits_per_million_tokens: 1,
          output_microunits_per_million_tokens: 2,
        },
      },
    };
    expect(() => modelExecutionProfileSchema.parse(changedPricing)).toThrow();
    await expect(computeModelExecutionProfileHash(profile)).resolves.toMatch(/^sha256:/);
  });

  it("replays one stable intent with a new permit before marker and blocks ALO redispatch after marker", async () => {
    const first = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const takeover = await buildProviderDispatchEnvelopeCandidate({
      ...envelopeDraft(),
      context_receipt_ref: { receipt_id: ids.permit, receipt_hash: hash("8") },
      lease: {
        ...envelopeDraft().lease,
        attempt_id: ids.permit,
        attempt_no: 2,
        lease_token: 9,
        worker_fence: 10,
      },
    });
    expect(projectProviderInvocationStableSpec(takeover)).toEqual(
      projectProviderInvocationStableSpec(first),
    );
    expect(takeover.dispatch_hash).not.toBe(first.dispatch_hash);
    expect(
      decideProviderInvocationTakeover({
        dispatch_marker_present: false,
        recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      }),
    ).toBe("ISSUE_NEW_PERMIT");
    expect(
      decideProviderInvocationTakeover({
        dispatch_marker_present: true,
        recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      }),
    ).toBe("MARK_OUTCOME_UNKNOWN");
  });

  it("allows only exact evidence-backed reconciliation from OUTCOME_UNKNOWN", async () => {
    const envelope = await buildProviderDispatchEnvelopeCandidate(envelopeDraft());
    const response = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "reconciled",
      tool_calls: [],
    });
    const outcome = {
      schema_version: "provider-invocation-completed-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      status: "COMPLETED",
      reason_code: null,
      response_hash: response.response_hash,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "OUTCOME_UNKNOWN",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: ids.outcome,
    } as const;
    const command = {
      schema_version: "provider-invocation-reconcile-unknown@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
      actor: "RECONCILIATION_JOB",
      reconciliation_id: ids.logicalCall,
      unknown_outcome_ref: { outcome_id: ids.outcome, outcome_hash: hash("6") },
      evidence_ref: {
        artifact_id: ids.task,
        artifact_type: "ExecutionReceipt",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: hash("7"),
      },
      evidence_hash: hash("7"),
      recovery_capability_used: "INVOCATION_RECONCILIATION",
      response_document: response,
      outcome,
      usage: {
        schema_version: "provider-invocation-usage-candidate@1.0.0",
        availability: "UNAVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        provider_call_count: 1,
        capacity_status: "UNAVAILABLE",
        unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
      },
    } as const;
    expect(reconcileProviderInvocationUnknownCommandSchema.safeParse(command).success).toBe(true);
    expect(
      reconcileProviderInvocationUnknownCommandSchema.safeParse({
        ...command,
        invocation_id: ids.permit,
      }).success,
    ).toBe(false);
    expect(
      reconcileProviderInvocationUnknownCommandSchema.safeParse({
        ...command,
        evidence_ref: { ...command.evidence_ref, tenant_id: ids.principal },
      }).success,
    ).toBe(false);
    const throttledCommand = {
      ...command,
      response_document: null,
      outcome: {
        schema_version: "provider-invocation-outcome-candidate@1.0.0",
        intent_id: ids.intent,
        invocation_id: ids.invocation,
        scope,
        run_id: ids.run,
        dispatch_hash: envelope.dispatch_hash,
        status: "THROTTLED",
        reason_code: "PROVIDER_THROTTLED",
        response_artifact_ref: null,
        response_hash: null,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
        transition_from: "OUTCOME_UNKNOWN",
        recovery_action: "NONE",
        provider_call_count: 1,
        retry_after_ms: 5_000,
        reconciliation_of: ids.outcome,
      },
    } as const;
    expect(
      reconcileProviderInvocationUnknownCommandSchema.safeParse(throttledCommand).success,
    ).toBe(true);
    expect(
      reconcileProviderInvocationUnknownCommandSchema.safeParse({
        ...throttledCommand,
        response_document: response,
      }).success,
    ).toBe(false);
  });

  it("loads only an exact permit-bound non-fresh invocation state", async () => {
    const { envelope, intent, permit, marker, startedProjection } = await committedAttemptFixture();
    const command = {
      schema_version: "provider-invocation-load@1.0.0",
      scope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      permit_id: permit.permit_id,
      permit_hash: permit.permit_hash,
      dispatch_hash: envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: envelope.lease.worker_fence,
    } as const;
    expect(loadProviderInvocationCommandSchema.safeParse(command).success).toBe(true);
    expect(
      loadProviderInvocationCommandSchema.safeParse({
        schema_version: command.schema_version,
        scope,
        run_id: ids.run,
        invocation_id: ids.invocation,
      }).success,
    ).toBe(false);
    expect(loadProviderInvocationResultSchema.safeParse(null).success).toBe(true);
    const loaded = {
      schema_version: "provider-invocation-load-result@1.0.0",
      intent,
      permit,
      marker,
      response_observed: null,
      outcome: null,
      usage: null,
      projection: startedProjection,
    } as const;
    expect(loadProviderInvocationResultSchema.safeParse(loaded).success).toBe(true);
    await expect(verifyLoadProviderInvocationResult(command, loaded)).resolves.toEqual(loaded);
    expect(
      loadProviderInvocationResultSchema.safeParse({
        ...loaded,
        marker: null,
      }).success,
    ).toBe(false);
    expect(
      loadProviderInvocationResultSchema.safeParse({
        ...loaded,
        projection: { ...startedProjection, provider_call_count: 0 },
      }).success,
    ).toBe(false);
    expect(
      loadProviderInvocationResultSchema.safeParse({
        ...loaded,
        permit: null,
      }).success,
    ).toBe(false);
    await expect(
      verifyLoadProviderInvocationResult({ ...command, permit_hash: hash("9") }, loaded),
    ).rejects.toThrow("LOAD_PERMIT_MISMATCH");
  });

  it("allows only a job to recover an exact stale dispatch marker", async () => {
    expect(
      [
        "IDEMPOTENT_REQUEST",
        "INVOCATION_STATUS_QUERY",
        "INVOCATION_RECONCILIATION",
        "AT_LEAST_ONCE_ONLY",
      ].map(decideStaleProviderMarkerRecoveryAction),
    ).toEqual([
      "SAFE_RETRY",
      "STATUS_QUERY_REQUIRED",
      "RECONCILIATION_REQUIRED",
      "MANUAL_REVIEW_REQUIRED",
    ]);
    const { envelope, intent, permit, marker } = await committedAttemptFixture();
    const command = {
      schema_version: "provider-invocation-recover-stale-marker@1.0.0",
      actor: "STALE_MARKER_RECOVERY_JOB",
      recovery_id: ids.response,
      intent,
      permit,
      marker,
      recovery_capability_used: "INVOCATION_RECONCILIATION",
      recovery_resolution: "MARK_OUTCOME_UNKNOWN",
      outcome: {
        schema_version: "provider-invocation-outcome-candidate@1.0.0",
        intent_id: ids.intent,
        invocation_id: ids.invocation,
        scope,
        run_id: ids.run,
        dispatch_hash: envelope.dispatch_hash,
        status: "OUTCOME_UNKNOWN",
        reason_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
        response_artifact_ref: null,
        response_hash: null,
        delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
        transition_from: "DISPATCH_MARKED",
        recovery_action: "RECONCILIATION_REQUIRED",
        provider_call_count: 1,
        retry_after_ms: null,
        reconciliation_of: null,
      },
      usage: {
        schema_version: "provider-invocation-usage-candidate@1.0.0",
        availability: "UNAVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        provider_call_count: 1,
        capacity_status: "UNAVAILABLE",
        unavailable_reason: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
      },
    } as const;
    expect(recoverStaleProviderInvocationMarkerCommandSchema.safeParse(command).success).toBe(true);
    expect(
      recoverStaleProviderInvocationMarkerCommandSchema.safeParse({
        ...command,
        actor: "WORKER",
      }).success,
    ).toBe(false);
    expect(
      recoverStaleProviderInvocationMarkerCommandSchema.safeParse({
        ...command,
        recovery_capability_used: "AT_LEAST_ONCE_ONLY",
      }).success,
    ).toBe(false);
    expect(
      recoverStaleProviderInvocationMarkerCommandSchema.safeParse({
        ...command,
        marker: { ...marker, dispatch_hash: hash("8") },
      }).success,
    ).toBe(false);

    const inactiveObservedAt = "2026-08-16T00:00:02.000Z";
    const inactiveObservationHash = await computeProviderStaleMarkerInactiveObservationHash({
      permit_id: permit.permit_id,
      permit_hash: permit.permit_hash,
      old_attempt_id: permit.attempt_id,
      old_worker_fence: permit.worker_fence,
      lease_status: "INACTIVE",
      observed_at: inactiveObservedAt,
    });
    const recoveryReceipt = await buildProviderStaleMarkerRecoveryReceiptDocument({
      schema_version: "provider-stale-marker-recovery-receipt@1.0.0",
      recovery_id: ids.response,
      actor: "STALE_MARKER_RECOVERY_JOB",
      intent_id: intent.intent_id,
      intent_hash: intent.intent_hash,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      permit_id: permit.permit_id,
      permit_hash: permit.permit_hash,
      marker_id: marker.marker_id,
      marker_hash: marker.marker_hash,
      old_attempt_id: permit.attempt_id,
      old_worker_fence: permit.worker_fence,
      recovery_capability_used: "INVOCATION_RECONCILIATION",
      recovery_action: "RECONCILIATION_REQUIRED",
      lease_status: "INACTIVE",
      inactive_observed_at: inactiveObservedAt,
      inactive_observation_hash: inactiveObservationHash,
      recovered_at: inactiveObservedAt,
    });
    const outcome = await buildProviderInvocationOutcomeReceipt({
      schema_version: "provider-invocation-outcome@1.0.0",
      outcome_id: ids.outcome,
      candidate: command.outcome,
      dispatch_marked_at: marker.dispatch_marked_at,
      terminal_at: inactiveObservedAt,
      latency_ms: 1_000,
    });
    const usage = await buildProviderInvocationUsageReceipt({
      ...command.usage,
      schema_version: "provider-invocation-usage@1.0.0",
      usage_receipt_id: ids.usage,
      outcome_id: ids.outcome,
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      observed_at: inactiveObservedAt,
    });
    const recoveryReference = {
      artifact_id: ids.response,
      artifact_type: "ProviderStaleMarkerRecoveryReceipt",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: recoveryReceipt.content_hash,
    } as const;
    const projection = {
      schema_version: "provider-invocation-public@1.0.0",
      invocation_id: ids.invocation,
      run_id: ids.run,
      provider: "deepseek",
      model_profile_id: ids.profile,
      model_config_version: 7,
      profile_version: "model-profile@7",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: envelope.certification.receipt_ref,
      attempt_id: ids.attempt,
      attempt_no: 1,
      recovery_action: "RECONCILIATION_REQUIRED",
      status: "OUTCOME_UNKNOWN",
      reason_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
      dispatch_hash: envelope.dispatch_hash,
      response_hash: null,
      usage_availability: "UNAVAILABLE",
      usage_source: "UNAVAILABLE",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      tool_calls: null,
      provider_call_count: 1,
      retry_after_ms: null,
      latency_ms: 1_000,
      receipt_deep_link: `/w/${ids.workspace}/runs/${ids.run}/provider-invocations/${ids.invocation}`,
      terminal_at: inactiveObservedAt,
    } as const;
    const result = {
      schema_version: "provider-invocation-recover-stale-marker-result@1.0.0",
      disposition: "CREATED",
      recovery_receipt_ref: recoveryReference,
      recovery_receipt: recoveryReceipt,
      intent,
      permit,
      marker,
      outcome,
      usage,
      projection,
    } as const;
    await expect(
      verifyRecoverStaleProviderInvocationMarkerResult(command, result),
    ).resolves.toEqual(result);
    await expect(
      verifyRecoverStaleProviderInvocationMarkerResult(command, {
        ...result,
        recovery_receipt: { ...recoveryReceipt, content_hash: hash("9") },
      }),
    ).rejects.toThrow();
  });

  it("commits a protected ProviderTaskArtifact only from DB-resolved accepted message authority", async () => {
    expect(knownArtifactTypeSchema.safeParse("ProviderTaskArtifact").success).toBe(true);
    expect(knownArtifactTypeSchema.safeParse("ProviderStaleMarkerRecoveryReceipt").success).toBe(
      true,
    );
    const document = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@1.0.0",
      message_id: ids.logicalCall,
      accepted_event_id: ids.logicalCall,
      conversation_id: ids.context,
      conversation_resource_version: 3,
      command_id: ids.command,
      run_id: ids.run,
      message_role: "user",
      message_type: "text",
      question: "What is governed revenue?",
    });
    const command = {
      schema_version: "provider-task-artifact-commit@1.0.0",
      scope,
      run_id: ids.run,
      conversation_binding: {
        conversation_id: ids.context,
        resource_version: 3,
      },
      context_summary_ref: null,
    } as const;
    expect(commitProviderTaskArtifactCommandSchema.safeParse(command).success).toBe(true);
    expect(
      commitProviderTaskArtifactCommandSchema.safeParse({
        ...command,
        question: "caller must not submit raw question",
      }).success,
    ).toBe(false);
    expect(
      commitProviderTaskArtifactCommandSchema.safeParse({
        ...command,
        message_id: ids.logicalCall,
      }).success,
    ).toBe(false);
    const reference = {
      artifact_id: ids.logicalCall,
      artifact_type: "ProviderTaskArtifact",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: document.content_hash,
    } as const;
    const result = {
      schema_version: "provider-task-artifact-commit-result@1.0.0",
      disposition: "CREATED",
      reference,
      document,
      committed_at: "2026-08-16T00:00:02.000Z",
    } as const;
    await expect(verifyCommitProviderTaskArtifactResult(command, result)).resolves.toEqual(result);
    await expect(
      verifyCommitProviderTaskArtifactResult(command, {
        ...result,
        document: { ...document, question: "tampered" },
      }),
    ).rejects.toThrow();
    expect(
      loadProviderTaskArtifactResultSchema.safeParse({
        schema_version: "provider-task-artifact-load-result@1.0.0",
        reference,
        document,
      }).success,
    ).toBe(true);
    if (document.schema_version !== "provider-task-artifact@1.0.0") {
      throw new Error("expected legacy ProviderTaskArtifact fixture");
    }
    expect(JSON.stringify({ command, reference })).not.toContain(document.question);
  });
});
