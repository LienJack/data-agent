import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";

export function aggregateRatioFixture() {
  return {
    output_name: "net_roi",
    interpretation_id: "request-scoped.net-roi",
    numerator_metric_id: "metric.revenue",
    denominator_metric_id: "metric.spend",
    numerator_adjustment: "SUBTRACT_DENOMINATOR" as "NONE" | "SUBTRACT_DENOMINATOR",
    source: {
      schema_name: "public",
      relation_name: "marketing",
      numerator_column: "revenue",
      numerator_type: "numeric",
      denominator_column: "spend",
      denominator_type: "numeric",
    },
    dimensions: [{ object_id: "dimension.channel", column_name: "channel" }],
    candidate: {
      schema_version: "text2sql-query-candidate@1.0.0",
      sql: "SELECT m.channel AS channel, SUM(m.revenue) AS revenue, SUM(m.spend) AS spend, (SUM(m.revenue)-SUM(m.spend))/NULLIF(SUM(m.spend),0) AS net_roi FROM public.marketing AS m GROUP BY m.channel ORDER BY net_roi DESC NULLS LAST",
      parameters: [],
      result_columns: [
        {
          name: "channel",
          semantic_type: "STRING",
          label: "渠道",
          semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.channel" },
        },
        {
          name: "revenue",
          semantic_type: "NUMBER",
          label: "收入",
          semantic_binding: { object_kind: "METRIC", object_id: "metric.revenue" },
        },
        {
          name: "spend",
          semantic_type: "NUMBER",
          label: "投入",
          semantic_binding: { object_kind: "METRIC", object_id: "metric.spend" },
        },
        {
          name: "net_roi",
          semantic_type: "NUMBER",
          label: "净ROI",
          semantic_binding: { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.net-roi" },
        },
      ],
      time_window: null,
      presentation: {
        title: "净ROI",
        summary: "先聚合后计算",
        visualization: "TABLE",
        x_key: null,
        y_keys: [],
      },
    } satisfies Text2SqlQueryCandidate,
  };
}
