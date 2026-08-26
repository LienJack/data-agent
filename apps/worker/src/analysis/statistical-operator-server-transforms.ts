type JsonObject = Readonly<Record<string, unknown>>;

export const STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS = Object.freeze({
  singleSeriesTheilSen: "analysis.single-series.theil-sen.v1",
  singleSeriesMannKendall: "analysis.single-series.mann-kendall.v1",
  q1ProductShapleyComparison: "falcon24.q1.product_shapley_comparison.v1",
  q2DeliveryScenarioOrders: "falcon24.q2.delivery_scenario_orders.v1",
  q2DeliveryModelOrders: "falcon24.q2.delivery_model_orders.v1",
  q3TheilSenSeries: "falcon24.q3.theil_sen_series.v1",
  q3MannKendallSeries: "falcon24.q3.mann_kendall_series.v1",
  q5Customers: "falcon24.q5.customers.v1",
  q5Events: "falcon24.q5.events.v1",
  q5Observation: "falcon24.q5.observation.v1",
} as const);

export type StatisticalOperatorServerTransformId =
  (typeof STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS)[keyof typeof STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS];

function invalidSource(): never {
  throw new TypeError("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_TRANSFORM_SOURCE_INVALID");
}

function requiredString(row: JsonObject, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) invalidSource();
  return value;
}

function requiredFinite(row: JsonObject, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) invalidSource();
  return value;
}

function nullableFinite(row: JsonObject, field: string): number | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) invalidSource();
  return value;
}

function dateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  return invalidSource();
}

function repeatedExact<T>(values: readonly T[]): T {
  const first = values[0];
  if (first === undefined || values.some((value) => !Object.is(value, first))) invalidSource();
  return first;
}

function assertSame(left: unknown, right: unknown): void {
  if (!Object.is(left, right)) invalidSource();
}

function singleSeries(
  rows: readonly JsonObject[],
  mode: "THEIL_SEN" | "MANN_KENDALL",
): readonly JsonObject[] {
  const first = rows[0];
  if (!first || rows.length < (mode === "THEIL_SEN" ? 2 : 3)) invalidSource();
  const fields = Object.keys(first);
  if (
    fields.length === 0 ||
    rows.some(
      (row) =>
        Object.keys(row).length !== fields.length ||
        fields.some((field) => !Object.hasOwn(row, field)),
    )
  ) {
    invalidSource();
  }
  const numericFields = fields.filter((field) =>
    rows.every((row) => typeof row[field] === "number" && Number.isFinite(row[field])),
  );
  const dateFields = fields.filter(
    (field) =>
      !numericFields.includes(field) &&
      (() => {
        try {
          return rows.every((row) => dateKey(row[field]).length === 10);
        } catch {
          return false;
        }
      })(),
  );
  if (numericFields.length !== 1 || dateFields.length !== 1) invalidSource();
  const numericField = numericFields[0] ?? invalidSource();
  const dateField = dateFields[0] ?? invalidSource();
  const ordered = rows
    .map((row) => ({
      order: dateKey(row[dateField]),
      value: requiredFinite(row, numericField),
    }))
    .sort((left, right) => left.order.localeCompare(right.order));
  if (new Set(ordered.map(({ order }) => order)).size !== ordered.length) invalidSource();
  const label = numericField;
  return Object.freeze([
    mode === "THEIL_SEN"
      ? Object.freeze({
          label,
          x: Object.freeze(ordered.map((_, index) => index)),
          y: Object.freeze(ordered.map(({ value }) => value)),
        })
      : Object.freeze({
          label,
          order: Object.freeze(ordered.map(({ order }) => order)),
          value: Object.freeze(ordered.map(({ value }) => value)),
        }),
  ]);
}

function q1ProductShapleyComparison(rows: readonly JsonObject[]): readonly JsonObject[] {
  type Order = Readonly<{
    orderDate: string;
    customerId: string;
    orderTotal: number;
  }>;
  const orders = new Map<string, Order>();
  for (const row of rows) {
    const orderId = requiredString(row, "order_id");
    const candidate = Object.freeze({
      orderDate: dateKey(row.order_date),
      customerId: requiredString(row, "customer_id"),
      orderTotal: requiredFinite(row, "order_total"),
    });
    const existing = orders.get(orderId);
    if (existing) {
      assertSame(existing.orderDate, candidate.orderDate);
      assertSame(existing.customerId, candidate.customerId);
      assertSame(existing.orderTotal, candidate.orderTotal);
    } else {
      orders.set(orderId, candidate);
    }
  }
  const monthOrders = new Map<string, Order[]>();
  for (const order of orders.values()) {
    const month = order.orderDate.slice(0, 7);
    const bucket = monthOrders.get(month) ?? [];
    bucket.push(order);
    monthOrders.set(month, bucket);
  }
  const months = Array.from(monthOrders).sort(([left], [right]) => left.localeCompare(right));
  if (months.length !== 18) invalidSource();
  const factors = months.map(([month, monthRows]) => {
    const revenue = monthRows.reduce((sum, row) => sum + row.orderTotal, 0);
    const orderCount = monthRows.length;
    const activeBuyers = new Set(monthRows.map(({ customerId }) => customerId)).size;
    if (orderCount === 0 || activeBuyers === 0) invalidSource();
    return Object.freeze({
      month,
      revenue,
      factors: Object.freeze({
        active_buyers: activeBuyers,
        orders_per_buyer: orderCount / activeBuyers,
        average_order_value: revenue / orderCount,
      }),
    });
  });
  const factorAt = (index: number) => factors[index] ?? invalidSource();
  let worstIndex = 1;
  let worstChange = factorAt(1).revenue - factorAt(0).revenue;
  for (let index = 2; index < factors.length; index += 1) {
    const change = factorAt(index).revenue - factorAt(index - 1).revenue;
    if (change < worstChange) {
      worstIndex = index;
      worstChange = change;
    }
  }
  return Object.freeze([
    Object.freeze({
      label: "worst_month_revenue_change",
      baseline_factors: factorAt(worstIndex - 1).factors,
      current_factors: factorAt(worstIndex).factors,
    }),
  ]);
}

function deliveryOrders(
  rows: readonly JsonObject[],
  includeModelFields: boolean,
): readonly JsonObject[] {
  type DeliveryOrder = {
    order_id: string;
    order_date: string;
    delivery_status: string;
    order_total: number;
    customer_segment: string;
    rating: number | null;
    categories: Set<string>;
  };
  const orders = new Map<string, DeliveryOrder>();
  for (const row of rows) {
    const orderId = requiredString(row, "order_id");
    const candidate = {
      order_id: orderId,
      order_date: dateKey(row.order_date),
      delivery_status: requiredString(row, "delivery_status"),
      order_total: requiredFinite(row, "order_total"),
      customer_segment: requiredString(row, "customer_segment"),
      rating: nullableFinite(row, "rating"),
    };
    const category = requiredString(row, "product_category");
    const existing = orders.get(orderId);
    if (!existing) {
      orders.set(orderId, { ...candidate, categories: new Set([category]) });
      continue;
    }
    for (const field of [
      "order_date",
      "delivery_status",
      "order_total",
      "customer_segment",
      "rating",
    ] as const) {
      assertSame(existing[field], candidate[field]);
    }
    existing.categories.add(category);
  }
  return Object.freeze(
    [...orders.values()].map((order) => {
      const productCategory = [...order.categories].sort()[0];
      if (!productCategory) invalidSource();
      if (!includeModelFields) {
        return Object.freeze({
          order_id: order.order_id,
          product_category: productCategory,
          customer_segment: order.customer_segment,
          delivery_status: order.delivery_status,
          rating: order.rating,
        });
      }
      return Object.freeze({
        order_id: order.order_id,
        order_date: order.order_date,
        delivery_status: order.delivery_status,
        order_total: order.order_total,
        product_category: productCategory,
        customer_segment: order.customer_segment,
        rating: order.rating,
      });
    }),
  );
}

function inventorySeries(
  rows: readonly JsonObject[],
  mode: "THEIL_SEN" | "MANN_KENDALL",
): readonly JsonObject[] {
  const byProduct = new Map<string, JsonObject[]>();
  for (const row of rows) {
    const productId = requiredString(row, "product_id");
    const bucket = byProduct.get(productId) ?? [];
    bucket.push(row);
    byProduct.set(productId, bucket);
  }
  return Object.freeze(
    [...byProduct]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, productRows]) => {
        const orderedRows = [...productRows].sort((left, right) =>
          dateKey(left.month).localeCompare(dateKey(right.month)),
        );
        if (orderedRows.length !== 12) invalidSource();
        const months = orderedRows.map((row) => dateKey(row.month));
        if (new Set(months).size !== months.length) invalidSource();
        const values = orderedRows.map((row) => {
          const received = requiredFinite(row, "stock_received");
          const damaged = requiredFinite(row, "damaged_stock");
          return received === 0 ? 0 : damaged / received;
        });
        return mode === "THEIL_SEN"
          ? Object.freeze({
              label: productId,
              x: Object.freeze(values.map((_, index) => index)),
              y: Object.freeze(values),
            })
          : Object.freeze({
              label: productId,
              order: Object.freeze(months),
              value: Object.freeze(values),
            });
      }),
  );
}

function q5Customers(rows: readonly JsonObject[]): readonly JsonObject[] {
  const customers = new Map<string, JsonObject>();
  for (const row of rows) {
    const customerId = requiredString(row, "customer_id");
    const candidate = Object.freeze({
      customer_id: customerId,
      registration_date: dateKey(row.registration_date),
      customer_type: requiredString(row, "customer_type"),
    });
    const existing = customers.get(customerId);
    if (existing) {
      assertSame(existing.registration_date, candidate.registration_date);
      assertSame(existing.customer_type, candidate.customer_type);
    } else {
      customers.set(customerId, candidate);
    }
  }
  return Object.freeze([...customers.values()]);
}

function q5Events(rows: readonly JsonObject[]): readonly JsonObject[] {
  return Object.freeze(
    rows.flatMap((row) => {
      if (row.order_id === null) return [];
      const deliveryMinutes = nullableFinite(row, "delivery_minutes");
      return [
        Object.freeze({
          customer_id: requiredString(row, "customer_id"),
          event_date: dateKey(row.event_date),
          order_id: requiredString(row, "order_id"),
          revenue: requiredFinite(row, "revenue"),
          delivery_minutes:
            deliveryMinutes !== null && deliveryMinutes < 0 ? null : deliveryMinutes,
          rating: nullableFinite(row, "average_rating"),
        }),
      ];
    }),
  );
}

function q5Observation(rows: readonly JsonObject[]): readonly JsonObject[] {
  const observationEndMonth = repeatedExact(rows.map((row) => row.observation_end_month));
  const invalidDeliveryOrders = repeatedExact(rows.map((row) => row.invalid_delivery_orders));
  if (
    typeof observationEndMonth !== "string" ||
    !/^\d{4}-\d{2}$/u.test(observationEndMonth) ||
    typeof invalidDeliveryOrders !== "number" ||
    !Number.isFinite(invalidDeliveryOrders) ||
    invalidDeliveryOrders < 0
  ) {
    invalidSource();
  }
  return Object.freeze([
    Object.freeze({
      observation_end_month: observationEndMonth,
      invalid_delivery_event_count: invalidDeliveryOrders,
    }),
  ]);
}

/**
 * Fixed, server-authored data preparation only. Statistical formulas remain
 * exclusively in the sandbox operator registry.
 */
export function recomputeStatisticalOperatorServerTransform(input: {
  readonly transform_id: string;
  readonly governed_rows: readonly JsonObject[];
}): readonly JsonObject[] {
  switch (input.transform_id as StatisticalOperatorServerTransformId) {
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesTheilSen:
      return singleSeries(input.governed_rows, "THEIL_SEN");
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesMannKendall:
      return singleSeries(input.governed_rows, "MANN_KENDALL");
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q1ProductShapleyComparison:
      return q1ProductShapleyComparison(input.governed_rows);
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q2DeliveryScenarioOrders:
      return deliveryOrders(input.governed_rows, false);
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q2DeliveryModelOrders:
      return deliveryOrders(input.governed_rows, true);
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q3TheilSenSeries:
      return inventorySeries(input.governed_rows, "THEIL_SEN");
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q3MannKendallSeries:
      return inventorySeries(input.governed_rows, "MANN_KENDALL");
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Customers:
      return q5Customers(input.governed_rows);
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Events:
      return q5Events(input.governed_rows);
    case STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Observation:
      return q5Observation(input.governed_rows);
    default:
      throw new TypeError("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_TRANSFORM_UNKNOWN");
  }
}

export const statisticalOperatorServerTransformInternals = Object.freeze({
  dateKey,
  singleSeries,
  q1ProductShapleyComparison,
  deliveryOrders,
  inventorySeries,
  q5Customers,
  q5Events,
  q5Observation,
});
