from __future__ import annotations

from copy import deepcopy

import pytest

from data_agent_stats.cohort import registration_retention_m0_m6
from data_agent_stats.registry import StatisticalOperatorError


def _inputs() -> dict[str, list[dict[str, object]]]:
    return {
        "customers": [
            {
                "customer_id": "c1",
                "registration_date": "2024-01-15",
                "customer_type": "retail",
            },
            {
                "customer_id": "c2",
                "registration_date": "2024-01-20",
                "customer_type": "retail",
            },
            {
                "customer_id": "c3",
                "registration_date": "2024-02-01",
                "customer_type": "vip",
            },
        ],
        "events": [
            {
                "customer_id": "c1",
                "event_date": "2023-12-31",
                "order_id": "pre-c1",
                "revenue": 5,
                "delivery_minutes": 50,
                "rating": 2,
            },
            {
                "customer_id": "c1",
                "event_date": "2024-01-16",
                "order_id": "c1-m0-a",
                "revenue": 10,
                "delivery_minutes": 30,
                "rating": 4,
            },
            {
                "customer_id": "c1",
                "event_date": "2024-01-17",
                "order_id": "c1-m0-b",
                "revenue": 20,
                "delivery_minutes": 40,
                "rating": 2,
            },
            {
                "customer_id": "c3",
                "event_date": "2024-02-02",
                "order_id": "c3-m0",
                "revenue": 30,
                "delivery_minutes": None,
                "rating": None,
            },
            {
                "customer_id": "orphan",
                "event_date": "2024-01-01",
                "order_id": "orphan-order",
                "revenue": 99,
                "delivery_minutes": 20,
                "rating": 5,
            },
        ],
        "observation": [
            {"observation_end_month": "2024-09", "invalid_delivery_event_count": 0}
        ],
    }


def _parameters(policy: str) -> dict[str, object]:
    return {
        "horizon_months": 6,
        "pre_registration_policy": policy,
        "duplicate_customer_policy": "reject",
    }


def _row(result: object, registration: str, customer_type: str, month: int) -> dict[str, object]:
    return next(
        row
        for row in result.output["cohort_periods"]  # type: ignore[attr-defined]
        if row["registration_month"] == registration
        and row["customer_type"] == customer_type
        and row["month_index"] == month
    )


def test_primary_cohort_grid_retains_zero_order_customers_and_discloses_anomalies() -> None:
    result = registration_retention_m0_m6(_inputs(), _parameters("hold_primary"))

    assert len(result.output["cohort_periods"]) == 14
    assert [
        row["month_index"]
        for row in result.output["cohort_periods"]
        if row["registration_month"] == "2024-01"
    ] == list(range(7))
    m0 = _row(result, "2024-01", "retail", 0)
    assert m0["cohort_size"] == 2
    assert m0["eligible_customers"] == 2
    assert m0["active_customers"] == 1
    assert m0["retention_rate"] == pytest.approx(0.5)
    assert m0["repeat_customers"] == 1
    assert m0["repeat_purchase_rate"] == pytest.approx(0.5)
    assert m0["order_count"] == 2
    assert m0["revenue"] == 30
    assert m0["average_spend"] == 30
    assert m0["average_delivery_minutes"] == 35
    assert m0["average_rating"] == 3
    assert m0["pre_registration_event_count"] == 1
    assert m0["orphan_event_count"] == 1
    assert m0["data_quality_status"] == "HOLD_TEMPORAL_AND_RELATIONSHIP_ANOMALIES"
    assert all(
        row["pre_registration_event_count"] == 1 and row["orphan_event_count"] == 1
        for row in result.output["cohort_periods"]
    )
    assert set(result.limitation_codes) == {
        "ORPHAN_EVENTS_EXCLUDED",
        "PRIMARY_HOLD_ON_PRE_REGISTRATION_EVENTS",
    }


def test_sensitivity_excludes_temporal_invalid_customer_but_retains_no_order_customer() -> None:
    result = registration_retention_m0_m6(_inputs(), _parameters("exclude_sensitivity"))
    m0 = _row(result, "2024-01", "retail", 0)

    assert m0["cohort_size"] == 2
    assert m0["eligible_customers"] == 1
    assert m0["active_customers"] == 0
    assert m0["retention_rate"] == 0
    assert m0["repeat_purchase_rate"] == 0
    assert m0["average_spend"] is None
    assert m0["pre_registration_event_count"] == 1
    assert m0["orphan_event_count"] == 1
    assert m0["data_quality_status"] == "SENSITIVITY_WITH_DISCLOSED_ANOMALIES"
    assert set(result.limitation_codes) == {
        "ORPHAN_EVENTS_EXCLUDED",
        "SENSITIVITY_MUST_RETAIN_QUALITY_COUNTS",
    }


def test_invalid_delivery_events_are_disclosed_as_excluded_quality_evidence() -> None:
    inputs = _inputs()
    inputs["observation"][0]["invalid_delivery_event_count"] = 2

    result = registration_retention_m0_m6(inputs, _parameters("hold_primary"))
    m0 = _row(result, "2024-01", "retail", 0)

    assert m0["invalid_delivery_event_count"] == 2
    assert m0["data_quality_status"] == "HOLD_MULTIPLE_DATA_QUALITY_ANOMALIES"
    assert "INVALID_DELIVERY_EVENTS_EXCLUDED" in result.limitation_codes


def test_empty_periods_are_present_with_zero_rates_and_null_experience() -> None:
    result = registration_retention_m0_m6(_inputs(), _parameters("hold_primary"))
    m6 = _row(result, "2024-02", "vip", 6)

    assert m6["matured"] is True
    assert m6["eligible_customers"] == 1
    assert m6["active_customers"] == 0
    assert m6["order_count"] == 0
    assert m6["revenue"] == 0
    assert m6["average_spend"] is None
    assert m6["average_delivery_minutes"] is None
    assert m6["average_rating"] is None


@pytest.mark.parametrize(
    "mutation",
    ["duplicate_customer", "duplicate_order", "invalid_month", "immature", "negative_revenue"],
)
def test_cohort_rejects_denominator_and_data_quality_mutations(mutation: str) -> None:
    inputs = deepcopy(_inputs())
    if mutation == "duplicate_customer":
        inputs["customers"].append(deepcopy(inputs["customers"][0]))
    elif mutation == "duplicate_order":
        inputs["events"].append(deepcopy(inputs["events"][0]))
    elif mutation == "invalid_month":
        inputs["customers"][0]["registration_date"] = "2024-02-30"
    elif mutation == "immature":
        inputs["observation"][0]["observation_end_month"] = "2024-06"
    else:
        inputs["events"][0]["revenue"] = -1

    with pytest.raises(StatisticalOperatorError):
        registration_retention_m0_m6(inputs, _parameters("hold_primary"))


def test_same_month_order_before_registration_is_detected_at_day_grain() -> None:
    inputs = deepcopy(_inputs())
    inputs["events"][0]["event_date"] = "2024-01-10"

    result = registration_retention_m0_m6(inputs, _parameters("hold_primary"))

    assert _row(result, "2024-01", "retail", 0)["pre_registration_event_count"] == 1
    assert "PRIMARY_HOLD_ON_PRE_REGISTRATION_EVENTS" in result.limitation_codes
