import type {
  ArtifactReference,
  Falcon24AgentAnalysisCase,
  RunWorkLease,
} from "@data-agent/contracts";
import type { SqlClient, SqlPool } from "@data-agent/platform";
import { tableFromIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";
import type { GovernedPythonInput } from "../../src/analysis/sandbox-executor.js";
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
  artifact_type: "SandboxResult",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("b"),
};
const queryEvidenceRef: ArtifactReference = {
  artifact_id: id(7),
  artifact_type: "QueryEvidence",
  ...scope,
  run_id: lease.run_id,
  revision: 1,
  content_hash: hash("c"),
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
    order_total: 10,
    payment_method: "cash",
    customer_id: `customer-${index}`,
    customer_segment: "new",
    product_category: "grocery",
    quantity: 1,
  }));
}

function node(nodeId: Falcon24AgentAnalysisCase["case_id"]) {
  return {
    node_id: nodeId,
    skill_id: "open-python-analysis@1",
  } as never;
}

describe("Falcon24 governed query port", () => {
  it("executes only the registered query in a read-only transaction and delegates strict evidence", async () => {
    const statements: string[] = [];
    let released = false;
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        statements.push(text);
        return {
          rows: (text.startsWith("select") ? fixtureRows() : []) as Row[],
          rowCount: text.startsWith("select") ? fixtureRows().length : 0,
        };
      },
      release() {
        released = true;
      },
    };
    const materialize = vi.fn(async (input): Promise<GovernedPythonInput> => {
      expect(input.spec_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(input.data_oracle_receipt).toBe(dataOracleReceipt);
      expect(tableFromIPC(input.content).numRows).toBe(4_612);
      return {
        name: input.spec.input_name,
        format: "ARROW",
        query_evidence_ref: queryEvidenceRef,
        query_evidence_document: {},
        input_ref: inputRef,
        materialization_receipt_ref: materializationReceiptRef,
        materialization_receipt_document: {},
        content: input.content,
      };
    });
    const port = createFalcon24GovernedAnalysisQueryPort({
      pool: { connect: async () => client } satisfies SqlPool,
      snapshot_authority: { inspect: async () => dataOracleReceipt },
      materializer: { materialize },
    });
    await expect(
      port.execute({
        lease,
        analysis_program_ref: analysisProgramRef,
        node: node("falcon24-business-review-18m"),
        idempotency_key: "query-1",
        max_rows: 5_000,
        timeout_ms: 120_000,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ name: "falcon24_business_review", format: "ARROW" }),
    ]);
    expect(statements[0]).toBe("begin transaction isolation level repeatable read read only");
    expect(statements[1]).toBe("set local statement_timeout = 120000");
    expect(statements[2]).toBe(
      FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"].sql,
    );
    expect(statements[3]).toBe("commit");
    expect(materialize).toHaveBeenCalledOnce();
    expect(released).toBe(true);
  });

  it("rejects unknown cases and budgets before opening a transaction", async () => {
    const connect = vi.fn();
    const port = createFalcon24GovernedAnalysisQueryPort({
      pool: { connect } as SqlPool,
      snapshot_authority: { inspect: async () => dataOracleReceipt },
      materializer: { materialize: vi.fn() },
    });
    await expect(
      port.execute({
        lease,
        analysis_program_ref: analysisProgramRef,
        node: node("falcon24-business-review-18m"),
        idempotency_key: "query-2",
        max_rows: 4_611,
        timeout_ms: 120_000,
      }),
    ).rejects.toThrow("FALCON24_QUERY_ROW_BUDGET_EXCEEDED");
    await expect(
      port.execute({
        lease,
        analysis_program_ref: analysisProgramRef,
        node: { node_id: "unregistered" } as never,
        idempotency_key: "query-3",
        max_rows: 5_000,
        timeout_ms: 120_000,
      }),
    ).rejects.toThrow("FALCON24_QUERY_CASE_NOT_REGISTERED");
    expect(connect).not.toHaveBeenCalled();
  });

  it("rolls back and commits no evidence when the row contract drifts", async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        statements.push(text);
        return { rows: [] as Row[], rowCount: 0 };
      },
      release() {},
    };
    const materialize = vi.fn();
    const port = createFalcon24GovernedAnalysisQueryPort({
      pool: { connect: async () => client },
      snapshot_authority: { inspect: async () => dataOracleReceipt },
      materializer: { materialize },
    });
    await expect(
      port.execute({
        lease,
        analysis_program_ref: analysisProgramRef,
        node: node("falcon24-business-review-18m"),
        idempotency_key: "query-4",
        max_rows: 5_000,
        timeout_ms: 120_000,
      }),
    ).rejects.toThrow("FALCON24_QUERY_ROW_BUDGET_INVALID");
    expect(statements.at(-1)).toBe("rollback");
    expect(materialize).not.toHaveBeenCalled();
  });
});
