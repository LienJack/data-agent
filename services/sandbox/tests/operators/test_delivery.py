from __future__ import annotations

from copy import deepcopy

import pytest

from data_agent_stats.delivery import (
    delivery_low_rating_adjusted,
    delivery_low_rating_scenarios,
)
from data_agent_stats.manifest import OPERATOR_BY_ID, input_records_match_manifest
from data_agent_stats.registry import StatisticalOperatorError


def _inputs() -> dict[str, list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    specifications = [
        ("cat-a", "premium", "Delayed", 4, 3),
        ("cat-b", "regular", "On Time", 5, 3),
        ("cat-c", "premium", "Delayed", 3, 2),
        ("cat-d", "regular", "Delayed", 2, 1),
        ("cat-e", "premium", "On Time", 1, 1),
        ("cat-f", "regular", "On Time", 10, 0),
    ]
    index = 0
    for category, segment, status, count, low_count in specifications:
        for offset in range(count):
            index += 1
            rows.append(
                {
                    "order_id": f"order-{index}",
                    "product_category": category,
                    "customer_segment": segment,
                    "delivery_status": status,
                    "rating": 2.0 if offset < low_count else None,
                }
            )
    return {"orders": rows}


def test_delivery_scenarios_return_unique_deterministic_top_five() -> None:
    result = delivery_low_rating_scenarios(_inputs(), {})

    assert result.output["scenarios"] == [
        {
            "product_category": "cat-a",
            "customer_segment": "premium",
            "delivery_status": "Delayed",
            "order_count": 4,
            "low_rating_rate": 0.75,
        },
        {
            "product_category": "cat-b",
            "customer_segment": "regular",
            "delivery_status": "On Time",
            "order_count": 5,
            "low_rating_rate": 0.6,
        },
        {
            "product_category": "cat-c",
            "customer_segment": "premium",
            "delivery_status": "Delayed",
            "order_count": 3,
            "low_rating_rate": pytest.approx(2 / 3),
        },
        {
            "product_category": "cat-e",
            "customer_segment": "premium",
            "delivery_status": "On Time",
            "order_count": 1,
            "low_rating_rate": 1.0,
        },
        {
            "product_category": "cat-d",
            "customer_segment": "regular",
            "delivery_status": "Delayed",
            "order_count": 2,
            "low_rating_rate": 0.5,
        },
    ]
    assert result.sample_size == 25
    assert result.group_count == 6
    assert result.family_size == 6


def test_delivery_scenarios_are_input_order_invariant() -> None:
    inputs = _inputs()
    reverse = {"orders": list(reversed(inputs["orders"]))}

    assert delivery_low_rating_scenarios(inputs, {}).output == delivery_low_rating_scenarios(
        reverse, {}
    ).output


def test_delivery_scenario_manifest_accepts_exact_order_rows() -> None:
    inputs = _inputs()
    descriptor = OPERATOR_BY_ID["descriptive.delivery-low-rating-scenarios@1"]

    assert input_records_match_manifest(descriptor["inputs"][0], inputs["orders"])
    projected = deepcopy(inputs["orders"])
    projected[0].pop("rating")
    assert not input_records_match_manifest(descriptor["inputs"][0], projected)


def test_delivery_scenarios_reject_duplicate_order_grain() -> None:
    inputs = _inputs()
    inputs["orders"].append(deepcopy(inputs["orders"][0]))

    with pytest.raises(StatisticalOperatorError):
        delivery_low_rating_scenarios(inputs, {})


def _model_inputs() -> dict[str, list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    index = 0
    for month in range(1, 7):
        for category_index, category in enumerate(["cat-a", "cat-b", "cat-c"]):
            for segment_index, segment in enumerate(["premium", "regular", "new"]):
                for delayed in range(2):
                    for replicate in range(3):
                        index += 1
                        rows.append(
                            {
                                "order_id": f"model-order-{index}",
                                "order_date": f"2024-{month:02d}-{replicate + 1:02d}",
                                "delivery_status": "Delayed" if delayed else "On Time",
                                "order_total": 50.0
                                + ((index * 17 + category_index * 5 + segment_index) % 91),
                                "product_category": category,
                                "customer_segment": segment,
                                "rating": float(
                                    ((index * 7 + month + category_index + delayed) % 5) + 1
                                ),
                            }
                        )
    return {"orders": rows}


def test_delivery_adjusted_builds_the_unique_controlled_glm() -> None:
    result = delivery_low_rating_adjusted(_model_inputs(), {})

    assert result.sample_size == 324
    assert result.group_count == 1
    assert result.output["models"] == [
        {
            "label": "delivery_low_rating_adjusted",
            "delayed_coefficient": pytest.approx(
                result.output["models"][0]["delayed_coefficient"]
            ),
            "delayed_p_value": pytest.approx(result.output["models"][0]["delayed_p_value"]),
            "sample_size": 324,
            "controls": ["month", "log_order_amount", "product_category", "customer_segment"],
            "finding": result.output["models"][0]["finding"],
            "rank": result.output["models"][0]["rank"],
            "converged": True,
            "iterations": result.output["models"][0]["iterations"],
        }
    ]
    assert 0 <= result.output["models"][0]["delayed_p_value"] <= 1
    assert result.output["models"][0]["finding"] in {
        "NOT_SIGNIFICANT",
        "POSITIVE_SIGNIFICANT",
        "NEGATIVE_SIGNIFICANT",
    }
    assert set(result.limitation_codes) == {
        "ASSOCIATION_NOT_CAUSATION",
        "BINOMIAL_LOGIT_COMPOSED_FROM_UNIQUE_OPERATOR",
    }


def test_delivery_adjusted_manifest_accepts_exact_order_rows() -> None:
    inputs = _model_inputs()
    descriptor = OPERATOR_BY_ID["regression.delivery-low-rating-adjusted@1"]

    assert input_records_match_manifest(descriptor["inputs"][0], inputs["orders"])
