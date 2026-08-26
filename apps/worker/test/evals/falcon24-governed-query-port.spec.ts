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
import { falcon24AnalysisDataOracleReceiptSchema } from "../../src/evals/falcon24-analysis-data-oracle.js";
import { FALCON24_ANALYSIS_QUERY_SPECS } from "../../src/evals/falcon24-analysis-queries.js";
import { createFalcon24GovernedAnalysisQueryPort } from "../../src/evals/falcon24-governed-query-port.js";

const id = (suffix: number) => `60000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
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
  worker_id: "falcon24-query-test",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-24T00:05:00.000Z",
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
const materializationReceiptRef: ArtifactReference = {
  artifact_id: id(11),
  artifact_type: "AnalysisInputMaterializationReceipt",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("e"),
};
const dataOracleReceipt = falcon24AnalysisDataOracleReceiptSchema.parse({
  schema_version: "falcon24-analysis-data-oracle@1.0.0",
  dataset_id: "falcon_db_24",
  verdict: "PASS_WITH_QUALITY_HOLDS",
  table_count: 9,
  column_count: 70,
  total_row_count: 121445,
  max_order_date: "2024-11-04",
  last_complete_month: "2024-10-01",
  complete_month_count_18: 18,
  complete_month_count_12: 12,
  order_item_total_mismatch_count: 4999,
  stored_order_count_mismatch_count: 2385,
  stored_aov_mismatch_count: 2172,
  orders_before_registration_count: 2556,
  first_order_before_registration_customers: 1438,
  valid_ordering_customers: 734,
  no_order_customers: 328,
  delivery_rows_12m: 3059,
  feedback_rows_12m: 3059,
  inventory_rows_12m: 45231,
  inventory_new_rows_12m: 9798,
  marketing_week_count: 79,
  fully_observed_cohort_count: 12,
  quality_findings: [
    "FIRST_ORDER_BEFORE_REGISTRATION",
    "INVENTORY_NEW_SENSITIVITY_ONLY",
    "ORDER_BEFORE_REGISTRATION",
    "ORDER_TOTAL_ITEM_MISMATCH",
    "STORED_CUSTOMER_KPI_UNTRUSTED",
  ],
  receipt_hash: hash("d"),
});

function fixtureRows() {
  const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
  return Array.from({ length: spec.expected_rows }, (_, index) => ({
    order_id: `order-${index}`,
    order_date: "2024-10-01",
    payment_method: "cash",
    customer_id: `customer-${index}`,
    customer_segment: "new",
    product_category: "grocery",
    quantity: 1,
    order_total: 10,
  }));
}

function node(nodeId: string) {
  return { node_id: nodeId, skill_id: "open-python-analysis@1" } as never;
}

async function documents(rows = fixtureRows()) {
  const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
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
      candidate_hash: hash("3"),
      parameters_hash: hash("4"),
      parameter_count: 0,
      datasource_ref: {
        resource_id: id(30),
        resource_revision: 1,
        resource_hash: hash("5"),
      },
      schema_snapshot_ref: { resource_id: id(31), resource_hash: hash("6") },
      semantic_context_ref: { package_id: id(32), package_hash: hash("7") },
      target_binding_hash: hash("8"),
    },
    projection: { kind: "SQL", dialect: "postgresql", sql: "select governed columns" },
    committed_at: "2026-08-24T00:00:00.000Z",
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
      request_hash: hash("1"),
      result_hash: hash("2"),
      row_count: rows.length,
      byte_count: 1,
      elapsed_ms: 42,
      truncated: false,
    },
    projection: {
      kind: "TABLE",
      columns: spec.columns.map((column) => ({
        key: column.name,
        label: column.name,
        data_type: column.kind === "FLOAT64" ? ("NUMBER" as const) : ("STRING" as const),
      })),
      rows,
      total_rows: rows.length,
    },
    committed_at: "2026-08-24T00:00:01.000Z",
  });
  return { sql, evidence };
}

async function createPort(
  input: {
    readonly rows?: ReturnType<typeof fixtureRows>;
    readonly omit_sql?: boolean;
    readonly omit_evidence?: boolean;
  } = {},
) {
  const { sql, evidence } = await documents(input.rows);
  const stored: ProductTeamArtifactDocument[] = [
    ...(input.omit_sql ? [] : [sql]),
    ...(input.omit_evidence ? [] : [evidence]),
  ];
  const materialize = vi.fn(
    async (command): Promise<GovernedAnalysisInput> => ({
      name: command.input_name,
      format: "ARROW",
      query_evidence_ref: command.query_evidence_ref,
      query_evidence_document: evidence,
      input_ref: inputRef,
      materialization_receipt_ref: materializationReceiptRef,
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
    resolveCommitted,
    port: createFalcon24GovernedAnalysisQueryPort({
      query_evidence_ref: evidence.artifact_ref as ArtifactReference & {
        artifact_type: "QueryEvidence";
      },
      artifact_authority: { resolveCommitted },
      artifact_capability: { authority: "application" },
      snapshot_authority: { inspect: async () => dataOracleReceipt },
      materializer: { materialize },
    }),
  };
}

const request = {
  lease,
  analysis_program_ref: analysisProgramRef,
  node: node("falcon24-business-review-18m"),
  idempotency_key: "query-1",
  max_rows: 5_000,
  timeout_ms: 120_000,
};

describe("Falcon24 governed query port", () => {
  it("materializes the authoritative accepted QueryEvidence without querying or replacing it", async () => {
    const harness = await createPort();
    await expect(harness.port.execute(request)).resolves.toEqual([
      expect.objectContaining({ name: "falcon24_business_review", format: "ARROW" }),
    ]);
    expect(harness.resolveCommitted).toHaveBeenCalledTimes(2);
    expect(harness.materialize).toHaveBeenCalledWith(
      expect.objectContaining({ query_evidence_ref: harness.evidence.artifact_ref }),
    );
    const materialization = harness.materialize.mock.calls[0]?.[0];
    expect(tableFromIPC(materialization?.content).numRows).toBe(4_612);
  });

  it("fails closed when accepted QueryEvidence is not persisted", async () => {
    const harness = await createPort({ omit_evidence: true });
    await expect(harness.port.execute(request)).rejects.toThrow(
      "FALCON24_QUERY_EVIDENCE_AUTHORITY_RESOLUTION_INVALID",
    );
    expect(harness.materialize).not.toHaveBeenCalled();
  });

  it("fails closed when the exact SqlArtifact lineage source is missing", async () => {
    const harness = await createPort({ omit_sql: true });
    await expect(harness.port.execute(request)).rejects.toThrow(
      "FALCON24_SQL_ARTIFACT_AUTHORITY_RESOLUTION_INVALID",
    );
    expect(harness.materialize).not.toHaveBeenCalled();
  });

  it("rejects row-shape drift and insufficient row budgets before materialization", async () => {
    const drifted = await createPort({ rows: [] });
    await expect(drifted.port.execute(request)).rejects.toThrow(
      "ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID",
    );
    const valid = await createPort();
    await expect(valid.port.execute({ ...request, max_rows: 4_611 })).rejects.toThrow(
      "FALCON24_QUERY_ROW_BUDGET_EXCEEDED",
    );
  });
});
