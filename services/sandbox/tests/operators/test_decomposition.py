from __future__ import annotations

import itertools
import math

import pytest

from data_agent_stats.decomposition import product_shapley_exact, revenue_segment_drivers
from data_agent_stats.registry import StatisticalOperatorError

PARAMETERS = {"mode": "exact", "max_factors": 8, "closure_tolerance": 1e-9}


def _independent_shapley(baseline: dict[str, float], current: dict[str, float]) -> dict[str, float]:
    contributions = {factor: 0.0 for factor in baseline}
    permutations = tuple(itertools.permutations(baseline))
    for permutation in permutations:
        state = dict(baseline)
        before = math.prod(state.values())
        for factor in permutation:
            state[factor] = current[factor]
            after = math.prod(state.values())
            contributions[factor] += after - before
            before = after
    return {factor: value / len(permutations) for factor, value in contributions.items()}


def _run(
    baseline: dict[str, float], current: dict[str, float], *, label: str = "transition"
) -> object:
    return product_shapley_exact(
        {
            "comparisons": [
                {
                    "label": label,
                    "baseline_factors": baseline,
                    "current_factors": current,
                }
            ]
        },
        PARAMETERS,
    )


def test_product_shapley_matches_independent_permutation_oracle_and_closes() -> None:
    baseline = {"buyers": 10, "frequency": 2, "aov": 5}
    current = {"buyers": 8, "frequency": 3, "aov": 4}
    result = _run(baseline, current)
    rows = {row["factor"]: row for row in result.output["contributions"]}  # type: ignore[attr-defined]
    expected = _independent_shapley(baseline, current)

    assert list(rows) == sorted(baseline)
    for factor in baseline:
        assert rows[factor]["contribution"] == pytest.approx(expected[factor], abs=1e-12)
        assert rows[factor]["permutation_count"] == 6
        assert rows[factor]["baseline_product"] == 100
        assert rows[factor]["current_product"] == 96
        assert rows[factor]["delta"] == -4
    assert sum(row["contribution"] for row in rows.values()) == pytest.approx(-4, abs=1e-12)
    assert all(abs(row["closure_error"]) <= 1e-9 for row in rows.values())


def test_product_shapley_is_factor_order_invariant_and_dummy_factor_is_zero() -> None:
    baseline = {"a": 2, "b": 3, "dummy": 7}
    current = {"a": 4, "b": 5, "dummy": 7}
    forward = _run(baseline, current)
    reverse = _run(dict(reversed(tuple(baseline.items()))), dict(reversed(tuple(current.items()))))

    assert forward.output == reverse.output  # type: ignore[attr-defined]
    dummy = next(
        row
        for row in forward.output["contributions"]
        if row["factor"] == "dummy"  # type: ignore[attr-defined]
    )
    assert dummy["contribution"] == pytest.approx(0)


def test_product_shapley_baseline_equals_current_has_zero_delta() -> None:
    result = _run({"a": 2, "b": 3}, {"a": 2, "b": 3})

    assert all(
        row["contribution"] == pytest.approx(0) and row["delta"] == 0 and row["closure_error"] == 0
        for row in result.output["contributions"]  # type: ignore[attr-defined]
    )


@pytest.mark.parametrize(
    ("baseline", "current", "parameters"),
    [
        ({"a": 1}, {"b": 1}, PARAMETERS),
        ({str(index): 1 for index in range(9)}, {str(index): 2 for index in range(9)}, PARAMETERS),
        ({"a": math.inf}, {"a": 1}, PARAMETERS),
        ({"a": 1}, {"a": 2}, {**PARAMETERS, "mode": "approximate"}),
    ],
)
def test_product_shapley_rejects_unsupported_or_unbounded_inputs(
    baseline: dict[str, float], current: dict[str, float], parameters: dict[str, object]
) -> None:
    with pytest.raises(StatisticalOperatorError):
        product_shapley_exact(
            {
                "comparisons": [
                    {
                        "label": "transition",
                        "baseline_factors": baseline,
                        "current_factors": current,
                    }
                ]
            },
            parameters,
        )


def test_revenue_segment_drivers_preserves_dimension_member_identity() -> None:
    rows = [
        {
            "order_id": "may-card-snacks",
            "order_date": "2024-05-10",
            "payment_method": "Card",
            "customer_segment": "Premium",
            "product_category": "Snacks",
            "quantity": 2,
            "order_total": 100,
        },
        {
            "order_id": "may-cash-drinks",
            "order_date": "2024-05-11",
            "payment_method": "Cash",
            "customer_segment": "Regular",
            "product_category": "Drinks",
            "quantity": 1,
            "order_total": 80,
        },
        {
            "order_id": "jun-card-snacks",
            "order_date": "2024-06-10",
            "payment_method": "Card",
            "customer_segment": "Premium",
            "product_category": "Snacks",
            "quantity": 1,
            "order_total": 20,
        },
        {
            "order_id": "jun-cash-drinks",
            "order_date": "2024-06-11",
            "payment_method": "Cash",
            "customer_segment": "Regular",
            "product_category": "Drinks",
            "quantity": 1,
            "order_total": 70,
        },
    ]

    result = revenue_segment_drivers({"order_items": rows}, {})

    assert result.output["drivers"] == [
        {
            "dimension": "customer_segment",
            "member": "Premium",
            "revenue_change": -80.0,
            "start_month": "2024-05",
            "end_month": "2024-06",
        },
        {
            "dimension": "payment_method",
            "member": "Card",
            "revenue_change": -80.0,
            "start_month": "2024-05",
            "end_month": "2024-06",
        },
        {
            "dimension": "product_category",
            "member": "Snacks",
            "revenue_change": -80.0,
            "start_month": "2024-05",
            "end_month": "2024-06",
        },
    ]
    assert result.sample_size == 4
    assert result.group_count == 3


def test_revenue_segment_drivers_rejects_conflicting_order_headers() -> None:
    row = {
        "order_id": "order-a",
        "order_date": "2024-05-10",
        "payment_method": "Card",
        "customer_segment": "Premium",
        "product_category": "Snacks",
        "quantity": 1,
        "order_total": 100,
    }
    with pytest.raises(StatisticalOperatorError, match="PYTHON_OPERATOR_APPLICABILITY_HOLD"):
        revenue_segment_drivers(
            {
                "order_items": [
                    row,
                    {**row, "product_category": "Drinks", "order_total": 90},
                ]
            },
            {},
        )
