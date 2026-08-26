import { describe, expect, it } from "vitest";
import {
  recomputeStatisticalOperatorServerTransform,
  STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS,
} from "../../src/analysis/statistical-operator-server-transforms.js";

function addMonths(start: string, count: number): string[] {
  const [year, month] = start.split("-").map(Number);
  if (!year || !month) throw new TypeError("invalid test month");
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(Date.UTC(year, month - 1 + index, 1));
    return value.toISOString().slice(0, 10);
  });
}

describe("fixed statistical operator server transforms", () => {
  it("derives generic single-series trend inputs from shape instead of a Falcon case", () => {
    const rows = [
      { month: "2024-03-01", order_revenue: 130 },
      { month: "2024-01-01", order_revenue: 100 },
      { month: "2024-02-01", order_revenue: 110 },
    ];
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesTheilSen,
        governed_rows: rows,
      }),
    ).toEqual([{ label: "order_revenue", x: [0, 1, 2], y: [100, 110, 130] }]);
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesMannKendall,
        governed_rows: rows,
      }),
    ).toEqual([
      {
        label: "order_revenue",
        order: ["2024-01-01", "2024-02-01", "2024-03-01"],
        value: [100, 110, 130],
      },
    ]);
  });

  it("rejects an ambiguous generic trend shape", () => {
    expect(() =>
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.singleSeriesTheilSen,
        governed_rows: [
          { month: "2024-01-01", revenue: 100, orders: 10 },
          { month: "2024-02-01", revenue: 110, orders: 11 },
        ],
      }),
    ).toThrowError("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_TRANSFORM_SOURCE_INVALID");
  });

  it("derives the exact worst-month Shapley comparison from unique orders", () => {
    const months = addMonths("2023-05", 18);
    const rows = months.flatMap((month, index) => {
      const order = {
        order_id: `order-${index}`,
        order_date: month,
        customer_id: `customer-${index}`,
        order_total: index === 10 ? 50 : 100,
      };
      return index === 2 ? [order, { ...order }] : [order];
    });
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q1ProductShapleyComparison,
        governed_rows: rows,
      }),
    ).toEqual([
      {
        label: "worst_month_revenue_change",
        baseline_factors: {
          active_buyers: 1,
          orders_per_buyer: 1,
          average_order_value: 100,
        },
        current_factors: {
          active_buyers: 1,
          orders_per_buyer: 1,
          average_order_value: 50,
        },
      },
    ]);
  });

  it("derives both 12-month inventory input shapes in product-key order", () => {
    const months = addMonths("2023-11", 12);
    const rows = ["product-b", "product-a"].flatMap((productId, productIndex) =>
      months.map((month, monthIndex) => ({
        product_id: productId,
        month,
        stock_received: monthIndex === 0 ? 0 : 100,
        damaged_stock: productIndex + monthIndex,
      })),
    );
    const theilSen = recomputeStatisticalOperatorServerTransform({
      transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q3TheilSenSeries,
      governed_rows: rows,
    });
    const mannKendall = recomputeStatisticalOperatorServerTransform({
      transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q3MannKendallSeries,
      governed_rows: rows,
    });
    expect(theilSen[0]).toMatchObject({
      label: "product-a",
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    expect((theilSen[0] as { y: number[] }).y.slice(0, 3)).toEqual([0, 0.02, 0.03]);
    expect(mannKendall[1]).toMatchObject({ label: "product-b", order: months });
    expect((mannKendall[1] as { value: number[] }).value.slice(0, 3)).toEqual([0, 0.01, 0.02]);
  });

  it("deduplicates cohort customers and builds exact events and observation", () => {
    const governedRows = [
      {
        customer_id: "customer-1",
        customer_type: "Premium",
        registration_date: "2024-01-15",
        order_id: "order-1",
        event_date: "2024-01-20",
        revenue: 120,
        delivery_minutes: -5,
        average_rating: 2,
        observation_end_month: "2024-10",
        invalid_delivery_orders: 932,
      },
      {
        customer_id: "customer-1",
        customer_type: "Premium",
        registration_date: "2024-01-15",
        order_id: null,
        event_date: null,
        revenue: null,
        delivery_minutes: null,
        average_rating: null,
        observation_end_month: "2024-10",
        invalid_delivery_orders: 932,
      },
    ];
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Customers,
        governed_rows: governedRows,
      }),
    ).toEqual([
      {
        customer_id: "customer-1",
        registration_date: "2024-01-15",
        customer_type: "Premium",
      },
    ]);
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Events,
        governed_rows: governedRows,
      }),
    ).toEqual([
      {
        customer_id: "customer-1",
        event_date: "2024-01-20",
        order_id: "order-1",
        revenue: 120,
        delivery_minutes: null,
        rating: 2,
      },
    ]);
    expect(
      recomputeStatisticalOperatorServerTransform({
        transform_id: STATISTICAL_OPERATOR_SERVER_TRANSFORM_IDS.q5Observation,
        governed_rows: governedRows,
      }),
    ).toEqual([{ observation_end_month: "2024-10", invalid_delivery_event_count: 932 }]);
  });

  it("rejects an unregistered transform id", () => {
    expect(() =>
      recomputeStatisticalOperatorServerTransform({
        transform_id: "falcon24.unregistered.v1",
        governed_rows: [],
      }),
    ).toThrowError("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_TRANSFORM_UNKNOWN");
  });
});
