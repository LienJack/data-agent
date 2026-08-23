import { canonicalizeJson } from "@data-agent/contracts";
import type pg from "pg";
import { parse } from "pgsql-parser";

const ALLOWED_SCHEMA = "demo_adb_ecommerce_mart";
const READER_ROLE = "data_agent_ecommerce_reader";
const ALLOWED_RELATIONS = new Set([
  "dim_date",
  "dim_customer",
  "dim_seller",
  "dim_category",
  "dim_product",
  "dim_geolocation_zip",
  "dim_amazon_product",
  "dim_ebay_listing",
  "fact_order",
  "fact_order_item",
  "fact_payment",
  "fact_review",
  "fact_amazon_review",
  "fact_delivery_state_month",
]);
const DANGEROUS_NODE_NAMES = new Set([
  "AlterTableStmt",
  "CallStmt",
  "CopyStmt",
  "CreateStmt",
  "DeleteStmt",
  "DoStmt",
  "DropStmt",
  "GrantStmt",
  "InsertStmt",
  "RefreshMatViewStmt",
  "TransactionStmt",
  "TruncateStmt",
  "UpdateStmt",
  "VariableSetStmt",
]);
const DANGEROUS_FUNCTION =
  /^(?:dblink|lo_|pg_advisory|pg_read|pg_ls|pg_sleep|pg_stat_file|set_config|current_setting)/iu;

type JsonRecord = Record<string, unknown>;

export interface EcommerceBenchmarkQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}

export interface EcommerceBenchmarkQueryExecutor {
  execute(input: {
    readonly sql: string;
    readonly timeout_ms: number;
    readonly max_rows: number;
  }): Promise<EcommerceBenchmarkQueryResult>;
  executeTableCount(input: { readonly timeout_ms: number }): Promise<EcommerceBenchmarkQueryResult>;
  executeMonthlyOrderTrend(input: {
    readonly timeout_ms: number;
  }): Promise<EcommerceBenchmarkQueryResult>;
}

export function compileEcommerceTableCountSql(): string {
  return `select count(*)::integer as table_count
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = '${ALLOWED_SCHEMA}'
  and relation.relkind in ('r', 'p')
  and relation.relname = any($1::text[])`;
}

export function compileEcommerceMonthlyOrderTrendSql(): string {
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${ALLOWED_SCHEMA}.fact_payment
  group by order_id
), monthly as (
  select pg_catalog.date_trunc('month', orders.purchase_date) as month_start,
         count(*)::integer as order_count,
         round(coalesce(sum(payment.sales_amount), 0), 2)::double precision as sales_amount_brl
  from ${ALLOWED_SCHEMA}.fact_order orders
  left join payment_by_order payment on payment.order_id = orders.order_id
  where orders.purchase_date is not null
  group by pg_catalog.date_trunc('month', orders.purchase_date)
)
select pg_catalog.to_char(month_start, 'YYYY-MM') as month,
       order_count,
       sales_amount_brl,
       round((
         (sales_amount_brl - lag(sales_amount_brl) over (order by month_start)) * 100
         / nullif(lag(sales_amount_brl) over (order by month_start), 0)
       )::numeric, 2)::double precision as sales_mom_pct
from monthly
order by month_start`;
}

export function compileEcommerceSalesAnomalySql(): string {
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${ALLOWED_SCHEMA}.fact_payment
  group by order_id
), monthly as (
  select pg_catalog.date_trunc('month', orders.purchase_date) as month_start,
         count(*)::integer as order_count,
         round(coalesce(sum(payment.sales_amount), 0), 2)::double precision as sales_amount_brl
  from ${ALLOWED_SCHEMA}.fact_order orders
  left join payment_by_order payment on payment.order_id = orders.order_id
  where orders.purchase_date is not null
  group by pg_catalog.date_trunc('month', orders.purchase_date)
), monthly_change as (
  select month_start,
         order_count,
         sales_amount_brl,
         round((
           (sales_amount_brl - lag(sales_amount_brl) over (order by month_start)) * 100
           / nullif(lag(sales_amount_brl) over (order by month_start), 0)
         )::numeric, 2)::double precision as mom_pct
  from monthly
), anomalies as (
  select 'MONTHLY_SALES_CHANGE'::text as anomaly_type,
         pg_catalog.to_char(month_start, 'YYYY-MM')::text as entity,
         mom_pct::double precision as metric_value,
         ('sales=' || sales_amount_brl::text || ' BRL; orders=' || order_count::text)::text as detail
  from monthly_change
  where abs(mom_pct) >= 50
  union all
  select 'DELIVERY_DELAY'::text,
         order_id::text,
         round(delivery_delay_days::numeric, 2)::double precision,
         ('status=' || coalesce(order_status, 'NULL'))::text
  from ${ALLOWED_SCHEMA}.fact_order
  where delivery_delay_days >= 100
)
select anomaly_type, entity, metric_value, detail
from anomalies
order by anomaly_type, abs(metric_value) desc, entity
limit 100`;
}

export function compileEcommerceSalesReportSummarySql(): string {
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${ALLOWED_SCHEMA}.fact_payment
  group by order_id
), review_by_order as (
  select order_id, avg(review_score)::numeric as review_score
  from ${ALLOWED_SCHEMA}.fact_review
  group by order_id
)
select min(orders.purchase_date)::text as period_start,
       max(orders.purchase_date)::text as period_end,
       count(*)::integer as total_orders,
       round(coalesce(sum(payment.sales_amount), 0), 2)::double precision as total_sales_brl,
       round(coalesce(avg(payment.sales_amount), 0), 2)::double precision as average_order_value_brl,
       count(*) filter (where orders.delivery_delay_days > 0)::integer as delayed_orders,
       round(coalesce(avg(orders.delivery_delay_days) filter (where orders.delivery_delay_days > 0), 0)::numeric, 2)::double precision as average_delay_days,
       round(coalesce(max(orders.delivery_delay_days), 0)::numeric, 2)::double precision as maximum_delay_days,
       round(coalesce(avg(review.review_score), 0), 2)::double precision as average_review_score
from ${ALLOWED_SCHEMA}.fact_order orders
left join payment_by_order payment on payment.order_id = orders.order_id
left join review_by_order review on review.order_id = orders.order_id`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visit(value: unknown, visitor: (name: string, node: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(value)) {
    if (isRecord(child)) visitor(name, child);
    visit(child, visitor);
  }
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && isRecord(entry.String) && typeof entry.String.sval === "string"
      ? [entry.String.sval]
      : [],
  );
}

export async function assertEcommerceBenchmarkReadOnlySql(sql: string): Promise<string> {
  const trimmed = sql.trim();
  if (trimmed.length === 0 || trimmed.length > 100_000) {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  let tree: Awaited<ReturnType<typeof parse>>;
  try {
    tree = await parse(trimmed);
  } catch {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  const statements = (
    tree as unknown as { readonly stmts?: readonly { readonly stmt?: unknown }[] }
  ).stmts;
  const statement = statements?.[0]?.stmt;
  if (statements?.length !== 1 || !isRecord(statement) || !isRecord(statement.SelectStmt)) {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  const ctes = new Set<string>();
  visit(tree, (name, node) => {
    if (DANGEROUS_NODE_NAMES.has(name)) throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
    if (name === "SelectStmt") {
      if (
        node.intoClause !== undefined ||
        (Array.isArray(node.lockingClause) && node.lockingClause.length > 0)
      ) {
        throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
      }
    }
    if (name === "CommonTableExpr" && typeof node.ctename === "string") ctes.add(node.ctename);
    if (name === "FuncCall") {
      const functionName = stringValues(node.funcname).at(-1);
      if (functionName && DANGEROUS_FUNCTION.test(functionName)) {
        throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
      }
    }
  });
  visit(tree, (name, node) => {
    if (name !== "RangeVar" || typeof node.relname !== "string") return;
    if (node.schemaname === undefined && ctes.has(node.relname)) return;
    if (
      (node.schemaname !== undefined && node.schemaname !== ALLOWED_SCHEMA) ||
      !ALLOWED_RELATIONS.has(node.relname)
    ) {
      throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
    }
  });
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

function normalize(value: unknown): null | string | number {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("POSTGRES_RESULT_CELL_UNSUPPORTED");
    return value;
  }
  if (typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `hex:${Buffer.from(value).toString("hex")}`;
  }
  if (typeof value === "object") return canonicalizeJson(value);
  throw new Error("POSTGRES_RESULT_CELL_UNSUPPORTED");
}

export function createPostgresEcommerceBenchmarkExecutor(input: {
  readonly pool: pg.Pool;
}): EcommerceBenchmarkQueryExecutor {
  const executor: EcommerceBenchmarkQueryExecutor = {
    async execute(request: {
      readonly sql: string;
      readonly timeout_ms: number;
      readonly max_rows: number;
    }) {
      const sql = await assertEcommerceBenchmarkReadOnlySql(request.sql);
      if (
        !Number.isInteger(request.timeout_ms) ||
        request.timeout_ms < 1 ||
        request.timeout_ms > 600_000 ||
        !Number.isInteger(request.max_rows) ||
        request.max_rows < 1 ||
        request.max_rows > 100_000
      ) {
        throw new Error("POSTGRES_QUERY_BUDGET_INVALID");
      }
      const client = await input.pool.connect();
      try {
        await client.query("begin read only");
        await client.query(`set local role ${READER_ROLE}`);
        await client.query(`set local statement_timeout = '${request.timeout_ms}ms'`);
        await client.query("set local lock_timeout = '1000ms'");
        await client.query(`set local search_path = ${ALLOWED_SCHEMA}, pg_catalog`);
        const result = await client.query({
          text: `select * from (${sql}) as __ecommerce_candidate limit ${request.max_rows + 1}`,
          rowMode: "array",
        });
        if (result.rows.length > request.max_rows) {
          throw new Error("POSTGRES_RESULT_ROW_LIMIT_EXCEEDED");
        }
        await client.query("commit");
        return Object.freeze({
          columns: Object.freeze(result.fields.map((field) => field.name)),
          rows: Object.freeze(
            result.rows.map((row) => Object.freeze((row as unknown[]).map(normalize))),
          ),
        });
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        if (isRecord(error) && error.code === "57014") throw new Error("POSTGRES_QUERY_TIMEOUT");
        throw error;
      } finally {
        client.release();
      }
    },

    async executeTableCount(request: { readonly timeout_ms: number }) {
      if (
        !Number.isInteger(request.timeout_ms) ||
        request.timeout_ms < 1 ||
        request.timeout_ms > 600_000
      ) {
        throw new Error("POSTGRES_QUERY_BUDGET_INVALID");
      }
      const client = await input.pool.connect();
      try {
        await client.query("begin read only");
        await client.query(`set local role ${READER_ROLE}`);
        await client.query(`set local statement_timeout = '${request.timeout_ms}ms'`);
        await client.query("set local lock_timeout = '1000ms'");
        const result = await client.query<{ readonly table_count: number | string }>(
          compileEcommerceTableCountSql(),
          [[...ALLOWED_RELATIONS].sort()],
        );
        await client.query("commit");
        return Object.freeze({
          columns: Object.freeze(["table_count"]),
          rows: Object.freeze([Object.freeze([Number(result.rows[0]?.table_count ?? 0)] as const)]),
        });
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        if (isRecord(error) && error.code === "57014") throw new Error("POSTGRES_QUERY_TIMEOUT");
        throw error;
      } finally {
        client.release();
      }
    },

    async executeMonthlyOrderTrend(request: { readonly timeout_ms: number }) {
      return executor.execute({
        sql: compileEcommerceMonthlyOrderTrendSql(),
        timeout_ms: request.timeout_ms,
        max_rows: 100,
      });
    },
  };
  return Object.freeze(executor);
}
