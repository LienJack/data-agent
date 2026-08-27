import { readFile } from "node:fs/promises";
import {
  type AdmittedSubagentDelegation,
  admitRootAgentDelegations,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  buildSubagentCapabilityCatalogSnapshot,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProductTeamArtifactDocument,
  projectSubagentCapabilityCatalogItem,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  RunDisplayEventInput,
  RunExecutionContext,
  RunSideEffectExecutionIdentity,
} from "../../src/runs/run-worker-runner.js";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";
import { createProductionTeamRuntime } from "../../src/teams/production-team-runtime.js";
import { buildTestQueryEvidenceSemanticBinding } from "../analysis/support/query-evidence-semantic-binding.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E2",
  baseline_id: id(4),
  baseline_hash: hash("a"),
  activation_attempt_id: id(5),
} as const;
const profileIds = [
  "governed-analysis-agent",
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

async function profiles(): Promise<ReadonlyMap<string, AgentProductProfileRegistryItemV2>> {
  const materialized = await buildBuiltinTeamMaterialization({
    scope,
    model_profile_refs: resources(10),
    context_policy_refs: resources(20),
    execution_safety_policy_refs: resources(30),
  });
  return new Map(
    materialized.profile_revisions.map((revision) => [
      revision.profile_id,
      {
        schema_version: "agent-product-profile-registry-item@2.0.0" as const,
        revision,
        head: {
          schema_version: "agent-product-profile-head@2.0.0" as const,
          scope,
          profile_id: revision.profile_id,
          active_revision: revision.revision,
          active_revision_hash: revision.revision_hash,
          lifecycle: "ENABLED" as const,
          version: 1,
          updated_at: "2026-08-18T12:00:00.000Z",
        },
      },
    ]),
  );
}

async function admittedDelegations(
  selected: readonly AgentProductProfileRegistryItemV2[],
  options: {
    readonly root_turn_index?: number;
    readonly input_artifact_refs?: ReadonlyMap<string, readonly ArtifactReference[]>;
  } = {},
): Promise<readonly AdmittedSubagentDelegation[]> {
  const catalog = await buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(97),
    scope,
    run_id: id(50),
    principal_id: id(3),
    policy_version: "subagent-catalog@1",
    items: await Promise.all(
      [...selected]
        .sort((left, right) => left.revision.profile_id.localeCompare(right.revision.profile_id))
        .map(projectSubagentCapabilityCatalogItem),
    ),
  });
  const admitted = await admitRootAgentDelegations({
    decision: {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "TOOL_CALLS",
      scope,
      run_id: id(50),
      catalog_snapshot_hash: catalog.snapshot_hash,
      public_summary: "选择冻结目录中的专职 Agent 完成受治理任务。",
      tool_calls: selected.map(({ revision }, index) => {
        return {
          tool_name: "delegate_to_subagent@2",
          tool_call_id: `specialist-${index + 1}`,
          profile_id: revision.profile_id,
          objective: `执行 ${revision.discovery.display_name} 的冻结职责。`,
          requested_artifact_types: revision.expected_output_artifact_types,
          input_artifact_refs: [...(options.input_artifact_refs?.get(revision.profile_id) ?? [])],
          requested_budget: {
            timeout_ms: 60_000,
            max_steps: revision.direct_tool_allowlist.length + 1,
            max_input_tokens: 4_096,
            max_output_tokens: 2_048,
            max_tool_calls: revision.direct_tool_allowlist.length,
            max_context_bytes: 16_384,
          },
        };
      }),
    },
    catalog,
    profiles: selected,
    run_ceiling: {
      timeout_ms: 60_000,
      max_steps: 4,
      max_input_tokens: 8_192,
      max_output_tokens: 4_096,
      max_tool_calls: 8,
      max_context_bytes: 32_768,
    },
    profile_ceiling: (profile) => ({
      timeout_ms: 60_000,
      max_steps: profile.revision.direct_tool_allowlist.length + 1,
      max_input_tokens: 4_096,
      max_output_tokens: 2_048,
      max_tool_calls: profile.revision.direct_tool_allowlist.length,
      max_context_bytes: 16_384,
    }),
    artifact_is_accepted: async () => true,
    delegation_identity_namespace: `delegation:${id(50)}:${options.root_turn_index ?? 0}`,
  });
  return admitted;
}

async function admittedSemanticDelegation(
  profile: AgentProductProfileRegistryItemV2,
): Promise<AdmittedSubagentDelegation> {
  const delegation = (await admittedDelegations([profile]))[0];
  if (!delegation) throw new TypeError("missing admitted semantic delegation fixture");
  return delegation;
}

function reference(
  artifactType: "SqlArtifact" | "QueryEvidence" | "AnalysisReport",
  taskId: string,
): ArtifactReference {
  return {
    artifact_id: taskId,
    artifact_type: artifactType,
    ...scope,
    run_id: id(50),
    revision: 1,
    content_hash: hash(artifactType === "AnalysisReport" ? "a" : "e"),
  };
}

async function queryProvenance(outputName: string) {
  return {
    kind: "GOVERNED_QUERY_RESULT" as const,
    query_id: id(70),
    request_hash: hash("1"),
    result_hash: hash("2"),
    row_count: 1,
    byte_count: 32,
    elapsed_ms: 4,
    truncated: false as const,
    semantic_binding: await buildTestQueryEvidenceSemanticBinding({
      columns: [
        {
          name: outputName,
          logical_type: "NUMBER",
          nullable: false,
          semantic_role: "METRIC",
          semantic_object_id: `metric.${outputName}`,
        },
      ],
    }),
  };
}

async function lease() {
  const catalog = await buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(98),
    scope,
    run_id: id(50),
    principal_id: id(3),
    policy_version: "root-harness@1.0.0",
    items: [],
  });
  return {
    scope,
    principal_id: id(3),
    outbox_id: id(51),
    run_id: id(50),
    command_id: id(52),
    command_kind: "START_DATA_AGENT_TEAM" as const,
    attempt_id: id(53),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "team-worker",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-18T12:00:30.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {
      schema_version: "effective-config-team-lease@3.0.0" as const,
      kind: "START_DATA_AGENT_TEAM" as const,
      executor_version: "ROOT_HARNESS@1" as const,
      effective_config_ref: { config_id: id(54), config_revision: 1, config_hash: hash("c") },
      catalog_snapshot: catalog,
      visible_message_refs: [id(99)],
    },
  };
}

function executionContext(events: unknown[]): RunExecutionContext {
  return {
    getEffectiveConfig: () =>
      ({
        context_policy: {
          max_context_tokens: 16_384,
        },
        execution_safety_policy: {
          max_tool_calls: 8,
          max_provider_calls: 2,
          max_elapsed_ms: 60_000,
        },
      }) as ReturnType<RunExecutionContext["getEffectiveConfig"]>,
    getContextReceipt: vi.fn(),
    getProviderDispatchCapability: () => null,
    heartbeat: vi.fn(),
    checkpoint: vi.fn(),
    emitDisplayEvent: async (event: RunDisplayEventInput) => {
      events.push(event);
      return { ok: true, value: { sequence: events.length } };
    },
    executeSideEffectOnce: async ({
      effect_kind,
      execute,
    }: {
      effect_kind: "SQL" | "EVAL";
      execute: (
        identity: RunSideEffectExecutionIdentity,
      ) => Promise<{ output: unknown; artifact_ref?: ArtifactReference }>;
    }) => {
      const result = await execute({
        idempotency_key: hash("i"),
        input_hash: hash("n"),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      });
      return {
        ok: true,
        value: {
          schema_version: "1.0.0",
          receipt_id: id(events.length + 200),
          scope,
          run_id: id(50),
          effect_kind,
          input_hash: hash("n"),
          output_hash: hash("o"),
          worker_fence: 1,
          artifact_ref: result.artifact_ref,
          committed_at: "2026-08-18T12:00:00.000Z",
        },
      };
    },
  } as unknown as RunExecutionContext;
}

function store(calls: Array<{ operation: string; document: unknown }>, loaded: unknown = null) {
  const invoke = async (_capability: unknown, command: unknown) => {
    const value = command as { operation: string; document: unknown };
    calls.push(value);
    return {
      ok: true as const,
      value: { document: value.operation === "LOAD_RUN" ? loaded : value.document },
    };
  };
  return {
    createTask: invoke,
    prepareHandoff: invoke,
    commitContextEpoch: invoke,
    commitCompletion: invoke,
    commitAcceptance: invoke,
    attachAcceptedSiblingOutput: invoke,
    issueTaskCapability: invoke,
    loadRun: invoke,
  };
}

describe("Production Team runtime", () => {
  it("keeps public identities deterministic and the runtime surface-neutral", async () => {
    const source = await readFile(
      new URL("../../src/teams/production-team-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/(?:from|import\()[^\n]*(?:apps\/web|desktop|tui)/iu);
    expect(source).not.toMatch(/(?:surface|client_type)\s*(?:===|switch)/iu);

    const { productionTeamRuntimeInternals } = await import(
      "../../src/teams/production-team-runtime.js"
    );
    expect(productionTeamRuntimeInternals.identity(id(50), "task:root")).toBe(
      productionTeamRuntimeInternals.identity(id(50), "task:root"),
    );
    expect(productionTeamRuntimeInternals.identity(id(50), "task:root")).not.toBe(
      productionTeamRuntimeInternals.identity(id(50), "task:report-writing-agent"),
    );
  });

  it("persists team transitions before public status and accepts committed specialist outputs", async () => {
    const profileMap = await profiles();
    const text2sql = profileMap.get("governed-text2sql-agent");
    const report = profileMap.get("report-writing-agent");
    if (!text2sql || !report) throw new TypeError("missing Root delegation fixtures");
    const queryDelegations = await admittedDelegations([text2sql], { root_turn_index: 0 });
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const invoked: string[] = [];
    const documents = new Map<string, ProductTeamArtifactDocument>();
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ task, tool_id }) {
          invoked.push(`${task.profile_id}:${tool_id}`);
          if (tool_id === "sql.compiler.compile") return reference("SqlArtifact", id(81));
          if (tool_id === "sql.sandbox.execute") {
            const output = reference("QueryEvidence", id(82));
            const document = await buildProductTeamArtifactDocument({
              schema_version: "product-team-artifact@2.0.0",
              artifact_ref: output,
              profile_id: "governed-text2sql-agent",
              task_id: task.task_id,
              source_refs: [reference("SqlArtifact", id(81))],
              provenance: await queryProvenance("table_count"),
              projection: {
                kind: "TABLE",
                columns: [{ key: "table_count", label: "table_count", data_type: "NUMBER" }],
                rows: [{ table_count: 14 }],
                total_rows: 1,
              },
              committed_at: "2026-08-18T12:00:00.000Z",
            });
            documents.set(output.artifact_id, document);
            return document.artifact_ref;
          }
          if (tool_id === "evidence.read") return reference("QueryEvidence", id(82));
          if (tool_id === "report.project") {
            const output = reference("AnalysisReport", id(83));
            const document = await buildProductTeamArtifactDocument({
              schema_version: "product-team-artifact@2.0.0",
              artifact_ref: output,
              profile_id: "report-writing-agent",
              task_id: task.task_id,
              source_refs: [reference("QueryEvidence", id(82))],
              provenance: null,
              projection: {
                kind: "REPORT",
                title: "E-commerce 数据库表数量",
                sections: [{ heading: "结论", body_text: "共有 14 张表。", source_refs: [] }],
              },
              committed_at: "2026-08-18T12:00:00.000Z",
            });
            documents.set(output.artifact_id, document);
            return document.artifact_ref;
          }
          return null;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async (artifactReference) => ({
          ok: true,
          value: documents.get(artifactReference.artifact_id) ?? null,
        }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });

    const runLease = await lease();
    const semanticContextRef = {
      package_id: id(60),
      package_hash: hash("p"),
      receipt_id: id(61),
      receipt_hash: hash("r"),
      semantic_domain: "commerce",
      semantic_release_id: id(41),
      semantic_release_hash: hash("s"),
    } as const;
    const queryResult = await runtime.execute({
      lease: runLease,
      root_turn_index: 0,
      authority,
      profiles: new Map([["governed-text2sql-agent", text2sql]]),
      admitted_delegations: queryDelegations,
      semantic_context_package: {} as never,
      semantic_context: {} as never,
      semantic_context_ref: semanticContextRef,
      restored_snapshot: null,
      execution_context: executionContext(events),
      signal: new AbortController().signal,
      deadline_at: "2026-08-18T12:01:00.000Z",
    });
    expect(queryResult).toMatchObject({
      status: "COMPLETED",
      reason_code: "TEAM_ACCEPTED",
      observations: [{ tool_call_id: "specialist-1", status: "COMPLETED" }],
    });
    const acceptedQueryEvidence = documents.get(id(82))?.artifact_ref;
    expect(acceptedQueryEvidence).toBeDefined();
    if (!acceptedQueryEvidence) throw new TypeError("missing accepted query evidence");
    const reportDelegations = await admittedDelegations([report], {
      root_turn_index: 1,
      input_artifact_refs: new Map([["report-writing-agent", [acceptedQueryEvidence]]]),
    });
    const reportResult = await runtime.execute({
      lease: runLease,
      root_turn_index: 1,
      authority,
      profiles: new Map([["report-writing-agent", report]]),
      admitted_delegations: reportDelegations,
      semantic_context_package: {} as never,
      semantic_context: {} as never,
      semantic_context_ref: semanticContextRef,
      restored_snapshot: null,
      execution_context: executionContext(events),
      signal: new AbortController().signal,
      deadline_at: "2026-08-18T12:01:00.000Z",
    });
    expect(reportResult).toMatchObject({
      status: "COMPLETED",
      reason_code: "TEAM_ACCEPTED",
      observations: [{ tool_call_id: "specialist-1", status: "COMPLETED" }],
    });

    expect(calls.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining([
        "CREATE_TASK",
        "ISSUE_TASK_CAPABILITY",
        "PREPARE_HANDOFF",
        "COMMIT_CONTEXT_EPOCH",
        "COMMIT_COMPLETION",
        "COMMIT_ACCEPTANCE",
      ]),
    );
    expect(calls.filter(({ operation }) => operation === "PREPARE_HANDOFF")).toHaveLength(2);
    expect(
      calls.filter(({ operation }) => operation === "ATTACH_ACCEPTED_SIBLING_OUTPUT"),
    ).toHaveLength(0);
    expect(calls.filter(({ operation }) => operation === "COMMIT_ACCEPTANCE")).toHaveLength(2);
    expect(invoked).toEqual([
      "governed-text2sql-agent:semantic.release.read",
      "governed-text2sql-agent:sql.compiler.compile",
      "governed-text2sql-agent:sql.sandbox.execute",
      "report-writing-agent:evidence.read",
      "report-writing-agent:report.project",
    ]);
    const statuses = events
      .filter((event) => (event as { kind: string }).kind === "agent_status")
      .map((event) => (event as { status: string }).status);
    expect(statuses).toEqual([
      "PENDING",
      "RUNNING",
      "COMPLETED",
      "PENDING",
      "RUNNING",
      "COMPLETED",
    ]);
    const secondHandoff = calls.findLastIndex(({ operation }) => operation === "PREPARE_HANDOFF");
    const secondHandoffDocument = calls[secondHandoff]?.document as
      | { child_task?: { artifact_refs?: readonly ArtifactReference[] } }
      | undefined;
    expect(secondHandoffDocument?.child_task?.artifact_refs).toEqual([acceptedQueryEvidence]);
  });

  it("returns an accepted replay without dispatching tools", async () => {
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const tool = vi.fn();
    const profileMap = await profiles();
    const report = profileMap.get("report-writing-agent");
    if (!report) throw new TypeError("missing replay Profile fixture");
    const delegations = await admittedDelegations([report]);
    const taskId = delegations[0]?.receipt.task_id;
    if (!taskId) throw new TypeError("missing replay delegation fixture");
    const document = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
      artifact_ref: reference("AnalysisReport", id(90)),
      profile_id: "report-writing-agent",
      task_id: taskId,
      source_refs: [reference("QueryEvidence", id(89))],
      provenance: null,
      projection: {
        kind: "REPORT",
        title: "已验收重放",
        sections: [{ heading: "结论", body_text: "这是已验收的重放答案。", source_refs: [] }],
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    const output = document.artifact_ref;
    const replayLease = await lease();
    const semanticContextRef = {
      package_id: id(60),
      package_hash: hash("p"),
      receipt_id: id(61),
      receipt_hash: hash("r"),
      semantic_domain: "commerce",
      semantic_release_id: id(41),
      semantic_release_hash: hash("s"),
    };
    const runtime = createProductionTeamRuntime({
      store: store(calls, {
        task: {
          task_id: taskId,
          run_id: replayLease.run_id,
          attempt_id: replayLease.attempt_id,
          worker_fence: replayLease.worker_fence,
          profile_id: report.revision.runtime_profile_ref.profile_id,
          profile_revision: report.revision.runtime_profile_ref.revision,
          profile_hash: report.revision.runtime_profile_ref.profile_hash,
        },
        context_epochs: [
          {
            phase: "ACTIVATED",
            proposed_epoch: { build_signature: await sha256ContentHash(semanticContextRef) },
          },
        ],
        completions: [{ completion_id: id(91), output_ref: output }],
        acceptances: [{ completion_id: id(91), status: "ACCEPTED" }],
      }),
      capability: {},
      tools: { invoke: tool },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: document }),
      },
    });
    const result = await runtime.execute({
      lease: replayLease,
      root_turn_index: 0,
      authority,
      profiles: new Map([["report-writing-agent", report]]),
      admitted_delegations: delegations,
      semantic_context_package: {} as never,
      semantic_context: {} as never,
      semantic_context_ref: semanticContextRef,
      restored_snapshot: null,
      execution_context: executionContext(events),
      signal: new AbortController().signal,
      deadline_at: "2026-08-18T12:01:00.000Z",
    });
    expect(result).toMatchObject({
      status: "COMPLETED",
      reason_code: "TEAM_ACCEPTED_REPLAY",
      observations: [{ tool_call_id: "specialist-1", status: "COMPLETED" }],
    });
    expect(tool).not.toHaveBeenCalled();
    expect(calls.map(({ operation }) => operation)).toEqual(["LOAD_RUN"]);
    expect(events).not.toContainEqual(expect.objectContaining({ kind: "answer_delta" }));
  });

  it("does not pre-create a later tool call when the current call fails", async () => {
    const profileMap = await profiles();
    const text2sql = profileMap.get("governed-text2sql-agent");
    if (!text2sql) throw new TypeError("missing fail-closed fixtures");
    const calls: Array<{ operation: string; document: unknown }> = [];
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke() {
          throw new Error("UPSTREAM_EXECUTION_FAILED");
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: null }),
      },
    });

    await expect(
      runtime.execute({
        lease: await lease(),
        root_turn_index: 0,
        authority,
        profiles: new Map([["governed-text2sql-agent", text2sql]]),
        admitted_delegations: await admittedDelegations([text2sql]),
        semantic_context_package: {} as never,
        semantic_context: {} as never,
        semantic_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
          semantic_domain: "commerce",
          semantic_release_id: id(41),
          semantic_release_hash: hash("s"),
        },
        restored_snapshot: null,
        execution_context: executionContext([]),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "FAILED" });
    expect(calls.filter(({ operation }) => operation === "PREPARE_HANDOFF")).toHaveLength(1);
    expect(calls.some(({ operation }) => operation === "ATTACH_ACCEPTED_SIBLING_OUTPUT")).toBe(
      false,
    );
  });

  it("runs a Report from ordinary accepted input_artifact_refs", async () => {
    const profileMap = await profiles();
    const report = profileMap.get("report-writing-agent");
    if (!report) throw new TypeError("missing adaptive Report fixtures");
    const acceptedInput = reference("QueryEvidence", id(93));
    const delegations = await admittedDelegations([report], {
      root_turn_index: 1,
      input_artifact_refs: new Map([["report-writing-agent", [acceptedInput]]]),
    });
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const documents = new Map<string, ProductTeamArtifactDocument>();
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ task, tool_id }) {
          if (tool_id === "sql.compiler.compile") return reference("SqlArtifact", id(91));
          if (tool_id === "sql.sandbox.execute") {
            const output = reference("QueryEvidence", id(93));
            const document = await buildProductTeamArtifactDocument({
              schema_version: "product-team-artifact@2.0.0",
              artifact_ref: output,
              profile_id: "governed-text2sql-agent",
              task_id: task.task_id,
              source_refs: [reference("SqlArtifact", id(91))],
              provenance: await queryProvenance("value"),
              projection: {
                kind: "TABLE",
                columns: [{ key: "value", label: "value", data_type: "NUMBER" }],
                rows: [{ value: 1 }],
                total_rows: 1,
              },
              committed_at: "2026-08-18T12:00:00.000Z",
            });
            documents.set(output.artifact_id, document);
            return document.artifact_ref;
          }
          if (tool_id === "evidence.read") return reference("QueryEvidence", id(93));
          if (tool_id === "report.project") {
            const output = reference("AnalysisReport", id(94));
            const document = await buildProductTeamArtifactDocument({
              schema_version: "product-team-artifact@2.0.0",
              artifact_ref: output,
              profile_id: "report-writing-agent",
              task_id: task.task_id,
              source_refs: [reference("QueryEvidence", id(93))],
              provenance: null,
              projection: {
                kind: "REPORT",
                title: "Adaptive Report",
                sections: [{ heading: "结论", body_text: "已验收。", source_refs: [] }],
              },
              committed_at: "2026-08-18T12:00:00.000Z",
            });
            documents.set(output.artifact_id, document);
            return document.artifact_ref;
          }
          return null;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async (artifactReference) => ({
          ok: true,
          value: documents.get(artifactReference.artifact_id) ?? null,
        }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });

    await expect(
      runtime.execute({
        lease: await lease(),
        root_turn_index: 1,
        authority,
        profiles: new Map([["report-writing-agent", report]]),
        admitted_delegations: delegations,
        semantic_context_package: {} as never,
        semantic_context: {} as never,
        semantic_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
          semantic_domain: "commerce",
          semantic_release_id: id(41),
          semantic_release_hash: hash("s"),
        },
        restored_snapshot: null,
        execution_context: executionContext(events),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      reason_code: "TEAM_ACCEPTED",
      observations: [{ tool_call_id: "specialist-1", status: "COMPLETED" }],
    });
    expect(calls.filter(({ operation }) => operation === "PREPARE_HANDOFF")).toHaveLength(1);
    const delegatedProfileIds = calls
      .filter(({ operation }) => operation === "PREPARE_HANDOFF")
      .map(
        ({ document }) =>
          (document as { child_task?: { profile_id?: string } }).child_task?.profile_id,
      );
    expect(delegatedProfileIds).toEqual(["report-writing-agent"]);
    expect(JSON.stringify(events)).not.toContain("semantic-management-agent");
    expect(events).not.toContainEqual(expect.objectContaining({ status: "SKIPPED" }));
  });

  it("executes an admitted semantic delegation read-only instead of skipping it", async () => {
    const profileMap = await profiles();
    const semantic = profileMap.get("semantic-management-agent");
    expect(semantic).toBeDefined();
    if (!semantic) throw new TypeError("missing semantic fixture");
    const delegation = await admittedSemanticDelegation(semantic);
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const invoked: string[] = [];
    const documents: ProductTeamArtifactDocument[] = [];
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ task, tool_id }) {
          invoked.push(tool_id);
          const output = reference("AnalysisReport", id(96));
          const document = await buildProductTeamArtifactDocument({
            schema_version: "product-team-artifact@2.0.0",
            artifact_ref: output,
            profile_id: "semantic-management-agent",
            task_id: task.task_id,
            source_refs: [],
            provenance: null,
            projection: {
              kind: "REPORT",
              title: "冻结语义层说明",
              sections: [{ heading: "结论", body_text: "只读语义层。", source_refs: [] }],
            },
            committed_at: "2026-08-18T12:00:00.000Z",
          });
          documents.push(document);
          return document.artifact_ref;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: documents.at(-1) ?? null }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });
    await expect(
      runtime.execute({
        lease: await lease(),
        root_turn_index: 0,
        authority,
        profiles: new Map([["semantic-management-agent", semantic]]),
        admitted_delegations: [delegation],
        semantic_context_package: {} as never,
        semantic_context: {} as never,
        semantic_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
          semantic_domain: "commerce",
          semantic_release_id: id(41),
          semantic_release_hash: hash("s"),
        },
        restored_snapshot: null,
        execution_context: executionContext(events),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      reason_code: "TEAM_ACCEPTED",
      observations: [{ tool_call_id: "specialist-1", status: "COMPLETED" }],
    });
    expect(invoked).toEqual(["semantic.catalog.read"]);
    expect(invoked).not.toContain("semantic.candidate.write");
    expect(documents[0]?.artifact_ref.artifact_type).toBe("AnalysisReport");
    expect(
      JSON.stringify(calls.filter(({ operation }) => operation === "COMMIT_COMPLETION")),
    ).not.toContain("SemanticGraphCandidate");
  });

  it("executes independent calls from one Root turn concurrently", async () => {
    const profileMap = await profiles();
    const semantic = profileMap.get("semantic-management-agent");
    const text2sql = profileMap.get("governed-text2sql-agent");
    if (!semantic || !text2sql) throw new TypeError("missing independent delegation fixtures");
    const delegations = await admittedDelegations([semantic, text2sql]);
    expect(delegations.every(({ receipt }) => receipt.input_artifact_refs.length === 0)).toBe(true);
    const calls: Array<{ operation: string; document: unknown }> = [];
    const documents = new Map<string, ProductTeamArtifactDocument>();
    const starters = new Set<string>();
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const reachBarrier = async (profileId: string) => {
      starters.add(profileId);
      if (starters.size === 2) releaseBarrier?.();
      await Promise.race([
        barrier,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("INDEPENDENT_BATCH_NOT_PARALLEL")), 1_000),
        ),
      ]);
    };
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ task, tool_id }) {
          if (tool_id === "semantic.catalog.read" || tool_id === "semantic.release.read") {
            await reachBarrier(task.profile_id);
          }
          if (task.profile_id === "semantic-management-agent") {
            const output = reference("AnalysisReport", id(110));
            documents.set(
              output.artifact_id,
              await buildProductTeamArtifactDocument({
                schema_version: "product-team-artifact@2.0.0",
                artifact_ref: output,
                profile_id: task.profile_id,
                task_id: task.task_id,
                source_refs: [],
                provenance: null,
                projection: {
                  kind: "REPORT",
                  title: "Semantic",
                  sections: [{ heading: "结论", body_text: "语义已解析。", source_refs: [] }],
                },
                committed_at: "2026-08-18T12:00:00.000Z",
              }),
            );
            return documents.get(output.artifact_id)?.artifact_ref ?? null;
          }
          if (tool_id === "sql.compiler.compile") return reference("SqlArtifact", id(111));
          if (tool_id === "sql.sandbox.execute") {
            const output = reference("QueryEvidence", id(112));
            documents.set(
              output.artifact_id,
              await buildProductTeamArtifactDocument({
                schema_version: "product-team-artifact@2.0.0",
                artifact_ref: output,
                profile_id: task.profile_id,
                task_id: task.task_id,
                source_refs: [reference("SqlArtifact", id(111))],
                provenance: await queryProvenance("value"),
                projection: {
                  kind: "TABLE",
                  columns: [{ key: "value", label: "value", data_type: "NUMBER" }],
                  rows: [{ value: 1 }],
                  total_rows: 1,
                },
                committed_at: "2026-08-18T12:00:00.000Z",
              }),
            );
            return documents.get(output.artifact_id)?.artifact_ref ?? null;
          }
          return null;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async (artifactReference) => ({
          ok: true,
          value: documents.get(artifactReference.artifact_id) ?? null,
        }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });

    const result = await runtime.execute({
      lease: await lease(),
      root_turn_index: 0,
      authority,
      profiles: new Map([
        [semantic.revision.profile_id, semantic],
        [text2sql.revision.profile_id, text2sql],
      ]),
      admitted_delegations: delegations,
      semantic_context_package: {} as never,
      semantic_context: {} as never,
      semantic_context_ref: {
        package_id: id(60),
        package_hash: hash("p"),
        receipt_id: id(61),
        receipt_hash: hash("r"),
        semantic_domain: "commerce",
        semantic_release_id: id(41),
        semantic_release_hash: hash("s"),
      },
      restored_snapshot: null,
      execution_context: executionContext([]),
      signal: new AbortController().signal,
      deadline_at: "2026-08-18T12:01:00.000Z",
    });
    expect(result.reason_code).toBe("TEAM_ACCEPTED");
    expect(result).toMatchObject({
      status: "COMPLETED",
      observations: [
        { profile_id: "semantic-management-agent" },
        { profile_id: "governed-text2sql-agent" },
      ],
    });
    expect([...starters].sort()).toEqual(["governed-text2sql-agent", "semantic-management-agent"]);
  });
});
