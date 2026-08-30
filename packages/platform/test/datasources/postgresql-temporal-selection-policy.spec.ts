import { describe, expect, it } from "vitest";
import { assertPostgresqlTemporalSelectionDeclared } from "../../src/datasources/adapters/postgresql-temporal-selection-policy.js";

const temporalColumns = [
  { schema_name: "public", relation_name: "orders", column_name: "ordered_at" },
];

describe("PostgreSQL undeclared temporal selection", () => {
  it.each([
    "select sum(o.amount) as total from public.orders o where o.ordered_at >= $1 and o.ordered_at < $2",
    "select sum(o.amount) as total from public.orders o where ordered_at >= $1",
    "select sum(o.amount) as total from public.orders orders where public.orders.ordered_at >= $1",
    "select sum(o.amount) as total from public.orders o where o.ordered_at is not null",
    "select sum(o.amount) as total from public.orders o where o.ordered_at >= $1 or o.amount > $2",
    "select sum(o.amount) as total from public.orders o having max(o.ordered_at) >= $1",
    "select sum(o.amount) filter (where o.ordered_at >= $1) as total from public.orders o",
    "select sum(case when o.ordered_at >= $1 then o.amount else 0 end) as total from public.orders o",
    "select sum(case o.ordered_at when $1 then o.amount else 0 end) as total from public.orders o",
    "select sum(o.amount) as total from public.orders o join public.orders p on o.ordered_at=p.ordered_at",
    "select sum(o.amount) as total from public.orders o where o.untyped::timestamp >= $1::timestamp",
    "select sum(o.amount) as total from public.orders o where date_part($1, o.untyped)=$2",
    "with rows as (select o.ordered_at as day, o.amount as value from public.orders o) select sum(r.value) as total from rows r where r.day >= $1",
    "with rows as (select o.ordered_at as day, o.amount as value from public.orders o), periods as (select date_trunc($1,r.day) as month, sum(r.value) as value from rows r group by 1) select sum(p.value) as total from periods p where p.month >= $2",
    "with rows as (select o.ordered_at >= $1 as included, o.amount as value from public.orders o) select sum(r.value) as total from rows r where r.included",
    "with rows as (select o.amount as value from public.orders o where o.ordered_at >= $1) select sum(r.value) as total from rows r",
    "select o.amount as value from public.orders o order by case when o.ordered_at >= $1 then 0 else 1 end limit $2",
  ])("requires a declaration for temporal selection: %s", async (sql) => {
    await expect(
      assertPostgresqlTemporalSelectionDeclared({
        sql,
        temporal_columns: temporalColumns,
        has_declared_window: false,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED",
    });
    // A declaration still needs the separate existing authority, range and predicate proof.
    await expect(
      assertPostgresqlTemporalSelectionDeclared({
        sql,
        temporal_columns: temporalColumns,
        has_declared_window: true,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    "select o.ordered_at::date as day from public.orders o order by o.ordered_at::timestamp desc limit $1",
    "select date_trunc($1,o.ordered_at::timestamp) as month, sum(o.amount) as total from public.orders o group by 1 order by 1",
    "select sum(o.amount) as total from public.orders o where o.amount >= $1",
    "select sum(o.amount) filter (where o.amount >= $1) as total from public.orders o",
    "select case when sum(o.amount)=0 then 0 else sum(o.amount)/sum(o.spend) end as ratio from public.orders o",
    "select sum(o.amount) as total from public.orders o join public.accounts a on o.account_id=a.id",
    "select sum(o.amount) as total from archive.orders o where o.ordered_at >= $1",
    "with rows as (select o.ordered_at as day, o.amount as value from public.orders o) select r.day as day, r.value as value from rows r where r.value >= $1 order by r.day desc limit $2",
    "with rows as (select o.amount as ordered_at from public.orders o) select r.ordered_at as total from rows r where r.ordered_at >= $1",
    "with rows as (select o.ordered_at as day from public.orders o), totals as (select o.amount as day from public.orders o where o.amount >= $1) select t.day as value from totals t where t.day >= $2",
  ])("allows non-temporal selection, projection and ordering: %s", async (sql) => {
    await expect(
      assertPostgresqlTemporalSelectionDeclared({
        sql,
        temporal_columns: temporalColumns,
        has_declared_window: false,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    "select broken syntax from",
    "select 1 as n; select 2 as n",
    "with recursive r as (select 1 as n) select r.n as n from r r",
    "with r(day) as (select o.ordered_at as day from public.orders o) select r.day as day from r r",
    "select r.day as day from missing_cte r",
    "select o.amount as total from public.orders o join public.orders o on o.amount=o.amount",
  ])("fails closed for an unsupported scope instead of losing lineage: %s", async (sql) => {
    await expect(
      assertPostgresqlTemporalSelectionDeclared({
        sql,
        temporal_columns: temporalColumns,
        has_declared_window: false,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
    });
  });
});
