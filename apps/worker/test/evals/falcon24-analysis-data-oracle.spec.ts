import type { SqlClient, SqlPool, SqlQueryResult } from "@data-agent/platform";
import { describe, expect, it } from "vitest";
import {
  createFalcon24AnalysisDataOracle,
  falcon24AnalysisDataOracleInternals,
  verifyFalcon24AnalysisDataOracleReceipt,
} from "../../src/evals/falcon24-analysis-data-oracle.js";

const fixedRow = {
  table_count: "9",
  column_count: "70",
  total_row_count: "121445",
  max_order_date: "2024-11-04",
  last_complete_month: "2024-10-01",
  complete_month_count_18: "18",
  complete_month_count_12: "12",
  order_item_total_mismatch_count: "4999",
  stored_order_count_mismatch_count: "2385",
  stored_aov_mismatch_count: "2172",
  orders_before_registration_count: "2556",
  first_order_before_registration_customers: "1438",
  valid_ordering_customers: "734",
  no_order_customers: "328",
  delivery_rows_12m: "3059",
  feedback_rows_12m: "3059",
  inventory_rows_12m: "45231",
  inventory_new_rows_12m: "9798",
  marketing_week_count: "79",
  fully_observed_cohort_count: "12",
};

function pool(row: Record<string, unknown>) {
  let released = false;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>() {
      return { rows: [row as Row], rowCount: 1 } as SqlQueryResult<Row>;
    },
    release() {
      released = true;
    },
  };
  return { pool: { connect: async () => client } satisfies SqlPool, released: () => released };
}

describe("Falcon24 analysis data oracle", () => {
  it("accepts the fixed snapshot and exposes all required quality holds", async () => {
    const scripted = pool(fixedRow);
    const receipt = await createFalcon24AnalysisDataOracle(scripted.pool).inspect();
    expect(receipt).toMatchObject({
      schema_version: "falcon24-analysis-data-oracle@2.0.0",
      dataset_id: "falcon_db_24",
      implementation_id: "falcon24-independent-data-oracle@2",
      implementation_hash: await falcon24AnalysisDataOracleInternals.implementationHash(),
      verdict: "PASS_WITH_QUALITY_HOLDS",
      table_count: 9,
      column_count: 70,
      total_row_count: 121445,
      last_complete_month: "2024-10-01",
      quality_findings: [
        "FIRST_ORDER_BEFORE_REGISTRATION",
        "INVENTORY_NEW_SENSITIVITY_ONLY",
        "ORDER_BEFORE_REGISTRATION",
        "ORDER_TOTAL_ITEM_MISMATCH",
        "STORED_CUSTOMER_KPI_UNTRUSTED",
      ],
    });
    await expect(verifyFalcon24AnalysisDataOracleReceipt(receipt)).resolves.toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(/select |falcon_db_24\.|stdout|credential|target/u);
    expect(scripted.released()).toBe(true);
  });

  it("fails closed when the dataset identity or acceptance windows drift", async () => {
    await expect(
      createFalcon24AnalysisDataOracle(
        pool({ ...fixedRow, complete_month_count_18: "17" }).pool,
      ).inspect(),
    ).rejects.toThrow("FALCON24_FIXED_SNAPSHOT_MISMATCH:complete_month_count_18");
  });
});
