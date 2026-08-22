import {
  buildAgentDispatchExecuteAdmission,
  buildAgentDispatchExecutionBinding,
  buildAgentDispatchPlan,
  buildDirectAdmissibilityReceipt,
  buildResolvedContextAuthoritySnapshot,
  buildResolvedContextPackage,
  buildResolvedContextReceipt,
  buildResolvedContextRequest,
  buildSubagentCapabilityCatalogSnapshot,
  type RunWorkLease,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";
import { createDataAgentTeamRunner } from "../../src/teams/data-agent-team-runner.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `80000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const principalId = id(4);
const profileIds = [
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function resources(offset: number) {
  return Object.fromEntries(
    profileIds.map((profileId, index) => [
      profileId,
      {
        resource_id: id(offset + index),
        resource_revision: 1,
        resource_hash: hash(String((offset + index) % 10)),
      },
    ]),
  ) as Record<
    (typeof profileIds)[number],
    { resource_id: string; resource_revision: number; resource_hash: string }
  >;
}

async function resolvedContext() {
  const snapshot = await buildResolvedContextAuthoritySnapshot({
    schema_version: "resolved-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Gross Revenue by channel",
    defaults_ref: { defaults_id: id(40), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(41),
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: id(42),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(43),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(42),
      semantic_release_id: id(41),
      semantic_generation: 1,
    },
    context_policy: {
      resource_id: id(44),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 4_096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(45),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.order_amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("6"), hash("7")],
  });
  const packageDocument = await buildResolvedContextPackage({
    schema_version: "resolved-context-package@1.0.0",
    scope,
    semantic_domain: snapshot.semantic_domain,
    question_hash: snapshot.question_hash,
    defaults_ref: snapshot.defaults_ref,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    context_policy: snapshot.context_policy,
    egress_policy: snapshot.egress_policy,
    provider: snapshot.provider,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route_decision: {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "gross_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4_096,
      max_context_bytes: 4_096,
      mandatory_bytes: 64,
      included_bytes: 64,
      cropped_bytes: 0,
      items: [
        {
          item_kind: "METRIC",
          item_id: "gross_revenue",
          item_hash: hash("6"),
          byte_size: 64,
          priority: 100,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "ROUTE_SELECTED",
        },
      ],
    },
    evidence: [
      {
        evidence_kind: "METRIC",
        evidence_id: "gross_revenue",
        evidence_hash: hash("6"),
        summary: "Gross Revenue = sum(order_amount)",
        source_ref: null,
      },
    ],
    knowledge_refs: [],
  });
  const request = await buildResolvedContextRequest({
    schema_version: "resolved-context-request@1.0.0",
    request_id: id(46),
    scope,
    basis: {
      consumer: "RUN",
      run_id: runId,
      config_ref: { config_id: id(47), config_revision: 1, config_hash: hash("8") },
      context_receipt_ref: { receipt_id: id(48), receipt_hash: hash("9") },
    },
  });
  const receipt = await buildResolvedContextReceipt({
    schema_version: "resolved-context-receipt@1.0.0",
    receipt_id: id(49),
    scope,
    consumer: "RUN",
    request_id: request.request_id,
    request_hash: request.request_hash,
    run_id: runId,
    package_ref: {
      package_id: packageDocument.package_id,
      package_revision: 1,
      package_hash: packageDocument.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: packageDocument.authority_snapshot_hash,
    resolved_at: "2026-08-18T12:00:00.000Z",
  });
  return {
    schema_version: "resolved-context-commit-result@1.0.0" as const,
    disposition: "CREATED" as const,
    package: packageDocument,
    receipt,
  };
}

async function harness() {
  const displayEvents: unknown[] = [];
  const effectiveConfig = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: principalId,
    run_id: runId,
  });
  const materialized = await buildBuiltinTeamMaterialization({
    scope,
    model_profile_refs: resources(10),
    context_policy_refs: resources(20),
    execution_safety_policy_refs: resources(30),
  });
  const profiles = materialized.profile_revisions.map((revision) => ({
    schema_version: "agent-product-profile-registry-item@1.0.0" as const,
    revision,
    head: {
      schema_version: "agent-product-profile-head@1.0.0" as const,
      scope,
      profile_id: revision.profile_id,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED" as const,
      version: 1,
      updated_at: "2026-08-18T12:00:00.000Z",
    },
  }));
  const lease: RunWorkLease = {
    scope,
    principal_id: principalId,
    outbox_id: id(50),
    run_id: runId,
    command_id: id(51),
    command_kind: "START_DATA_AGENT_TEAM",
    attempt_id: id(52),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-team",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-18T12:05:00.000Z",
    payload: {
      kind: "START_DATA_AGENT_TEAM",
      effective_config_ref: effectiveConfigRef(effectiveConfig),
      profile_refs: profiles.map(({ revision }) => ({
        profile_id: revision.profile_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      })),
    },
  };
  const loaded = await createEffectiveConfigFixtureLoader(effectiveConfig)(lease);
  if (!loaded.ok) throw new Error("effective config fixture load failed");
  const consumption = loaded.value as {
    effective_config: typeof effectiveConfig;
    context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
  };
  const resolved = await resolvedContext();
  const context = createRunExecutionContext({
    lease,
    effective_config: consumption.effective_config,
    context_receipt: consumption.context_receipt,
    run_signal: new AbortController().signal,
    event_store: {
      findSideEffect: async () => ({ ok: true, value: null }),
      commitSideEffect: async () => ({
        ok: false,
        error: { code: "UNUSED", message: "unused", retryable: false },
      }),
      commitSnapshot: async () => ({
        ok: false,
        error: { code: "UNUSED", message: "unused", retryable: false },
      }),
    },
    now: () => new Date("2026-08-18T12:00:00.000Z"),
    create_id: () => id(60),
    side_effect_timeout_ms: 1_000,
    provider_dispatch: null,
    resolved_context: { resolve: async () => ({ ok: true, value: resolved }) },
    heartbeat: async () => ({ ok: true, value: { expires_at: lease.expires_at } }),
    guard_running_lease: async () => ({
      ok: false,
      error: { code: "UNUSED", message: "unused", retryable: false },
    }),
    append_checkpoint_event: async () => ({
      ok: false,
      error: { code: "UNUSED", message: "unused", retryable: false },
    }),
    append_side_effect_event: async () => ({
      ok: false,
      error: { code: "UNUSED", message: "unused", retryable: false },
    }),
    append_display_event: async (input) => {
      displayEvents.push(input);
      return { ok: true, value: { sequence: displayEvents.length } };
    },
  });
  return { context, lease, profiles, resolved, displayEvents, effectiveConfig };
}

describe("Data Agent Team runner", () => {
  it("passes only content-addressed Context identity to an accepted product runtime", async () => {
    const { context, lease, profiles, resolved, displayEvents } = await harness();
    const execute = vi.fn(async () => ({ status: "ACCEPTED", reason_code: "TEAM_ACCEPTED" }));
    const runner = createDataAgentTeamRunner({
      profiles: { listEnabled: async () => ({ ok: true, value: profiles }) },
      profile_capability_input: {},
      runtime: { execute },
    });
    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        resolved_context_ref: {
          package_id: resolved.package.package_id,
          package_hash: resolved.package.package_hash,
          receipt_id: resolved.receipt.receipt_id,
          receipt_hash: resolved.receipt.receipt_hash,
          semantic_domain: resolved.package.semantic_domain,
          semantic_release_id: resolved.package.semantic_release.resource_id,
          semantic_release_hash: resolved.package.semantic_release.resource_hash,
        },
      }),
    );
    expect(JSON.stringify(execute.mock.calls[0])).not.toMatch(/Gross Revenue|evidence|question/i);
    expect(displayEvents).toEqual([
      expect.objectContaining({ kind: "reasoning_started", key: "team.reasoning.started" }),
      expect.objectContaining({ kind: "reasoning_delta", key: "team.reasoning.profiles" }),
      expect.objectContaining({ kind: "reasoning_delta", key: "team.reasoning.context" }),
      expect.objectContaining({ kind: "reasoning_completed", key: "team.reasoning.completed" }),
    ]);
  });

  it("rejects stale Profile refs before runtime execution", async () => {
    const { context, lease, profiles } = await harness();
    const execute = vi.fn();
    const runner = createDataAgentTeamRunner({
      profiles: { listEnabled: async () => ({ ok: true, value: profiles.slice(1) }) },
      profile_capability_input: {},
      runtime: { execute },
    });
    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "DATA_AGENT_TEAM_PROFILE_STALE" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a Text2SQL-only adaptive lease when Report is not enabled", async () => {
    const { context, lease, profiles, effectiveConfig } = await harness();
    const text2sql = profiles.find(
      ({ revision }) => revision.profile_id === "governed-text2sql-agent",
    );
    expect(text2sql).toBeDefined();
    if (!text2sql) throw new TypeError("missing Text2SQL fixture");
    const selected = [
      {
        profile_id: text2sql.revision.profile_id,
        revision: text2sql.revision.revision,
        revision_hash: text2sql.revision.revision_hash,
      },
    ];
    const capabilityHash = await sha256ContentHash({ selected });
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(70),
      run_id: lease.run_id,
      question_class: "DATA_QUERY",
      mode: "TEAM",
      selected_profile_refs: selected,
      dependency_edges: [],
      required_evidence: ["ACCEPTED_QUERY_EVIDENCE", "FROZEN_SEMANTIC_RELEASE"],
      reason_codes: ["DATA_QUERY_SPECIALIST_REQUIRED"],
      capability_snapshot_hash: capabilityHash,
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: null,
    });
    const binding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: lease.run_id,
      effective_executor_version: "ADAPTIVE@1",
      dispatch_plan_ref: { plan_id: plan.plan_id, plan_hash: plan.plan_hash },
      selected_profile_refs: selected,
      policy_version: plan.policy_version,
      capability_snapshot_hash: plan.capability_snapshot_hash,
      shadow_dispatch_plan_ref: null,
    });
    const admission = await buildAgentDispatchExecuteAdmission({ kind: "EXECUTE", plan, binding });
    const adaptiveLease: RunWorkLease = {
      ...lease,
      payload: {
        schema_version: "effective-config-team-lease@2.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ADAPTIVE@1",
        effective_config_ref: effectiveConfigRef(effectiveConfig),
        profile_refs: selected,
        dispatch_plan: admission.plan,
        dispatch_binding: admission.binding,
      },
    };
    const execute = vi.fn(async ({ profiles: selectedProfiles }) => {
      expect([...selectedProfiles.keys()]).toEqual(["governed-text2sql-agent"]);
      return { status: "ACCEPTED" as const, reason_code: "TEXT2SQL_ONLY_ACCEPTED" };
    });
    const runner = createDataAgentTeamRunner({
      profiles: { listEnabled: async () => ({ ok: true, value: [text2sql] }) },
      profile_capability_input: {},
      runtime: { execute },
    });
    await expect(
      runner.execute({
        lease: adaptiveLease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("routes DIRECT to the zero-Agent executor without listing Product Profiles", async () => {
    const { context, lease, effectiveConfig } = await harness();
    const capabilityHash = await sha256ContentHash({ direct: true });
    const directReceipt = await buildDirectAdmissibilityReceipt({
      schema_version: "direct-admissibility-receipt@1.0.0",
      no_new_facts: true,
      no_governance_mutation: true,
      no_formal_report: true,
      policy_version: "adaptive-routing@1.0.0",
      capability_snapshot_hash: capabilityHash,
    });
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(71),
      run_id: lease.run_id,
      question_class: "EXPLANATION",
      mode: "DIRECT",
      selected_profile_refs: [],
      dependency_edges: [],
      required_evidence: ["DIRECT_PROVIDER_RECEIPT"],
      reason_codes: ["DIRECT_EXPLANATION_ADMISSIBLE"],
      capability_snapshot_hash: capabilityHash,
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: directReceipt,
    });
    const binding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: lease.run_id,
      effective_executor_version: "ADAPTIVE@1",
      dispatch_plan_ref: { plan_id: plan.plan_id, plan_hash: plan.plan_hash },
      selected_profile_refs: [],
      policy_version: plan.policy_version,
      capability_snapshot_hash: plan.capability_snapshot_hash,
      shadow_dispatch_plan_ref: null,
    });
    const adaptiveLease: RunWorkLease = {
      ...lease,
      payload: {
        schema_version: "effective-config-team-lease@2.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ADAPTIVE@1",
        effective_config_ref: effectiveConfigRef(effectiveConfig),
        profile_refs: [],
        dispatch_plan: plan,
        dispatch_binding: binding,
      },
    };
    const listEnabled = vi.fn();
    const direct = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const runtime = { execute: vi.fn() };
    const runner = createDataAgentTeamRunner({
      profiles: { listEnabled },
      profile_capability_input: {},
      runtime,
      direct,
    });
    await expect(
      runner.execute({
        lease: adaptiveLease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(direct.execute).toHaveBeenCalledOnce();
    expect(listEnabled).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();

    const mismatchedBinding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: lease.run_id,
      effective_executor_version: "ADAPTIVE@1",
      dispatch_plan_ref: { plan_id: id(72), plan_hash: plan.plan_hash },
      selected_profile_refs: [],
      policy_version: plan.policy_version,
      capability_snapshot_hash: plan.capability_snapshot_hash,
      shadow_dispatch_plan_ref: null,
    });
    await expect(
      runner.execute({
        lease: {
          ...adaptiveLease,
          payload: { ...adaptiveLease.payload, dispatch_binding: mismatchedBinding },
        },
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "DATA_AGENT_TEAM_LEASE_INVALID" });
    await expect(
      runner.execute({
        lease: {
          ...adaptiveLease,
          payload: {
            ...adaptiveLease.payload,
            dispatch_binding: {
              ...binding,
              binding_hash: `sha256:${"0".repeat(64)}`,
            },
          },
        },
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "AGENT_DISPATCH_RECEIPT_MISMATCH" });
    expect(direct.execute).toHaveBeenCalledOnce();
  });

  it("hands a v3 frozen Catalog decision to the Root runtime without legacy routing", async () => {
    const { context, lease, effectiveConfig, displayEvents } = await harness();
    const catalog = await buildSubagentCapabilityCatalogSnapshot({
      schema_version: "subagent-capability-catalog-snapshot@1.0.0",
      catalog_id: id(80),
      scope,
      run_id: lease.run_id,
      principal_id: principalId,
      policy_version: "root-harness@1.0.0",
      items: [],
    });
    const v3Lease: RunWorkLease = {
      ...lease,
      payload: {
        schema_version: "effective-config-team-lease@3.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ROOT_HARNESS@1",
        effective_config_ref: effectiveConfigRef(effectiveConfig),
        catalog_snapshot: catalog,
      },
    };
    const decision = {
      schema_version: "root-agent-turn-candidate@1.0.0" as const,
      kind: "FINAL_ANSWER" as const,
      scope,
      run_id: lease.run_id,
      catalog_snapshot_hash: catalog.snapshot_hash,
      sections: [
        {
          kind: "GENERAL_TEXT" as const,
          text: "同比是与上年同一时期比较。",
          basis: "GENERAL_KNOWLEDGE" as const,
          source_message_refs: [],
        },
      ],
      public_summary: "主 Agent 直接解释通用概念。",
    };
    const listEnabled = vi.fn();
    const root = { decide: vi.fn(async () => ({ ok: true as const, value: decision })) };
    const rootRuntime = {
      execute: vi.fn(async ({ decision: selected }) => {
        expect(selected).toEqual(decision);
        return { status: "ACCEPTED" as const, reason_code: "ROOT_DIRECT_ANSWER_ACCEPTED" };
      }),
    };
    const runner = createDataAgentTeamRunner({
      profiles: { listEnabled },
      profile_capability_input: {},
      runtime: { execute: vi.fn() },
      root,
      root_runtime: rootRuntime,
    });

    await expect(
      runner.execute({
        lease: v3Lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:05:00.000Z",
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(root.decide).toHaveBeenCalledOnce();
    expect(rootRuntime.execute).toHaveBeenCalledOnce();
    expect(listEnabled).not.toHaveBeenCalled();
    expect(displayEvents).toEqual([
      expect.objectContaining({
        kind: "reasoning_started",
        key: "root.decision.started",
        title: "主 Agent 正在判断是否调用专职 Agent",
      }),
      expect.objectContaining({
        kind: "reasoning_delta",
        key: "root.decision.selected",
        delta: "主 Agent 选择直接回答；未调用 Subagent。",
      }),
      expect.objectContaining({
        kind: "reasoning_completed",
        key: "root.answer.completed",
        summary: "主 Agent 直接回答已通过公开输出验证。",
      }),
    ]);
  });
});
