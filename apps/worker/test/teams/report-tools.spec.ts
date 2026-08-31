import { contextReceiptBindingSchema } from "@data-agent/contracts";
import {
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { DEFAULT_RUN_EXECUTION_POLICY } from "@data-agent/contracts/runs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import type { ProductProfileToolPort } from "../../src/teams/mastra-profile-composition.js";
import type { ProductionTeamToolFactoryInput } from "../../src/teams/production-team-runtime.js";
import { createProductionTeamTools } from "../../src/teams/production-team-tools.js";
import {
  comparisonHash as hash,
  comparisonId as id,
  monthlyComparisonFixture,
  comparisonRef as ref,
  comparisonScope as scope,
} from "../analysis/support/monthly-comparison-fixture.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

async function fixture(withReport = true) {
  const query = (await monthlyComparisonFixture()).document;
  const chart = ref("ArtifactWorkspaceDocument", 70);
  const report = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: ref("AnalysisReport", 71),
    profile_id: "governed-analysis-agent",
    task_id: id(72),
    source_refs: [query.artifact_ref, chart],
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "月度分析",
      sections: [
        {
          heading: "图表",
          body_text: `原图 artifact://${chart.artifact_id}`,
          source_refs: [chart],
        },
      ],
    },
    committed_at: "2026-08-31T00:00:00.000Z",
  });
  const documents = new Map(
    [query, report].map((document) => [document.artifact_ref.artifact_id, document]),
  );
  // Only the Report tool path is exercised; unused workflow ports fail if called.
  const unused = vi.fn(async () => {
    throw new Error("TEST_UNUSED_PORT_CALLED");
  });
  const lease = {
    scope,
    principal_id: id(4),
    run_id: id(3),
    outbox_id: id(5),
    command_id: id(6),
    command_kind: "START_DATA_AGENT_TEAM",
    attempt_id: id(7),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "report-test",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-31T00:00:30.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: { kind: "START_DATA_AGENT_TEAM" },
  } as ProductionTeamToolFactoryInput["lease"];
  let answer = "以已验收事实形成管理层摘要；非因果结论。";
  const provider = vi.fn(async () => ({
    ok: true as const,
    value: {
      output_text: JSON.stringify({ answer }),
      tool_calls: [],
      projection: {
        invocation_id: id(23),
        status: "COMPLETED" as const,
        provider: "deepseek",
        model_id: "fixture",
      },
    },
  }));
  const config = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: lease.principal_id,
    run_id: lease.run_id,
  });
  const loaded = await createEffectiveConfigFixtureLoader(config)(lease);
  if (!loaded.ok) throw new Error("TEST_CONFIG_REQUIRED");
  const consumption = z
    .object({ context_receipt: contextReceiptBindingSchema })
    .parse(loaded.value);
  const execution = createRunExecutionContext({
    lease,
    effective_config: config,
    context_receipt: consumption.context_receipt,
    run_signal: new AbortController().signal,
    event_store: { commitSideEffect: unused, commitSnapshot: unused, findSideEffect: unused },
    now: () => new Date("2026-08-31T00:00:00.000Z"),
    create_id: () => id(22),
    side_effect_timeout_ms: 1_000,
    provider_dispatch: { invoke: provider },
    heartbeat: unused,
    guard_running_lease: unused,
    append_checkpoint_event: unused,
    append_side_effect_event: unused,
    append_display_event: vi.fn(async () => ({ ok: true as const, value: { sequence: 1 } })),
  });
  const references = withReport ? [query.artifact_ref, report.artifact_ref] : [query.artifact_ref];
  const factory = {
    lease,
    execution_context: execution,
    accepted_evidence_ref: query.artifact_ref,
    accepted_semantic_query_context_ref: null,
    delegation: {
      profile: { revision: { profile_id: "report-writing-agent" } },
      call: { objective: "组合当前 Run 已验收的报告与查询，保留原图" },
      receipt: { input_artifact_refs: references },
    },
  } as ProductionTeamToolFactoryInput;
  const commit = vi.fn(async (_capability, _lease, document: ProductTeamArtifactDocument) => ({
    ok: true as const,
    value: document.artifact_ref,
  }));
  const resolve = vi.fn(async (_capability, reference) => ({
    ok: true as const,
    value: documents.get(reference.artifact_id) ?? null,
  }));
  const tools = createProductionTeamTools(
    {
      capability: {},
      artifacts: { commit, resolveCommitted: resolve, commitWorkspaceChart: unused },
      text2sql: {} as never,
      semantic_release: {} as never,
    },
    factory,
  );
  const invocation = {
    task: {
      task_id: id(80),
      profile_id: "report-writing-agent",
      run_id: id(3),
      scope,
      bounds: { max_context_bytes: 65_536 },
    },
    profile: factory.delegation?.profile,
    tool_id: "report.project",
    context_epoch: { epoch_id: id(81), build_signature: hash("f") },
  } as Parameters<ProductProfileToolPort["invoke"]>[0];
  return {
    query,
    report,
    chart,
    documents,
    provider,
    factory,
    commit,
    resolve,
    tools,
    invocation,
    unused,
    setAnswer: (value: string) => {
      answer = value;
    },
  };
}

describe("production Report evidence composition", () => {
  it.each([false, true])(
    "calls the real run-bound provider capability once and commits closed evidence (analysis=%s)",
    async (withReport) => {
      const f = await fixture(withReport);
      await f.tools.invoke({ ...f.invocation, tool_id: "evidence.read" });
      expect(f.provider).not.toHaveBeenCalled();
      const result = await f.tools.invoke(f.invocation);
      expect(f.provider).toHaveBeenCalledTimes(1);
      expect(f.commit).toHaveBeenCalledTimes(1);
      const document = f.commit.mock.calls[0]?.[2];
      expect(result).toMatchObject({ output_ref: document?.artifact_ref });
      expect(document?.source_refs).toEqual(
        withReport
          ? [f.query.artifact_ref, f.report.artifact_ref, f.chart]
          : [f.query.artifact_ref],
      );
      expect(document?.projection).toMatchObject({
        kind: "REPORT",
        sections: [
          {
            heading: "结论",
            body_text: "以已验收事实形成管理层摘要；非因果结论。",
            source_refs: withReport
              ? [f.query.artifact_ref, f.report.artifact_ref]
              : [f.query.artifact_ref],
          },
          ...(withReport && f.report.projection.kind === "REPORT"
            ? f.report.projection.sections
            : []),
        ],
      });
      expect(f.unused).not.toHaveBeenCalled();
    },
  );

  it.each([
    "cross_run",
    "cross_scope",
    "missing",
    "hash",
    "reference",
    "no_admission",
    "context_budget",
  ])("rejects %s before provider/commit", async (problem) => {
    const f = await fixture();
    if (problem === "no_admission") Object.assign(f.factory, { delegation: null });
    else if (problem === "context_budget")
      Object.assign(f.invocation.task.bounds, { max_context_bytes: 10 });
    else if (problem === "missing") f.documents.clear();
    else if (problem === "hash")
      f.documents.set(f.query.artifact_ref.artifact_id, { ...f.query, task_id: id(999) });
    else if (f.factory.delegation)
      Object.assign(f.factory.delegation.receipt, {
        input_artifact_refs: [
          {
            ...f.query.artifact_ref,
            ...(problem === "cross_run"
              ? { run_id: id(999) }
              : problem === "cross_scope"
                ? { tenant_id: id(999) }
                : { revision: 2 }),
          },
        ],
      });
    await expect(f.tools.invoke(f.invocation)).rejects.toThrow();
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(20_001)])(
    "rejects an invalid summary before Artifact commit",
    async (answer) => {
      const f = await fixture();
      f.setAnswer(answer);
      await expect(f.tools.invoke(f.invocation)).rejects.toThrow("TEAM_REPORT_RESPONSE_INVALID");
      expect(f.provider).toHaveBeenCalledTimes(1);
      expect(f.commit).not.toHaveBeenCalled();
    },
  );
});
