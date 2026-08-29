import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactWorkspaceChartDocumentV2,
  buildFalcon24RunExecutionPolicy,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
  buildSemanticQueryContext,
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
import { buildTestQueryEvidenceSemanticBinding } from "../analysis/support/query-evidence-semantic-binding.js";
import { buildWorkerEffectiveConfigFixture } from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `93000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Production Team governed chart publication", () => {
  it("scopes Specialist provider logical calls to the accepted child task", () => {
    const firstTask = productionTeamToolsInternals.specialistProviderLogicalCallId({
      run_id: id(1),
      task_id: id(2),
      stage: "TEXT2SQL",
      call_index: 0,
    });
    const firstTaskReplay = productionTeamToolsInternals.specialistProviderLogicalCallId({
      run_id: id(1),
      task_id: id(2),
      stage: "TEXT2SQL",
      call_index: 0,
    });
    const firstTaskRepair = productionTeamToolsInternals.specialistProviderLogicalCallId({
      run_id: id(1),
      task_id: id(2),
      stage: "TEXT2SQL",
      call_index: 1,
    });
    const nextRootTurnTask = productionTeamToolsInternals.specialistProviderLogicalCallId({
      run_id: id(1),
      task_id: id(3),
      stage: "TEXT2SQL",
      call_index: 0,
    });

    expect(firstTaskReplay).toBe(firstTask);
    expect(firstTaskRepair).not.toBe(firstTask);
    expect(nextRootTurnTask).not.toBe(firstTask);
  });

  it("returns only allowlisted Text2SQL policy codes to the Root Tool Result", () => {
    expect(
      productionTeamToolsInternals.text2SqlCandidateFailureCode("TEXT2SQL_SQL_SHAPE_REJECTED"),
    ).toBe("TEXT2SQL_SQL_SHAPE_REJECTED");
    expect(
      productionTeamToolsInternals.text2SqlCandidateFailureCode(
        "TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE",
      ),
    ).toBe("TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE");
    expect(productionTeamToolsInternals.text2SqlCandidateFailureCode("DATABASE_URL_LEAK")).toBe(
      "TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED",
    );
    expect(productionTeamToolsInternals.text2SqlCandidateFailureCode(null)).toBe(
      "TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED",
    );
  });

  it("derives a chart intent from typed tabular columns without keyword routing", () => {
    const candidate = {
      schema_version: "text2sql-query-candidate@1.0.0" as const,
      sql: "select channel as channel, sum(spend) as spend from governed.source group by channel",
      parameters: [],
      result_columns: [
        {
          name: "channel",
          semantic_type: "STRING" as const,
          label: "渠道",
          semantic_binding: { object_kind: "DIMENSION" as const, object_id: "channel" },
        },
        {
          name: "spend",
          semantic_type: "NUMBER" as const,
          label: "投入",
          semantic_binding: { object_kind: "METRIC" as const, object_id: "spend" },
        },
      ],
      time_window: null,
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
          {
            name: "month",
            semantic_type: "DATE" as const,
            label: "月份",
            semantic_binding: { object_kind: "DIMENSION" as const, object_id: "month" },
          },
          {
            name: "revenue",
            semantic_type: "NUMBER" as const,
            label: "收入",
            semantic_binding: { object_kind: "METRIC" as const, object_id: "revenue" },
          },
        ],
      }),
    ).toBe("TREND");
  });

  it("normalizes bounded PostgreSQL numeric strings and rejects missing, non-finite or null drift", async () => {
    const candidate = {
      schema_version: "text2sql-query-candidate@1.0.0" as const,
      sql: "select bucket, revenue from governed.source",
      parameters: [],
      result_columns: [
        {
          name: "bucket",
          semantic_type: "STRING" as const,
          label: "分组",
          semantic_binding: { object_kind: "DIMENSION" as const, object_id: "dimension.bucket" },
        },
        {
          name: "revenue",
          semantic_type: "NUMBER" as const,
          label: "收入",
          semantic_binding: { object_kind: "METRIC" as const, object_id: "metric.revenue" },
        },
      ],
      time_window: null,
      presentation: {
        title: "分组收入",
        summary: "通用分组收入。",
        visualization: "TABLE" as const,
        x_key: null,
        y_keys: [],
      },
    };
    const binding = await buildTestQueryEvidenceSemanticBinding({
      columns: [
        {
          name: "bucket",
          logical_type: "STRING",
          nullable: false,
          semantic_role: "DIMENSION",
          semantic_object_id: "dimension.bucket",
        },
        {
          name: "revenue",
          logical_type: "NUMBER",
          nullable: false,
          semantic_role: "METRIC",
          semantic_object_id: "metric.revenue",
        },
      ],
    });

    expect(
      productionTeamToolsInternals.normalizedQueryEvidenceRows({
        candidate,
        binding,
        rows: [{ bucket: "A", revenue: "120.50" }],
      }),
    ).toEqual([{ bucket: "A", revenue: 120.5 }]);
    for (const rows of [
      [{ bucket: "A" }],
      [{ bucket: "A", revenue: "Infinity" }],
      [{ bucket: "A", revenue: "9007199254740993" }],
      [{ bucket: "A", revenue: null }],
    ]) {
      expect(() =>
        productionTeamToolsInternals.normalizedQueryEvidenceRows({
          candidate,
          binding,
          rows,
        }),
      ).toThrow();
    }
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
          schema_version: "semantic-query-selection-intent@1.0.0",
          selected_metric_ids: [],
          selected_dimension_ids: [],
          selected_formula_ids: [],
          selected_relationship_ids: ["relationship.order_customer"],
          selected_time_domain_ids: [],
          selected_quality_constraint_ids: [],
          unresolved_ambiguities: [],
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
          release_id: config.semantic_release.resource_id,
          release_digest: config.semantic_release.resource_hash,
          release_generation: config.semantic_release.semantic_generation,
          datasource_id: config.datasource.resource_id,
        },
        executable: { metrics: [], dimensions: [], formulas: [], physical_bindings: [] },
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
              left_row_preservation: "required",
              right_row_preservation: "optional",
              proof_kind: "SNAPSHOT_CERTIFIED",
              proof_detail: "fixed snapshot",
              tags: [],
              analysis: {
                join_allowed: true,
                fanout_closed: true,
                ontology_path: ["customers", "orders"],
              },
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
        authority: {
          schema_version: "falcon24-authority-binding@2.0.0",
          authority_epoch: "E2",
          baseline_id: id(4),
          baseline_hash: hash("d"),
          activation_attempt_id: id(5),
        },
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
          scope,
          semantic_domain: "commerce",
          semantic_release: config.semantic_release,
          schema_snapshot: config.schema_snapshot,
          route_decision: { route: "GRAPH", state: "READY" },
          retrieval_receipt: {
            route_states: { LEXICON: "READY", SPARSE: "READY", VECTOR: "READY", GRAPH: "READY" },
            selected_object_ids: ["relationship.order_customer"],
            pruned_object_ids: [],
            hits: [],
            expansions: [],
            receipt_hash: hash("f"),
          },
          inference_receipt: {
            closure_complete: true,
            mandatory_object_ids: [],
            mandatory_relationship_ids: ["relationship.order_customer"],
            steps: [],
            receipt_hash: hash("e"),
          },
        } as never,
        semantic_context: {
          package: {
            semantic_domain: "commerce",
          },
        } as never,
        accepted_evidence_ref: null,
        accepted_semantic_query_context_ref: null,
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

    expect(result).toMatchObject({ output_ref: { artifact_type: "SemanticQueryContext" } });
    expect(releaseRead).toHaveBeenCalledOnce();
    expect(semanticProvider).toHaveBeenCalledOnce();
    expect(text2sqlPrepare).not.toHaveBeenCalled();
    expect(text2sqlExecute).not.toHaveBeenCalled();
    expect(committed).toMatchObject({
      projection: {
        kind: "SEMANTIC_CONTEXT",
        context: expect.objectContaining({
          schema_version: "semantic-query-context@1.0.0",
          run_id: lease.run_id,
          semantic_release: config.semantic_release,
          relationships: [
            expect.objectContaining({
              relationship_id: "relationship.order_customer",
              cardinality: "many-to-one",
            }),
          ],
        }),
      },
    });
  });

  it("resolves an exact accepted SemanticQueryContext before Text2SQL prepare", async () => {
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
      worker_id: "worker-text2sql-context",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-27T01:00:30.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: { kind: "START_DATA_AGENT_TEAM" },
    } as unknown as RunWorkLease;
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: lease.principal_id,
      run_id: lease.run_id,
    });
    const contextReceipt = {
      package_id: id(20),
      package_hash: hash("a"),
      receipt_id: id(21),
      receipt_hash: hash("b"),
    } as const;
    const semanticPackage = {
      package_id: contextReceipt.package_id,
      package_hash: contextReceipt.package_hash,
      scope,
      semantic_domain: "commerce",
      semantic_release: config.semantic_release,
      schema_snapshot: config.schema_snapshot,
      retrieval_receipt: { selected_object_ids: [], receipt_hash: hash("c") },
      inference_receipt: {
        mandatory_object_ids: [],
        mandatory_relationship_ids: [],
        receipt_hash: hash("d"),
      },
    } as never;
    const semanticContext = await buildSemanticQueryContext({
      schema_version: "semantic-query-context@1.0.0",
      scope,
      run_id: lease.run_id,
      semantic_domain: "commerce",
      semantic_release: config.semantic_release,
      schema_snapshot: config.schema_snapshot,
      datasource: config.datasource,
      semantic_context_ref: {
        ...contextReceipt,
        retrieval_receipt_hash: hash("c"),
        inference_receipt_hash: hash("d"),
      },
      requested_object_ids: [],
      metrics: [],
      dimensions: [],
      formulas: [],
      relationships: [],
      physical_bindings: [],
      time_semantics: [],
      quality_constraints: [],
      unresolved_ambiguities: [],
    });
    const contextDocument = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
      artifact_ref: {
        artifact_id: id(22),
        artifact_type: "SemanticQueryContext",
        ...scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: hash("0"),
      },
      profile_id: "semantic-management-agent",
      task_id: id(23),
      source_refs: [],
      provenance: null,
      projection: { kind: "SEMANTIC_CONTEXT", context: semanticContext },
      committed_at: "2026-08-27T01:00:00.000Z",
    });
    const executionContext = createRunExecutionContext({
      lease,
      effective_config: config,
      context_receipt: contextReceipt as never,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-27T01:00:00.000Z"),
      create_id: () => id(24),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: vi.fn() as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(),
    });
    const releaseRead = vi.fn(async () => ({
      ok: true as const,
      value: {
        release_identity: {
          semantic_domain: "commerce",
          release_id: config.semantic_release.resource_id,
          release_digest: config.semantic_release.resource_hash,
          release_generation: config.semantic_release.semantic_generation,
          datasource_id: config.datasource.resource_id,
        },
        executable: {
          schema_version: "semantic-executable-projection@1.0.0" as const,
          metrics: [],
          dimensions: [],
          formulas: [],
          physical_bindings: [],
        },
        relationships: {
          schema_version: "semantic-relationship-projection@1.0.0" as const,
          relationships: [],
        },
        restrictions: {
          schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
          quality_constraints: [],
          time_semantics: [],
        },
      },
    }));
    const prepare = vi.fn(async () => ({
      context_text: "{}",
      datasource_id: config.datasource.resource_id,
      schema_snapshot_id: config.schema_snapshot.resource_id,
      schema_snapshot_hash: config.schema_snapshot.resource_hash,
      allowed_relations: ["falcon_db_24.orders"],
      target_capability_hash: hash("e"),
      reader_role: "falcon_demo_reader",
      semantic_query_context_hash: semanticContext.context_hash,
    }));
    const tools = createProductionTeamTools(
      {
        capability: {},
        artifacts: {
          commit: vi.fn(),
          commitWorkspaceChart: vi.fn(),
          resolveCommitted: vi.fn(async () => ({ ok: true as const, value: contextDocument })),
        },
        text2sql: { prepare, compileCandidate: vi.fn(), execute: vi.fn() } as never,
        semantic_release: { read: releaseRead },
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        authority: {
          schema_version: "falcon24-authority-binding@2.0.0",
          authority_epoch: "E3",
          baseline_id: id(25),
          baseline_hash: hash("f"),
          activation_attempt_id: id(26),
        },
        execution_context: executionContext,
        semantic_context_ref: {
          ...contextReceipt,
          semantic_domain: "commerce",
          semantic_release_id: config.semantic_release.resource_id,
          semantic_release_hash: config.semantic_release.resource_hash,
        },
        semantic_context_package: semanticPackage,
        semantic_context: { package: semanticPackage } as never,
        accepted_evidence_ref: null,
        accepted_semantic_query_context_ref: contextDocument.artifact_ref,
        delegation: {
          profile: { revision: { profile_id: "governed-text2sql-agent" } },
          call: { objective: "查询订单数据" },
        } as ProductionTeamToolFactoryInput["delegation"],
      },
    );

    await expect(
      tools.invoke({
        task: {
          task_id: id(27),
          run_id: lease.run_id,
          profile_id: "governed-text2sql-agent",
          scope,
          bounds: { max_context_bytes: 16_384 },
        } as Parameters<ProductProfileToolPort["invoke"]>[0]["task"],
        profile: {
          revision: { profile_id: "governed-text2sql-agent" },
        } as unknown as AgentProductProfileRegistryItemV2,
        tool_id: "semantic.release.read",
        context_epoch: { epoch_id: id(28), build_signature: hash("1") },
      }),
    ).resolves.toMatchObject({ output_ref: null });
    expect(releaseRead).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ semantic_query_context: semanticContext }),
    );
  });

  it("rejects a stale accepted SemanticQueryContext before semantic release I/O", async () => {
    const resolveAccepted = productionTeamToolsInternals.resolveAcceptedSemanticQueryContext;
    const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
    const lease = {
      scope,
      run_id: id(5),
      lease_duration_ms: 30_000,
      expires_at: "2026-08-27T01:00:30.000Z",
    } as ProductionTeamToolFactoryInput["lease"];
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: id(3),
      run_id: lease.run_id,
    });
    const staleContext = await buildSemanticQueryContext({
      schema_version: "semantic-query-context@1.0.0",
      scope,
      run_id: lease.run_id,
      semantic_domain: "commerce",
      semantic_release: { ...config.semantic_release, resource_hash: hash("9") },
      schema_snapshot: config.schema_snapshot,
      datasource: config.datasource,
      semantic_context_ref: {
        package_id: id(20),
        package_hash: hash("a"),
        receipt_id: id(21),
        receipt_hash: hash("b"),
        retrieval_receipt_hash: hash("c"),
        inference_receipt_hash: hash("d"),
      },
      requested_object_ids: [],
      metrics: [],
      dimensions: [],
      formulas: [],
      relationships: [],
      physical_bindings: [],
      time_semantics: [],
      quality_constraints: [],
      unresolved_ambiguities: [],
    });
    const staleDocument = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
      artifact_ref: {
        artifact_id: id(22),
        artifact_type: "SemanticQueryContext",
        ...scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: hash("0"),
      },
      profile_id: "semantic-management-agent",
      task_id: id(23),
      source_refs: [],
      provenance: null,
      projection: { kind: "SEMANTIC_CONTEXT", context: staleContext },
      committed_at: "2026-08-27T01:00:00.000Z",
    });
    const resolveCommitted = vi.fn(async () => ({
      ok: true as const,
      value: staleDocument,
    }));

    await expect(
      resolveAccepted(
        {
          capability: {},
          artifacts: {
            commit: vi.fn(),
            commitWorkspaceChart: vi.fn(),
            resolveCommitted,
          },
          text2sql: {} as never,
          semantic_release: {} as never,
        },
        {
          lease,
          authority: {} as never,
          execution_context: { getEffectiveConfig: () => config } as never,
          semantic_context_ref: {
            package_id: id(20),
            package_hash: hash("a"),
            receipt_id: id(21),
            receipt_hash: hash("b"),
          } as never,
          semantic_context_package: {
            semantic_domain: "commerce",
            retrieval_receipt: { receipt_hash: hash("c") },
            inference_receipt: { receipt_hash: hash("d") },
          } as never,
          semantic_context: {} as never,
          accepted_evidence_ref: null,
          accepted_semantic_query_context_ref: staleDocument.artifact_ref,
          delegation: null,
        },
      ),
    ).rejects.toMatchObject({ code: "TEAM_ACCEPTED_SEMANTIC_CONTEXT_BINDING_STALE" });
    expect(resolveCommitted).toHaveBeenCalledOnce();
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
        campaign_id: "E1-C1",
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
    const report = {
      artifact_id: id(32),
      artifact_type: "AnalysisReport" as const,
      ...scope,
      run_id: lease.run_id,
      revision: 1,
      content_hash: hash("f"),
    };
    const commit = vi.fn(
      async (
        _capability: unknown,
        _lease: RunWorkLease,
        document: ProductTeamArtifactDocument,
      ) => ({
        ok: true as const,
        value: document.artifact_ref,
      }),
    );
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
        accepted_artifact_refs: [derivedEvidence, report],
        public_artifact_refs: [chart],
      };
    });
    const tools = createProductionTeamTools(
      {
        capability: {},
        artifacts: {
          commit,
          commitWorkspaceChart: vi.fn(),
          resolveCommitted: vi.fn(),
        },
        text2sql: {} as never,
        semantic_release: {} as never,
        governed_analysis: { analyze } as never,
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        authority: {
          schema_version: "falcon24-authority-binding@2.0.0",
          authority_epoch: "E2",
          baseline_id: id(4),
          baseline_hash: hash("d"),
          activation_attempt_id: id(5),
        },
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
        accepted_semantic_query_context_ref: null,
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
      output_ref: report,
      public_artifact_refs: [chart, report],
    });
    expect(commit).not.toHaveBeenCalled();
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
            {
              name: "month",
              semantic_type: "STRING",
              label: "月份",
              semantic_binding: { object_kind: "DIMENSION", object_id: "month" },
            },
            {
              name: "order_count",
              semantic_type: "NUMBER",
              label: "订单量",
              semantic_binding: { object_kind: "METRIC", object_id: "order-count" },
            },
          ],
          time_window: null,
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
      semantic_query_context_hash: null,
    }));
    const semanticBinding = await buildQueryEvidenceSemanticBinding({
      protocol_version: "query-evidence-semantic-binding@1.0.0",
      semantic_release_ref: config.semantic_release,
      semantic_context_ref: {
        package_id: id(20),
        package_hash: hash("a"),
        receipt_id: id(21),
        receipt_hash: hash("b"),
      },
      schema_snapshot_ref: config.schema_snapshot,
      datasource_ref: config.datasource,
      target_binding_hash: hash("5"),
      columns: [
        {
          output_name: "month",
          logical_type: "STRING",
          nullable: false,
          semantic_role: "DIMENSION",
          semantic_object_id: "month",
          formula_hash: null,
          aggregate: null,
          grain: { grain_id: "month", granularity: "month" },
          physical_sources: [
            {
              schema_name: "falcon_db_24",
              relation_name: "orders",
              column_name: "month",
              formatted_type: "text",
              nullable: false,
            },
          ],
        },
        {
          output_name: "order_count",
          logical_type: "NUMBER",
          nullable: false,
          semantic_role: "METRIC",
          semantic_object_id: "order-count",
          formula_hash: hash("9"),
          aggregate: "count",
          grain: { grain_id: "order", granularity: "atomic" },
          physical_sources: [
            {
              schema_name: "falcon_db_24",
              relation_name: "orders",
              column_name: "id",
              formatted_type: "uuid",
              nullable: false,
            },
          ],
        },
      ],
      time_window: null,
    });
    const queryResult = {
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
    };
    const text2sqlExecute = vi.fn(async () => ({
      result: queryResult,
      semantic_binding: semanticBinding,
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
            ok: true as const,
            value: {
              release_identity: {
                semantic_domain: "commerce",
                release_id: config.semantic_release.resource_id,
                release_digest: config.semantic_release.resource_hash,
                release_generation: config.semantic_release.semantic_generation,
                datasource_id: config.datasource.resource_id,
              },
              executable: {
                schema_version: "semantic-executable-projection@1.0.0" as const,
                metrics: [],
                dimensions: [],
                formulas: [],
                physical_bindings: [],
              },
              relationships: {
                schema_version: "semantic-relationship-projection@1.0.0" as const,
                relationships: [],
              },
              restrictions: {
                schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
                quality_constraints: [],
                time_semantics: [],
              },
            },
          })),
        },
      },
      {
        lease: lease as ProductionTeamToolFactoryInput["lease"],
        authority: {
          schema_version: "falcon24-authority-binding@2.0.0",
          authority_epoch: "E2",
          baseline_id: id(4),
          baseline_hash: hash("d"),
          activation_attempt_id: id(5),
        },
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
        accepted_semantic_query_context_ref: null,
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
      logical_call_id: productionTeamToolsInternals.specialistProviderLogicalCallId({
        run_id: lease.run_id,
        task_id: task.task_id,
        stage: "TEXT2SQL",
        call_index: 0,
      }),
      turn: {
        kind: "SPECIALIST",
        stage: "TEXT2SQL",
        profile_id: "governed-text2sql-agent",
        objective: "查询每月订单趋势",
        context_text: "frozen-schema-and-semantic-context",
      },
    });

    const committedBeforeFailure = [...productDocuments.keys()].sort();
    const chartBeforeFailure = chartDocument;
    text2sqlExecute.mockRejectedValueOnce(
      Object.assign(new TypeError("DATASOURCE_ADAPTER_PERMISSION_DENIED"), {
        code: "DATASOURCE_ADAPTER_PERMISSION_DENIED",
      }),
    );
    await expect(invocation("sql.sandbox.execute")).rejects.toMatchObject({
      code: "DATASOURCE_ADAPTER_PERMISSION_DENIED",
    });
    expect([...productDocuments.keys()].sort()).toEqual(committedBeforeFailure);
    expect(chartDocument).toBe(chartBeforeFailure);
  });
});
