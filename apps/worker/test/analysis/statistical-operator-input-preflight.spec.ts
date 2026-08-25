import { describe, expect, it } from "vitest";
import { preflightStatisticalOperatorArguments } from "../../src/analysis/statistical-operator-input-preflight.js";

describe("statistical operator input preflight", () => {
  const valid = {
    operator_id: "cohort.registration-retention-m0-m6@2" as const,
    inputs: {
      customers: [
        {
          customer_id: "customer-a",
          registration_date: "2023-05-01",
          customer_type: "Premium",
        },
      ],
      events: [
        {
          customer_id: "customer-a",
          event_date: "2023-05-02",
          order_id: "order-a",
          revenue: 10,
          delivery_minutes: null,
          rating: 5,
        },
      ],
      observation: [{ observation_end_month: "2024-10", invalid_delivery_event_count: 1 }],
    },
    parameters: {
      horizon_months: 6,
      pre_registration_policy: "hold_primary",
      duplicate_customer_policy: "reject",
    },
  };

  it("accepts the exact manifest-declared cohort input", () => {
    expect(preflightStatisticalOperatorArguments(valid)).toBeNull();
  });

  it("returns only a manifest field identifier for a malformed date", () => {
    expect(
      preflightStatisticalOperatorArguments({
        ...valid,
        inputs: {
          ...valid.inputs,
          events: [{ ...valid.inputs.events[0], event_date: "2023-05-02 00:00:00" }],
        },
      }),
    ).toEqual({
      code: "ANALYSIS_OPERATOR_ARGUMENT_FIELD_TYPE_INVALID",
      input_name: "events",
      field_name: "event_date",
      expected_kind: "DATE_KEY",
      expected_fields: [],
    });
  });

  it("rejects bool and null in governed numeric fields before intent persistence", () => {
    expect(
      preflightStatisticalOperatorArguments({
        ...valid,
        inputs: {
          ...valid.inputs,
          events: [{ ...valid.inputs.events[0], revenue: true }],
        },
      }),
    ).toMatchObject({
      code: "ANALYSIS_OPERATOR_ARGUMENT_FIELD_TYPE_INVALID",
      input_name: "events",
      field_name: "revenue",
      expected_kind: "NON_NEGATIVE_FINITE_NUMBER",
    });
  });

  it("returns the frozen record field set without returning row values", () => {
    expect(
      preflightStatisticalOperatorArguments({
        ...valid,
        inputs: {
          ...valid.inputs,
          events: [
            {
              ...valid.inputs.events[0],
              average_rating: 5,
            },
          ],
        },
      }),
    ).toEqual({
      code: "ANALYSIS_OPERATOR_ARGUMENT_RECORD_FIELDS_INVALID",
      input_name: "events",
      field_name: null,
      expected_kind: "RECORD",
      expected_fields: [
        "customer_id",
        "event_date",
        "order_id",
        "revenue",
        "delivery_minutes",
        "rating",
      ],
    });
  });

  it("rejects undeclared inputs and parameter values without projecting data", () => {
    expect(
      preflightStatisticalOperatorArguments({
        ...valid,
        inputs: { ...valid.inputs, extra: [] },
      }),
    ).toMatchObject({ code: "ANALYSIS_OPERATOR_ARGUMENT_INPUT_SET_INVALID" });
    expect(
      preflightStatisticalOperatorArguments({
        ...valid,
        parameters: { ...valid.parameters, horizon_months: 5 },
      }),
    ).toMatchObject({
      code: "ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_VALUE_INVALID",
      field_name: "horizon_months",
      expected_kind: "ENUM_INTEGER",
    });
  });
});
