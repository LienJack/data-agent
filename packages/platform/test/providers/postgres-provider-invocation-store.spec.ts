import {
  buildProviderDispatchEnvelopeCandidate,
  buildProviderResponseArtifactDocument,
  buildProviderTaskArtifactDocument,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresProviderInvocationStore } from "../../src/providers/postgres-provider-invocation-store.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "80000000-0000-4000-8000-000000000001",
  workspace: "80000000-0000-4000-8000-000000000002",
  deployment: "80000000-0000-4000-8000-000000000003",
  principal: "80000000-0000-4000-8000-000000000004",
  conversation: "80000000-0000-4000-8000-000000000005",
  model: "80000000-0000-4000-8000-000000000006",
  datasource: "80000000-0000-4000-8000-000000000007",
  run: "80000000-0000-4000-8000-000000000008",
  invocation: "80000000-0000-4000-8000-000000000009",
  logicalCall: "80000000-0000-4000-8000-000000000010",
  task: "80000000-0000-4000-8000-000000000011",
  config: "80000000-0000-4000-8000-000000000012",
  context: "80000000-0000-4000-8000-000000000013",
  outbox: "80000000-0000-4000-8000-000000000014",
  command: "80000000-0000-4000-8000-000000000015",
  attempt: "80000000-0000-4000-8000-000000000016",
  certification: "80000000-0000-4000-8000-000000000017",
  intent: "80000000-0000-4000-8000-000000000018",
  outcome: "80000000-0000-4000-8000-000000000019",
  usage: "80000000-0000-4000-8000-000000000020",
  response: "80000000-0000-4000-8000-000000000021",
  event: "80000000-0000-4000-8000-000000000022",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const providerScope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "test",
  workspace_id: ids.workspace,
  principal_id: ids.principal,
} as const;

function workerLease() {
  return {
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-u3",
    lease_token: 3,
    worker_fence: 4,
    expires_at: "2026-08-16T00:05:00.000Z",
    payload: {
      kind: "START_L2_RESEARCH",
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("b") },
    },
  } as const;
}

async function dispatchEnvelope() {
  return buildProviderDispatchEnvelopeCandidate({
    schema_version: "provider-dispatch-envelope@1.0.0",
    invocation_id: ids.invocation,
    idempotency_key: "provider-invocation-0001",
    scope: providerScope,
    run_id: ids.run,
    logical_call_id: ids.invocation,
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
    effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("b") },
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
      profile_id: ids.model,
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
        max_context_tokens: 16_000,
        max_output_tokens: 4_000,
      },
    },
    connection: {
      kind: "SYSTEM_DEPLOYMENT",
      deployment_id: ids.deployment,
      deployment_revision: 1,
      deployment_hash: hash("1"),
    },
    request_policy: {
      response_schema_version: "text2sql-answer@1.0.0",
      tool_allowlist: [],
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 8_000,
        max_output_tokens: 2_000,
        max_tool_calls: 0,
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
      effective_context_ceiling_tokens: 16_000,
      effective_output_ceiling_tokens: 4_000,
      capacity_status: "WITHIN_LIMIT",
      taint_hash: hash("3"),
    },
  });
}

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.workspace,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("fixture authority missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

describe("PostgresProviderInvocationStore conversation selection", () => {
  it("uses only the frozen U3 invocation RPC signatures", async () => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool((text) =>
      text.includes("provider_invocation") || text.includes("provider_response_artifact")
        ? { rows: [{ value: {} }], rowCount: 1 }
        : undefined,
    );
    const store = createPostgresProviderInvocationStore({ pool: scripted.pool, authorizer });
    const envelope = await dispatchEnvelope();
    const transition = {
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope: providerScope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
    } as const;
    const failedOutcome = {
      schema_version: "provider-invocation-outcome-candidate@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope: providerScope,
      run_id: ids.run,
      dispatch_hash: envelope.dispatch_hash,
      status: "FAILED",
      reason_code: "PROVIDER_INVOCATION_FAILED",
      response_artifact_ref: null,
      response_hash: null,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      transition_from: "RESPONSE_OBSERVED",
      recovery_action: "NONE",
      provider_call_count: 1,
      retry_after_ms: null,
      reconciliation_of: null,
    } as const;
    const unavailableUsage = {
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
    } as const;
    const unknownOutcome = {
      ...failedOutcome,
      status: "OUTCOME_UNKNOWN",
      reason_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
      delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
      recovery_action: "RECONCILIATION_REQUIRED",
    } as const;
    const unknownUsage = {
      ...unavailableUsage,
      unavailable_reason: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
    } as const;
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
    const taskDocument = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@1.0.0",
      message_id: ids.event,
      accepted_event_id: ids.event,
      conversation_id: ids.conversation,
      conversation_resource_version: 9,
      command_id: ids.command,
      run_id: ids.run,
      message_role: "user",
      message_type: "text",
      question: "What is governed revenue?",
    });
    const taskRef = {
      artifact_id: ids.event,
      artifact_type: "ProviderTaskArtifact",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: taskDocument.content_hash,
    } as const;

    const invalidBeginResult = await store.begin(capability, workerLease(), {
      schema_version: "provider-invocation-begin@1.0.0",
      envelope,
    });
    expect(invalidBeginResult).toMatchObject({
      ok: false,
      error: {
        code: "PROVIDER_INVOCATION_DATABASE_CONTRACT_INVALID",
        retryable: false,
      },
    });
    await store.markDispatched(capability, workerLease(), {
      schema_version: "provider-invocation-mark-started@1.0.0",
      ...transition,
    });
    await store.markResponseObserved(capability, workerLease(), {
      schema_version: "provider-invocation-mark-response-observed@1.0.0",
      ...transition,
      observation_kind: "FAILED",
      response_hash: null,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    });
    await store.commitTerminal(capability, workerLease(), {
      schema_version: "provider-invocation-commit-terminal@1.0.0",
      ...transition,
      outcome: failedOutcome,
      usage: unavailableUsage,
    });
    await store.markOutcomeUnknown(capability, workerLease(), {
      schema_version: "provider-invocation-mark-unknown@1.0.0",
      ...transition,
      outcome: unknownOutcome,
      usage: unknownUsage,
    });
    await store.commitCompleted(capability, workerLease(), {
      schema_version: "provider-invocation-commit-completed@1.0.0",
      ...transition,
      response_document: response,
      outcome: {
        schema_version: "provider-invocation-completed-candidate@1.0.0",
        intent_id: ids.intent,
        invocation_id: ids.invocation,
        scope: providerScope,
        run_id: ids.run,
        dispatch_hash: envelope.dispatch_hash,
        status: "COMPLETED",
        reason_code: null,
        response_hash: response.response_hash,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
        transition_from: "RESPONSE_OBSERVED",
        recovery_action: "NONE",
        provider_call_count: 1,
        retry_after_ms: null,
        reconciliation_of: null,
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
    });
    await store.load(capability, {
      schema_version: "provider-invocation-load@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      permit_id: ids.response,
      permit_hash: hash("5"),
      dispatch_hash: envelope.dispatch_hash,
      attempt_id: ids.attempt,
      worker_fence: 4,
    });
    await store.loadResponse(capability, {
      schema_version: "provider-response-artifact-load@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      reference: responseRef,
    });
    await store.commitTaskArtifact(capability, workerLease(), {
      schema_version: "provider-task-artifact-commit@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      conversation_binding: { conversation_id: ids.conversation, resource_version: 9 },
    });
    await store.loadTaskArtifact(capability, {
      schema_version: "provider-task-artifact-load@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      reference: taskRef,
    });

    const rpcNames = scripted.calls
      .map((call) => call.text.match(/app_data_agent\.([a-z_]+)/)?.[1])
      .filter(Boolean);
    expect(rpcNames).toEqual(
      expect.arrayContaining([
        "begin_provider_invocation",
        "mark_provider_invocation_dispatched",
        "mark_provider_invocation_response_observed",
        "commit_provider_invocation_terminal",
        "mark_provider_invocation_outcome_unknown",
        "commit_provider_invocation_completed",
        "load_provider_invocation",
        "load_provider_response_artifact",
        "commit_provider_task_artifact",
        "load_provider_task_artifact",
      ]),
    );
    const completed = scripted.calls.find((call) =>
      call.text.includes("commit_provider_invocation_completed"),
    );
    expect(completed?.values).toHaveLength(2);
    const loaded = scripted.calls.find((call) => call.text.includes("load_provider_invocation"));
    expect(loaded?.values).toEqual([
      {
        schema_version: "provider-invocation-load@1.0.0",
        scope: providerScope,
        run_id: ids.run,
        invocation_id: ids.invocation,
        permit_id: ids.response,
        permit_hash: hash("5"),
        dispatch_hash: envelope.dispatch_hash,
        attempt_id: ids.attempt,
        worker_fence: 4,
      },
    ]);
    expect(JSON.stringify(scripted.calls)).not.toMatch(/billing|pricing|credit|settlement/iu);
  });

  it("rejects caller-supplied Provider Task content before opening PostgreSQL", async () => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool(() => undefined);
    const store = createPostgresProviderInvocationStore({ pool: scripted.pool, authorizer });

    const result = await store.commitTaskArtifact(capability, workerLease(), {
      schema_version: "provider-task-artifact-commit@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      conversation_binding: { conversation_id: ids.conversation, resource_version: 9 },
      question: "caller supplied",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_TASK_ARTIFACT_COMMAND_INVALID", retryable: false },
    });
    expect(scripted.calls).toHaveLength(0);
  });

  it("lists pricing-free execution profiles through one scope-bound narrow RPC", async () => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool((text) =>
      text.includes("list_provider_execution_profiles")
        ? {
            rows: [
              {
                value: {
                  schema_version: "provider-execution-profile-list@1.0.0",
                  scope: {
                    app_id: ids.app,
                    tenant_id: ids.workspace,
                    environment: "test",
                    workspace_id: ids.workspace,
                    principal_id: ids.principal,
                  },
                  profiles: [
                    {
                      model_profile_id: ids.model,
                      model_config_version: 12,
                      resource_hash: `sha256:${"a".repeat(64)}`,
                      profile_version: "model-profile@12",
                      provider: "deepseek",
                      model_id: "deepseek-v4-flash",
                      display_name: "DeepSeek V4 Flash",
                      readiness: "CERTIFICATION_REQUIRED",
                      selectable: false,
                      unavailable_reason: "MODEL_CERTIFICATION_REQUIRED",
                    },
                  ],
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const store = createPostgresProviderInvocationStore({ pool: scripted.pool, authorizer });

    const result = await store.listExecutionProfiles(capability);

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          model_id: "deepseek-v4-flash",
          readiness: "CERTIFICATION_REQUIRED",
          selectable: false,
        },
      ],
    });
    const rpc = scripted.calls.filter((call) =>
      call.text.includes("list_provider_execution_profiles"),
    );
    expect(rpc).toHaveLength(1);
    expect(rpc[0]?.values).toEqual([]);
    expect(rpc[0]?.text).not.toMatch(/billing|pricing|credit|settlement/iu);
  });

  it("rejects a response artifact substituted by PostgreSQL", async () => {
    const { capability, authorizer } = authority();
    const response = await buildProviderResponseArtifactDocument({
      schema_version: "provider-response-artifact@1.0.0",
      invocation_id: ids.invocation,
      output_text: "protected",
      tool_calls: [],
    });
    const requestedReference = {
      artifact_id: ids.response,
      artifact_type: "ProviderResponseArtifact",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: response.content_hash,
    } as const;
    const scripted = scriptedPool((text) =>
      text.includes("load_provider_response_artifact")
        ? {
            rows: [
              {
                value: {
                  schema_version: "provider-response-artifact-load-result@1.0.0",
                  invocation_id: ids.invocation,
                  reference: { ...requestedReference, artifact_id: ids.outcome },
                  document: response,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const store = createPostgresProviderInvocationStore({ pool: scripted.pool, authorizer });

    const result = await store.loadResponse(capability, {
      schema_version: "provider-response-artifact-load@1.0.0",
      scope: providerScope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      reference: requestedReference,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_RESPONSE_ARTIFACT_MISMATCH", retryable: false },
    });
  });

  it("resolves exact Conversation-selected model and datasource revisions through one narrow RPC", async () => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool((text) =>
      text.includes("resolve_conversation_run_selections")
        ? {
            rows: [
              {
                value: {
                  schema_version: "conversation-run-selections@1.0.0",
                  conversation_id: ids.conversation,
                  conversation_resource_version: 9,
                  model_profile_id: ids.model,
                  model_config_version: 12,
                  datasource_id: ids.datasource,
                  datasource_resource_version: 7,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const store = createPostgresProviderInvocationStore({
      pool: scripted.pool,
      authorizer,
    });

    const result = await store.resolveConversationRunSelections(capability, {
      conversation_id: ids.conversation,
      expected_resource_version: 9,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        schema_version: "conversation-run-selections@1.0.0",
        conversation_id: ids.conversation,
        conversation_resource_version: 9,
        model_profile_id: ids.model,
        model_config_version: 12,
        datasource_id: ids.datasource,
        datasource_resource_version: 7,
      },
    });
    const rpc = scripted.calls.find((call) =>
      call.text.includes("resolve_conversation_run_selections"),
    );
    expect(rpc?.values).toEqual([ids.conversation, 9]);
    expect(rpc?.text).not.toMatch(/billing|pricing|credit/iu);
  });

  it("fails closed when PostgreSQL substitutes the conversation identity or version", async () => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool((text) =>
      text.includes("resolve_conversation_run_selections")
        ? {
            rows: [
              {
                value: {
                  schema_version: "conversation-run-selections@1.0.0",
                  conversation_id: "80000000-0000-4000-8000-000000000099",
                  conversation_resource_version: 10,
                  model_profile_id: ids.model,
                  model_config_version: 12,
                  datasource_id: ids.datasource,
                  datasource_resource_version: 7,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const store = createPostgresProviderInvocationStore({
      pool: scripted.pool,
      authorizer,
    });

    const result = await store.resolveConversationRunSelections(capability, {
      conversation_id: ids.conversation,
      expected_resource_version: 9,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_CONVERSATION_SELECTION_INVALID", retryable: false },
    });
  });

  it.each([
    ["CONVERSATION_RUN_SELECTION_INPUT_INVALID", false],
    ["CONVERSATION_RUN_SELECTION_NOT_FOUND_OR_FORBIDDEN", false],
    ["CONVERSATION_RUN_SELECTION_VERSION_CONFLICT", true],
    ["PROVIDER_PROFILE_NOT_AVAILABLE", false],
    ["DATASOURCE_NOT_FOUND_OR_DENIED", false],
  ] as const)("maps %s to a stable boundary failure", async (marker, retryable) => {
    const { capability, authorizer } = authority();
    const scripted = scriptedPool((text) => {
      if (!text.includes("resolve_conversation_run_selections")) return undefined;
      throw new Error(marker);
    });
    const store = createPostgresProviderInvocationStore({
      pool: scripted.pool,
      authorizer,
    });

    const result = await store.resolveConversationRunSelections(capability, {
      conversation_id: ids.conversation,
      expected_resource_version: 9,
    });

    expect(result).toMatchObject({ ok: false, error: { code: marker, retryable } });
  });
});
