import { sha256ContentHash } from "@data-agent/contracts/common";
import type { SqlPool } from "@data-agent/platform/persistence";
import { z } from "zod";

const integerText = z.coerce.number().int().nonnegative().safe();

const snapshotRowSchema = z.strictObject({
  table_count: integerText,
  column_count: integerText,
  total_row_count: integerText,
  max_order_date: z.string(),
  last_complete_month: z.string(),
  complete_month_count_18: integerText,
  complete_month_count_12: integerText,
  order_item_total_mismatch_count: integerText,
  stored_order_count_mismatch_count: integerText,
  stored_aov_mismatch_count: integerText,
  orders_before_registration_count: integerText,
  first_order_before_registration_customers: integerText,
  valid_ordering_customers: integerText,
  no_order_customers: integerText,
  delivery_rows_12m: integerText,
  feedback_rows_12m: integerText,
  inventory_rows_12m: integerText,
  inventory_new_rows_12m: integerText,
  marketing_week_count: integerText,
  fully_observed_cohort_count: integerText,
});

export const falcon24AnalysisDataOracleReceiptSchema = snapshotRowSchema.extend({
  schema_version: z.literal("falcon24-analysis-data-oracle@1.0.0"),
  dataset_id: z.literal("falcon_db_24"),
  verdict: z.literal("PASS_WITH_QUALITY_HOLDS"),
  quality_findings: z.tuple([
    z.literal("FIRST_ORDER_BEFORE_REGISTRATION"),
    z.literal("INVENTORY_NEW_SENSITIVITY_ONLY"),
    z.literal("ORDER_BEFORE_REGISTRATION"),
    z.literal("ORDER_TOTAL_ITEM_MISMATCH"),
    z.literal("STORED_CUSTOMER_KPI_UNTRUSTED"),
  ]),
  receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

export type Falcon24AnalysisDataOracleReceipt = z.infer<
  typeof falcon24AnalysisDataOracleReceiptSchema
>;

export async function verifyFalcon24AnalysisDataOracleReceipt(input: unknown) {
  const receipt = falcon24AnalysisDataOracleReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_DATA_ORACLE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

const SNAPSHOT_SQL = `
with order_dates as (
  select order_id,customer_id,order_date::date as order_date,order_total
  from falcon_db_24.blinkit_orders
), bounds as (
  select max(order_date) as max_order_date,
    case when max(order_date)=(date_trunc('month',max(order_date))+interval '1 month'-interval '1 day')::date
      then date_trunc('month',max(order_date))::date
      else (date_trunc('month',max(order_date))-interval '1 month')::date end as last_complete_month
  from order_dates
), customer_actual as (
  select customer.customer_id,customer.total_orders,customer.avg_order_value,
    count(order_row.order_id) as actual_orders,avg(order_row.order_total) as actual_aov
  from falcon_db_24.blinkit_customers customer
  left join falcon_db_24.blinkit_orders order_row using(customer_id)
  group by customer.customer_id,customer.total_orders,customer.avg_order_value
), item_totals as (
  select order_row.order_id,order_row.order_total,
    sum(item.quantity*item.unit_price) as item_total
  from falcon_db_24.blinkit_orders order_row
  left join falcon_db_24.blinkit_order_items item using(order_id)
  group by order_row.order_id,order_row.order_total
), first_orders as (
  select customer_id,min(order_date) as first_order_date from order_dates group by customer_id
), registration_quality as (
  select
    (select count(*) from falcon_db_24.blinkit_orders order_row
      join falcon_db_24.blinkit_customers customer using(customer_id)
      where order_row.order_date::date<customer.registration_date::date) as orders_before_registration_count,
    count(*) filter(where first_order.first_order_date<customer.registration_date::date)
      as first_order_before_registration_customers,
    count(*) filter(where first_order.first_order_date>=customer.registration_date::date)
      as valid_ordering_customers,
    count(*) filter(where first_order.first_order_date is null) as no_order_customers
  from falcon_db_24.blinkit_customers customer
  left join first_orders first_order using(customer_id)
), row_counts as (
  select
    (select count(*) from falcon_db_24.blinkit_customer_feedback)+
    (select count(*) from falcon_db_24.blinkit_customers)+
    (select count(*) from falcon_db_24.blinkit_delivery_performance)+
    (select count(*) from falcon_db_24.blinkit_inventory)+
    (select count(*) from falcon_db_24."blinkit_inventoryNew")+
    (select count(*) from falcon_db_24.blinkit_marketing_performance)+
    (select count(*) from falcon_db_24.blinkit_order_items)+
    (select count(*) from falcon_db_24.blinkit_orders)+
    (select count(*) from falcon_db_24.blinkit_products) as total_row_count
)
select
  (select count(*)::text from information_schema.tables
    where table_schema='falcon_db_24' and table_type='BASE TABLE') as table_count,
  (select count(*)::text from information_schema.columns
    where table_schema='falcon_db_24') as column_count,
  row_counts.total_row_count::text as total_row_count,
  bounds.max_order_date::text as max_order_date,
  bounds.last_complete_month::text as last_complete_month,
  (select count(distinct date_trunc('month',order_date))::text from order_dates
    where order_date>=bounds.last_complete_month-interval '17 months'
      and order_date<bounds.last_complete_month+interval '1 month') as complete_month_count_18,
  (select count(distinct date_trunc('month',order_date))::text from order_dates
    where order_date>=bounds.last_complete_month-interval '11 months'
      and order_date<bounds.last_complete_month+interval '1 month') as complete_month_count_12,
  (select count(*)::text from item_totals where abs(order_total-item_total)>0.01)
    as order_item_total_mismatch_count,
  (select count(*)::text from customer_actual where total_orders<>actual_orders)
    as stored_order_count_mismatch_count,
  (select count(*)::text from customer_actual
    where actual_orders>0 and abs(avg_order_value-actual_aov)>0.01) as stored_aov_mismatch_count,
  registration_quality.orders_before_registration_count::text,
  registration_quality.first_order_before_registration_customers::text,
  registration_quality.valid_ordering_customers::text,
  registration_quality.no_order_customers::text,
  (select count(*)::text from falcon_db_24.blinkit_delivery_performance delivery
    join order_dates using(order_id)
    where order_date>=bounds.last_complete_month-interval '11 months'
      and order_date<bounds.last_complete_month+interval '1 month') as delivery_rows_12m,
  (select count(*)::text from falcon_db_24.blinkit_customer_feedback feedback
    join order_dates using(order_id)
    where order_date>=bounds.last_complete_month-interval '11 months'
      and order_date<bounds.last_complete_month+interval '1 month') as feedback_rows_12m,
  (select count(*)::text from falcon_db_24.blinkit_inventory inventory
    where to_date(inventory.date,'DD-MM-YYYY')>=bounds.last_complete_month-interval '11 months'
      and to_date(inventory.date,'DD-MM-YYYY')<bounds.last_complete_month+interval '1 month') as inventory_rows_12m,
  (select count(*)::text from falcon_db_24."blinkit_inventoryNew" inventory
    where to_date(inventory.date,'Mon-YY')>=bounds.last_complete_month-interval '11 months'
      and to_date(inventory.date,'Mon-YY')<bounds.last_complete_month+interval '1 month') as inventory_new_rows_12m,
  (select count(distinct date_trunc('week',marketing.date::date))::text
    from falcon_db_24.blinkit_marketing_performance marketing
    where marketing.date::date>=bounds.last_complete_month-interval '17 months'
      and marketing.date::date<bounds.last_complete_month+interval '1 month') as marketing_week_count,
  (select count(distinct date_trunc('month',customer.registration_date::date))::text
    from falcon_db_24.blinkit_customers customer
    where customer.registration_date::date>=bounds.last_complete_month-interval '17 months'
      and customer.registration_date::date<bounds.last_complete_month-interval '5 months')
    as fully_observed_cohort_count
from bounds,row_counts,registration_quality
`;

function assertFixedFalcon24Snapshot(snapshot: z.infer<typeof snapshotRowSchema>) {
  const exact = {
    table_count: 9,
    column_count: 70,
    total_row_count: 121_445,
    last_complete_month: "2024-10-01",
    complete_month_count_18: 18,
    complete_month_count_12: 12,
    order_item_total_mismatch_count: 4_999,
    stored_order_count_mismatch_count: 2_385,
    stored_aov_mismatch_count: 2_172,
    orders_before_registration_count: 2_556,
    first_order_before_registration_customers: 1_438,
    valid_ordering_customers: 734,
    no_order_customers: 328,
    marketing_week_count: 79,
    fully_observed_cohort_count: 12,
  } as const;
  for (const [key, expected] of Object.entries(exact)) {
    if (snapshot[key as keyof typeof snapshot] !== expected) {
      throw new TypeError(`FALCON24_FIXED_SNAPSHOT_MISMATCH:${key}`);
    }
  }
  for (const key of [
    "delivery_rows_12m",
    "feedback_rows_12m",
    "inventory_rows_12m",
    "inventory_new_rows_12m",
  ] as const) {
    if (snapshot[key] <= 0) throw new TypeError(`FALCON24_CASE_INPUT_EMPTY:${key}`);
  }
}

export function createFalcon24AnalysisDataOracle(pool: SqlPool) {
  return Object.freeze({
    async inspect() {
      const client = await pool.connect();
      try {
        const result = await client.query<Record<string, unknown>>(SNAPSHOT_SQL);
        if (result.rows.length !== 1) throw new TypeError("FALCON24_DATA_ORACLE_ROW_INVALID");
        const snapshot = snapshotRowSchema.parse(result.rows[0]);
        assertFixedFalcon24Snapshot(snapshot);
        const material = {
          ...snapshot,
          schema_version: "falcon24-analysis-data-oracle@1.0.0" as const,
          dataset_id: "falcon_db_24" as const,
          verdict: "PASS_WITH_QUALITY_HOLDS" as const,
          quality_findings: [
            "FIRST_ORDER_BEFORE_REGISTRATION",
            "INVENTORY_NEW_SENSITIVITY_ONLY",
            "ORDER_BEFORE_REGISTRATION",
            "ORDER_TOTAL_ITEM_MISMATCH",
            "STORED_CUSTOMER_KPI_UNTRUSTED",
          ] as const,
        };
        return falcon24AnalysisDataOracleReceiptSchema.parse({
          ...material,
          receipt_hash: await sha256ContentHash(material),
        });
      } finally {
        client.release();
      }
    },
  });
}

export const falcon24AnalysisDataOracleInternals = Object.freeze({ SNAPSHOT_SQL });
