from __future__ import annotations

import math
from collections import defaultdict
from datetime import date
from typing import Any

from data_agent_stats.registry import OperatorExecutionResult, StatisticalOperatorError


def _linear_quantile(values: list[float], probability: float) -> float:
    if not values:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _labeled_values(rows: list[dict[str, Any]], value_field: str) -> dict[str, float]:
    values: dict[str, float] = {}
    for row in rows:
        label = row["label"]
        value = row[value_field]
        if label in values:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        values[label] = float(value)
    return values


def _month_key(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD") from error
    if parsed.day != 1:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    return value[:7]


def inventory_damage_priority(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Produce the complete deterministic high-sales damage-deterioration candidate set."""

    alpha = float(parameters["alpha"])
    percentile = float(parameters["category_sales_percentile"])
    inventory_rows = inputs["inventory_rows"]
    by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in inventory_rows:
        by_product[row["product_id"]].append(row)
    if not by_product:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    slopes = _labeled_values(inputs["theil_sen"], "slope")
    raw_p_values = _labeled_values(inputs["mann_kendall"], "p_value")
    adjusted_p_values = _labeled_values(inputs["bh_fdr"], "adjusted_p_value")
    product_ids = set(by_product)
    if (
        set(slopes) != product_ids
        or set(raw_p_values) != product_ids
        or set(adjusted_p_values) != product_ids
    ):
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    summaries: dict[str, dict[str, Any]] = {}
    category_sales: dict[str, list[float]] = defaultdict(list)
    for product_id, rows in by_product.items():
        ordered = sorted(rows, key=lambda row: _month_key(row["month"]))
        months = [_month_key(row["month"]) for row in ordered]
        names = {row["product_name"] for row in ordered}
        categories = {row["category"] for row in ordered}
        if len(ordered) != 12 or len(set(months)) != 12 or len(names) != 1 or len(categories) != 1:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        rates = [
            0.0
            if float(row["stock_received"]) == 0
            else float(row["damaged_stock"]) / float(row["stock_received"])
            for row in ordered
        ]
        total_sales = math.fsum(float(row["sales_quantity"]) for row in ordered)
        category = next(iter(categories))
        summary = {
            "product_id": product_id,
            "product_name": next(iter(names)),
            "category": category,
            "sales_quantity": total_sales,
            "previous9_damage_rate": math.fsum(rates[:9]) / 9,
            "last3_damage_rate": math.fsum(rates[9:]) / 3,
        }
        summaries[product_id] = summary
        category_sales[category].append(total_sales)

    category_thresholds = {
        category: _linear_quantile(values, percentile)
        for category, values in category_sales.items()
    }
    candidates: list[dict[str, Any]] = []
    for product_id in sorted(summaries):
        summary = summaries[product_id]
        category_p75 = category_thresholds[summary["category"]]
        slope = slopes[product_id]
        previous = summary["previous9_damage_rate"]
        recent = summary["last3_damage_rate"]
        if not (summary["sales_quantity"] >= category_p75 and slope > 0 and recent > previous):
            continue
        adjusted_p_value = adjusted_p_values[product_id]
        candidates.append(
            {
                **summary,
                "category_sales_p75": category_p75,
                "theil_sen_slope": slope,
                "raw_p_value": raw_p_values[product_id],
                "bh_q_value": adjusted_p_value,
                "status": "PRIORITY" if adjusted_p_value <= alpha else "WATCHLIST",
                "product_count": len(product_ids),
                "candidate_count": 0,
                "category_sales_percentile": percentile,
                "selection_rule": "SALES_GTE_P75_AND_SLOPE_GT_0_AND_LAST3_GT_PREVIOUS9",
            }
        )
    for candidate in candidates:
        candidate["candidate_count"] = len(candidates)
    return OperatorExecutionResult(
        output={"products": candidates},
        sample_size=len(inventory_rows),
        group_count=len(product_ids),
        family_size=len(product_ids),
        applicability="ASSUMPTION_BOUND",
        limitation_codes=(
            "DESCRIPTIVE_SCREENING_NOT_CAUSAL",
            "INPUT_SERIES_MUST_COVER_ALL_PRODUCTS",
        ),
    )


__all__ = ["inventory_damage_priority"]
