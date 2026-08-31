import { periodComparisonFixture } from "./period-comparison-fixture.js";

export function groupedPeriodComparisonFixture(joined = true) {
  const input = periodComparisonFixture();
  const scan = (start: number, end: number) =>
    `SELECT date_trunc($1, o.order_date::pg_catalog.timestamp) AS m, ${joined ? "d" : "o"}.segment AS g, sum(o.amount) AS v FROM public.orders AS o${joined ? " LEFT JOIN public.customers AS d ON o.customer_id=d.customer_id" : ""} WHERE o.order_date::pg_catalog.timestamp >= $${start}::pg_catalog.timestamp AND o.order_date::pg_catalog.timestamp < $${end}::pg_catalog.timestamp GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp), ${joined ? "d" : "o"}.segment`;
  input.candidate.sql = `WITH current_months AS (${scan(2, 3)}), comparison_months AS (${scan(4, 5)}) SELECT c.m AS month, c.g AS segment, c.v AS current_value, p.v AS comparison_value, (c.v-p.v)/NULLIF(p.v,0) AS growth FROM current_months AS c LEFT JOIN comparison_months AS p ON c.m=p.m+$6::pg_catalog.interval AND (c.g=p.g OR (c.g IS NULL AND p.g IS NULL)) ORDER BY month, segment`;
  input.candidate.result_columns.splice(1, 0, {
    name: "segment",
    semantic_type: "STRING",
    label: "客户类型",
    semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.segment" },
  });
  return {
    ...input,
    group_dimension: {
      object_id: "dimension.segment",
      schema_name: "public",
      relation_name: joined ? "customers" : "orders",
      column_name: "segment",
      join: joined ? { left_column: "customer_id", right_column: "customer_id" } : null,
    },
  };
}
