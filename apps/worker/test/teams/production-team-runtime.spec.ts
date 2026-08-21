import { readFile } from "node:fs/promises";
import {
  type AgentProductProfileRegistryItem,
  type ArtifactReference,
  buildAgentDispatchPlan,
  buildProductTeamArtifactDocument,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  RunDisplayEventInput,
  RunExecutionContext,
  RunSideEffectExecutionIdentity,
} from "../../src/runs/run-worker-runner.js";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";
import { createProductionTeamRuntime } from "../../src/teams/production-team-runtime.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
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

async function profiles(): Promise<
  ReadonlyMap<(typeof profileIds)[number], AgentProductProfileRegistryItem>
> {
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
      },
    ]),
  );
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

function lease() {
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
    payload: {
      kind: "START_DATA_AGENT_TEAM" as const,
      effective_config_ref: { config_id: id(54), config_revision: 1, config_hash: hash("c") },
      profile_refs: profileIds.map((profileId, index) => ({
        profile_id: profileId,
        revision: 1,
        revision_hash: hash(String(index + 1)),
      })),
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
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const invoked: string[] = [];
    const reportDocument = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@1.0.0",
      artifact_ref: reference("AnalysisReport", id(83)),
      profile_id: "report-writing-agent",
      task_id: id(83),
      source_refs: [],
      projection: {
        kind: "REPORT",
        title: "E-commerce 数据库表数量",
        sections: [{ heading: "结论", body_text: "共有 14 张表。", source_refs: [] }],
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ task, tool_id }) {
          invoked.push(`${task.profile_id}:${tool_id}`);
          if (tool_id === "sql.compiler.compile") return reference("SqlArtifact", id(81));
          if (tool_id === "sql.sandbox.execute") return reference("QueryEvidence", id(82));
          if (tool_id === "evidence.read") return reference("QueryEvidence", id(82));
          if (tool_id === "report.project") return reportDocument.artifact_ref;
          return null;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: reportDocument }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });

    await expect(
      runtime.execute({
        lease: lease(),
        profiles: await profiles(),
        resolved_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
        },
        restored_snapshot: null,
        execution_context: executionContext(events),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toEqual({ status: "ACCEPTED", reason_code: "TEAM_ACCEPTED" });

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
    expect(calls.filter(({ operation }) => operation === "PREPARE_HANDOFF")).toHaveLength(3);
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
      "PENDING",
      "PENDING",
      "SKIPPED",
      "RUNNING",
      "COMPLETED",
      "RUNNING",
      "COMPLETED",
    ]);
  });

  it("returns an accepted replay without dispatching tools", async () => {
    const calls: Array<{ operation: string; document: unknown }> = [];
    const tool = vi.fn();
    const output = reference("AnalysisReport", id(90));
    const runtime = createProductionTeamRuntime({
      store: store(calls, {
        completions: [{ completion_id: id(91), output_ref: output }],
        acceptances: [{ completion_id: id(91), status: "ACCEPTED" }],
      }),
      capability: {},
      tools: { invoke: tool },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: null }),
      },
    });
    await expect(
      runtime.execute({
        lease: lease(),
        profiles: await profiles(),
        resolved_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
        },
        restored_snapshot: null,
        execution_context: executionContext([]),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toEqual({ status: "ACCEPTED", reason_code: "TEAM_ACCEPTED_REPLAY" });
    expect(tool).not.toHaveBeenCalled();
    expect(calls.map(({ operation }) => operation)).toEqual(["LOAD_RUN"]);
  });

  it("runs adaptive Report with Text2SQL and Report only", async () => {
    const profileMap = await profiles();
    const text2sql = profileMap.get("governed-text2sql-agent");
    const report = profileMap.get("report-writing-agent");
    if (!text2sql || !report) throw new TypeError("missing adaptive Report fixtures");
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(92),
      run_id: id(50),
      question_class: "REPORT",
      mode: "TEAM",
      selected_profile_refs: [text2sql, report].map(({ revision }) => ({
        profile_id: revision.profile_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      })),
      dependency_edges: [
        {
          from_profile_id: "governed-text2sql-agent",
          to_profile_id: "report-writing-agent",
          evidence_requirement: "ACCEPTED_QUERY_EVIDENCE",
        },
      ],
      required_evidence: [
        "ACCEPTED_QUERY_EVIDENCE",
        "ACCEPTED_REPORT_ARTIFACT",
        "FROZEN_SEMANTIC_RELEASE",
      ],
      reason_codes: ["REPORT_SPECIALIST_REQUIRED"],
      capability_snapshot_hash: hash("4"),
      policy_version: "adaptive-routing@1.0.0+rollout.2",
      direct_admissibility_receipt: null,
    });
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const reportDocument = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@1.0.0",
      artifact_ref: reference("AnalysisReport", id(94)),
      profile_id: "report-writing-agent",
      task_id: id(94),
      source_refs: [reference("QueryEvidence", id(93))],
      projection: {
        kind: "REPORT",
        title: "Adaptive Report",
        sections: [{ heading: "结论", body_text: "已验收。", source_refs: [] }],
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ tool_id }) {
          if (tool_id === "sql.compiler.compile") return reference("SqlArtifact", id(91));
          if (tool_id === "sql.sandbox.execute") return reference("QueryEvidence", id(93));
          if (tool_id === "evidence.read") return reference("QueryEvidence", id(93));
          if (tool_id === "report.project") return reportDocument.artifact_ref;
          return null;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: reportDocument }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });

    await expect(
      runtime.execute({
        lease: lease(),
        profiles: new Map([
          ["governed-text2sql-agent", text2sql],
          ["report-writing-agent", report],
        ]),
        dispatch_plan: plan,
        resolved_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
        },
        restored_snapshot: null,
        execution_context: executionContext(events),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toEqual({ status: "ACCEPTED", reason_code: "TEAM_ACCEPTED" });
    expect(calls.filter(({ operation }) => operation === "PREPARE_HANDOFF")).toHaveLength(2);
    const delegatedProfileIds = calls
      .filter(({ operation }) => operation === "PREPARE_HANDOFF")
      .map(
        ({ document }) =>
          (document as { child_task?: { profile_id?: string } }).child_task?.profile_id,
      );
    expect(delegatedProfileIds).toEqual(["governed-text2sql-agent", "report-writing-agent"]);
    expect(JSON.stringify(events)).not.toContain("semantic-management-agent");
    expect(events).not.toContainEqual(expect.objectContaining({ status: "SKIPPED" }));
  });

  it("keeps SEMANTIC_READ read-only and emits no candidate write or candidate artifact", async () => {
    const profileMap = await profiles();
    const semantic = profileMap.get("semantic-management-agent");
    expect(semantic).toBeDefined();
    if (!semantic) throw new TypeError("missing semantic fixture");
    const semanticRef = {
      profile_id: semantic.revision.profile_id,
      revision: semantic.revision.revision,
      revision_hash: semantic.revision.revision_hash,
    };
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(95),
      run_id: id(50),
      question_class: "SEMANTIC_READ",
      mode: "TEAM",
      selected_profile_refs: [semanticRef],
      dependency_edges: [],
      required_evidence: ["FROZEN_SEMANTIC_RELEASE"],
      reason_codes: ["SEMANTIC_READ_SPECIALIST_REQUIRED"],
      capability_snapshot_hash: hash("4"),
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: null,
    });
    const calls: Array<{ operation: string; document: unknown }> = [];
    const events: unknown[] = [];
    const invoked: string[] = [];
    const draftOutput = reference("AnalysisReport", id(96));
    const document = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@1.0.0",
      artifact_ref: draftOutput,
      profile_id: "semantic-management-agent",
      task_id: id(96),
      source_refs: [],
      projection: {
        kind: "REPORT",
        title: "冻结语义层说明",
        sections: [{ heading: "语义层", body_text: "只读语义层。", source_refs: [] }],
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    const output = document.artifact_ref;
    const runtime = createProductionTeamRuntime({
      store: store(calls),
      capability: {},
      tools: {
        async invoke({ tool_id }) {
          invoked.push(tool_id);
          return output;
        },
      },
      artifacts: {
        verifyCommitted: async () => ({ ok: true, value: true }),
        resolveCommitted: async () => ({ ok: true, value: document }),
      },
      now: () => new Date("2026-08-18T12:00:01.000Z"),
    });
    await expect(
      runtime.execute({
        lease: lease(),
        profiles: new Map([["semantic-management-agent", semantic]]),
        dispatch_plan: plan,
        resolved_context_ref: {
          package_id: id(60),
          package_hash: hash("p"),
          receipt_id: id(61),
          receipt_hash: hash("r"),
        },
        restored_snapshot: null,
        execution_context: executionContext(events),
        signal: new AbortController().signal,
        deadline_at: "2026-08-18T12:01:00.000Z",
      }),
    ).resolves.toEqual({ status: "ACCEPTED", reason_code: "TEAM_ACCEPTED" });
    expect(invoked).toEqual(["semantic.catalog.read"]);
    expect(invoked).not.toContain("semantic.candidate.write");
    expect(document.artifact_ref.artifact_type).toBe("AnalysisReport");
    expect(
      JSON.stringify(calls.filter(({ operation }) => operation === "COMMIT_COMPLETION")),
    ).not.toContain("SemanticGraphCandidate");
  });
});
