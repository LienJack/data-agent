import {
  type ArtifactReference,
  artifactReferenceIdentity,
  buildProductTeamArtifactDocument,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProductTeamArtifactDocument,
  type RunWorkLease,
} from "@data-agent/contracts";
import { DateDay, tableFromIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";
import type { GovernedAnalysisInput } from "../../src/analysis/governed-analysis-input.js";
import { createProductTeamGovernedAnalysisQueryPort } from "../../src/analysis/product-team-query-port.js";
import { buildTestQueryEvidenceSemanticBinding } from "./support/query-evidence-semantic-binding.js";

const id = (suffix: number) => `61000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
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
  worker_id: "product-team-query-test",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-26T00:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {},
};
const analysisProgramRef: ArtifactReference = {
  artifact_id: id(5),
  artifact_type: "AnalysisProgram",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("a"),
};
const inputRef: ArtifactReference = {
  artifact_id: id(6),
  artifact_type: "SensitiveExecutionArtifact",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("b"),
};
const receiptRef: ArtifactReference = {
  artifact_id: id(7),
  artifact_type: "AnalysisInputMaterializationReceipt",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("c"),
};

function node() {
  return { node_id: "monthly-revenue-trend", skill_id: "open-python-analysis@1" } as never;
}

async function documents(input?: {
  readonly columns?: readonly {
    readonly key: string;
    readonly label: string;
    readonly data_type: "STRING" | "NUMBER" | "BOOLEAN" | "NULL" | "MIXED";
  }[];
  readonly rows?: readonly Readonly<Record<string, string | number | boolean | null>>[];
  readonly bindings?: readonly {
    readonly name: string;
    readonly logical_type: "NUMBER" | "STRING" | "DATE" | "DATETIME" | "BOOLEAN";
    readonly nullable: boolean;
    readonly semantic_role:
      | "METRIC"
      | "FORMULA"
      | "DIMENSION"
      | "PHYSICAL_COLUMN"
      | "REQUEST_DERIVED";
    readonly semantic_object_id: string;
  }[];
}) {
  const sql = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(20),
      artifact_type: "SqlArtifact",
      ...scope,
      run_id: lease.run_id,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: id(21),
    source_refs: [],
    provenance: {
      kind: "TEXT2SQL_CANDIDATE",
      candidate_hash: hash("1"),
      parameters_hash: hash("2"),
      parameter_count: 0,
      datasource_ref: {
        resource_id: id(30),
        resource_revision: 1,
        resource_hash: hash("3"),
      },
      schema_snapshot_ref: { resource_id: id(31), resource_hash: hash("4") },
      semantic_context_ref: { package_id: id(32), package_hash: hash("5") },
      semantic_query_context_ref: null,
      semantic_query_context_hash: null,
      target_binding_hash: hash("6"),
    },
    projection: { kind: "SQL", dialect: "postgresql", sql: "select month, revenue" },
    committed_at: "2026-08-26T00:00:00.000Z",
  });
  const columns = input?.columns ?? [
    { key: "month", label: "月份", data_type: "STRING" as const },
    { key: "revenue", label: "订单收入", data_type: "NUMBER" as const },
    { key: "complete", label: "完整月份", data_type: "BOOLEAN" as const },
  ];
  const rows = input?.rows ?? [
    { month: "2024-09-01", revenue: 120.5, complete: true },
    { month: "2024-10-01", revenue: 140, complete: true },
  ];
  const semanticBinding = await buildTestQueryEvidenceSemanticBinding({
    columns:
      input?.bindings ??
      columns.map((column) => ({
        name: column.key,
        logical_type:
          column.key === "month"
            ? ("DATE" as const)
            : column.data_type === "NUMBER"
              ? ("NUMBER" as const)
              : column.data_type === "BOOLEAN"
                ? ("BOOLEAN" as const)
                : ("STRING" as const),
        nullable: false,
        semantic_role: column.data_type === "NUMBER" ? ("METRIC" as const) : ("DIMENSION" as const),
        semantic_object_id: column.key,
      })),
  });
  const evidence = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(22),
      artifact_type: "QueryEvidence",
      ...scope,
      run_id: lease.run_id,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: id(21),
    source_refs: [sql.artifact_ref],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(23),
      request_hash: hash("7"),
      result_hash: hash("8"),
      row_count: rows.length,
      byte_count: 128,
      elapsed_ms: 12,
      truncated: false,
      semantic_binding: semanticBinding,
    },
    projection: { kind: "TABLE", columns, rows, total_rows: rows.length },
    committed_at: "2026-08-26T00:00:01.000Z",
  });
  return { sql, evidence, semanticBinding };
}

async function harness(input?: Parameters<typeof documents>[0]) {
  const { sql, evidence, semanticBinding } = await documents(input);
  const stored: ProductTeamArtifactDocument[] = [sql, evidence];
  const materialize = vi.fn(
    async (command): Promise<GovernedAnalysisInput> => ({
      name: command.input_name,
      format: command.format,
      query_evidence_ref: command.query_evidence_ref,
      query_evidence_document: evidence,
      input_ref: inputRef,
      materialization_receipt_ref: receiptRef,
      materialization_receipt_document: {},
      content: command.content,
    }),
  );
  const resolveCommitted = vi.fn(async (_capability, reference: ArtifactReference) => ({
    ok: true as const,
    value:
      stored.find(
        ({ artifact_ref: artifactRef }) =>
          artifactReferenceIdentity(artifactRef) === artifactReferenceIdentity(reference),
      ) ?? null,
  }));
  const expectedAuthority = {
    semantic_release_ref: semanticBinding.semantic_release_ref,
    semantic_context_ref: semanticBinding.semantic_context_ref,
    schema_snapshot_ref: semanticBinding.schema_snapshot_ref,
    datasource_ref: semanticBinding.datasource_ref,
    target_binding_hash: semanticBinding.target_binding_hash,
  };
  return {
    evidence,
    materialize,
    resolveCommitted,
    semanticBinding,
    expectedAuthority,
    port: createProductTeamGovernedAnalysisQueryPort({
      query_evidence_ref: evidence.artifact_ref as ArtifactReference & {
        artifact_type: "QueryEvidence";
      },
      artifact_authority: { resolveCommitted },
      artifact_capability: { authority: "application" },
      materializer: { materialize },
      expected_authority: expectedAuthority,
    }),
  };
}

const request = {
  lease,
  analysis_program_ref: analysisProgramRef,
  node: node(),
  idempotency_key: "query-evidence-1",
  max_rows: 1_000,
  timeout_ms: 120_000,
};

describe("Product Team governed analysis query port", () => {
  it.each(["FORMULA", "REQUEST_DERIVED"] as const)(
    "materializes a %s column without promoting it to Metric authority",
    async (role) => {
      const objectId = role === "FORMULA" ? "formula.roas" : "request-scoped.yoy";
      const fixture = await harness({
        columns: [{ key: "roas", label: "ROAS", data_type: "NUMBER" }],
        rows: [{ roas: 3.2 }],
        bindings: [
          {
            name: "roas",
            logical_type: "NUMBER",
            nullable: false,
            semantic_role: role,
            semantic_object_id: objectId,
          },
        ],
      });
      await fixture.port.execute(request);
      expect(fixture.materialize).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: [
            {
              name: "roas",
              arrow_type: "FLOAT64",
              nullable: false,
              semantic_role: role,
              semantic_object_id: objectId,
            },
          ],
          source_binding_hash: fixture.semanticBinding.binding_hash,
          query_evidence_ref: fixture.evidence.artifact_ref,
        }),
      );
    },
  );

  it("rejects row-level physical-column evidence before analysis materialization", async () => {
    const fixture = await harness({
      columns: [{ key: "order_id", label: "订单编号", data_type: "STRING" }],
      rows: [{ order_id: "order-1" }],
      bindings: [
        {
          name: "order_id",
          logical_type: "STRING",
          nullable: false,
          semantic_role: "PHYSICAL_COLUMN",
          semantic_object_id: "column.orders.order_id",
        },
      ],
    });

    await expect(fixture.port.execute(request)).rejects.toThrow(
      "ANALYSIS_QUERY_EVIDENCE_PHYSICAL_COLUMN_UNSUPPORTED",
    );
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it.each([
    {
      shape: "single-series",
      columns: [
        { key: "bucket", label: "分组", data_type: "STRING" as const },
        { key: "value", label: "数值", data_type: "NUMBER" as const },
      ],
      rows: [
        { bucket: "A", value: 1 },
        { bucket: "B", value: 2 },
      ],
      bindings: [
        {
          name: "bucket",
          logical_type: "STRING" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.bucket",
        },
        {
          name: "value",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.value",
        },
      ],
    },
    {
      shape: "grouped-multi-series",
      columns: [
        { key: "group", label: "分组", data_type: "STRING" as const },
        { key: "series", label: "序列", data_type: "STRING" as const },
        { key: "value", label: "数值", data_type: "NUMBER" as const },
      ],
      rows: [
        { group: "A", series: "new", value: 1 },
        { group: "A", series: "returning", value: 2 },
      ],
      bindings: [
        {
          name: "group",
          logical_type: "STRING" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.group",
        },
        {
          name: "series",
          logical_type: "STRING" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.series",
        },
        {
          name: "value",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.value",
        },
      ],
    },
    {
      shape: "wide-table",
      columns: [
        { key: "region", label: "区域", data_type: "STRING" as const },
        { key: "revenue", label: "收入", data_type: "NUMBER" as const },
        { key: "orders", label: "订单", data_type: "NUMBER" as const },
      ],
      rows: [{ region: "north", revenue: 12.5, orders: 3 }],
      bindings: [
        {
          name: "region",
          logical_type: "STRING" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.region",
        },
        {
          name: "revenue",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.revenue",
        },
        {
          name: "orders",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.orders",
        },
      ],
    },
    {
      shape: "time-series",
      columns: [
        { key: "occurred_at", label: "时间", data_type: "STRING" as const },
        { key: "value", label: "数值", data_type: "NUMBER" as const },
      ],
      rows: [
        { occurred_at: "2026-08-26T01:02:03.000Z", value: 4 },
        { occurred_at: "2026-08-26T02:02:03.000Z", value: null },
      ],
      bindings: [
        {
          name: "occurred_at",
          logical_type: "DATETIME" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.occurred_at",
        },
        {
          name: "value",
          logical_type: "NUMBER" as const,
          nullable: true,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.value",
        },
      ],
    },
    {
      shape: "cohort",
      columns: [
        { key: "cohort", label: "队列", data_type: "STRING" as const },
        { key: "month_index", label: "月序", data_type: "NUMBER" as const },
        { key: "retention", label: "留存", data_type: "NUMBER" as const },
      ],
      rows: [
        { cohort: "2026-01", month_index: 0, retention: 1 },
        { cohort: "2026-01", month_index: 1, retention: 0.7 },
      ],
      bindings: [
        {
          name: "cohort",
          logical_type: "STRING" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.cohort",
        },
        {
          name: "month_index",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "DIMENSION" as const,
          semantic_object_id: "dimension.month_index",
        },
        {
          name: "retention",
          logical_type: "NUMBER" as const,
          nullable: false,
          semantic_role: "METRIC" as const,
          semantic_object_id: "metric.retention",
        },
      ],
    },
  ])("materializes the generic $shape data shape", async ({ columns, rows, bindings }) => {
    const fixture = await harness({ columns, rows, bindings });
    await fixture.port.execute(request);

    const command = fixture.materialize.mock.calls[0]?.[0];
    const table = tableFromIPC(command?.content);
    expect(table.schema.fields.map(({ name }) => name)).toEqual(columns.map(({ key }) => key));
    expect(table.numRows).toBe(rows.length);
  });

  it("materializes exact committed QueryEvidence as typed Arrow", async () => {
    const fixture = await harness();

    await expect(fixture.port.execute(request)).resolves.toEqual([
      expect.objectContaining({ name: "query_evidence", format: "ARROW" }),
    ]);

    const command = fixture.materialize.mock.calls[0]?.[0];
    expect(command).toEqual(
      expect.objectContaining({
        query_evidence_ref: fixture.evidence.artifact_ref,
        row_count: 2,
        columns: [
          expect.objectContaining({ name: "month", arrow_type: "DATE32" }),
          expect.objectContaining({ name: "revenue", arrow_type: "FLOAT64" }),
          expect.objectContaining({ name: "complete", arrow_type: "BOOL" }),
        ],
      }),
    );
    const table = tableFromIPC(command?.content);
    expect(table.schema.fields.map(({ name }) => name)).toEqual(["month", "revenue", "complete"]);
    expect(String(table.schema.fields[0]?.type)).toBe(String(new DateDay()));
    expect(table.getChild("month")?.get(0)).toBe(Date.parse("2024-09-01T00:00:00.000Z"));
    expect(table.getChild("revenue")?.toArray()).toEqual(Float64Array.from([120.5, 140]));
  });

  it("rejects QueryEvidence beyond the executor row budget", async () => {
    const fixture = await harness();

    await expect(fixture.port.execute({ ...request, max_rows: 1 })).rejects.toThrow(
      "ANALYSIS_QUERY_ROW_BUDGET_EXCEEDED",
    );
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it("rejects cross-Run, reference-substitution and frozen-authority drift before materialization", async () => {
    const fixture = await harness();

    await expect(
      fixture.port.execute({
        ...request,
        lease: { ...request.lease, run_id: id(99) },
      }),
    ).rejects.toThrow("ANALYSIS_QUERY_EVIDENCE_SCOPE_INVALID");

    const substitutedRef = {
      ...fixture.evidence.artifact_ref,
      artifact_id: id(98),
      artifact_type: "QueryEvidence" as const,
    };
    const substitutionPort = createProductTeamGovernedAnalysisQueryPort({
      query_evidence_ref: substitutedRef,
      artifact_authority: {
        resolveCommitted: vi.fn(async () => ({ ok: true as const, value: fixture.evidence })),
      },
      artifact_capability: { authority: "application" },
      materializer: { materialize: fixture.materialize },
      expected_authority: fixture.expectedAuthority,
    });
    await expect(substitutionPort.execute(request)).rejects.toThrow(
      "ANALYSIS_QUERY_EVIDENCE_AUTHORITY_RESOLUTION_INVALID",
    );

    const driftedAuthorityPort = createProductTeamGovernedAnalysisQueryPort({
      query_evidence_ref: fixture.evidence.artifact_ref as ArtifactReference & {
        artifact_type: "QueryEvidence";
      },
      artifact_authority: { resolveCommitted: fixture.resolveCommitted },
      artifact_capability: { authority: "application" },
      materializer: { materialize: fixture.materialize },
      expected_authority: {
        ...fixture.expectedAuthority,
        target_binding_hash: hash("f"),
      },
    });
    await expect(driftedAuthorityPort.execute(request)).rejects.toThrow(
      "ANALYSIS_QUERY_EVIDENCE_AUTHORITY_BINDING_INVALID",
    );
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it.each([
    {
      columns: [{ key: "value", label: "值", data_type: "NUMBER" as const }],
      rows: [{ value: "not-a-number" }],
    },
    {
      columns: [{ key: "value", label: "值", data_type: "NUMBER" as const }],
      rows: [{}],
    },
    {
      columns: [{ key: "value", label: "值", data_type: "NUMBER" as const }],
      rows: [{ value: Number.POSITIVE_INFINITY }],
    },
  ])("rejects ambiguous or drifted table column types", async (input) => {
    await expect(harness(input)).rejects.toBeDefined();
  });
});
