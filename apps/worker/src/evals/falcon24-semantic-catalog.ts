import type {
  SemanticFormulaExpression,
  SemanticMetric,
  SemanticRelationship,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import { FALCON24_SEMANTIC_RELEASE_BLUEPRINT } from "@data-agent/evals";

type FormulaId = keyof typeof FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas;
type DimensionId = keyof typeof FALCON24_DIMENSIONS;
type MetricId = keyof typeof FALCON24_METRICS;

export const FALCON24_COMPLETE_MONTH_TIME_DOMAIN = Object.freeze({
  time_domain_id: "time.complete_month_frontier",
  description: "Falcon24 observed complete-month frontier; windows are half-open.",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: "2023-05-01T00:00:00.000Z",
  max_time: "2024-11-01T00:00:00.000Z",
});

const units = Object.freeze({
  count: {
    unit_id: "unit.count",
    description: "Distinct entity or event count.",
    dimension: "count" as const,
    base_unit: null,
    conversion_factor: null,
  },
  currency: {
    unit_id: "unit.currency",
    description: "Falcon24 monetary amount in the datasource currency.",
    dimension: "currency" as const,
    base_unit: null,
    conversion_factor: null,
  },
  duration_minutes: {
    unit_id: "unit.duration_minutes",
    description: "Delivery duration in minutes.",
    dimension: "duration" as const,
    base_unit: null,
    conversion_factor: null,
  },
  ratio: {
    unit_id: "unit.ratio",
    description: "Dimensionless ratio represented as a decimal, not percentage points.",
    dimension: "ratio" as const,
    base_unit: null,
    conversion_factor: null,
  },
});

const grain = (grainId: string, description: string): SemanticMetric["grain"] => ({
  grain_id: grainId,
  description,
  granularity: "atomic",
});

const slot = (slot_id: string): SemanticFormulaExpression => ({ kind: "SLOT", slot_id });
const literal = (value: string | number | boolean | null): SemanticFormulaExpression => ({
  kind: "LITERAL",
  value,
});
const binary = (
  operator: Extract<SemanticFormulaExpression, { kind: "BINARY" }>["operator"],
  left: SemanticFormulaExpression,
  right: SemanticFormulaExpression,
): SemanticFormulaExpression => ({ kind: "BINARY", operator, left, right });
const aggregate = (
  fn: Extract<SemanticFormulaExpression, { kind: "AGGREGATE" }>["function"],
  slotId: string,
  options: { readonly distinct?: boolean; readonly filter?: SemanticFormulaExpression } = {},
): SemanticFormulaExpression => ({
  kind: "AGGREGATE",
  function: fn,
  input: slot(slotId),
  distinct: options.distinct ?? fn === "COUNT_DISTINCT",
  filter: options.filter ?? null,
});
const groupCount = (
  groupBy: readonly string[],
  having: SemanticFormulaExpression,
): SemanticFormulaExpression => ({
  kind: "GROUP_COUNT",
  group_by: groupBy.map(slot),
  having,
});
const safeDivide = (
  numerator: SemanticFormulaExpression,
  denominator: SemanticFormulaExpression,
  zeroResult: 0 | null,
): SemanticFormulaExpression => ({
  kind: "CASE",
  branches: [{ when: binary("EQ", denominator, literal(0)), result: literal(zeroResult) }],
  otherwise: binary("DIVIDE", numerator, denominator),
});

export function falcon24FormulaExpression(formulaId: string): SemanticFormulaExpression {
  switch (formulaId as FormulaId) {
    case "active_buyers":
      return aggregate("COUNT_DISTINCT", "customer_id", { distinct: true });
    case "average_order_value":
      return safeDivide(
        aggregate("SUM", "order_total"),
        aggregate("COUNT_DISTINCT", "order_id", { distinct: true }),
        null,
      );
    case "buyer_frequency":
      return safeDivide(
        aggregate("COUNT_DISTINCT", "order_id", { distinct: true }),
        aggregate("COUNT_DISTINCT", "customer_id", { distinct: true }),
        null,
      );
    case "buyer_frequency_aov":
      return binary(
        "MULTIPLY",
        binary("MULTIPLY", slot("active_buyers"), slot("buyer_frequency")),
        slot("average_order_value"),
      );
    case "clicks":
      return aggregate("SUM", "clicks");
    case "cohort_customers":
      return aggregate("COUNT_DISTINCT", "customer_id", { distinct: true });
    case "click_through_rate":
      return safeDivide(aggregate("SUM", "clicks"), aggregate("SUM", "impressions"), 0);
    case "cohort_month_index":
      return slot("completed_months_since_registration");
    case "cohort_retention":
      return safeDivide(slot("retained_customers"), slot("cohort_customers"), 0);
    case "conversions":
      return aggregate("SUM", "conversions");
    case "conversion_rate":
      return safeDivide(aggregate("SUM", "conversions"), aggregate("SUM", "clicks"), 0);
    case "damaged_stock":
      return aggregate("SUM", "damaged_stock");
    case "delivery_minutes":
      return aggregate("AVG", "delivery_time_minutes");
    case "impressions":
      return aggregate("SUM", "impressions");
    case "inventory_damage_rate":
      return safeDivide(aggregate("SUM", "damaged_stock"), aggregate("SUM", "stock_received"), 0);
    case "low_rating_rate": {
      const ratedOrders = aggregate("COUNT_DISTINCT", "order_id", { distinct: true });
      return safeDivide(
        aggregate("COUNT_DISTINCT", "order_id", {
          distinct: true,
          filter: binary("LTE", slot("rating"), literal(2)),
        }),
        ratedOrders,
        0,
      );
    }
    case "marketing_revenue":
      return aggregate("SUM", "revenue_generated");
    case "marketing_roas":
      return safeDivide(aggregate("SUM", "revenue_generated"), aggregate("SUM", "spend"), 0);
    case "marketing_spend":
      return aggregate("SUM", "spend");
    case "new_customers":
      return aggregate("COUNT_DISTINCT", "customer_id", { distinct: true });
    case "on_time_rate":
      return safeDivide(
        aggregate("COUNT_DISTINCT", "order_id", {
          distinct: true,
          filter: binary("EQ", slot("delivery_status"), literal("On Time")),
        }),
        aggregate("COUNT_DISTINCT", "order_id", { distinct: true }),
        0,
      );
    case "order_count":
      return aggregate("COUNT_DISTINCT", "order_id", { distinct: true });
    case "order_revenue":
      return aggregate("SUM", "order_total");
    case "repeat_customers":
      return groupCount(
        ["customer_id"],
        binary("GT", aggregate("COUNT_DISTINCT", "order_id", { distinct: true }), literal(1)),
      );
    case "repeat_purchase_rate":
      return safeDivide(slot("repeat_customers"), slot("cohort_customers"), 0);
    case "retained_customers":
      return aggregate("COUNT_DISTINCT", "customer_id", { distinct: true });
    case "sales_quantity":
      return aggregate("SUM", "quantity");
    case "stock_received":
      return aggregate("SUM", "stock_received");
    default:
      throw new TypeError(`FALCON24_FORMULA_UNKNOWN:${formulaId}`);
  }
}

function formulaSlots(expression: SemanticFormulaExpression, slots: Set<string>): void {
  switch (expression.kind) {
    case "LITERAL":
      return;
    case "SLOT":
      slots.add(expression.slot_id);
      return;
    case "BINARY":
      formulaSlots(expression.left, slots);
      formulaSlots(expression.right, slots);
      return;
    case "BOOLEAN":
      for (const operand of expression.operands) formulaSlots(operand, slots);
      return;
    case "NOT":
      formulaSlots(expression.operand, slots);
      return;
    case "CASE":
      for (const branch of expression.branches) {
        formulaSlots(branch.when, slots);
        formulaSlots(branch.result, slots);
      }
      if (expression.otherwise) formulaSlots(expression.otherwise, slots);
      return;
    case "AGGREGATE":
      if (expression.input) formulaSlots(expression.input, slots);
      if (expression.filter) formulaSlots(expression.filter, slots);
      return;
    case "DATE_BUCKET":
      formulaSlots(expression.input, slots);
      return;
    case "GROUP_COUNT":
      for (const group of expression.group_by) formulaSlots(group, slots);
      formulaSlots(expression.having, slots);
  }
}

function physicalFormulaDependencies(tableId: string, formulaId: FormulaId): string[] {
  const table = FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables.find(
    ({ table_id: candidate }) => candidate === tableId,
  );
  if (!table) throw new TypeError(`FALCON24_FORMULA_TABLE_UNKNOWN:${tableId}`);
  const slots = new Set<string>();
  formulaSlots(falcon24FormulaExpression(formulaId), slots);
  const physicalColumns = new Set(table.columns);
  return [...slots]
    .filter((slotId) => physicalColumns.has(slotId))
    .map((slotId) => `${tableId}.${slotId}`)
    .sort();
}

type DimensionSpec = {
  readonly table_id: string;
  readonly column_id: string;
  readonly aliases: readonly string[];
  readonly data_type: "date" | "text";
  readonly grain: SemanticMetric["grain"];
};

export const FALCON24_DIMENSIONS = Object.freeze({
  customer_segment: {
    table_id: "blinkit_customers",
    column_id: "customer_segment",
    aliases: ["客户类型"],
    data_type: "text",
    grain: grain("grain.customer", "One row per customer_id."),
  },
  delivery_status: {
    table_id: "blinkit_delivery_performance",
    column_id: "delivery_status",
    aliases: ["配送状态"],
    data_type: "text",
    grain: grain("grain.delivery_order", "One delivery record per order_id."),
  },
  marketing_channel: {
    table_id: "blinkit_marketing_performance",
    column_id: "channel",
    aliases: ["渠道", "营销渠道"],
    data_type: "text",
    grain: grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
  },
  order_month: {
    table_id: "blinkit_orders",
    column_id: "order_date",
    aliases: ["订单月份"],
    data_type: "date",
    grain: {
      grain_id: "grain.order_month",
      description: "Calendar month of order_date.",
      granularity: "month",
    },
  },
  payment_method: {
    table_id: "blinkit_orders",
    column_id: "payment_method",
    aliases: ["支付方式"],
    data_type: "text",
    grain: grain("grain.order", "One row per order_id."),
  },
  product: {
    table_id: "blinkit_products",
    column_id: "product_id",
    aliases: ["商品", "商品编号"],
    data_type: "text",
    grain: grain("grain.product", "One row per product_id."),
  },
  product_category: {
    table_id: "blinkit_products",
    column_id: "category",
    aliases: ["品类", "商品品类"],
    data_type: "text",
    grain: grain("grain.product", "One row per product_id."),
  },
  registration_cohort: {
    table_id: "blinkit_customers",
    column_id: "registration_date",
    aliases: ["客户批次", "注册月份"],
    data_type: "date",
    grain: {
      grain_id: "grain.registration_cohort",
      description: "Calendar month of registration_date.",
      granularity: "month",
    },
  },
  target_audience: {
    table_id: "blinkit_marketing_performance",
    column_id: "target_audience",
    aliases: ["目标人群"],
    data_type: "text",
    grain: grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
  },
} as const satisfies Record<string, DimensionSpec>);

const dimensionIds = (...ids: DimensionId[]) => ids.map((id) => `dimension.${id}`).sort();
const capabilities = (...values: SemanticMetric["analysis"]["capabilities"]) => [...values].sort();

type MetricSpec = Omit<SemanticMetric, "metric_id" | "name" | "aliases" | "formula"> & {
  readonly aliases: readonly string[];
  readonly formula_id: FormulaId;
};

export const FALCON24_METRICS = Object.freeze({
  active_buyers: metric(
    "blinkit_orders",
    "customer_id",
    "count_distinct",
    "active_buyers",
    ["活跃买家", "购买人数"],
    units.count,
    grain("grain.order", "Distinct customers over order rows."),
    dimensionIds(
      "customer_segment",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["CONTRIBUTION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  cohort_retention: metric(
    "blinkit_customers",
    "customer_id",
    "count_distinct",
    "cohort_retention",
    ["客户留存"],
    units.ratio,
    grain("grain.cohort_customer", "Registration cohort and customer population."),
    dimensionIds("customer_segment", "registration_cohort"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  cohort_customers: metric(
    "blinkit_customers",
    "customer_id",
    "count_distinct",
    "cohort_customers",
    ["批次客户数", "注册客户数"],
    units.count,
    grain("grain.cohort_customer", "Distinct customers in each registration cohort."),
    dimensionIds("customer_segment", "registration_cohort"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  clicks: metric(
    "blinkit_marketing_performance",
    "clicks",
    "sum",
    "clicks",
    ["点击量"],
    units.count,
    grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
    dimensionIds("marketing_channel", "target_audience"),
    ["TREND_CHANGE", "CHART_DATASET"],
  ),
  conversions: metric(
    "blinkit_marketing_performance",
    "conversions",
    "sum",
    "conversions",
    ["转化量"],
    units.count,
    grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
    dimensionIds("marketing_channel", "target_audience"),
    ["TREND_CHANGE", "CHART_DATASET"],
  ),
  damaged_stock: metric(
    "blinkit_inventory",
    "damaged_stock",
    "sum",
    "damaged_stock",
    ["库存损坏", "损坏量"],
    units.count,
    grain("grain.inventory_snapshot", "Product and inventory date."),
    dimensionIds("product", "product_category"),
    ["CONCENTRATION", "ROBUST_ANOMALY", "TREND_CHANGE", "CHART_DATASET"],
  ),
  delivery_minutes: metric(
    "blinkit_delivery_performance",
    "delivery_time_minutes",
    "avg",
    "delivery_minutes",
    ["配送时效", "配送时长"],
    units.duration_minutes,
    grain("grain.delivery_order", "One delivery record per order_id."),
    dimensionIds(
      "customer_segment",
      "delivery_status",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["ASSOCIATION", "ROBUST_ANOMALY", "TREND_CHANGE", "CHART_DATASET"],
  ),
  impressions: metric(
    "blinkit_marketing_performance",
    "impressions",
    "sum",
    "impressions",
    ["曝光量"],
    units.count,
    grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
    dimensionIds("marketing_channel", "target_audience"),
    ["TREND_CHANGE", "CHART_DATASET"],
  ),
  low_rating_rate: metric(
    "blinkit_customer_feedback",
    "rating",
    "count_distinct",
    "low_rating_rate",
    ["低评分率", "差评率"],
    units.ratio,
    grain("grain.rated_order", "Distinct rated order_id; low rating is rating <= 2."),
    dimensionIds(
      "customer_segment",
      "delivery_status",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["ASSOCIATION", "CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  marketing_revenue: metric(
    "blinkit_marketing_performance",
    "revenue_generated",
    "sum",
    "marketing_revenue",
    ["营销归因收入", "营销收入"],
    units.currency,
    grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
    dimensionIds("marketing_channel", "target_audience"),
    ["TREND_CHANGE", "CHART_DATASET"],
  ),
  marketing_spend: metric(
    "blinkit_marketing_performance",
    "spend",
    "sum",
    "marketing_spend",
    ["营销投入"],
    units.currency,
    grain("grain.marketing_observation", "Campaign, date, audience, and channel."),
    dimensionIds("marketing_channel", "target_audience"),
    ["ASSOCIATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  new_customers: metric(
    "blinkit_customers",
    "customer_id",
    "count_distinct",
    "new_customers",
    ["新增客户"],
    units.count,
    grain("grain.customer", "One row per customer_id."),
    dimensionIds("customer_segment", "registration_cohort"),
    ["ASSOCIATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  on_time_rate: metric(
    "blinkit_delivery_performance",
    "delivery_status",
    "count_distinct",
    "on_time_rate",
    ["准时率", "按时率"],
    units.ratio,
    grain("grain.delivery_order", "Distinct delivery order_id; on time is status = On Time."),
    dimensionIds(
      "customer_segment",
      "delivery_status",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["ASSOCIATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  order_count: metric(
    "blinkit_orders",
    "order_id",
    "count_distinct",
    "order_count",
    ["订单量"],
    units.count,
    grain("grain.order", "One row per order_id."),
    dimensionIds(
      "customer_segment",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["ASSOCIATION", "CONTRIBUTION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  order_revenue: metric(
    "blinkit_orders",
    "order_total",
    "sum",
    "order_revenue",
    ["订单收入"],
    units.currency,
    grain("grain.order", "Sum order_total exactly once per distinct order_id."),
    dimensionIds(
      "customer_segment",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
    ),
    ["ASSOCIATION", "CONTRIBUTION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  repeat_purchase_rate: metric(
    "blinkit_orders",
    "customer_id",
    "count_distinct",
    "repeat_purchase_rate",
    ["复购率"],
    units.ratio,
    grain(
      "grain.cohort_customer",
      "Registration cohort and customer population; denominator retains customers without orders.",
    ),
    dimensionIds("customer_segment", "registration_cohort"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  repeat_customers: metric(
    "blinkit_orders",
    "customer_id",
    "count_distinct",
    "repeat_customers",
    ["复购客户数"],
    units.count,
    grain(
      "grain.cohort_customer",
      "Distinct customer groups with more than one distinct order in the selected window.",
    ),
    dimensionIds("customer_segment", "order_month", "registration_cohort"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  retained_customers: metric(
    "blinkit_orders",
    "customer_id",
    "count_distinct",
    "retained_customers",
    ["留存客户数"],
    units.count,
    grain(
      "grain.cohort_customer",
      "Distinct cohort customers with at least one order in the selected observation month.",
    ),
    dimensionIds("customer_segment", "order_month", "registration_cohort"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  sales_quantity: metric(
    "blinkit_order_items",
    "quantity",
    "sum",
    "sales_quantity",
    ["商品销量", "销量"],
    units.count,
    grain("grain.order_product", "Order and product item."),
    dimensionIds("order_month", "product", "product_category"),
    ["CONCENTRATION", "TREND_CHANGE", "CHART_DATASET"],
  ),
  stock_received: metric(
    "blinkit_inventory",
    "stock_received",
    "sum",
    "stock_received",
    ["入库量"],
    units.count,
    grain("grain.inventory_snapshot", "Product and inventory date."),
    dimensionIds("product", "product_category"),
    ["CONCENTRATION", "ROBUST_ANOMALY", "TREND_CHANGE", "CHART_DATASET"],
  ),
} as const satisfies Record<string, MetricSpec>);

function metric(
  table_id: string,
  column: string,
  aggregation: SemanticMetric["aggregation"],
  formula_id: FormulaId,
  aliases: readonly string[],
  unit: NonNullable<SemanticMetric["unit"]>,
  metricGrain: SemanticMetric["grain"],
  allowed_dimension_ids: readonly string[],
  metricCapabilities: SemanticMetric["analysis"]["capabilities"],
): MetricSpec {
  const timeColumn = ["blinkit_inventory", "blinkit_marketing_performance"].includes(table_id)
    ? `${table_id}.date`
    : table_id === "blinkit_customer_feedback"
      ? "blinkit_customer_feedback.feedback_date"
      : table_id === "blinkit_customers"
        ? "blinkit_customers.registration_date"
        : "blinkit_orders.order_date";
  return {
    aliases,
    table_id,
    column_id: `${table_id}.${column}`,
    aggregation,
    formula_id,
    grain: metricGrain,
    unit,
    time_domain: FALCON24_COMPLETE_MONTH_TIME_DOMAIN,
    time_column_id: timeColumn,
    additivity: aggregation === "sum" ? "additive" : "non-additive",
    null_policy: "exclude",
    fanout_policy: "preaggregate",
    dependency_column_ids: physicalFormulaDependencies(table_id, formula_id),
    tags: ["falcon24"],
    analysis: {
      primary: ["order_revenue", "order_count"].includes(formula_id),
      priority: ["order_revenue", "order_count"].includes(formula_id) ? 10_000 : 1_000,
      missing_period_policy: "REJECT_GAP",
      seasonality: null,
      allowed_dimension_ids: [...allowed_dimension_ids],
      capabilities: capabilities(...metricCapabilities),
      causal_role: "OUTCOME",
    },
  };
}

export const FALCON24_RELATIONSHIPS = Object.freeze({
  feedback_customer: [
    "blinkit_customer_feedback",
    "customer_id",
    "blinkit_customers",
    "customer_id",
    "many-to-one",
  ],
  feedback_order: [
    "blinkit_customer_feedback",
    "order_id",
    "blinkit_orders",
    "order_id",
    "one-to-one",
  ],
  delivery_order: [
    "blinkit_delivery_performance",
    "order_id",
    "blinkit_orders",
    "order_id",
    "one-to-one",
  ],
  inventory_new_product: [
    "blinkit_inventoryNew",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
  inventory_product: [
    "blinkit_inventory",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
  order_customer: [
    "blinkit_orders",
    "customer_id",
    "blinkit_customers",
    "customer_id",
    "many-to-one",
  ],
  order_item_order: [
    "blinkit_order_items",
    "order_id",
    "blinkit_orders",
    "order_id",
    "many-to-one",
  ],
  order_item_product: [
    "blinkit_order_items",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
} as const satisfies Record<
  string,
  readonly [string, string, string, string, SemanticRelationship["cardinality"]]
>);

export const FALCON24_QUALITY_CONSTRAINTS = Object.freeze({
  "quality.first_order_before_registration": ["first_order_date >= registration_date", "WARN"],
  "quality.inventory_new_sensitivity_only": [
    "blinkit_inventoryNew must not be unioned into primary inventory analysis",
    "ERROR",
  ],
  "quality.order_before_registration": ["order_date >= registration_date", "WARN"],
  "quality.order_total_item_mismatch": [
    "abs(order_total-sum(quantity*unit_price)) <= 0.01",
    "WARN",
  ],
  "quality.stored_customer_kpi_untrusted": [
    "customer total_orders and avg_order_value must be recomputed",
    "ERROR",
  ],
} as const);

export const FALCON24_FORMULA_ALIASES = Object.freeze({
  active_buyers: ["活跃买家", "购买人数"],
  average_order_value: ["客单价"],
  buyer_frequency: ["购买频次"],
  buyer_frequency_aov: ["购买人数频次客单价分解"],
  clicks: ["点击量"],
  click_through_rate: ["点击率"],
  cohort_month_index: ["注册后月份"],
  cohort_customers: ["批次客户数", "注册客户数"],
  cohort_retention: ["客户留存率"],
  conversions: ["转化量"],
  conversion_rate: ["转化率"],
  damaged_stock: ["损坏量"],
  delivery_minutes: ["平均配送分钟"],
  impressions: ["曝光量"],
  inventory_damage_rate: ["损坏率"],
  low_rating_rate: ["低评分率", "差评率"],
  marketing_revenue: ["营销归因收入", "营销收入"],
  marketing_roas: ["营销ROAS", "营销投入产出比", "投入回报率（营销归因收入/营销投入）"],
  marketing_spend: ["营销投入"],
  new_customers: ["新增客户"],
  on_time_rate: ["准时率"],
  order_count: ["订单量"],
  order_revenue: ["订单收入"],
  repeat_customers: ["复购客户数"],
  repeat_purchase_rate: ["复购率"],
  retained_customers: ["留存客户数"],
  sales_quantity: ["销量"],
  stock_received: ["入库量"],
} as const satisfies Record<FormulaId, readonly string[]>);

export function falcon24RequiredMetricIds(testCase: Falcon24AgentAnalysisCase): MetricId[] {
  return testCase.required_semantic_keys
    .filter((key) => key.startsWith("metric."))
    .map((key) => key.slice("metric.".length) as MetricId)
    .sort();
}

export async function buildFalcon24SemanticConsumptionProjection(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly semantic_release_hash: string;
}) {
  const requiredKeys = new Set(input.test_case.required_semantic_keys);
  const metrics = falcon24RequiredMetricIds(input.test_case).map((metricId) => {
    const spec = FALCON24_METRICS[metricId];
    if (!spec) throw new TypeError(`FALCON24_METRIC_UNKNOWN:${metricId}`);
    return {
      metric_id: `metric.${metricId}`,
      definition: FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas[spec.formula_id],
      formula_id: `formula.${spec.formula_id}`,
      grain: spec.grain,
      unit: spec.unit,
      time_dimension_id: spec.time_column_id,
      additivity: spec.additivity,
      null_policy: spec.null_policy,
      allowed_dimension_ids: spec.analysis.allowed_dimension_ids,
    };
  });
  const formulas = Object.entries(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas)
    .filter(
      ([formulaId]) =>
        requiredKeys.has(`formula.${formulaId}`) ||
        metrics.some((metric) => metric.formula_id === `formula.${formulaId}`),
    )
    .map(([formulaId, expression]) => ({
      formula_id: `formula.${formulaId}`,
      expression,
      expression_hash: null as string | null,
    }));
  const formulasWithHashes = await Promise.all(
    formulas.map(async (formula) => ({
      ...formula,
      expression_hash: await sha256ContentHash({
        semantic_release_hash: input.semantic_release_hash,
        formula_id: formula.formula_id,
        expression: falcon24FormulaExpression(formula.formula_id.slice("formula.".length)),
      }),
    })),
  );
  return Object.freeze({
    semantic_release_hash: input.semantic_release_hash,
    metrics,
    formulas: formulasWithHashes,
    dimensions: Object.entries(FALCON24_DIMENSIONS)
      .filter(([dimensionId]) => requiredKeys.has(`dimension.${dimensionId}`))
      .map(([dimensionId, spec]) => ({
        dimension_id: `dimension.${dimensionId}`,
        definition: `${spec.table_id}.${spec.column_id}`,
        grain: spec.grain,
        data_type: spec.data_type,
      })),
    relationships: Object.entries(FALCON24_RELATIONSHIPS)
      .filter(([relationshipId]) => requiredKeys.has(`relationship.${relationshipId}`))
      .map(([relationshipId, spec]) => ({
        relationship_id: `relationship.${relationshipId}`,
        left: `${spec[0]}.${spec[1]}`,
        right: `${spec[2]}.${spec[3]}`,
        cardinality: spec[4],
        fanout_policy: "preaggregate_before_join" as const,
      })),
    quality_rules: Object.entries(FALCON24_QUALITY_CONSTRAINTS)
      .filter(([ruleId]) => requiredKeys.has(ruleId))
      .map(([rule_id, [expression, severity]]) => ({ rule_id, expression, severity })),
  });
}

export const falcon24SemanticCatalogInternals = Object.freeze({
  complete_month_time_domain: FALCON24_COMPLETE_MONTH_TIME_DOMAIN,
  units,
});
