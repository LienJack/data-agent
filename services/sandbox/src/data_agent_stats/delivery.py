from __future__ import annotations

import math
from collections import defaultdict
from datetime import date
from typing import Any

from data_agent_stats.registry import OperatorExecutionResult, StatisticalOperatorError
from data_agent_stats.regression import binomial_logit_wald


def delivery_low_rating_scenarios(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Return the unique deterministic top-five low-rating scenario projection."""

    if parameters:
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    rows = inputs["orders"]
    order_ids: set[str] = set()
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        order_id = row["order_id"]
        if order_id in order_ids:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        order_ids.add(order_id)
        grouped[
            (
                row["product_category"],
                row["customer_segment"],
                row["delivery_status"],
            )
        ].append(row)
    if not grouped:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    ranked: list[dict[str, Any]] = []
    for (category, segment, status), selected in grouped.items():
        low_rating_count = sum(
            1 for row in selected if row["rating"] is not None and float(row["rating"]) <= 2
        )
        ranked.append(
            {
                "product_category": category,
                "customer_segment": segment,
                "delivery_status": status,
                "order_count": len(selected),
                "low_rating_count": low_rating_count,
                "low_rating_rate": low_rating_count / len(selected),
            }
        )
    ranked.sort(
        key=lambda row: (
            -row["low_rating_count"],
            -row["low_rating_rate"],
            -row["order_count"],
            row["product_category"],
            row["customer_segment"],
            row["delivery_status"],
        )
    )
    scenarios = [
        {
            "product_category": row["product_category"],
            "customer_segment": row["customer_segment"],
            "delivery_status": row["delivery_status"],
            "order_count": row["order_count"],
            "low_rating_rate": row["low_rating_rate"],
        }
        for row in ranked[:5]
    ]
    return OperatorExecutionResult(
        output={"scenarios": scenarios},
        sample_size=len(rows),
        group_count=len(grouped),
        family_size=len(grouped),
        applicability="PASS",
        limitation_codes=("DESCRIPTIVE_CONCENTRATION_NOT_CAUSAL",),
    )


def _date_key(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD") from error
    return parsed.isoformat()


def delivery_low_rating_adjusted(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Build the frozen delivery GLM design and return the governed delayed-term finding."""

    if parameters:
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    rows = inputs["orders"]
    order_ids: set[str] = set()
    rated: list[dict[str, Any]] = []
    for row in rows:
        order_id = row["order_id"]
        if order_id in order_ids:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        order_ids.add(order_id)
        _date_key(row["order_date"])
        if row["rating"] is not None:
            if float(row["order_total"]) <= 0:
                raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
            rated.append(row)
    if not rated:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    months = sorted({row["order_date"][:7] for row in rated})
    categories = sorted({row["product_category"] for row in rated})
    segments = sorted({row["customer_segment"] for row in rated})
    predictors: dict[str, list[float]] = {
        "delayed": [0.0 if row["delivery_status"] == "On Time" else 1.0 for row in rated],
        "log_order_amount": [math.log(float(row["order_total"])) for row in rated],
    }
    for month in months[1:]:
        predictors[f"month={month}"] = [
            1.0 if row["order_date"][:7] == month else 0.0 for row in rated
        ]
    for category in categories[1:]:
        predictors[f"product_category={category}"] = [
            1.0 if row["product_category"] == category else 0.0 for row in rated
        ]
    for segment in segments[1:]:
        predictors[f"customer_segment={segment}"] = [
            1.0 if row["customer_segment"] == segment else 0.0 for row in rated
        ]
    result = binomial_logit_wald(
        {
            "models": [
                {
                    "label": "delivery_low_rating_adjusted",
                    "outcome": [1.0 if float(row["rating"]) <= 2 else 0.0 for row in rated],
                    "predictors": predictors,
                }
            ]
        },
        {
            "add_intercept": True,
            "max_iterations": 100,
            "tolerance": 1e-8,
        },
    )
    delayed = next(
        (
            row
            for row in result.output["coefficients"]
            if row["label"] == "delivery_low_rating_adjusted" and row["term"] == "delayed"
        ),
        None,
    )
    if delayed is None:
        raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    coefficient = float(delayed["coefficient"])
    p_value = float(delayed["p_value"])
    finding = (
        "NOT_SIGNIFICANT"
        if p_value > 0.05
        else "POSITIVE_SIGNIFICANT"
        if coefficient > 0
        else "NEGATIVE_SIGNIFICANT"
    )
    return OperatorExecutionResult(
        output={
            "models": [
                {
                    "label": "delivery_low_rating_adjusted",
                    "delayed_coefficient": coefficient,
                    "delayed_p_value": p_value,
                    "sample_size": int(delayed["sample_size"]),
                    "controls": [
                        "month",
                        "log_order_amount",
                        "product_category",
                        "customer_segment",
                    ],
                    "finding": finding,
                    "rank": int(delayed["rank"]),
                    "converged": bool(delayed["converged"]),
                    "iterations": int(delayed["iterations"]),
                }
            ]
        },
        sample_size=len(rated),
        group_count=1,
        rank=int(delayed["rank"]),
        applicability="PASS",
        limitation_codes=(
            "ASSOCIATION_NOT_CAUSATION",
            "BINOMIAL_LOGIT_COMPOSED_FROM_UNIQUE_OPERATOR",
        ),
    )


__all__ = ["delivery_low_rating_adjusted", "delivery_low_rating_scenarios"]
