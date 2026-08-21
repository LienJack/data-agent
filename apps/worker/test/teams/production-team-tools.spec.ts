import {
  type AgentProductProfileRegistryItem,
  type ArtifactWorkspaceChartDocumentV2,
  buildAgentDispatchPlan,
  type ProductTeamArtifactDocument,
  type RunWorkLease,
  verifyArtifactWorkspaceChartDocumentV2,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import type { ProductProfileToolPort } from "../../src/teams/mastra-profile-composition.js";
import type { ProductionTeamToolFactoryInput } from "../../src/teams/production-team-runtime.js";
import { createProductionTeamTools } from "../../src/teams/production-team-tools.js";
import { buildWorkerEffectiveConfigFixture } from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `93000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Production Team governed chart publication", () => {
  it("keeps QueryEvidence as output and publishes a sealed chart companion for trend intent", async () => {
    const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
    const lease = {
      scope,
      principal_id: id(3),
      outbox_id: id(4),
      run_id: id(5),
      command_id: id(6),
      command_kind: "START_DATA_AGENT_TEAM",
      attempt_id: id(7),
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-chart",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-22T01:00:30.000Z",
      payload: { kind: "START_DATA_AGENT_TEAM" },
    } as unknown as RunWorkLease;
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: lease.principal_id,
      run_id: lease.run_id,
    });
    const provider = vi.fn(async () => ({
      ok: true as const,
      value: {
        output_text: JSON.stringify({ answer: "按月统计订单趋势。" }),
        tool_calls: [],
        projection: { status: "COMPLETED" as const },
      },
    }));
    const executionContext = createRunExecutionContext({
      lease,
      effective_config: config,
      context_receipt: {
        package_id: id(20),
        package_hash: hash("a"),
        receipt_id: id(21),
        receipt_hash: hash("b"),
      } as never,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-22T01:00:00.000Z"),
      create_id: () => id(22),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: provider as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(),
    });
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(23),
      run_id: lease.run_id,
      question_class: "DATA_QUERY",
      mode: "TEAM",
      selected_profile_refs: [
        { profile_id: "governed-text2sql-agent", revision: 1, revision_hash: hash("d") },
      ],
      dependency_edges: [],
      required_evidence: ["ACCEPTED_QUERY_EVIDENCE", "FROZEN_SEMANTIC_RELEASE"],
      reason_codes: ["DATA_QUERY_SPECIALIST_REQUIRED", "DATA_QUERY_TREND_VISUALIZATION"],
      capability_snapshot_hash: hash("c"),
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: null,
    });
    const productDocuments = new Map<string, ProductTeamArtifactDocument>();
    let chartDocument: ArtifactWorkspaceChartDocumentV2 | null = null;
    const tools = createProductionTeamTools(
      {
        capability: {},
        artifacts: {
          async commit(_capability, _lease, document) {
            productDocuments.set(document.artifact_ref.artifact_id, document);
            return { ok: true, value: document.artifact_ref };
          },
          async commitWorkspaceChart(_capability, _lease, document) {
            chartDocument = await verifyArtifactWorkspaceChartDocumentV2(document);
            return { ok: true, value: document.document_ref };
          },
          async resolveCommitted(_capability, reference) {
            return { ok: true, value: productDocuments.get(reference.artifact_id) ?? null };
          },
        },
        sandbox: {
          execute: vi.fn(),
          executeTableCount: vi.fn(),
          executeMonthlyOrderTrend: vi.fn(async () => ({
            columns: ["month", "order_count"],
            rows: [
              ["2026-01", 20],
              ["2026-02", 32],
              ["2026-03", 27],
            ],
          })),
        },
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        execution_context: executionContext,
        resolved_context_ref: {
          package_id: id(20),
          package_hash: hash("a"),
          receipt_id: id(21),
          receipt_hash: hash("b"),
        },
        accepted_evidence_ref: null,
        dispatch_plan: plan,
      },
    );
    const task = {
      task_id: id(24),
      run_id: lease.run_id,
      profile_id: "governed-text2sql-agent",
      scope,
      bounds: { timeout_ms: 30_000 },
    } as Parameters<ProductProfileToolPort["invoke"]>[0]["task"];
    const profile = {
      revision: { profile_id: "governed-text2sql-agent" },
    } as AgentProductProfileRegistryItem;
    const invocation = (toolId: string) =>
      tools.invoke({
        task,
        profile,
        tool_id: toolId,
        context_epoch: { epoch_id: id(25), build_signature: hash("e") },
      });

    await invocation("semantic.release.read");
    await invocation("sql.compiler.compile");
    const result = await invocation("sql.sandbox.execute");
    expect(result).toMatchObject({
      output_ref: { artifact_type: "QueryEvidence" },
      public_artifact_refs: [
        { artifact_type: "QueryEvidence" },
        { artifact_type: "ArtifactWorkspaceDocument" },
      ],
    });
    expect(chartDocument).toMatchObject({
      schema_version: "artifact-workspace-chart-document@2.0.0",
      projection: { kind: "CHART", chart_type: "LINE", x_key: "month" },
    });
    expect(provider).toHaveBeenCalledOnce();
  });
});
