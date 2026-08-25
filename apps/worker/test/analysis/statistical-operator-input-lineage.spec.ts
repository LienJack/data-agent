import {
  type StatisticalOperatorObligation,
  statisticalOperatorObligationSchema,
} from "@data-agent/contracts/statistical-operators";
import { DateDay, Float64, Table, tableToIPC, Utf8, vectorFromArray } from "apache-arrow";
import { describe, expect, it } from "vitest";
import type { GovernedAnalysisInput } from "../../src/analysis/governed-analysis-input.js";
import { verifyStatisticalOperatorInputLineage } from "../../src/analysis/statistical-operator-input-lineage.js";

const obligation = {
  call_id: "q1_segment_drivers",
  operator_id: "decomposition.revenue-segment-drivers@1",
  input_lineage_bindings: [
    {
      lineage_kind: "GOVERNED_INPUT_EXACT",
      operator_input_name: "order_items",
      governed_input_name: "falcon24_business_review",
      row_mode: "ALL_ROWS_EXACT",
      field_sources: [
        { operator_field: "order_id", governed_column: "order_id" },
        { operator_field: "order_date", governed_column: "order_date" },
        { operator_field: "payment_method", governed_column: "payment_method" },
        { operator_field: "customer_segment", governed_column: "customer_segment" },
        { operator_field: "product_category", governed_column: "product_category" },
        { operator_field: "quantity", governed_column: "quantity" },
        { operator_field: "order_total", governed_column: "order_total" },
      ],
    },
  ],
  result_binding: {
    result_output_name: "result",
    result_collection_path: "/segment_drivers",
    operator_collection_path: "/drivers",
    label_fields: ["dimension", "member"],
    value_bindings: [
      {
        result_field: "revenue_change",
        operator_field: "revenue_change",
        comparison: "EXACT",
        absolute_tolerance: 0,
        relative_tolerance: 0,
      },
    ],
    require_exact_label_set: true,
  },
} as const satisfies StatisticalOperatorObligation;

const authoritativeRow = Object.freeze({
  order_id: "order-1",
  order_date: "2024-05-10",
  payment_method: "Card",
  customer_segment: "Premium",
  product_category: "Snacks & Munchies",
  quantity: 2,
  order_total: 100,
});

function governedInput(): GovernedAnalysisInput {
  const table = new Table({
    order_id: vectorFromArray([authoritativeRow.order_id], new Utf8()),
    order_date: vectorFromArray(
      [new Date(`${authoritativeRow.order_date}T00:00:00.000Z`)],
      new DateDay(),
    ),
    payment_method: vectorFromArray([authoritativeRow.payment_method], new Utf8()),
    customer_segment: vectorFromArray([authoritativeRow.customer_segment], new Utf8()),
    product_category: vectorFromArray([authoritativeRow.product_category], new Utf8()),
    quantity: vectorFromArray([authoritativeRow.quantity], new Float64()),
    order_total: vectorFromArray([authoritativeRow.order_total], new Float64()),
  });
  return {
    name: "falcon24_business_review",
    format: "ARROW",
    content: tableToIPC(table, "file"),
  } as GovernedAnalysisInput;
}

describe("statistical operator input lineage", () => {
  it("rejects an empty lineage contract instead of treating it as authorized", () => {
    expect(
      statisticalOperatorObligationSchema.safeParse({
        ...obligation,
        input_lineage_bindings: [],
      }).success,
    ).toBe(false);
  });

  it("accepts the exact governed column identity", () => {
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation,
        inputs: { order_items: [{ ...authoritativeRow }] },
        governed_inputs: [governedInput()],
      }),
    ).toBeNull();
  });

  it("rejects same-type Card and Snacks field swaps before operator invocation", () => {
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation,
        inputs: {
          order_items: [
            {
              ...authoritativeRow,
              payment_method: authoritativeRow.product_category,
              product_category: authoritativeRow.payment_method,
            },
          ],
        },
        governed_inputs: [governedInput()],
      }),
    ).toMatchObject({
      code: "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
      input_name: "order_items",
      field_name: "payment_method",
    });
  });

  it("recomputes a fixed delivery transform and rejects a model-edited row", () => {
    const deliveryObligation = {
      call_id: "q2_low_rating_scenarios",
      operator_id: "descriptive.delivery-low-rating-scenarios@1",
      input_lineage_bindings: [
        {
          lineage_kind: "SERVER_TRANSFORM_EXACT",
          operator_input_name: "orders",
          governed_input_name: "falcon24_delivery_experience",
          transform_id: "falcon24.q2.delivery_scenario_orders.v1",
        },
      ],
      result_binding: {
        result_output_name: "result",
        result_collection_path: "/low_rating_scenarios",
        operator_collection_path: "/scenarios",
        label_fields: ["product_category", "customer_segment", "delivery_status"],
        value_bindings: [
          {
            result_field: "order_count",
            operator_field: "order_count",
            comparison: "EXACT",
            absolute_tolerance: 0,
            relative_tolerance: 0,
          },
        ],
        require_exact_label_set: true,
      },
    } as const satisfies StatisticalOperatorObligation;
    const deliveryTable = new Table({
      order_id: vectorFromArray(["order-1", "order-1"], new Utf8()),
      order_date: vectorFromArray(
        [new Date("2024-05-10T00:00:00.000Z"), new Date("2024-05-10T00:00:00.000Z")],
        new DateDay(),
      ),
      delivery_status: vectorFromArray(["Delayed", "Delayed"], new Utf8()),
      order_total: vectorFromArray([100, 100], new Float64()),
      customer_segment: vectorFromArray(["Premium", "Premium"], new Utf8()),
      product_category: vectorFromArray(["Snacks", "Grocery"], new Utf8()),
      rating: vectorFromArray([2, 2], new Float64()),
    });
    const governed = {
      name: "falcon24_delivery_experience",
      format: "ARROW",
      content: tableToIPC(deliveryTable, "file"),
    } as GovernedAnalysisInput;
    const exactOrders = [
      {
        order_id: "order-1",
        product_category: "Grocery",
        customer_segment: "Premium",
        delivery_status: "Delayed",
        rating: 2,
      },
    ];
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation: deliveryObligation,
        inputs: { orders: exactOrders },
        governed_inputs: [governed],
      }),
    ).toBeNull();
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation: deliveryObligation,
        inputs: { orders: [{ ...exactOrders[0], product_category: "Snacks" }] },
        governed_inputs: [governed],
      }),
    ).toMatchObject({
      code: "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
      input_name: "orders",
    });
  });

  it("projects an exact protected operator result and fails closed when it is unavailable", () => {
    const bhObligation = {
      call_id: "q3_bh_all_products",
      operator_id: "multiple-testing.bh-fdr@1",
      input_lineage_bindings: [
        {
          lineage_kind: "OPERATOR_RESULT_EXACT",
          operator_input_name: "tests",
          source_call_id: "q3_mann_kendall_all_products",
          source_collection_path: "/series",
          row_mode: "ALL_ROWS_EXACT",
          field_sources: [
            { operator_field: "label", source_field: "label" },
            { operator_field: "p_value", source_field: "p_value" },
          ],
        },
      ],
      result_binding: {
        result_output_name: "result",
        result_collection_path: "/tests",
        operator_collection_path: "/tests",
        label_fields: ["label"],
        value_bindings: [
          {
            result_field: "adjusted_p_value",
            operator_field: "adjusted_p_value",
            comparison: "EXACT",
            absolute_tolerance: 0,
            relative_tolerance: 0,
          },
        ],
        require_exact_label_set: true,
      },
    } as const satisfies StatisticalOperatorObligation;
    const inputs = { tests: [{ label: "product-1", p_value: 0.0125 }] };
    const protectedOutputs = new Map<string, unknown>([
      [
        "q3_mann_kendall_all_products",
        { series: [{ label: "product-1", p_value: 0.0125, trend: "INCREASING" }] },
      ],
    ]);
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation: bhObligation,
        inputs,
        governed_inputs: [],
        protected_operator_outputs: protectedOutputs,
      }),
    ).toBeNull();
    expect(
      verifyStatisticalOperatorInputLineage({
        obligation: bhObligation,
        inputs,
        governed_inputs: [],
      }),
    ).toMatchObject({
      code: "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
      input_name: "tests",
    });
  });
});
