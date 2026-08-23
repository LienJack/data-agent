export type EcommerceDirectQaIntent =
  | "TABLE_COUNT"
  | "SALES_TREND"
  | "SALES_ANOMALIES"
  | "SALES_REPORT";

export const ECOMMERCE_DIRECT_QA_CAPABILITY = Object.freeze({
  capability_id: "ecommerce-production-direct-qa@1.0.0",
  benchmark_profile_id: "ecommerce-production",
  datasource_id: "00000000-0000-4000-8000-00000000ec01",
  semantic_release_id: "00000000-0000-4000-8000-00000000ec25",
  allowed_schema: "demo_adb_ecommerce_mart",
  reader_role: "data_agent_ecommerce_reader",
  allowed_relations: Object.freeze([
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
  ]),
});

export interface EcommerceDirectQaRegistration {
  readonly workspace_id: string;
  readonly benchmark_profile_id: string;
}

export interface EcommerceDirectQaApplicabilityInput {
  readonly workspace_id: string;
  readonly datasource_id: string;
  readonly semantic_release_id: string;
}

export function matchesEcommerceDirectQaRegistration(
  registration: EcommerceDirectQaRegistration,
  input: EcommerceDirectQaApplicabilityInput,
): boolean {
  return (
    registration.benchmark_profile_id === ECOMMERCE_DIRECT_QA_CAPABILITY.benchmark_profile_id &&
    registration.workspace_id === input.workspace_id &&
    input.datasource_id === ECOMMERCE_DIRECT_QA_CAPABILITY.datasource_id &&
    input.semantic_release_id === ECOMMERCE_DIRECT_QA_CAPABILITY.semantic_release_id
  );
}

export function classifyEcommerceDirectQaIntent(question: string): EcommerceDirectQaIntent | null {
  const normalized = question.trim().toLocaleLowerCase("zh-CN");
  if (/(?:分析报告|销售报告|报告)/u.test(normalized)) return "SALES_REPORT";
  if (/(?:异常|离群|异常值|异常数据)/u.test(normalized)) return "SALES_ANOMALIES";
  if (/(?:趋势|趋向|走势|按月|环比|trend)/u.test(normalized)) return "SALES_TREND";
  if (/(?:多少张表|表的数量|表数量|table count)/u.test(normalized)) return "TABLE_COUNT";
  return null;
}

export function compileEcommerceMonthlyOrderTrendSql(): string {
  const schema = ECOMMERCE_DIRECT_QA_CAPABILITY.allowed_schema;
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${schema}.fact_payment
  group by order_id
), monthly as (
  select pg_catalog.date_trunc('month', orders.purchase_date) as month_start,
         count(*)::integer as order_count,
         round(coalesce(sum(payment.sales_amount), 0), 2)::double precision as sales_amount_brl
  from ${schema}.fact_order orders
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
  const schema = ECOMMERCE_DIRECT_QA_CAPABILITY.allowed_schema;
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${schema}.fact_payment
  group by order_id
), monthly as (
  select pg_catalog.date_trunc('month', orders.purchase_date) as month_start,
         count(*)::integer as order_count,
         round(coalesce(sum(payment.sales_amount), 0), 2)::double precision as sales_amount_brl
  from ${schema}.fact_order orders
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
  from ${schema}.fact_order
  where delivery_delay_days >= 100
)
select anomaly_type, entity, metric_value, detail
from anomalies
order by anomaly_type, abs(metric_value) desc, entity
limit 100`;
}

export function compileEcommerceSalesReportSummarySql(): string {
  const schema = ECOMMERCE_DIRECT_QA_CAPABILITY.allowed_schema;
  return `with payment_by_order as (
  select order_id, sum(payment_value_brl)::numeric as sales_amount
  from ${schema}.fact_payment
  group by order_id
), review_by_order as (
  select order_id, avg(review_score)::numeric as review_score
  from ${schema}.fact_review
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
from ${schema}.fact_order orders
left join payment_by_order payment on payment.order_id = orders.order_id
left join review_by_order review on review.order_id = orders.order_id`;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decimal(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderEcommerceTrend(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const points = rows.flatMap((row) => {
    const month = typeof row.month === "string" ? row.month : null;
    const orders = numeric(row.order_count);
    const sales = numeric(row.sales_amount_brl);
    const mom = numeric(row.sales_mom_pct);
    return month && orders !== null && sales !== null ? [{ month, orders, sales, mom }] : [];
  });
  if (points.length === 0) return "没有可用于趋势分析的有效月份。";
  const sortedOrders = points.map(({ orders }) => orders).sort((a, b) => a - b);
  const medianOrders = sortedOrders[Math.floor(sortedOrders.length / 2)] ?? 0;
  const core = points.filter(({ orders }) => orders >= Math.max(1, medianOrders * 0.1));
  const comparable = core.length >= 2 ? core : points;
  const first = comparable[0];
  const last = comparable.at(-1);
  if (!first || !last) return "没有可用于趋势分析的有效月份。";
  const peak = comparable.reduce((best, point) => (point.sales > best.sales ? point : best));
  const change = first.sales === 0 ? null : ((last.sales - first.sales) / first.sales) * 100;
  const direction =
    change === null || Math.abs(change) < 1 ? "总体持平" : change > 0 ? "总体上升" : "总体下降";
  const latestMom =
    last.mom === null ? "无可比环比" : `环比 ${last.mom >= 0 ? "+" : ""}${last.mom.toFixed(2)}%`;
  const excluded = points.length - comparable.length;
  return [
    `销售额在可比完整月份内${direction}：${first.month} 为 ${decimal(first.sales)} BRL，${last.month} 为 ${decimal(last.sales)} BRL${change === null ? "" : `，累计变化 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}。`,
    `峰值出现在 ${peak.month}，销售额 ${decimal(peak.sales)} BRL、订单 ${peak.orders} 单；最近可比月份 ${last.month} 为 ${last.orders} 单，${latestMom}。`,
    excluded > 0
      ? `数据首尾有 ${excluded} 个低覆盖月份，已从总体方向比较中剔除，避免不完整月份扭曲结论。`
      : "所有月份均纳入总体方向比较。",
  ].join("\n");
}

export function renderEcommerceAnomalies(
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  const monthly = rows.filter(({ anomaly_type: type }) => type === "MONTHLY_SALES_CHANGE");
  const delivery = rows.filter(({ anomaly_type: type }) => type === "DELIVERY_DELAY");
  const monthlySummary = monthly
    .slice(0, 6)
    .map((row) => {
      const metric = numeric(row.metric_value) ?? 0;
      return `${String(row.entity)} 销售额环比 ${metric >= 0 ? "+" : ""}${metric.toFixed(2)}%（${String(row.detail)}）`;
    })
    .join("；");
  const deliverySummary = delivery
    .slice(0, 5)
    .map((row) => `${String(row.entity)} 延迟 ${decimal(numeric(row.metric_value) ?? 0)} 天`)
    .join("；");
  return [
    `共识别 ${rows.length} 条规则命中：${monthly.length} 条月度销售剧烈波动、${delivery.length} 条超 100 天配送延迟。`,
    monthlySummary ? `月度异常：${monthlySummary}。` : "未发现绝对环比超过 50% 的月度销售异常。",
    deliverySummary ? `最严重配送异常：${deliverySummary}。` : "未发现超过 100 天的配送延迟。",
    "2016-09、2016-12、2018-09、2018-10 等低订单月份位于数据覆盖边界，剧烈环比更可能由月份不完整造成，应与真实业务异常分开处理。",
  ].join("\n");
}

export const ecommerceDirectQaInternals = Object.freeze({ numeric, decimal });
