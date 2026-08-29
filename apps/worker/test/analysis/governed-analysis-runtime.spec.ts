import {
  type ArtifactReference,
  artifactReferenceIdentity,
  buildAnalysisContext,
  buildAnalysisResultContract,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
  DEFAULT_RUN_EXECUTION_POLICY,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisArtifactCommitPort } from "../../src/analysis/executor.js";
import {
  createGovernedAnalysisRuntime,
  projectStagedAnalysisChart,
} from "../../src/analysis/governed-analysis-runtime.js";
import type { RunProviderDispatchCapability } from "../../src/runs/run-execution-context.js";

const id = (suffix: number) => `96800000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const lease: RunWorkLease = {
  scope,
  principal_id: id(8),
  outbox_id: id(9),
  run_id: id(3),
  command_id: id(10),
  command_kind: "START_DATA_AGENT_TEAM",
  attempt_id: id(4),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 300_000,
  worker_id: "governed-analysis-runtime-test",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-27T00:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {},
};

function reference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: lease.run_id,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as ArtifactReference & { readonly artifact_type: T };
}

async function fixture() {
  const semanticReleaseRef = reference("SemanticRelease", 20);
  const schemaSnapshotRef = reference("SchemaSnapshot", 22);
  const policyReceiptRef = reference("PolicyReceipt", 25);
  const context = await buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(23),
      package_hash: hash("3"),
      receipt_id: id(24),
      receipt_hash: hash("4"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
    semantic_retrieval_receipt_hash: hash("5"),
    semantic_inference_receipt_hash: hash("6"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "metric.revenue" },
        formula_hash: hash("e"),
        unit: null,
        grain: { grain_id: "grain.month", granularity: "month" },
        time_domain: {
          time_domain_id: "time.order-month",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: "2024-01-01T00:00:00.000+08:00",
          max_time: "2025-01-01T00:00:00.000+08:00",
        },
        time_dimension_ref: "dimension.month",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "REJECT_GAP",
        seasonality: null,
        priority: 100,
        causal_role: "OUTCOME",
        allowed_dimensions: [
          {
            dimension_id: "dimension.month",
            grain: { grain_id: "grain.month", granularity: "month" },
            data_type: "date",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: false,
            causal_role: null,
          },
        ],
        analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
  const binding = await buildQueryEvidenceSemanticBinding({
    protocol_version: "query-evidence-semantic-binding@1.0.0",
    semantic_release_ref: {
      resource_id: semanticReleaseRef.artifact_id,
      resource_revision: 1,
      resource_hash: semanticReleaseRef.content_hash,
      datasource_id: id(21),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    semantic_context_ref: context.semantic_context_binding,
    schema_snapshot_ref: {
      resource_id: schemaSnapshotRef.artifact_id,
      resource_revision: 1,
      resource_hash: schemaSnapshotRef.content_hash,
      datasource_id: id(21),
      semantic_release_id: semanticReleaseRef.artifact_id,
      semantic_generation: 1,
    },
    datasource_ref: { resource_id: id(21), resource_revision: 1, resource_hash: hash("1") },
    target_binding_hash: hash("2"),
    columns: [
      {
        output_name: "month",
        logical_type: "DATE",
        nullable: false,
        semantic_role: "DIMENSION",
        semantic_object_id: "dimension.month",
        formula_hash: null,
        aggregate: null,
        grain: { grain_id: "grain.month", granularity: "month" },
        physical_sources: [
          {
            schema_name: "private_schema",
            relation_name: "orders",
            column_name: "order_month",
            formatted_type: "date",
            nullable: false,
          },
        ],
      },
      {
        output_name: "revenue",
        logical_type: "NUMBER",
        nullable: false,
        semantic_role: "METRIC",
        semantic_object_id: "metric.revenue",
        formula_hash: hash("e"),
        aggregate: "sum",
        grain: { grain_id: "grain.month", granularity: "month" },
        physical_sources: [
          {
            schema_name: "private_schema",
            relation_name: "orders",
            column_name: "order_total",
            formatted_type: "numeric",
            nullable: false,
          },
        ],
      },
    ],
    time_window: {
      dimension_id: "dimension.month",
      start: "2024-01-01",
      end: "2025-01-01",
      semantics: "HALF_OPEN",
      timezone: "Asia/Shanghai",
    },
  });
  const sqlRef = reference("SqlArtifact", 30);
  const evidence = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      ...reference("QueryEvidence", 31),
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: id(32),
    source_refs: [sqlRef],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(33),
      request_hash: hash("7"),
      result_hash: hash("8"),
      row_count: 1,
      byte_count: 64,
      elapsed_ms: 4,
      truncated: false,
      semantic_binding: binding,
    },
    projection: {
      kind: "TABLE",
      columns: [
        { key: "month", label: "月份", data_type: "STRING" },
        { key: "revenue", label: "收入", data_type: "NUMBER" },
      ],
      rows: [{ month: "SENSITIVE_ROW_VALUE", revenue: 42 }],
      total_rows: 1,
    },
    committed_at: "2026-08-27T00:00:00.000Z",
  });
  const resultContract = await buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "monthly-revenue-result",
    semantic_context_hash: context.semantic_context_binding.package_hash,
    result_fields: [
      { field: "month", data_type: "STRING", nullable: false, semantic_role: "DIMENSION" },
      { field: "revenue", data_type: "NUMBER", nullable: false, semantic_role: "METRIC" },
    ],
    metric_bindings: [
      {
        semantic_metric_id: "metric.revenue",
        field: "revenue",
        unit: null,
        aggregation: "SUM",
        formula_hash: hash("e"),
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: "dimension.month", field: "month" }],
    grain: {
      dimension_ids: ["dimension.month"],
      time_dimension_id: "dimension.month",
      time_grain: "MONTH",
    },
    lineage: [
      {
        field: "month",
        source_semantic_object_ids: ["dimension.month"],
        source_physical_fields: ["orders.order_month"],
        transformation: "DIRECT",
      },
      {
        field: "revenue",
        source_semantic_object_ids: ["metric.revenue"],
        source_physical_fields: ["orders.order_total"],
        transformation: "AGGREGATION",
      },
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "monthly-revenue",
        title_zh: "月度收入",
        required: true,
        columns: [
          {
            key: "month",
            label_zh: "月份",
            data_type: "STRING",
            nullable: false,
            semantic_object_id: "dimension.month",
            semantic_role: "DIMENSION",
          },
          {
            key: "revenue",
            label_zh: "收入",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.revenue",
            semantic_role: "METRIC",
          },
        ],
        projection: { mode: "MODEL_DERIVED" },
        max_rows: 12,
      },
    ],
    charts: [
      {
        chart_id: "monthly-revenue-chart",
        title_zh: "月度收入趋势",
        required: true,
        intent: "TREND",
        table_id: "monthly-revenue",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 12,
      max_table_columns: 2,
      max_closure_bytes: 4_194_304,
    },
  });
  return { binding, context, evidence, resultContract };
}

async function harness(input?: { readonly omitOracle?: boolean }) {
  const fixed = await fixture();
  const briefRef = reference("ResearchBrief", 40);
  const programRef = reference("AnalysisProgram", 41);
  const evidenceRef = reference("DerivedAnalysisEvidence", 42);
  const outputRef = reference("SandboxResult", 43);
  const completionRef = reference("AnalysisCompletionReceipt", 44);
  const chartRef = reference("ArtifactWorkspaceDocument", 45);
  const reportRef = reference("AnalysisReport", 46);
  let providerContext = "";
  const diagnostics = vi.fn();
  const execute = vi.fn(async () => ({
    analysis_program_ref: programRef,
    completion_ref: completionRef,
    completion: { terminal: "READY" },
    evidence_refs: [evidenceRef],
    query_evidence_refs: [fixed.evidence.artifact_ref],
    generated_python_refs: [],
    sandbox_receipts: [{}],
    sandbox_receipt_refs: [reference("SandboxExecutionReceipt", 47)],
    provider_invocation_refs: [],
    oracle_receipts: input?.omitOracle ? [] : [{}],
    published_outputs: [
      {
        node_id: "monthly-revenue",
        output: { reference: outputRef },
      },
    ],
    explanations: [
      {
        node_id: "monthly-revenue",
        explanation: {
          schema_version: "analysis-agent-final@1.0.0",
          summary_zh: "收入趋势已通过独立 Oracle 验证。",
        },
      },
    ],
    chart_refs: [chartRef],
    report_ref: reportRef,
    publication_receipt: {},
  })) as never;
  const artifacts: AnalysisArtifactCommitPort = {
    async commitL2() {
      return briefRef;
    },
    async commitSystem(command) {
      return command.reference;
    },
    async resolveCommitted() {
      return null;
    },
  };
  const runtime = createGovernedAnalysisRuntime({
    artifacts,
    artifact_authority: {
      async resolveCommitted(_capability, referenceInput) {
        return {
          ok: true as const,
          value:
            artifactReferenceIdentity(referenceInput) ===
            artifactReferenceIdentity(fixed.evidence.artifact_ref)
              ? fixed.evidence
              : null,
        };
      },
    },
    artifact_capability: {},
    semantic_release: {
      async read() {
        return { ok: true as const, value: {} as never };
      },
    },
    compile_context: async (compileInput) => {
      expect(compileInput.requested_metric_ids).toEqual(["metric.revenue"]);
      return fixed.context;
    },
    method_registry: {
      async resolve() {
        return [
          {
            method_id: "published-monthly-revenue@1",
            skill_id: "open-python-analysis@1",
            result_contract: fixed.resultContract,
            required_operator_obligations: [],
          },
        ];
      },
    },
    create_executor: () => ({ execute }),
    diagnostics,
  });
  const semanticContext = {
    package: {
      package_id: fixed.context.semantic_context_binding.package_id,
      package_hash: fixed.context.semantic_context_binding.package_hash,
    },
    receipt: {
      receipt_id: fixed.context.semantic_context_binding.receipt_id,
      receipt_hash: fixed.context.semantic_context_binding.receipt_hash,
    },
  } as never;
  const command = {
    lease,
    task_id: id(50),
    max_context_bytes: 65_536,
    accepted_query_evidence_ref: fixed.evidence.artifact_ref,
    question: "分析月度收入趋势",
    semantic_context: semanticContext,
    effective_config: {} as never,
    provider_dispatch: {
      async invoke(providerInput: Parameters<RunProviderDispatchCapability["invoke"]>[0]) {
        providerContext =
          providerInput.turn?.kind === "SPECIALIST" ? providerInput.turn.context_text : "";
        const authority = JSON.parse(providerContext) as { objective_hash: string };
        return {
          ok: true as const,
          value: {
            output_text: JSON.stringify({
              schema_version: "analysis-program-candidate@2.0.0",
              objective_hash: authority.objective_hash,
              nodes: [
                {
                  node_id: "monthly-revenue",
                  method_registry_entry_ids: ["published-monthly-revenue@1"],
                  metric_ids: ["metric.revenue"],
                  dimension_ids: ["dimension.month"],
                  time_window: {
                    start: "2024-01-01T00:00:00.000+08:00",
                    end: "2025-01-01T00:00:00.000+08:00",
                    timezone: "Asia/Shanghai",
                    semantics: "HALF_OPEN",
                  },
                  comparison_window: null,
                  parameters: {},
                  operator_obligations: [],
                  dependency_node_ids: [],
                  activation_rule: { kind: "ALWAYS" },
                  criticality: "CRITICAL",
                },
              ],
            }),
            tool_calls: [],
            projection: {
              invocation_id: id(51),
              status: "COMPLETED" as const,
              provider: "deepseek",
              model_id: "test",
            },
          },
        };
      },
    },
    fence_guard: { isCurrent: async () => true },
  } as never;
  return { command, diagnostics, execute, providerContext: () => providerContext, runtime };
}

describe("generic governed analysis runtime", () => {
  it("projects the full semantic column contract emitted by Result Publisher", () => {
    const content = new TextEncoder().encode(
      JSON.stringify({
        schema_version: "analysis-published-chart@1.0.0",
        chart_id: "monthly-revenue-chart",
        title_zh: "月度收入趋势",
        intent: "TREND",
        template_id: "line.multi-series@1",
        bindings: {
          x_field: "month",
          y_fields: ["revenue"],
          series_field: null,
          lower_bound_field: null,
          upper_bound_field: null,
        },
        dataset: {
          table_id: "monthly-revenue",
          columns: [
            {
              key: "month",
              label_zh: "月份",
              data_type: "STRING",
              nullable: false,
              semantic_object_id: "dimension.month",
              semantic_role: "DIMENSION",
            },
            {
              key: "revenue",
              label_zh: "收入",
              data_type: "NUMBER",
              nullable: false,
              semantic_object_id: "metric.revenue",
              semantic_role: "METRIC",
            },
          ],
          rows: [{ month: "2024-01-01", revenue: 42 }],
          total_rows: 1,
        },
      }),
    );

    expect(
      projectStagedAnalysisChart({
        artifact_name: "chart:monthly-revenue-chart",
        artifact_kind: "CHART",
        media_type: "application/json",
        content,
        content_sha256: hash("f"),
        bytes: content.byteLength,
      }),
    ).toMatchObject({
      chart_id: "monthly-revenue-chart",
      projection: {
        table: {
          columns: [
            { key: "month", label: "月份", data_type: "STRING" },
            { key: "revenue", label: "收入", data_type: "NUMBER" },
          ],
        },
      },
    });
  });

  it("plans from exact semantic authority without exposing rows or benchmark routing", async () => {
    const test = await harness();
    const result = await test.runtime.analyze(test.command);

    expect(result.public_artifact_refs.map(({ artifact_type: type }) => type)).toEqual([
      "ArtifactWorkspaceDocument",
      "AnalysisReport",
    ]);
    expect(result.answer).toContain("收入趋势已通过独立 Oracle 验证");
    expect(test.providerContext()).not.toContain("SENSITIVE_ROW_VALUE");
    expect(test.providerContext()).not.toContain("private_schema");
    expect(test.providerContext()).not.toMatch(/case_id|acceptance|raw_rows|stdout|credential/u);
    const planningAuthority = JSON.parse(test.providerContext()) as {
      method_registry: {
        entries: Array<{
          method_id: string;
          parameter_schema: {
            type?: string;
            additionalProperties?: boolean;
            properties?: Record<string, unknown>;
          };
        }>;
      };
    };
    expect(planningAuthority.method_registry.entries[0]).toMatchObject({
      method_id: "published-monthly-revenue@1",
      parameter_schema: {
        type: "object",
        additionalProperties: false,
        properties: expect.objectContaining({
          result_schema_version: expect.any(Object),
          claim_strength: expect.any(Object),
        }),
      },
    });
    expect(
      planningAuthority.method_registry.entries[0]?.parameter_schema.properties,
    ).not.toHaveProperty("acceptance_case_id");
    expect(test.execute).toHaveBeenCalledOnce();
  });

  it("fails closed when the executor cannot prove one Oracle receipt per node", async () => {
    const test = await harness({ omitOracle: true });
    await expect(test.runtime.analyze(test.command)).rejects.toThrow(
      "GOVERNED_ANALYSIS_PUBLICATION_CLOSURE_INVALID",
    );
    expect(test.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "EXECUTE",
        failure_code: "GOVERNED_ANALYSIS_PUBLICATION_CLOSURE_INVALID",
      }),
    );
  });
});
