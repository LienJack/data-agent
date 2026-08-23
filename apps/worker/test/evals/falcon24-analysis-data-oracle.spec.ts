import type { SqlClient, SqlPool, SqlQueryResult } from "@data-agent/platform";
import { describe, expect, it } from "vitest";
import { createFalcon24AnalysisDataOracle } from "../../src/evals/falcon24-analysis-data-oracle.js";

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
    await expect(createFalcon24AnalysisDataOracle(scripted.pool).inspect()).resolves.toMatchObject({
      dataset_id: "falcon_db_24",
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
