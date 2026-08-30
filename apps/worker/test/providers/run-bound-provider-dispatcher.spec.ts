import {
  buildProviderTaskArtifactDocument,
  buildSubagentCapabilityCatalogSnapshot,
  computeProviderTaskContextSelectionHash,
  computeProviderTaskVisibleMessageHash,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProviderExecutionProfile,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentDataProjectionReceiptAuthority,
  AuditedModelProvider,
} from "../../src/providers/audited-model-provider.js";
import { createRunBoundProviderDispatcher } from "../../src/providers/run-bound-provider-dispatcher.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const ids = {
  app: "88000000-0000-4000-8000-000000000001",
  workspace: "88000000-0000-4000-8000-000000000002",
  principal: "88000000-0000-4000-8000-000000000003",
  run: "88000000-0000-4000-8000-000000000004",
  command: "88000000-0000-4000-8000-000000000005",
  event: "88000000-0000-4000-8000-000000000006",
  history: "88000000-0000-4000-8000-000000000007",
  outbox: "88000000-0000-4000-8000-000000000008",
  attempt: "88000000-0000-4000-8000-000000000009",
  deployment: "88000000-0000-4000-8000-000000000010",
  certification: "88000000-0000-4000-8000-000000000011",
} as const;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = { app_id: ids.app, tenant_id: ids.workspace, environment: "test" } as const;
const reportUsages = ["FINAL_ANSWER_EVIDENCE", "CONTINUATION_INPUT"] as const;

function baseLease(): RunWorkLease {
  return {
    scope,
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-root",
    lease_token: 2,
    worker_fence: 3,
    expires_at: "2026-08-27T12:05:00.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {
      kind: "START_L2_RESEARCH",
      effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: hash("a") },
    },
  };
}

describe("audited run-bound Root provider coordinator", () => {
  it.each(reportUsages)("binds conversation and %s report usage", async (reportUsage) => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const researchLease = bindEffectiveConfigLease(baseLease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(researchLease);
    if (!loaded.ok) throw new TypeError("missing context receipt fixture");
    const contextReceipt = (
      loaded.value as {
        readonly context_receipt: Parameters<
          ReturnType<typeof createRunBoundProviderDispatcher>["invoke"]
        >[0]["context_receipt"];
      }
    ).context_receipt;
    const history = {
      message_id: ids.history,
      role: "agent" as const,
      type: "text" as const,
      content: "上一轮已确认按月展示。",
      run_id: ids.history,
    };
    const current = {
      message_id: ids.event,
      role: "user" as const,
      type: "text" as const,
      content: "只看华东呢？",
      run_id: ids.run,
    };
    const visibleMessages = await Promise.all(
      [history, current].map(async (message) => ({
        ...message,
        content_hash: await computeProviderTaskVisibleMessageHash(message),
      })),
    );
    const taskDocument = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: config.conversation_binding.conversation_id,
      conversation_resource_version: config.conversation_binding.resource_version,
      current_message: { message_id: current.message_id, content: current.content },
      visible_messages: visibleMessages,
      context_summary_ref: null,
      context_selection_hash: await computeProviderTaskContextSelectionHash({
        conversation_id: config.conversation_binding.conversation_id,
        conversation_resource_version: config.conversation_binding.resource_version,
        current_message_id: current.message_id,
        visible_messages: visibleMessages,
        context_summary_ref: null,
      }),
    });
    if (taskDocument.schema_version !== "provider-task-artifact@2.0.0") {
      throw new TypeError("missing ProviderTaskArtifact v2 fixture");
    }
    const catalog = await buildSubagentCapabilityCatalogSnapshot({
      schema_version: "subagent-capability-catalog-snapshot@1.0.0",
      catalog_id: ids.command,
      scope,
      run_id: ids.run,
      principal_id: ids.principal,
      policy_version: "root-harness@1.0.0",
      items: [
        {
          profile_ref: {
            profile_id: "semantic-management-agent",
            revision: 1,
            revision_hash: hash("1"),
          },
          discovery: {
            schema_version: "subagent-discovery-descriptor@1.0.0",
            display_name: "Semantic",
            description: "Reads governed semantics.",
            when_to_use: ["Use for governed semantic questions."],
            when_not_to_use: ["Do not use for database values."],
            examples: [],
            accepted_input_artifact_types: [],
            produced_artifact_types: ["AnalysisReport"],
            access_mode: "READ_ONLY",
          },
        },
      ],
    });
    const workerLease: RunWorkLease = {
      ...researchLease,
      command_kind: "START_DATA_AGENT_TEAM",
      payload: {
        schema_version: "effective-config-team-lease@3.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ROOT_HARNESS@1",
        effective_config_ref: effectiveConfigRef(config),
        catalog_snapshot: catalog,
        visible_message_refs: visibleMessages.map(({ message_id }) => message_id),
      },
    };
    const profile = {
      model_profile_id: config.model.resource_id,
      model_config_version: config.model.resource_revision,
      resource_hash: config.model.resource_hash,
      profile_version: config.model.profile_version,
      provider: config.model.provider,
      model_id: config.model.model_id,
      display_name: "DeepSeek V4 Flash",
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        ...scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("c"),
      },
      execution_profile_hash: hash("d"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: ids.deployment,
        deployment_revision: 1,
        deployment_hash: hash("e"),
      },
      effective_context_ceiling_tokens: 32_000,
      effective_output_ceiling_tokens: 4_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const satisfies ProviderExecutionProfile;
    let projectionAuthority: AgentDataProjectionReceiptAuthority | null = null;
    const auditedInvoke = vi.fn(
      async (invocation: Parameters<AuditedModelProvider["invoke"]>[0]) => {
        const committed = await projectionAuthority?.commit({
          worker_lease: invocation.worker_lease,
          envelope: invocation.envelope,
        });
        expect(committed?.ok).toBe(true);
        return {
          ok: false as const,
          error: { code: "PROVIDER_FAKE_TERMINAL", message: "fake", retryable: false },
        };
      },
    );
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: {
        commit: async () => ({
          ok: true,
          value: {
            schema_version: "provider-task-artifact-commit-result@1.0.0",
            disposition: "CREATED",
            reference: {
              artifact_id: ids.event,
              artifact_type: "ProviderTaskArtifact",
              ...scope,
              run_id: ids.run,
              revision: 1,
              content_hash: taskDocument.content_hash,
            },
            document: taskDocument,
            committed_at: "2026-08-27T12:00:00.000Z",
          },
        }),
        load: vi.fn(),
      },
      execution_profiles: { list: async () => ({ ok: true, value: [profile] }) },
      projection_store: {
        commit: async (_lease, receipt) => ({
          ok: true,
          value: {
            artifact_id: receipt.receipt_id,
            artifact_type: "AgentDataProjectionReceipt",
            ...scope,
            run_id: ids.run,
            revision: 1,
            content_hash: receipt.receipt_hash,
          },
        }),
        committedResolverForLease: () => ({ resolve_committed: async () => null }),
      },
      create_audited_provider: (authority) => {
        projectionAuthority = authority;
        return { invoke: auditedInvoke };
      },
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      root_response_schema_version: "root-agent-final-answer@1.0.0",
      root_response_schema_bytes: 512,
    });

    const result = await dispatcher.invoke({
      lease: workerLease,
      effective_config: config,
      context_receipt: contextReceipt,
      logical_call_id: ids.command,
      turn: { kind: "ROOT", turn_index: 0, tool_observations: [], verifier_feedback: null },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_FAKE_TERMINAL" } });
    const invocation = auditedInvoke.mock.calls[0]?.[0];
    expect(invocation?.payload).toMatchObject({
      messages: [
        expect.objectContaining({ role: "system" }),
        { role: "assistant", content: history.content },
        { role: "user", content: current.content },
        { role: "system", content: "Current normal Root turn index: 0." },
      ],
      tool_allowlist: ["delegate_to_subagent@2"],
    });
    expect(invocation?.envelope.invocation_id).toBe(ids.command);
    expect(invocation?.envelope.projection.payload_hash).toMatch(/^sha256:/u);

    const analysisReportRef = {
      artifact_id: ids.history,
      artifact_type: "AnalysisReport" as const,
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("f"),
    };
    const closureResult = await dispatcher.invoke({
      lease: workerLease,
      effective_config: config,
      context_receipt: contextReceipt,
      logical_call_id: ids.event,
      turn: {
        kind: "ROOT",
        turn_index: 1,
        tool_observations: [
          {
            schema_version: "root-tool-observation@1.0.0",
            tool_call_id: "analysis-call",
            profile_id: "governed-analysis-agent",
            output_usage: reportUsage,
            status: "COMPLETED",
            output_ref: analysisReportRef,
            safe_projection: {
              schema_version: "root-tool-safe-projection@1.0.0",
              artifact_ref: analysisReportRef,
              projection_kind: "REPORT",
              title: "Monthly order revenue trend",
              summary: "1 accepted governed report section is available.",
              column_keys: [],
              total_rows: null,
              source_artifact_refs: [],
              semantic_query_context: null,
            },
            error_code: null,
          },
        ],
        verifier_feedback: null,
      },
      signal: new AbortController().signal,
    });

    expect(closureResult).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_FAKE_TERMINAL" },
    });
    expect(auditedInvoke.mock.calls[1]?.[0]?.payload).toMatchObject({
      tool_allowlist: reportUsage === "FINAL_ANSWER_EVIDENCE" ? [] : ["delegate_to_subagent@2"],
      ...(reportUsage === "FINAL_ANSWER_EVIDENCE" ? { budget: { max_tool_calls: 0 } } : {}),
    });
  });
});
