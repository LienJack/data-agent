import {
  type ArtifactReference,
  artifactReferenceIdentity,
  buildProductTeamArtifactDocument,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProductTeamArtifactDocument,
  type RunWorkLease,
} from "@data-agent/contracts";
import { tableFromIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";
import type { GovernedAnalysisInput } from "../../src/analysis/governed-analysis-input.js";
import { createProductTeamGovernedAnalysisQueryPort } from "../../src/analysis/product-team-query-port.js";

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
    },
    projection: { kind: "TABLE", columns, rows, total_rows: rows.length },
    committed_at: "2026-08-26T00:00:01.000Z",
  });
  return { sql, evidence };
}

async function harness(input?: Parameters<typeof documents>[0]) {
  const { sql, evidence } = await documents(input);
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
  return {
    evidence,
    materialize,
    port: createProductTeamGovernedAnalysisQueryPort({
      query_evidence_ref: evidence.artifact_ref as ArtifactReference & {
        artifact_type: "QueryEvidence";
      },
      artifact_authority: { resolveCommitted },
      artifact_capability: { authority: "application" },
      materializer: { materialize },
      semantic_context_hash: hash("9"),
      schema_snapshot_hash: hash("d"),
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
        ordered_columns: ["month", "revenue", "complete"],
      }),
    );
    const table = tableFromIPC(command?.content);
    expect(table.schema.fields.map(({ name }) => name)).toEqual(["month", "revenue", "complete"]);
    expect(table.toArray()).toMatchObject([
      { month: "2024-09-01", revenue: 120.5, complete: true },
      { month: "2024-10-01", revenue: 140, complete: true },
    ]);
  });

  it("rejects QueryEvidence beyond the executor row budget", async () => {
    const fixture = await harness();

    await expect(fixture.port.execute({ ...request, max_rows: 1 })).rejects.toThrow(
      "ANALYSIS_QUERY_ROW_BUDGET_EXCEEDED",
    );
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it.each([
    {
      columns: [{ key: "value", label: "值", data_type: "MIXED" as const }],
      rows: [{ value: 1 }],
    },
    {
      columns: [{ key: "value", label: "值", data_type: "NUMBER" as const }],
      rows: [{ value: "not-a-number" }],
    },
  ])("rejects ambiguous or drifted table column types", async (input) => {
    const fixture = await harness(input);

    await expect(fixture.port.execute(request)).rejects.toThrow(
      "ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID",
    );
    expect(fixture.materialize).not.toHaveBeenCalled();
  });
});
