import { describe, expect, it } from "vitest";
import {
  assertPostgresReadOnlyBenchmarkSql,
  compilePostgresTableCountSql,
} from "../../src/sandbox/postgres-read-only-benchmark-executor.js";

const policy = {
  allowed_schema: "benchmark_mart",
  reader_role: "benchmark_reader",
  allowed_relations: ["fact_order", "fact_payment"],
} as const;

describe("parameterized benchmark PostgreSQL policy", () => {
  it("compiles table count through the explicit schema authority", () => {
    expect(compilePostgresTableCountSql(policy.allowed_schema)).toContain(
      "pg_catalog.pg_namespace",
    );
    expect(compilePostgresTableCountSql(policy.allowed_schema)).toContain("benchmark_mart");
    expect(compilePostgresTableCountSql(policy.allowed_schema)).toContain("any($1::text[])");
  });
  it("accepts complex read-only analytics over the fixed mart allowlist", async () => {
    await expect(
      assertPostgresReadOnlyBenchmarkSql(
        "with x as (select order_id from benchmark_mart.fact_order) select count(*) from x",
        policy,
      ),
    ).resolves.toContain("select count(*)");
  });

  it("rejects unsafe policy identifiers before parsing SQL", async () => {
    await expect(
      assertPostgresReadOnlyBenchmarkSql("select * from benchmark_mart.fact_order", {
        ...policy,
        reader_role: "reader; reset role",
      }),
    ).rejects.toThrow("POSTGRES_QUERY_POLICY_INVALID");
  });

  it.each([
    "delete from benchmark_mart.fact_order",
    "select * from app_data_agent.artifacts",
    "select pg_sleep(10)",
    "select * into temporary x from benchmark_mart.fact_order",
    "select * from benchmark_mart.fact_order for update",
    "select 1; select 2",
  ])("rejects unsafe SQL: %s", async (sql) => {
    await expect(assertPostgresReadOnlyBenchmarkSql(sql, policy)).rejects.toThrow(
      "POSTGRES_QUERY_POLICY_REJECTED",
    );
  });
});
