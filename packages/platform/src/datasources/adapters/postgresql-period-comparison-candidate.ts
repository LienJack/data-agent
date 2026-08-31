import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";
import type { provePostgresqlPeriodComparison } from "./postgresql-request-derivation.js";

type PeriodSource = Omit<
  Parameters<typeof provePostgresqlPeriodComparison>[0],
  "candidate" | "output_name"
>;

/** Pure syntax renderer, never an authority grant. Its caller must run the existing proof. */
export function renderPostgresqlPeriodComparisonCandidate(
  input: PeriodSource & { readonly interpretation_id: string },
): Text2SqlQueryCandidate {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const table = (schema: string, relation: string) => `${quote(schema)}.${quote(relation)}`;
  const source = input.source,
    group = input.group_dimension;
  const time = `f.${quote(source.time_column)}${source.time_type === "text" ? "::pg_catalog.timestamp" : ""}`;
  const month = `date_trunc($1, ${time})`;
  const category = group ? `${group.join ? "d" : "f"}.${quote(group.column_name)}` : null;
  const scan = (start: number, end: number) =>
    `SELECT ${month} AS m, sum(f.${quote(source.value_column)}) AS v${category ? `, ${category} AS g` : ""} ` +
    `FROM ${table(source.schema_name, source.relation_name)} AS f` +
    (group?.join
      ? ` LEFT JOIN ${table(group.schema_name, group.relation_name)} AS d ON f.${quote(group.join.left_column)}=d.${quote(group.join.right_column)}`
      : "") +
    ` WHERE ${time} >= $${start}::pg_catalog.timestamp AND ${time} < $${end}::pg_catalog.timestamp ` +
    `GROUP BY ${month}${category ? `, ${category}` : ""}`;
  const shifted = "p.m+$6::pg_catalog.interval";
  return {
    schema_version: "text2sql-query-candidate@1.0.0",
    sql:
      `WITH current_months AS (${scan(2, 3)}), comparison_months AS (${scan(4, 5)}) ` +
      `SELECT ${group ? `COALESCE(c.m,${shifted})` : "c.m"} AS month, ` +
      (group ? "COALESCE(c.g,p.g) AS category, " : "") +
      "c.v AS current_value, p.v AS comparison_value, (c.v-p.v)/NULLIF(p.v,$7) AS growth " +
      `FROM current_months AS c ${group ? "FULL" : "LEFT"} JOIN comparison_months AS p ON c.m=${shifted}` +
      (group ? " AND (c.g=p.g OR (c.g IS NULL AND p.g IS NULL))" : "") +
      ` ORDER BY month${group ? ", category" : ""}`,
    parameters: [
      "month",
      input.current.start,
      input.current.end,
      input.comparison.start,
      input.comparison.end,
      "1 year",
      0,
    ],
    result_columns: [
      {
        name: "month",
        semantic_type: "DATETIME",
        label: "月份",
        semantic_binding: { object_kind: "DIMENSION", object_id: input.dimension_id },
      },
      ...(group
        ? [
            {
              name: "category",
              semantic_type: "STRING" as const,
              label: "分类",
              semantic_binding: { object_kind: "DIMENSION" as const, object_id: group.object_id },
            },
          ]
        : []),
      {
        name: "current_value",
        semantic_type: "NUMBER",
        label: "本期",
        semantic_binding: { object_kind: "METRIC", object_id: input.metric_id },
      },
      {
        name: "comparison_value",
        semantic_type: "NUMBER",
        label: "上年同期",
        semantic_binding: { object_kind: "METRIC", object_id: input.metric_id },
      },
      {
        name: "growth",
        semantic_type: "NUMBER",
        label: "同比",
        semantic_binding: { object_kind: "REQUEST_DERIVED", object_id: input.interpretation_id },
      },
    ],
    time_window: {
      dimension_id: input.dimension_id,
      start_parameter: 2,
      end_parameter: 3,
      semantics: "HALF_OPEN",
    },
    // Grouped charts require Analysis's role-preserving series mapping, not repeated x-only points.
    presentation: {
      title: "月度同比",
      summary: "按本轮语义口径比较本期与上年同期，缺失保持空值。",
      visualization: group ? "TABLE" : "LINE",
      x_key: group ? null : "month",
      y_keys: group ? [] : ["growth"],
    },
  };
}
