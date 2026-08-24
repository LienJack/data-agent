import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import {
  DateDay,
  Float64,
  Table,
  tableToIPC,
  Utf8,
  type Vector,
  vectorFromArray,
} from "apache-arrow";

type Falcon24CaseId = Falcon24AgentAnalysisCase["case_id"];
type ColumnKind = "DATE" | "FLOAT64" | "UTF8";

export interface Falcon24AnalysisQueryColumn {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly nullable: boolean;
}

export interface Falcon24AnalysisQuerySpec {
  readonly case_id: Falcon24CaseId;
  readonly input_name: string;
  readonly sql: string;
  readonly columns: readonly Falcon24AnalysisQueryColumn[];
  readonly expected_rows: number;
  readonly semantic_contract: {
    readonly primary_metric_id: string;
    readonly metric_output: string;
    readonly formula_inputs: readonly string[];
    readonly grain: string;
    readonly unit: string;
    readonly time_range: {
      readonly start: string;
      readonly end: string;
      readonly timezone: "Asia/Shanghai";
      readonly semantics: "HALF_OPEN";
    };
  };
}

const utf8 = (name: string, nullable = false): Falcon24AnalysisQueryColumn => ({
  name,
  kind: "UTF8",
  nullable,
});
const float64 = (name: string, nullable = false): Falcon24AnalysisQueryColumn => ({
  name,
  kind: "FLOAT64",
  nullable,
});
const date = (name: string, nullable = false): Falcon24AnalysisQueryColumn => ({
  name,
  kind: "DATE",
  nullable,
});

const BUSINESS_REVIEW_SQL = `
select
  order_row.order_id::text as order_id,
  order_row.order_date::date::text as order_date,
  order_row.payment_method,
  order_row.customer_id::text as customer_id,
  customer.customer_segment,
  coalesce(product.category,'UNKNOWN') as product_category,
  coalesce(item.quantity,0)::float8 as quantity,
  order_row.order_total::float8 as order_total
from falcon_db_24.blinkit_orders order_row
join falcon_db_24.blinkit_customers customer using(customer_id)
left join falcon_db_24.blinkit_order_items item using(order_id)
left join falcon_db_24.blinkit_products product using(product_id)
where order_row.order_date::date>=date '2023-05-01'
  and order_row.order_date::date<date '2024-11-01'
order by order_row.order_date::date,order_row.order_id,product.product_id
`.trim();

const DELIVERY_EXPERIENCE_SQL = `
with delivery_scope as (
  select delivery.*,
    count(*) filter(where delivery.delivery_time_minutes<0) over()::float8
      as invalid_delivery_orders
  from falcon_db_24.blinkit_delivery_performance delivery
  join falcon_db_24.blinkit_orders order_row using(order_id)
  where order_row.order_date::date>=date '2023-11-01'
    and order_row.order_date::date<date '2024-11-01'
)
select
  order_row.order_id::text as order_id,
  order_row.order_date::date::text as order_date,
  delivery.delivery_status,
  order_row.order_total::float8 as order_total,
  customer.customer_segment,
  coalesce(product.category,'UNKNOWN') as product_category,
  feedback.rating::float8 as rating,
  feedback.feedback_category,
  feedback.sentiment,
  delivery.distance_km::float8 as distance_km,
  delivery.invalid_delivery_orders,
  case when delivery.delivery_time_minutes>=0
    then delivery.delivery_time_minutes::float8 end as delivery_time_minutes
from delivery_scope delivery
join falcon_db_24.blinkit_orders order_row using(order_id)
join falcon_db_24.blinkit_customers customer using(customer_id)
left join falcon_db_24.blinkit_order_items item using(order_id)
left join falcon_db_24.blinkit_products product using(product_id)
left join falcon_db_24.blinkit_customer_feedback feedback using(order_id,customer_id)
where order_row.order_date::date>=date '2023-11-01'
  and order_row.order_date::date<date '2024-11-01'
order by order_row.order_date::date,order_row.order_id,product.product_id
`.trim();

const INVENTORY_DAMAGE_SQL = `
with primary_inventory as (
  select date_trunc('month',to_date(inventory.date,'DD-MM-YYYY'))::date as month_start,
    inventory.product_id,
    sum(inventory.stock_received)::float8 as stock_received,
    sum(inventory.damaged_stock)::float8 as damaged_stock
  from falcon_db_24.blinkit_inventory inventory
  where to_date(inventory.date,'DD-MM-YYYY')>=date '2023-11-01'
    and to_date(inventory.date,'DD-MM-YYYY')<date '2024-11-01'
  group by 1,2
), sensitivity_inventory as (
  select date_trunc('month',to_date(inventory.date,'Mon-YY'))::date as month_start,
    inventory.product_id,
    sum(inventory.stock_received)::float8 as sensitivity_stock_received,
    sum(inventory.damaged_stock)::float8 as sensitivity_damaged_stock
  from falcon_db_24."blinkit_inventoryNew" inventory
  where to_date(inventory.date,'Mon-YY')>=date '2023-11-01'
    and to_date(inventory.date,'Mon-YY')<date '2024-11-01'
  group by 1,2
), sales as (
  select date_trunc('month',order_row.order_date::date)::date as month_start,
    item.product_id,
    sum(item.quantity)::float8 as sales_quantity
  from falcon_db_24.blinkit_orders order_row
  join falcon_db_24.blinkit_order_items item using(order_id)
  where order_row.order_date::date>=date '2023-11-01'
    and order_row.order_date::date<date '2024-11-01'
  group by 1,2
)
select
  to_char(primary_inventory.month_start,'YYYY-MM') as month,
  primary_inventory.product_id::text as product_id,
  product.product_name,
  product.category,
  coalesce(sales.sales_quantity,0)::float8 as sales_quantity,
  primary_inventory.stock_received,
  sensitivity_inventory.sensitivity_stock_received,
  sensitivity_inventory.sensitivity_damaged_stock,
  primary_inventory.damaged_stock
from primary_inventory
join falcon_db_24.blinkit_products product using(product_id)
left join sales using(month_start,product_id)
left join sensitivity_inventory using(month_start,product_id)
order by primary_inventory.month_start,primary_inventory.product_id
`.trim();

const MARKETING_LAG_SQL = `
with calendar as (
  select week_start::date
  from generate_series(date '2023-05-01',date '2024-10-28',interval '1 week') week_start
), observed_groups as (
  select distinct marketing.channel,marketing.target_audience
  from falcon_db_24.blinkit_marketing_performance marketing
  where marketing.date::date>=date '2023-05-01'
    and marketing.date::date<date '2024-11-01'
), marketing as (
  select date_trunc('week',marketing.date::date)::date as week_start,
    marketing.channel,
    marketing.target_audience,
    sum(marketing.impressions)::float8 as impressions,
    sum(marketing.clicks)::float8 as clicks,
    sum(marketing.conversions)::float8 as conversions,
    sum(marketing.spend)::float8 as spend,
    sum(marketing.revenue_generated)::float8 as campaign_revenue
  from falcon_db_24.blinkit_marketing_performance marketing
  where marketing.date::date>=date '2023-05-01'
    and marketing.date::date<date '2024-11-01'
  group by 1,2,3
), orders as (
  select date_trunc('week',order_row.order_date::date)::date as week_start,
    count(*)::float8 as order_count,
    count(distinct order_row.customer_id)::float8 as active_customers,
    sum(order_row.order_total)::float8 as order_revenue
  from falcon_db_24.blinkit_orders order_row
  where order_row.order_date::date>=date '2023-05-01'
    and order_row.order_date::date<date '2024-11-01'
  group by 1
), registrations as (
  select date_trunc('week',customer.registration_date::date)::date as week_start,
    count(*)::float8 as new_customers
  from falcon_db_24.blinkit_customers customer
  where customer.registration_date::date>=date '2023-05-01'
    and customer.registration_date::date<date '2024-11-01'
  group by 1
)
select
  calendar.week_start::text as week_start,
  observed_groups.channel,
  observed_groups.target_audience,
  coalesce(marketing.impressions,0)::float8 as impressions,
  coalesce(marketing.clicks,0)::float8 as clicks,
  coalesce(marketing.conversions,0)::float8 as conversions,
  coalesce(marketing.campaign_revenue,0)::float8 as campaign_revenue,
  coalesce(orders.order_count,0)::float8 as order_count,
  coalesce(orders.active_customers,0)::float8 as active_customers,
  coalesce(orders.order_revenue,0)::float8 as order_revenue,
  coalesce(registrations.new_customers,0)::float8 as new_customers,
  coalesce(marketing.spend,0)::float8 as spend
from calendar cross join observed_groups
left join marketing using(week_start,channel,target_audience)
left join orders using(week_start)
left join registrations using(week_start)
order by calendar.week_start,observed_groups.channel,observed_groups.target_audience
`.trim();

const COHORT_RETENTION_SQL = `
with cohort_customers as (
  select customer.customer_id,customer.customer_segment,
    customer.registration_date::date as registration_date
  from falcon_db_24.blinkit_customers customer
  where date_trunc('month',customer.registration_date::date)>=date '2023-05-01'
    and date_trunc('month',customer.registration_date::date)<date '2024-05-01'
), observed_orders as (
  select order_row.order_id,order_row.customer_id,order_row.order_date,order_row.order_total
  from falcon_db_24.blinkit_orders order_row
  where order_row.order_date::date<date '2024-11-01'
), customer_order_frontier as (
  select cohort_customers.customer_id,cohort_customers.registration_date,
    min(order_row.order_date::date) as first_order_date
  from cohort_customers
  left join observed_orders order_row using(customer_id)
  group by cohort_customers.customer_id,cohort_customers.registration_date
), delivery as (
  select delivery.order_id,avg(delivery.delivery_time_minutes)::float8 as delivery_minutes
  from falcon_db_24.blinkit_delivery_performance delivery
  group by delivery.order_id
), anomaly as (
  select
    count(*) filter(where order_row.order_date::date<customer.registration_date)::float8
      as orders_before_registration,
    count(distinct customer.customer_id)
      filter(where customer.first_order_date<customer.registration_date)::float8
      as customers_first_order_before_registration,
    count(distinct customer.customer_id)
      filter(where customer.first_order_date>=customer.registration_date)::float8
      as valid_ordering_customers,
    count(distinct customer.customer_id)
      filter(where customer.first_order_date is null)::float8
      as no_order_customers,
    count(*) filter(where delivery.delivery_minutes<0)::float8
      as invalid_delivery_orders
  from customer_order_frontier customer
  left join observed_orders order_row using(customer_id)
  left join delivery using(order_id)
), feedback as (
  select feedback.order_id,feedback.customer_id,avg(feedback.rating)::float8 as average_rating
  from falcon_db_24.blinkit_customer_feedback feedback
  group by feedback.order_id,feedback.customer_id
)
select
  cohort_customers.customer_id::text as customer_id,
  cohort_customers.customer_segment as customer_type,
  cohort_customers.registration_date::text as registration_date,
  order_row.order_id::text as order_id,
  order_row.order_date::date::text as event_date,
  delivery.delivery_minutes,
  feedback.average_rating,
  '2024-10'::text as observation_end_month,
  anomaly.orders_before_registration,
  anomaly.customers_first_order_before_registration,
  anomaly.valid_ordering_customers,
  anomaly.no_order_customers,
  anomaly.invalid_delivery_orders,
  order_row.order_total::float8 as revenue
from cohort_customers
left join observed_orders order_row using(customer_id)
left join delivery using(order_id)
left join feedback using(order_id,customer_id)
cross join anomaly
order by cohort_customers.registration_date,cohort_customers.customer_id,order_row.order_date,order_row.order_id
`.trim();

export const FALCON24_ANALYSIS_QUERY_SPECS = Object.freeze({
  "falcon24-business-review-18m": {
    case_id: "falcon24-business-review-18m",
    input_name: "falcon24_business_review",
    sql: BUSINESS_REVIEW_SQL,
    columns: [
      utf8("order_id"),
      date("order_date"),
      utf8("payment_method"),
      utf8("customer_id"),
      utf8("customer_segment"),
      utf8("product_category"),
      float64("quantity"),
      float64("order_total"),
    ],
    expected_rows: 4_612,
    semantic_contract: {
      primary_metric_id: "metric.order_revenue",
      metric_output: "order_total",
      formula_inputs: ["order_total"],
      grain: "order-item",
      unit: "CNY",
      time_range: {
        start: "2023-05-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    },
  },
  "falcon24-delivery-experience-12m": {
    case_id: "falcon24-delivery-experience-12m",
    input_name: "falcon24_delivery_experience",
    sql: DELIVERY_EXPERIENCE_SQL,
    columns: [
      utf8("order_id"),
      date("order_date"),
      utf8("delivery_status"),
      float64("order_total"),
      utf8("customer_segment"),
      utf8("product_category"),
      float64("rating", true),
      utf8("feedback_category", true),
      utf8("sentiment", true),
      float64("distance_km"),
      float64("invalid_delivery_orders"),
      float64("delivery_time_minutes", true),
    ],
    expected_rows: 3_059,
    semantic_contract: {
      primary_metric_id: "metric.delivery_minutes",
      metric_output: "delivery_time_minutes",
      formula_inputs: ["delivery_time_minutes"],
      grain: "delivery-order-item",
      unit: "minutes",
      time_range: {
        start: "2023-11-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    },
  },
  "falcon24-inventory-damage-12m": {
    case_id: "falcon24-inventory-damage-12m",
    input_name: "falcon24_inventory_damage",
    sql: INVENTORY_DAMAGE_SQL,
    columns: [
      date("month"),
      utf8("product_id"),
      utf8("product_name"),
      utf8("category"),
      float64("sales_quantity"),
      float64("stock_received"),
      float64("sensitivity_stock_received", true),
      float64("sensitivity_damaged_stock", true),
      float64("damaged_stock"),
    ],
    expected_rows: 3_216,
    semantic_contract: {
      primary_metric_id: "metric.damaged_stock",
      metric_output: "damaged_stock",
      formula_inputs: ["damaged_stock", "stock_received"],
      grain: "product-month",
      unit: "units",
      time_range: {
        start: "2023-11-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    },
  },
  "falcon24-marketing-lag-effect": {
    case_id: "falcon24-marketing-lag-effect",
    input_name: "falcon24_marketing_lag",
    sql: MARKETING_LAG_SQL,
    columns: [
      date("week_start"),
      utf8("channel"),
      utf8("target_audience"),
      float64("impressions"),
      float64("clicks"),
      float64("conversions"),
      float64("campaign_revenue"),
      float64("order_count"),
      float64("active_customers"),
      float64("order_revenue"),
      float64("new_customers"),
      float64("spend"),
    ],
    expected_rows: 1_264,
    semantic_contract: {
      primary_metric_id: "metric.marketing_spend",
      metric_output: "spend",
      formula_inputs: ["spend"],
      grain: "channel-audience-week",
      unit: "CNY",
      time_range: {
        start: "2023-05-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    },
  },
  "falcon24-cohort-retention-m0-m6": {
    case_id: "falcon24-cohort-retention-m0-m6",
    input_name: "falcon24_cohort_retention",
    sql: COHORT_RETENTION_SQL,
    columns: [
      utf8("customer_id"),
      utf8("customer_type"),
      date("registration_date"),
      utf8("order_id", true),
      date("event_date", true),
      float64("delivery_minutes", true),
      float64("average_rating", true),
      utf8("observation_end_month"),
      float64("orders_before_registration"),
      float64("customers_first_order_before_registration"),
      float64("valid_ordering_customers"),
      float64("no_order_customers"),
      float64("invalid_delivery_orders"),
      float64("revenue", true),
    ],
    expected_rows: 3_188,
    semantic_contract: {
      primary_metric_id: "metric.cohort_retention",
      metric_output: "revenue",
      formula_inputs: ["revenue"],
      grain: "registered-customer-order-event",
      unit: "ratio",
      time_range: {
        start: "2023-05-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
    },
  },
} as const satisfies Record<Falcon24CaseId, Falcon24AnalysisQuerySpec>);

function normalizeValue(
  column: Falcon24AnalysisQueryColumn,
  value: unknown,
  rowIndex: number,
): string | number | null {
  if (value === null || value === undefined) {
    if (!column.nullable) {
      throw new TypeError(`FALCON24_QUERY_NULL_FORBIDDEN:${column.name}:${rowIndex}`);
    }
    return null;
  }
  if (column.kind === "UTF8") return String(value);
  if (column.kind === "DATE") {
    const input = String(value);
    const dateText = /^\d{4}-\d{2}$/u.test(input) ? `${input}-01` : input;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateText)) {
      throw new TypeError(`FALCON24_QUERY_DATE_INVALID:${column.name}:${rowIndex}`);
    }
    const normalized = new Date(`${dateText}T00:00:00.000Z`);
    if (Number.isNaN(normalized.getTime()) || normalized.toISOString().slice(0, 10) !== dateText) {
      throw new TypeError(`FALCON24_QUERY_DATE_INVALID:${column.name}:${rowIndex}`);
    }
    return dateText;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`FALCON24_QUERY_NUMBER_INVALID:${column.name}:${rowIndex}`);
  }
  return numeric;
}

export function normalizeFalcon24QueryResult(
  spec: Falcon24AnalysisQuerySpec,
  rows: readonly Readonly<Record<string, unknown>>[],
) {
  if (rows.length !== spec.expected_rows) {
    throw new TypeError(`FALCON24_QUERY_ROW_BUDGET_INVALID:${spec.case_id}:${rows.length}`);
  }
  const expectedNames = spec.columns.map(({ name }) => name);
  const normalizedRows = rows.map((row, rowIndex) => {
    const observedNames = Object.keys(row);
    if (
      observedNames.length !== expectedNames.length ||
      observedNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new TypeError(`FALCON24_QUERY_COLUMN_CONTRACT_INVALID:${spec.case_id}:${rowIndex}`);
    }
    return spec.columns.map((column) => normalizeValue(column, row[column.name], rowIndex));
  });
  return Object.freeze({
    columns: spec.columns.map((column) => ({
      name: column.name,
      type:
        column.kind === "UTF8" || column.kind === "DATE"
          ? ("STRING" as const)
          : ("NUMBER" as const),
    })),
    rows: normalizedRows,
  });
}

export function materializeFalcon24Arrow(
  spec: Falcon24AnalysisQuerySpec,
  rows: readonly Readonly<Record<string, unknown>>[],
): Uint8Array {
  const normalized = normalizeFalcon24QueryResult(spec, rows);
  const vectors: Record<string, Vector> = {};
  for (const [columnIndex, column] of spec.columns.entries()) {
    const values = normalized.rows.map((row) => row[columnIndex] ?? null);
    vectors[column.name] =
      column.kind === "UTF8"
        ? vectorFromArray(values as readonly (string | null)[], new Utf8())
        : column.kind === "DATE"
          ? vectorFromArray(
              (values as readonly (string | null)[]).map((value) =>
                value === null ? null : new Date(`${value}T00:00:00.000Z`),
              ),
              new DateDay(),
            )
          : vectorFromArray(values as readonly (number | null)[], new Float64());
  }
  return tableToIPC(new Table(vectors), "file");
}
