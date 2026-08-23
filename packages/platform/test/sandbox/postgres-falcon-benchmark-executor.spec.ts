import { describe, expect, it } from "vitest";
import {
  assertFalconBenchmarkReadOnlySql,
  assertFalconDatabaseSchema,
} from "../../src/sandbox/postgres-falcon-benchmark-executor.js";

describe("Falcon benchmark PostgreSQL policy", () => {
  it("accepts CTEs, windows, ordering, subqueries and the selected schema", async () => {
    await expect(
      assertFalconBenchmarkReadOnlySql({
        database_schema: "falcon_db_24",
        sql: `
          with ranked as (
            select *, row_number() over (partition by "grade" order by "student id") as rank
            from falcon_db_24."student"
          )
          select * from ranked where rank <= 3 order by rank
        `,
      }),
    ).resolves.toContain("row_number()");
  });

  it.each(["falcon_db_01", "falcon_db_14", "falcon_db_28"])(
    "accepts a fixed Falcon schema: %s",
    (schema) => {
      expect(assertFalconDatabaseSchema(schema)).toBe(schema);
    },
  );

  it.each(["falcon_db_00", "falcon_db_29", "falcon_db_1", "public", "falcon_db_14;drop"])(
    "rejects an invalid schema: %s",
    (schema) => {
      expect(() => assertFalconDatabaseSchema(schema)).toThrow("FALCON_DATABASE_SCHEMA_INVALID");
    },
  );

  it.each([
    "delete from student",
    "select * from app_data_agent.artifacts",
    "select * from falcon_db_23.student",
    "select pg_sleep(10)",
    "select * into temporary x from student",
    "select * from student for update",
    "select 1; select 2",
  ])("rejects unsafe SQL: %s", async (sql) => {
    await expect(
      assertFalconBenchmarkReadOnlySql({ database_schema: "falcon_db_24", sql }),
    ).rejects.toThrow("POSTGRES_QUERY_POLICY_REJECTED");
  });
});
