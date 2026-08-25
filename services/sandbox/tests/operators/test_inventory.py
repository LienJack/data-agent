from __future__ import annotations

from copy import deepcopy

import pytest

from data_agent_stats.inventory import inventory_damage_priority
from data_agent_stats.registry import StatisticalOperatorError


def _inputs() -> dict[str, list[dict[str, object]]]:
    inventory_rows: list[dict[str, object]] = []
    products = [
        ("p1", "Product 1", "grocery", 10.0),
        ("p2", "Product 2", "grocery", 20.0),
        ("p3", "Product 3", "grocery", 30.0),
        ("p4", "Product 4", "grocery", 40.0),
        ("p5", "Product 5", "fresh", 50.0),
    ]
    for product_id, product_name, category, monthly_sales in products:
        for index in range(12):
            inventory_rows.append(
                {
                    "product_id": product_id,
                    "product_name": product_name,
                    "category": category,
                    "month": f"2024-{index + 1:02d}",
                    "sales_quantity": monthly_sales,
                    "stock_received": 100.0,
                    "damaged_stock": float(index if product_id == "p4" else 11 - index),
                }
            )
    labels = [product[0] for product in products]
    return {
        "inventory_rows": inventory_rows,
        "theil_sen": [
            {"label": label, "slope": 0.01 if label == "p4" else -0.01} for label in labels
        ],
        "mann_kendall": [
            {"label": label, "p_value": 0.01 if label == "p4" else 0.5} for label in labels
        ],
        "bh_fdr": [
            {"label": label, "adjusted_p_value": 0.04 if label == "p4" else 0.5} for label in labels
        ],
    }


def _parameters() -> dict[str, float]:
    return {"alpha": 0.05, "category_sales_percentile": 0.75}


def test_inventory_priority_returns_complete_deterministic_candidate_set() -> None:
    inputs = _inputs()
    result = inventory_damage_priority(inputs, _parameters())

    assert result.output["products"] == [
        {
            "product_id": "p4",
            "product_name": "Product 4",
            "category": "grocery",
            "sales_quantity": 480.0,
            "previous9_damage_rate": pytest.approx(0.04),
            "last3_damage_rate": pytest.approx(0.1),
            "category_sales_p75": 390.0,
            "theil_sen_slope": 0.01,
            "raw_p_value": 0.01,
            "bh_q_value": 0.04,
            "status": "PRIORITY",
            "product_count": 5,
            "candidate_count": 1,
            "category_sales_percentile": 0.75,
            "selection_rule": "SALES_GTE_P75_AND_SLOPE_GT_0_AND_LAST3_GT_PREVIOUS9",
        }
    ]
    assert result.sample_size == 60
    assert result.group_count == 5
    assert result.family_size == 5
    assert set(result.limitation_codes) == {
        "DESCRIPTIVE_SCREENING_NOT_CAUSAL",
        "INPUT_SERIES_MUST_COVER_ALL_PRODUCTS",
    }


def test_inventory_priority_is_input_order_invariant() -> None:
    forward = _inputs()
    reverse = {key: list(reversed(rows)) for key, rows in forward.items()}

    assert (
        inventory_damage_priority(forward, _parameters()).output
        == inventory_damage_priority(reverse, _parameters()).output
    )


@pytest.mark.parametrize("mutation", ["missing_month", "metadata_conflict", "missing_label"])
def test_inventory_priority_rejects_incomplete_or_ambiguous_product_closure(mutation: str) -> None:
    inputs = deepcopy(_inputs())
    if mutation == "missing_month":
        inputs["inventory_rows"].pop()
    elif mutation == "metadata_conflict":
        inputs["inventory_rows"][0]["category"] = "other"
    else:
        inputs["bh_fdr"].pop()

    with pytest.raises(StatisticalOperatorError):
        inventory_damage_priority(inputs, _parameters())
