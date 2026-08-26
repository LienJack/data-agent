import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactWorkspaceChartDocumentV2,
  buildFalcon24RunExecutionPolicy,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProductTeamArtifactDocument,
  type RunWorkLease,
  verifyArtifactWorkspaceChartDocumentV2,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import type { ProductProfileToolPort } from "../../src/teams/mastra-profile-composition.js";
import type { ProductionTeamToolFactoryInput } from "../../src/teams/production-team-runtime.js";
import {
  createProductionTeamTools,
  productionTeamToolsInternals,
} from "../../src/teams/production-team-tools.js";
import { buildWorkerEffectiveConfigFixture } from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `93000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Production Team governed chart publication", () => {
  it("derives a chart intent from typed tabular columns without keyword routing", () => {
    const candidate = {
      schema_version: "text2sql-query-candidate@1.0.0" as const,
      sql: "select channel as channel, sum(spend) as spend from governed.source group by channel",
      parameters: [],
      result_columns: [
        { name: "channel", semantic_type: "STRING" as const, label: "渠道" },
        { name: "spend", semantic_type: "NUMBER" as const, label: "投入" },
      ],
      presentation: {
        title: "渠道投入",
        summary: "渠道比较",
        visualization: "TABLE" as const,
        x_key: null,
        y_keys: [],
      },
    };
    expect(productionTeamToolsInternals.visualizationIntent(candidate)).toBe("COMPARISON");
    expect(
      productionTeamToolsInternals.visualizationIntent({
        ...candidate,
        result_columns: [
          { name: "month", semantic_type: "DATE" as const, label: "月份" },
          { name: "revenue", semantic_type: "NUMBER" as const, label: "收入" },
        ],
      }),
    ).toBe("TREND");
  });

  it("reads frozen semantic relationships without invoking Text2SQL or table count", async () => {
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
      worker_id: "worker-semantic",
      lease_token: 1,
      worker_fence: 1,
      lease_duration_ms: 30_000,
      expires_at: "2026-08-22T01:00:30.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: { kind: "START_DATA_AGENT_TEAM" },
    } as unknown as RunWorkLease;
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: lease.principal_id,
      run_id: lease.run_id,
    });
    const semanticProvider = vi.fn(async () => ({
      ok: true as const,
      value: {
        output_text: JSON.stringify({
          answer:
            "订单通过 blinkit_orders.customer_id 以 many-to-one 关系连接 blinkit_customers.customer_id。",
        }),
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
      create_id: () => id(23),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: semanticProvider as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(async () => ({ ok: true as const, value: lease })) as never,
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({
        ok: true as const,
        value: { sequence: 1 },
      })),
    });
    let committed: ProductTeamArtifactDocument | null = null;
    const text2sqlPrepare = vi.fn();
    const text2sqlCompile = vi.fn();
    const text2sqlExecute = vi.fn();
    const releaseRead = vi.fn(async () => ({
      ok: true as const,
      value: {
        release_identity: {
          semantic_domain: "commerce",
          release_id: id(22),
          release_digest: hash("c"),
        },
        executable: { metrics: [], dimensions: [], formulas: [] },
        relationships: {
          relationships: [
            {
              relationship_id: "relationship.order_customer",
              name: "order_customer",
              kind: "physical",
              left_table_id: "orders",
              left_column_ids: ["orders.customer_id"],
              right_table_id: "customers",
              right_column_ids: ["customers.id"],
              cardinality: "many-to-one",
              proof_kind: "SNAPSHOT_CERTIFIED",
              proof_detail: "fixed snapshot",
              analysis: { fanout_closed: true, ontology_path: ["orders", "customers"] },
            },
          ],
        },
        restrictions: { quality_constraints: [], time_semantics: [] },
      },
    }));
    const tools = createProductionTeamTools(
      {
        capability: {},
        artifacts: {
          async commit(_capability, _lease, document) {
            committed = document;
            return { ok: true, value: document.artifact_ref };
          },
          commitWorkspaceChart: vi.fn(),
          resolveCommitted: vi.fn(),
        },
        text2sql: {
          prepare: text2sqlPrepare,
          compileCandidate: text2sqlCompile,
          execute: text2sqlExecute,
        },
        semantic_release: { read: releaseRead as never },
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        execution_context: executionContext,
        semantic_context_ref: {
          package_id: id(20),
          package_hash: hash("a"),
          receipt_id: id(21),
          receipt_hash: hash("b"),
          semantic_domain: "commerce",
          semantic_release_id: id(22),
          semantic_release_hash: hash("c"),
        },
        semantic_context_package: {
          route_decision: { route: "GRAPH", state: "READY" },
          retrieval_receipt: {
            route_states: { LEXICON: "READY", SPARSE: "READY", VECTOR: "READY", GRAPH: "READY" },
            selected_object_ids: [],
            pruned_object_ids: [],
            hits: [],
            expansions: [],
          },
          inference_receipt: {
            closure_complete: true,
            mandatory_object_ids: [],
            mandatory_relationship_ids: [],
            steps: [],
          },
        } as never,
        semantic_context: {
          package: {
            semantic_domain: "commerce",
          },
        } as never,
        accepted_evidence_ref: null,
        delegation: {
          profile: { revision: { profile_id: "semantic-management-agent" } },
          call: { objective: "订单与客户实体如何关联" },
        } as ProductionTeamToolFactoryInput["delegation"],
      },
    );
    const result = await tools.invoke({
      task: {
        task_id: id(24),
        run_id: lease.run_id,
        profile_id: "semantic-management-agent",
        scope,
      } as Parameters<ProductProfileToolPort["invoke"]>[0]["task"],
      profile: {
        revision: { profile_id: "semantic-management-agent" },
      } as unknown as AgentProductProfileRegistryItemV2,
      tool_id: "semantic.catalog.read",
      context_epoch: { epoch_id: id(25), build_signature: hash("e") },
    });

    expect(result).toMatchObject({ output_ref: { artifact_type: "AnalysisReport" } });
    expect(releaseRead).toHaveBeenCalledOnce();
    expect(semanticProvider).toHaveBeenCalledOnce();
    expect(text2sqlPrepare).not.toHaveBeenCalled();
    expect(text2sqlExecute).not.toHaveBeenCalled();
    expect(committed).toMatchObject({
      projection: {
        kind: "REPORT",
        title: "冻结语义图关系证据",
        sections: expect.arrayContaining([
          expect.objectContaining({
            heading: "结论",
            body_text: expect.stringContaining("blinkit_orders.customer_id"),
          }),
          expect.objectContaining({
            body_text: expect.stringContaining(
              "[PHYSICAL] relationship.order_customer order_customer: orders(orders.customer_id) -> customers(customers.id)",
            ),
          }),
        ]),
      },
    });
  });

  it("executes the semantic-selected governed AnalysisProgram and binds its chart evidence", async () => {
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
      worker_id: "worker-analysis",
      lease_token: 1,
      worker_fence: 11,
      expires_at: "2026-08-22T01:00:30.000Z",
      execution_policy: buildFalcon24RunExecutionPolicy({
        campaign_id: "falcon24-root-v13-final-20260826",
        case_id: "falcon24-business-review-18m",
        run_variant: "COLD",
        repetition: 1,
      }),
      payload: { kind: "START_DATA_AGENT_TEAM" },
    } as unknown as RunWorkLease;
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: lease.principal_id,
      run_id: lease.run_id,
    });
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
      provider_dispatch: {
        invoke: vi.fn(async () => ({
          ok: true as const,
          value: { output_text: "{}", tool_calls: [], projection: {} },
        })) as never,
      },
      heartbeat: vi.fn(async () => ({
        ok: true as const,
        value: { expires_at: lease.expires_at },
      })),
      guard_running_lease: vi.fn(async () => ({ ok: true as const, value: lease })) as never,
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({
        ok: true as const,
        value: { sequence: 1 },
      })),
    });
    const semanticPackage = {
      semantic_domain: "falcon24",
      mandatory_closure: {
        object_ids: ["metric.active_buyers", "metric.average_order_value", "metric.order_revenue"],
        relationship_ids: [],
      },
      evidence: [],
      retrieval_receipt: {
        hits: [
          { object_id: "metric.active_buyers", rank: 1 },
          { object_id: "metric.average_order_value", rank: 2 },
          { object_id: "metric.order_revenue", rank: 3 },
        ],
      },
    } as const;
    const derivedEvidence = {
      artifact_id: id(30),
      artifact_type: "DerivedAnalysisEvidence" as const,
      ...scope,
      run_id: lease.run_id,
      revision: 1,
      content_hash: hash("d"),
    };
    const chart = {
      artifact_id: id(31),
      artifact_type: "ArtifactWorkspaceDocument" as const,
      ...scope,
      run_id: lease.run_id,
      revision: 1,
      content_hash: hash("e"),
    };
    let committed: ProductTeamArtifactDocument | null = null;
    const analyze = vi.fn(async (analysisInput) => {
      expect(
        await analysisInput.fence_guard.isCurrent({
          run_id: lease.run_id,
          attempt_id: lease.attempt_id,
          worker_fence: lease.worker_fence,
          fence_token: `${lease.attempt_id}:${lease.worker_fence}`,
        }),
      ).toBe(true);
      return {
        answer: "最近 18 个完整月的经营复盘已通过受治理统计 Oracle。",
        accepted_artifact_refs: [derivedEvidence],
        public_artifact_refs: [chart],
      };
    });
    const tools = createProductionTeamTools(
      {
        capability: {},
        artifacts: {
          async commit(_capability, _lease, document) {
            committed = document;
            return { ok: true as const, value: document.artifact_ref };
          },
          commitWorkspaceChart: vi.fn(),
          resolveCommitted: vi.fn(),
        },
        text2sql: {} as never,
        semantic_release: {} as never,
        governed_analysis: { analyze } as never,
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        execution_context: executionContext,
        semantic_context_ref: {
          package_id: id(20),
          package_hash: hash("a"),
          receipt_id: id(21),
          receipt_hash: hash("b"),
          semantic_domain: "falcon24",
          semantic_release_id: id(22),
          semantic_release_hash: hash("c"),
        },
        semantic_context_package: semanticPackage as never,
        semantic_context: { package: semanticPackage } as never,
        accepted_evidence_ref: {
          artifact_id: id(29),
          artifact_type: "QueryEvidence",
          ...scope,
          run_id: lease.run_id,
          revision: 1,
          content_hash: hash("9"),
        },
        delegation: {
          profile: { revision: { profile_id: "governed-analysis-agent" } },
          call: { objective: "复盘经营表现并解释收入变化驱动" },
        } as ProductionTeamToolFactoryInput["delegation"],
      },
    );

    const result = await tools.invoke({
      task: {
        task_id: id(24),
        run_id: lease.run_id,
        profile_id: "governed-analysis-agent",
        scope,
        bounds: { timeout_ms: 30_000, max_context_bytes: 16_384 },
      } as Parameters<ProductProfileToolPort["invoke"]>[0]["task"],
      profile: {
        revision: { profile_id: "governed-analysis-agent" },
      } as unknown as AgentProductProfileRegistryItemV2,
      tool_id: "analysis.program.execute",
      context_epoch: { epoch_id: id(25), build_signature: hash("f") },
    });

    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted_query_evidence_ref: expect.objectContaining({ artifact_type: "QueryEvidence" }),
        question: "复盘经营表现并解释收入变化驱动",
      }),
    );
    expect(result).toMatchObject({
      output_ref: { artifact_type: "AnalysisReport" },
      public_artifact_refs: [{ artifact_type: "ArtifactWorkspaceDocument" }],
    });
    expect(committed).toMatchObject({
      profile_id: "governed-analysis-agent",
      source_refs: [derivedEvidence, chart],
      projection: {
        kind: "REPORT",
        sections: expect.arrayContaining([
          expect.objectContaining({
            heading: "结论",
            body_text: expect.stringContaining("受治理统计 Oracle"),
          }),
        ]),
      },
    });
  });

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
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: { kind: "START_DATA_AGENT_TEAM" },
    } as unknown as RunWorkLease;
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: lease.principal_id,
      run_id: lease.run_id,
    });
    const provider = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      value: {
        output_text: JSON.stringify({
          schema_version: "text2sql-query-candidate@1.0.0",
          sql: "select month, count(*)::integer as order_count from falcon_db_24.orders group by month order by month",
          parameters: [],
          result_columns: [
            { name: "month", semantic_type: "STRING", label: "月份" },
            { name: "order_count", semantic_type: "NUMBER", label: "订单量" },
          ],
          presentation: {
            title: "月度订单趋势",
            summary: "按月展示订单量。",
            visualization: "LINE",
            x_key: "month",
            y_keys: ["order_count"],
          },
        }),
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
      append_display_event: vi.fn(async () => ({
        ok: true as const,
        value: { sequence: 1 },
      })),
    });
    const productDocuments = new Map<string, ProductTeamArtifactDocument>();
    let chartDocument: ArtifactWorkspaceChartDocumentV2 | null = null;
    const text2sqlPrepare = vi.fn(async () => ({
      context_text: "frozen-schema-and-semantic-context",
      datasource_id: id(40),
      schema_snapshot_id: id(41),
      schema_snapshot_hash: hash("4"),
      allowed_relations: ["falcon_db_24.orders"],
      target_capability_hash: hash("5"),
      reader_role: "falcon_demo_reader",
    }));
    const text2sqlExecute = vi.fn(async () => ({
      schema_version: "governed-datasource-query-result@1.0.0" as const,
      query_id: id(42),
      request_hash: hash("6"),
      adapter_ref: {
        adapter_id: "postgresql" as const,
        adapter_revision: 1,
        descriptor_hash: hash("7"),
        dialect: "POSTGRESQL" as const,
      },
      columns: [
        { name: "month", type: "text" },
        { name: "order_count", type: "integer" },
      ],
      rows: [
        { month: "2026-01", order_count: 20 },
        { month: "2026-02", order_count: 32 },
        { month: "2026-03", order_count: 27 },
      ],
      row_count: 3,
      byte_count: 128,
      elapsed_ms: 5,
      truncated: false as const,
      result_hash: hash("8"),
    }));
    const text2sqlCompile = vi.fn(async ({ candidate }) => candidate);
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
        text2sql: {
          prepare: text2sqlPrepare,
          compileCandidate: text2sqlCompile,
          execute: text2sqlExecute,
        },
        semantic_release: {
          read: vi.fn(async () => ({
            ok: false as const,
            error: { code: "UNUSED", message: "unused", retryable: false },
          })),
        },
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        execution_context: executionContext,
        semantic_context_ref: {
          package_id: id(20),
          package_hash: hash("a"),
          receipt_id: id(21),
          receipt_hash: hash("b"),
          semantic_domain: "commerce",
          semantic_release_id: id(22),
          semantic_release_hash: hash("c"),
        },
        semantic_context_package: {} as never,
        semantic_context: {} as never,
        accepted_evidence_ref: null,
        delegation: {
          profile: { revision: { profile_id: "governed-text2sql-agent" } },
          call: { objective: "查询每月订单趋势" },
        } as ProductionTeamToolFactoryInput["delegation"],
      },
    );
    const task = {
      task_id: id(24),
      run_id: lease.run_id,
      profile_id: "governed-text2sql-agent",
      scope,
      bounds: { timeout_ms: 30_000, max_context_bytes: 16_384 },
    } as Parameters<ProductProfileToolPort["invoke"]>[0]["task"];
    const profile = {
      revision: { profile_id: "governed-text2sql-agent" },
    } as unknown as AgentProductProfileRegistryItemV2;
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
    expect(text2sqlPrepare).toHaveBeenCalledOnce();
    expect(text2sqlCompile).toHaveBeenCalledOnce();
    expect(text2sqlExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          schema_version: "text2sql-query-candidate@1.0.0",
        }),
      }),
    );
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      turn: {
        kind: "SPECIALIST",
        stage: "TEXT2SQL",
        profile_id: "governed-text2sql-agent",
        objective: "查询每月订单趋势",
        context_text: "frozen-schema-and-semantic-context",
      },
    });
  });
});
