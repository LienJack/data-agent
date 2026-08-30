import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";

export function periodComparisonFixture() {
  const scan = (start: number, end: number) =>
    `SELECT date_trunc($1, o.order_date::pg_catalog.timestamp) AS m, sum(o.amount) AS v FROM public.orders AS o WHERE o.order_date::pg_catalog.timestamp >= $${start}::pg_catalog.timestamp AND o.order_date::pg_catalog.timestamp < $${end}::pg_catalog.timestamp GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp)`;
  const candidate: Text2SqlQueryCandidate = {
    schema_version: "text2sql-query-candidate@1.0.0",
    sql: `WITH current_months AS (${scan(2, 3)}), comparison_months AS (${scan(4, 5)}) SELECT c.m AS month, c.v AS current_value, p.v AS comparison_value, (c.v-p.v)/NULLIF(p.v,0) AS growth FROM current_months AS c LEFT JOIN comparison_months AS p ON c.m=p.m+$6::pg_catalog.interval ORDER BY month`,
    parameters: ["month", "2023-11-01", "2024-11-01", "2023-05-01", "2023-11-01", "1 year"],
    result_columns: [
      {
        name: "month",
        semantic_type: "DATETIME",
        label: "月份",
        semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.order_month" },
      },
      {
        name: "current_value",
        semantic_type: "NUMBER",
        label: "本期",
        semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
      },
      {
        name: "comparison_value",
        semantic_type: "NUMBER",
        label: "同期",
        semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
      },
      {
        name: "growth",
        semantic_type: "NUMBER",
        label: "同比",
        semantic_binding: { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.yoy" },
      },
    ],
    time_window: {
      dimension_id: "dimension.order_month",
      start_parameter: 2,
      end_parameter: 3,
      semantics: "HALF_OPEN",
    },
    presentation: {
      title: "月度同比",
      summary: "请求内同比",
      visualization: "LINE",
      x_key: "month",
      y_keys: ["growth"],
    },
  };
  return {
    candidate,
    output_name: "growth",
    metric_id: "metric.order_revenue",
    dimension_id: "dimension.order_month",
    source: {
      schema_name: "public",
      relation_name: "orders",
      value_column: "amount",
      value_type: "numeric",
      time_column: "order_date",
      time_type: "text",
    },
    current: { start: "2023-11-01T00:00:00.000Z", end: "2024-11-01T00:00:00.000Z" },
    comparison: { start: "2023-05-01T00:00:00.000Z", end: "2023-11-01T00:00:00.000Z" },
  };
}
