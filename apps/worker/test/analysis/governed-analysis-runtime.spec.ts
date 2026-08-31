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
import { resolveAnalysisResultSourceObjects } from "../../src/analysis/analysis-result-source-authority.js";
import type { AnalysisArtifactCommitPort } from "../../src/analysis/executor.js";
import {
  createGovernedAnalysisRuntime,
  projectStagedAnalysisChart,
} from "../../src/analysis/governed-analysis-runtime.js";
import { buildGovernedResultProjections } from "../../src/analysis/governed-result-projection.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
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

async function withInputResultRole(
  base: Awaited<ReturnType<typeof fixture>>,
  role: "FORMULA" | "REQUEST_DERIVED",
) {
  const objectId = role === "FORMULA" ? "formula.return" : "request-scoped.return";
  const metric = base.binding.columns[1];
  if (
    !metric ||
    base.evidence.projection.kind !== "TABLE" ||
    base.evidence.provenance?.kind !== "GOVERNED_QUERY_RESULT"
  )
    throw new Error("TEST_BINDING_REQUIRED");
  const { binding_hash: _bindingHash, ...bindingMaterial } = base.binding;
  const binding = await buildQueryEvidenceSemanticBinding({
    ...bindingMaterial,
    columns: [
      ...bindingMaterial.columns,
      {
        ...metric,
        output_name: "ratio",
        semantic_role: role,
        semantic_object_id: objectId,
        aggregate: null,
        ...(role === "REQUEST_DERIVED"
          ? {
              request_derivation: {
                semantic_query_context_hash: hash("c"),
                interpretation: {
                  interpretation_id: objectId,
                  requested_term: "同比",
                  scope: "REQUEST_ONLY" as const,
                  source_object_ids: ["dimension.month", "metric.revenue"],
                  operator: {
                    kind: "PERIOD_COMPARISON_RATE" as const,
                    metric_id: "metric.revenue",
                    time_dimension_id: "dimension.month",
                    comparison_offset: { unit: "YEAR" as const, value: 1 as const },
                    formula:
                      "(current_value - comparison_value) / NULLIF(comparison_value, 0)" as const,
                  },
                  user_explanation: "请求内同比，不是发布指标。",
                  publication_effect: "NONE" as const,
                },
              },
            }
          : {}),
      },
    ],
  });
  const evidence = await buildProductTeamArtifactDocument({
    ...base.evidence,
    provenance: { ...base.evidence.provenance, semantic_binding: binding },
    projection: {
      ...base.evidence.projection,
      columns: [
        ...base.evidence.projection.columns,
        { key: "ratio", label: "比例", data_type: "NUMBER" },
      ],
      rows: base.evidence.projection.rows.map((row) => ({ ...row, ratio: 0.2 })),
    },
  });
  const { contract_hash: _contractHash, ...contract } = base.resultContract;
  const resultContract = await buildAnalysisResultContract({
    ...contract,
    result_fields: [
      { field: "series", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
    ],
    metric_bindings: contract.metric_bindings.map((item) => ({ ...item, field: "series" })),
    dimension_bindings: contract.dimension_bindings.map((item) => ({ ...item, field: "series" })),
    lineage: [
      {
        field: "series",
        source_semantic_object_ids: binding.columns.map((c) => c.semantic_object_id),
        source_physical_fields: binding.columns.map((c) => `query_evidence.${c.output_name}`),
        transformation: "DIRECT",
      },
    ],
    tables: contract.tables.map((table) => ({
      ...table,
      columns: [
        ...table.columns,
        {
          key: "ratio",
          label_zh: "比例",
          data_type: "NUMBER",
          nullable: false,
          semantic_role: role,
          semantic_object_id: objectId,
        },
      ],
      projection: {
        mode: "RESULT_COLLECTION",
        collection_field: "series",
        column_mappings: binding.columns.map((c) => ({
          result_field: c.output_name,
          table_column: c.output_name,
          source: { input_name: "query_evidence", output_name: c.output_name },
        })),
      },
    })),
    limits: { ...contract.limits, max_table_columns: 3 },
  });
  return { ...base, binding, evidence, resultContract };
}

async function harness(input?: {
  readonly omitOracle?: boolean;
  readonly inputRole?: "FORMULA" | "REQUEST_DERIVED";
  readonly omitAcceptedRole?: boolean;
  readonly promoteRole?: boolean;
}) {
  const base = await fixture();
  const withRole = input?.inputRole ? await withInputResultRole(base, input.inputRole) : base;
  const fixed = input?.omitAcceptedRole ? { ...withRole, evidence: base.evidence } : withRole;
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
                  metric_ids: input?.promoteRole
                    ? [input.inputRole === "FORMULA" ? "formula.return" : "request-scoped.return"]
                    : ["metric.revenue"],
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
  it.each(["FORMULA", "REQUEST_DERIVED"] as const)(
    "projects %s through verified Arrow without relabeling or filling NULL",
    async (role) => {
      const fixed = await withInputResultRole(await fixture(), role);
      if (
        fixed.evidence.projection.kind !== "TABLE" ||
        fixed.evidence.provenance?.kind !== "GOVERNED_QUERY_RESULT"
      )
        throw new Error("TEST_EVIDENCE_REQUIRED");
      const { binding_hash: _hash, ...binding } = fixed.binding;
      const semanticBinding = await buildQueryEvidenceSemanticBinding({
        ...binding,
        columns: binding.columns.map((column) =>
          column.output_name === "ratio" ? { ...column, nullable: true } : column,
        ),
      });
      const document = await buildProductTeamArtifactDocument({
        ...fixed.evidence,
        provenance: { ...fixed.evidence.provenance, semantic_binding: semanticBinding },
        projection: {
          ...fixed.evidence.projection,
          rows: [{ month: "2024-01-01", revenue: 42, ratio: null }],
        },
      });
      if (
        document.artifact_ref.artifact_type !== "QueryEvidence" ||
        document.projection.kind !== "TABLE"
      )
        throw new Error("TEST_EVIDENCE_REQUIRED");
      const { contract_hash: _contractHash, ...material } = fixed.resultContract;
      const contract = await buildAnalysisResultContract({
        ...material,
        tables: material.tables.map((table) => ({
          ...table,
          columns: table.columns.map((column) =>
            column.key === "ratio" ? { ...column, nullable: true } : column,
          ),
        })),
      });
      const projections = await buildGovernedResultProjections({
        contract,
        governed_inputs: [
          {
            name: "query_evidence",
            format: "ARROW",
            query_evidence_ref: document.artifact_ref,
            query_evidence_document: document,
            input_ref: reference("SensitiveExecutionArtifact", 80),
            materialization_receipt_ref: reference("AnalysisInputMaterializationReceipt", 81),
            materialization_receipt_document: {},
            content: productTeamGovernedQueryInternals.materializeProductTeamArrow(
              document.projection,
              semanticBinding.columns,
            ),
          },
        ],
      });
      expect(projections[0]?.table_rows).toEqual([
        { month: "2024-01-01", revenue: 42, ratio: null },
      ]);
      expect(contract.tables[0]?.columns[2]?.semantic_role).toBe(role);
    },
  );

  it.each([
    "missing-evidence",
    "reference",
    "run",
    "scope",
    "package",
    "receipt",
    "release",
    "snapshot",
    "context-hash",
    "source-column",
    "source-role",
    "missing-dependency",
    "promoted-id",
  ])("rejects independent result source authority drift: %s", async (variant) => {
    const fixed = await withInputResultRole(await fixture(), "REQUEST_DERIVED");
    if (
      fixed.evidence.artifact_ref.artifact_type !== "QueryEvidence" ||
      fixed.evidence.provenance?.kind !== "GOVERNED_QUERY_RESULT"
    )
      throw new Error("TEST_EVIDENCE_REQUIRED");
    const { binding_hash: _hash, ...binding } = fixed.binding;
    const rebound = await buildQueryEvidenceSemanticBinding({
      ...binding,
      semantic_context_ref: {
        ...binding.semantic_context_ref,
        ...(variant === "package" ? { package_id: id(90) } : {}),
        ...(variant === "receipt" ? { receipt_hash: hash("0") } : {}),
      },
      semantic_release_ref: {
        ...binding.semantic_release_ref,
        ...(variant === "release" ? { resource_revision: 2 } : {}),
      },
      schema_snapshot_ref: {
        ...binding.schema_snapshot_ref,
        ...(variant === "snapshot" ? { resource_hash: hash("0") } : {}),
      },
    });
    const document = await buildProductTeamArtifactDocument({
      ...fixed.evidence,
      artifact_ref: {
        ...fixed.evidence.artifact_ref,
        ...(variant === "scope" ? { tenant_id: id(91) } : {}),
      },
      source_refs: fixed.evidence.source_refs.map((ref) => ({
        ...ref,
        ...(variant === "scope" ? { tenant_id: id(91) } : {}),
      })),
      provenance: { ...fixed.evidence.provenance, semantic_binding: rebound },
    });
    if (document.artifact_ref.artifact_type !== "QueryEvidence")
      throw new Error("TEST_EVIDENCE_REQUIRED");
    const { contract_hash: _contractHash, ...contract } = fixed.resultContract;
    const resultContract = await buildAnalysisResultContract({
      ...contract,
      lineage: contract.lineage.map((lineage) => ({
        ...lineage,
        source_physical_fields: [...lineage.source_physical_fields, "query_evidence.missing"],
      })),
      tables: contract.tables.map((table) => ({
        ...table,
        columns: table.columns.map((column) =>
          column.key === "ratio" && variant === "source-role"
            ? { ...column, semantic_role: "FORMULA" as const }
            : column,
        ),
        projection:
          table.projection.mode === "RESULT_COLLECTION"
            ? {
                ...table.projection,
                column_mappings: table.projection.column_mappings.map((mapping) =>
                  mapping.table_column === "ratio" && variant === "source-column"
                    ? {
                        ...mapping,
                        source: { input_name: "query_evidence", output_name: "missing" },
                      }
                    : mapping,
                ),
              }
            : table.projection,
      })),
    });
    await expect(
      resolveAnalysisResultSourceObjects({
        result_contract: resultContract,
        context:
          variant === "context-hash"
            ? { ...fixed.context, context_hash: hash("0") }
            : fixed.context,
        run_id: variant === "run" ? id(92) : lease.run_id,
        selected_object_ids: new Set([
          "metric.revenue",
          ...(variant === "missing-dependency" ? [] : ["dimension.month"]),
          ...(variant === "promoted-id" ? ["request-scoped.return"] : []),
        ]),
        ...(variant === "missing-evidence"
          ? {}
          : {
              query_evidence: {
                reference: {
                  ...document.artifact_ref,
                  ...(variant === "reference" ? { artifact_id: id(93) } : {}),
                },
                document,
              },
            }),
      }),
    ).rejects.toThrow("ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID");
  });

  it.each(["FORMULA", "REQUEST_DERIVED"] as const)(
    "consumes exact %s data without adding Metric authority",
    async (role) => {
      const test = await harness({ inputRole: role });
      await test.runtime.analyze(test.command);
      expect(test.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.objectContaining({
            nodes: [
              expect.objectContaining({
                metric_refs: [expect.objectContaining({ node_id: "metric.revenue" })],
                result_contract: expect.objectContaining({
                  tables: [
                    expect.objectContaining({
                      columns: expect.arrayContaining([
                        expect.objectContaining({ key: "ratio", semantic_role: role }),
                      ]),
                    }),
                  ],
                }),
              }),
            ],
          }),
        }),
      );
      expect(test.providerContext()).not.toContain("SENSITIVE_ROW_VALUE");
    },
  );

  it.each(["FORMULA", "REQUEST_DERIVED"] as const)(
    "rejects unbacked or Metric-promoted %s",
    async (role) => {
      const unbacked = await harness({ inputRole: role, omitAcceptedRole: true });
      await expect(unbacked.runtime.analyze(unbacked.command)).rejects.toThrow(
        "ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID",
      );
      expect(unbacked.execute).not.toHaveBeenCalled();
      const promoted = await harness({ inputRole: role, promoteRole: true });
      await expect(promoted.runtime.analyze(promoted.command)).rejects.toThrow(
        "ANALYSIS_PROGRAM_CANDIDATE_METRIC_NOT_PUBLISHED",
      );
      expect(promoted.execute).not.toHaveBeenCalled();
    },
  );

  it.each(["METRIC", "FORMULA", "REQUEST_DERIVED"])(
    "projects the full %s column contract emitted by Result Publisher",
    (role) => {
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
                semantic_role: role,
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
    },
  );

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
    expect(test.execute).toHaveBeenCalledWith(expect.objectContaining({ task_id: id(50) }));
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
