import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts";

type Falcon24CaseId = Falcon24AgentAnalysisCase["case_id"];
type ColumnKind = "FLOAT64" | "UTF8";

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

const BUSINESS_REVIEW_SQL = `
select
  order_row.order_id::text as order_id,
  order_row.order_date::date::text as order_date,
  order_row.order_total::float8 as order_total,
  order_row.payment_method,
  order_row.customer_id::text as customer_id,
  customer.customer_segment,
  coalesce(product.category,'UNKNOWN') as product_category,
  coalesce(item.quantity,0)::float8 as quantity
from falcon_db_24.blinkit_orders order_row
join falcon_db_24.blinkit_customers customer using(customer_id)
left join falcon_db_24.blinkit_order_items item using(order_id)
left join falcon_db_24.blinkit_products product using(product_id)
where order_row.order_date::date>=date '2023-05-01'
  and order_row.order_date::date<date '2024-11-01'
order by order_row.order_date::date,order_row.order_id,product.product_id
`.trim();

const DELIVERY_EXPERIENCE_SQL = `
select
  order_row.order_id::text as order_id,
  order_row.order_date::date::text as order_date,
  delivery.delivery_time_minutes::float8 as delivery_time_minutes,
  delivery.delivery_status,
  order_row.order_total::float8 as order_total,
  customer.customer_segment,
  coalesce(product.category,'UNKNOWN') as product_category,
  feedback.rating::float8 as rating,
  feedback.feedback_category,
  feedback.sentiment,
  delivery.distance_km::float8 as distance_km
from falcon_db_24.blinkit_delivery_performance delivery
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
  primary_inventory.damaged_stock,
  sensitivity_inventory.sensitivity_stock_received,
  sensitivity_inventory.sensitivity_damaged_stock
from primary_inventory
join falcon_db_24.blinkit_products product using(product_id)
left join sales using(month_start,product_id)
left join sensitivity_inventory using(month_start,product_id)
order by primary_inventory.month_start,primary_inventory.product_id
`.trim();

const MARKETING_LAG_SQL = `
with marketing as (
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
  marketing.week_start::text as week_start,
  marketing.channel,
  marketing.target_audience,
  marketing.impressions,
  marketing.clicks,
  marketing.conversions,
  marketing.spend,
  marketing.campaign_revenue,
  coalesce(orders.order_count,0)::float8 as order_count,
  coalesce(orders.active_customers,0)::float8 as active_customers,
  coalesce(orders.order_revenue,0)::float8 as order_revenue,
  coalesce(registrations.new_customers,0)::float8 as new_customers
from marketing
left join orders using(week_start)
left join registrations using(week_start)
order by marketing.week_start,marketing.channel,marketing.target_audience
`.trim();

const COHORT_RETENTION_SQL = `
with customer_base as (
  select customer.customer_id,customer.customer_segment,
    date_trunc('month',customer.registration_date::date)::date as cohort_month,
    customer.registration_date::date as registration_date,
    min(order_row.order_date::date) as first_order_date
  from falcon_db_24.blinkit_customers customer
  left join falcon_db_24.blinkit_orders order_row using(customer_id)
  group by customer.customer_id,customer.customer_segment,customer.registration_date
), cohort_customers as (
  select customer_base.*,
    (first_order_date is null or first_order_date>=registration_date) as valid_timeline
  from customer_base
  where cohort_month>=date '2023-05-01' and cohort_month<date '2024-05-01'
), month_grid as (
  select customer.customer_id,customer.customer_segment,customer.cohort_month,
    customer.valid_timeline,month_index
  from cohort_customers customer cross join generate_series(0,6) month_index
), order_month as (
  select order_row.customer_id,
    date_trunc('month',order_row.order_date::date)::date as order_month,
    count(*)::float8 as order_count,
    sum(order_row.order_total)::float8 as revenue
  from falcon_db_24.blinkit_orders order_row
  group by 1,2
), delivery_month as (
  select order_row.customer_id,date_trunc('month',order_row.order_date::date)::date as order_month,
    avg(delivery.delivery_time_minutes)::float8 as delivery_minutes
  from falcon_db_24.blinkit_orders order_row
  join falcon_db_24.blinkit_delivery_performance delivery using(order_id)
  group by 1,2
), feedback_month as (
  select order_row.customer_id,date_trunc('month',order_row.order_date::date)::date as order_month,
    avg(feedback.rating)::float8 as average_rating
  from falcon_db_24.blinkit_orders order_row
  join falcon_db_24.blinkit_customer_feedback feedback using(order_id,customer_id)
  group by 1,2
), customer_month as (
  select month_grid.*,
    coalesce(order_month.order_count,0)::float8 as order_count,
    coalesce(order_month.revenue,0)::float8 as revenue,
    delivery_month.delivery_minutes,
    feedback_month.average_rating
  from month_grid
  left join order_month on order_month.customer_id=month_grid.customer_id
    and order_month.order_month=month_grid.cohort_month+(month_grid.month_index*interval '1 month')
  left join delivery_month on delivery_month.customer_id=month_grid.customer_id
    and delivery_month.order_month=month_grid.cohort_month+(month_grid.month_index*interval '1 month')
  left join feedback_month on feedback_month.customer_id=month_grid.customer_id
    and feedback_month.order_month=month_grid.cohort_month+(month_grid.month_index*interval '1 month')
), anomaly as (
  select
    count(*) filter(where order_row.order_date::date<customer.registration_date::date)::float8
      as orders_before_registration,
    count(distinct customer.customer_id) filter(where first_order.first_order_date<customer.registration_date::date)::float8
      as customers_first_order_before_registration,
    count(distinct customer.customer_id) filter(where first_order.first_order_date>=customer.registration_date::date)::float8
      as valid_ordering_customers,
    count(distinct customer.customer_id) filter(where first_order.first_order_date is null)::float8
      as no_order_customers
  from falcon_db_24.blinkit_customers customer
  left join falcon_db_24.blinkit_orders order_row using(customer_id)
  left join (select customer_id,min(order_date::date) as first_order_date
    from falcon_db_24.blinkit_orders group by customer_id) first_order using(customer_id)
)
select
  to_char(customer_month.cohort_month,'YYYY-MM') as registration_cohort,
  customer_month.customer_segment,
  customer_month.month_index::float8 as month_index,
  count(distinct customer_month.customer_id)::float8 as cohort_size,
  count(distinct customer_month.customer_id) filter(where customer_month.order_count>0)::float8
    as active_customers,
  count(distinct customer_month.customer_id) filter(where customer_month.order_count>1)::float8
    as repeat_customers,
  sum(customer_month.order_count)::float8 as order_count,
  sum(customer_month.revenue)::float8 as revenue,
  avg(customer_month.delivery_minutes)::float8 as delivery_minutes,
  avg(customer_month.average_rating)::float8 as average_rating,
  count(distinct customer_month.customer_id) filter(where customer_month.valid_timeline)::float8
    as valid_timeline_customers,
  count(distinct customer_month.customer_id) filter(where customer_month.valid_timeline and customer_month.order_count>0)::float8
    as valid_active_customers,
  sum(customer_month.order_count) filter(where customer_month.valid_timeline)::float8
    as valid_order_count,
  sum(customer_month.revenue) filter(where customer_month.valid_timeline)::float8
    as valid_revenue,
  anomaly.orders_before_registration,
  anomaly.customers_first_order_before_registration,
  anomaly.valid_ordering_customers,
  anomaly.no_order_customers
from customer_month cross join anomaly
group by customer_month.cohort_month,customer_month.customer_segment,customer_month.month_index,
  anomaly.orders_before_registration,anomaly.customers_first_order_before_registration,
  anomaly.valid_ordering_customers,anomaly.no_order_customers
order by customer_month.cohort_month,customer_month.customer_segment,customer_month.month_index
`.trim();

export const FALCON24_ANALYSIS_QUERY_SPECS = Object.freeze({
  "falcon24-business-review-18m": {
    case_id: "falcon24-business-review-18m",
    input_name: "falcon24_business_review",
    sql: BUSINESS_REVIEW_SQL,
    columns: [
      utf8("order_id"),
      utf8("order_date"),
      float64("order_total"),
      utf8("payment_method"),
      utf8("customer_id"),
      utf8("customer_segment"),
      utf8("product_category"),
      float64("quantity"),
    ],
    expected_rows: 4_612,
  },
  "falcon24-delivery-experience-12m": {
    case_id: "falcon24-delivery-experience-12m",
    input_name: "falcon24_delivery_experience",
    sql: DELIVERY_EXPERIENCE_SQL,
    columns: [
      utf8("order_id"),
      utf8("order_date"),
      float64("delivery_time_minutes"),
      utf8("delivery_status"),
      float64("order_total"),
      utf8("customer_segment"),
      utf8("product_category"),
      float64("rating", true),
      utf8("feedback_category", true),
      utf8("sentiment", true),
      float64("distance_km"),
    ],
    expected_rows: 3_059,
  },
  "falcon24-inventory-damage-12m": {
    case_id: "falcon24-inventory-damage-12m",
    input_name: "falcon24_inventory_damage",
    sql: INVENTORY_DAMAGE_SQL,
    columns: [
      utf8("month"),
      utf8("product_id"),
      utf8("product_name"),
      utf8("category"),
      float64("sales_quantity"),
      float64("stock_received"),
      float64("damaged_stock"),
      float64("sensitivity_stock_received", true),
      float64("sensitivity_damaged_stock", true),
    ],
    expected_rows: 3_216,
  },
  "falcon24-marketing-lag-effect": {
    case_id: "falcon24-marketing-lag-effect",
    input_name: "falcon24_marketing_lag",
    sql: MARKETING_LAG_SQL,
    columns: [
      utf8("week_start"),
      utf8("channel"),
      utf8("target_audience"),
      float64("impressions"),
      float64("clicks"),
      float64("conversions"),
      float64("spend"),
      float64("campaign_revenue"),
      float64("order_count"),
      float64("active_customers"),
      float64("order_revenue"),
      float64("new_customers"),
    ],
    expected_rows: 1_238,
  },
  "falcon24-cohort-retention-m0-m6": {
    case_id: "falcon24-cohort-retention-m0-m6",
    input_name: "falcon24_cohort_retention",
    sql: COHORT_RETENTION_SQL,
    columns: [
      utf8("registration_cohort"),
      utf8("customer_segment"),
      float64("month_index"),
      float64("cohort_size"),
      float64("active_customers"),
      float64("repeat_customers"),
      float64("order_count"),
      float64("revenue"),
      float64("delivery_minutes", true),
      float64("average_rating", true),
      float64("valid_timeline_customers"),
      float64("valid_active_customers"),
      float64("valid_order_count", true),
      float64("valid_revenue", true),
      float64("orders_before_registration"),
      float64("customers_first_order_before_registration"),
      float64("valid_ordering_customers"),
      float64("no_order_customers"),
    ],
    expected_rows: 336,
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
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`FALCON24_QUERY_NUMBER_INVALID:${column.name}:${rowIndex}`);
  }
  return numeric;
}

export function materializeFalcon24Arrow(
  spec: Falcon24AnalysisQuerySpec,
  rows: readonly Readonly<Record<string, unknown>>[],
): Uint8Array {
  if (rows.length !== spec.expected_rows) {
    throw new TypeError(`FALCON24_QUERY_ROW_BUDGET_INVALID:${spec.case_id}:${rows.length}`);
  }
  const expectedNames = spec.columns.map(({ name }) => name);
  const vectors: Record<string, readonly (string | number | null)[]> = {};
  for (const column of spec.columns) {
    vectors[column.name] = rows.map((row, rowIndex) =>
      normalizeValue(column, row[column.name], rowIndex),
    );
  }
  for (const [rowIndex, row] of rows.entries()) {
    const observedNames = Object.keys(row);
    if (
      observedNames.length !== expectedNames.length ||
      observedNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new TypeError(`FALCON24_QUERY_COLUMN_CONTRACT_INVALID:${spec.case_id}:${rowIndex}`);
    }
  }
  return tableToIPC(tableFromArrays(vectors), "file");
}
