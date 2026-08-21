import { describe, expect, it } from "vitest";
import {
  assertEcommerceBenchmarkReadOnlySql,
  compileEcommerceTableCountSql,
} from "../../src/sandbox/postgres-ecommerce-benchmark-executor.js";

describe("E-commerce benchmark PostgreSQL policy", () => {
  it("compiles table count through the fixed sandbox adapter authority", () => {
    expect(compileEcommerceTableCountSql()).toContain("pg_catalog.pg_namespace");
    expect(compileEcommerceTableCountSql()).toContain("demo_adb_ecommerce_mart");
    expect(compileEcommerceTableCountSql()).toContain("any($1::text[])");
  });
  it("accepts complex read-only analytics over the fixed mart allowlist", async () => {
    await expect(
      assertEcommerceBenchmarkReadOnlySql(
        "with x as (select order_id from demo_adb_ecommerce_mart.fact_order) select count(*) from x",
      ),
    ).resolves.toContain("select count(*)");
  });

  it.each([
    "delete from demo_adb_ecommerce_mart.fact_order",
    "select * from app_data_agent.artifacts",
    "select pg_sleep(10)",
    "select * into temporary x from demo_adb_ecommerce_mart.fact_order",
    "select * from demo_adb_ecommerce_mart.fact_order for update",
    "select 1; select 2",
  ])("rejects unsafe SQL: %s", async (sql) => {
    await expect(assertEcommerceBenchmarkReadOnlySql(sql)).rejects.toThrow(
      "POSTGRES_QUERY_POLICY_REJECTED",
    );
  });
});
