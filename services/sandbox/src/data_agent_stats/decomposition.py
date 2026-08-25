from __future__ import annotations

import itertools
import math
from collections import defaultdict
from datetime import date
from typing import Any

from data_agent_stats.registry import (
    OperatorExecutionResult,
    StatisticalOperatorError,
)

MAX_TOTAL_PERMUTATIONS = 250_000


def _finite_factors(value: Any) -> dict[str, float]:
    if not isinstance(value, dict) or not value:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    result: dict[str, float] = {}
    for factor, raw_value in value.items():
        if not isinstance(factor, str) or not factor or len(factor) > 128:
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        if (
            isinstance(raw_value, bool)
            or not isinstance(raw_value, (int, float))
            or not math.isfinite(float(raw_value))
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        result[factor] = float(raw_value)
    return result


def product_shapley_exact(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Exact all-permutation Shapley decomposition for a named product identity."""

    if parameters.get("mode") != "exact":
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    comparisons = inputs["comparisons"]
    if not comparisons:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    max_factors = int(parameters["max_factors"])
    tolerance = float(parameters["closure_tolerance"])
    labels: set[str] = set()
    rows: list[dict[str, Any]] = []
    total_permutations = 0
    for comparison in comparisons:
        label = comparison["label"]
        if not isinstance(label, str) or not label or len(label) > 128:
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        if label in labels:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        labels.add(label)
        baseline = _finite_factors(comparison["baseline_factors"])
        current = _finite_factors(comparison["current_factors"])
        if set(baseline) != set(current) or len(baseline) > max_factors:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        factors = sorted(baseline)
        permutation_count = math.factorial(len(factors))
        total_permutations += permutation_count
        if total_permutations > MAX_TOTAL_PERMUTATIONS:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        marginal_values: dict[str, list[float]] = {factor: [] for factor in factors}
        for permutation in itertools.permutations(factors):
            state = dict(baseline)
            product_before = math.prod(state[factor] for factor in factors)
            for factor in permutation:
                state[factor] = current[factor]
                product_after = math.prod(state[name] for name in factors)
                if not math.isfinite(product_after):
                    raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
                marginal_values[factor].append(product_after - product_before)
                product_before = product_after
        contributions = {
            factor: math.fsum(marginal_values[factor]) / permutation_count for factor in factors
        }
        baseline_product = math.prod(baseline[factor] for factor in factors)
        current_product = math.prod(current[factor] for factor in factors)
        delta = current_product - baseline_product
        closure_error = math.fsum(contributions.values()) - delta
        if any(
            not math.isfinite(value)
            for value in (
                baseline_product,
                current_product,
                delta,
                closure_error,
                *contributions.values(),
            )
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        if abs(closure_error) > tolerance:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        for factor in factors:
            rows.append(
                {
                    "label": label,
                    "factor": factor,
                    "contribution": contributions[factor],
                    "baseline_product": baseline_product,
                    "current_product": current_product,
                    "delta": delta,
                    "closure_error": closure_error,
                    "permutation_count": permutation_count,
                }
            )
    rows.sort(key=lambda row: (row["label"], row["factor"]))
    return OperatorExecutionResult(
        output={"contributions": rows},
        sample_size=len(comparisons),
        group_count=len(comparisons),
        limitation_codes=("APPROXIMATE_MODE_NOT_SUPPORTED", "PRODUCT_IDENTITY_REQUIRED"),
    )


def revenue_segment_drivers(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Select the worst revenue month and preserve each driver dimension's identity."""

    if parameters:
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in inputs["order_items"]:
        try:
            date.fromisoformat(row["order_date"])
        except ValueError as error:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD") from error
        grouped[row["order_id"]].append(row)
    if not grouped:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    orders: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    monthly_revenue: dict[str, list[float]] = defaultdict(list)
    header_fields = (
        "order_date",
        "payment_method",
        "customer_segment",
        "order_total",
    )
    for _order_id, item_rows in grouped.items():
        first = item_rows[0]
        if first is None or any(
            row[field] != first[field] for row in item_rows[1:] for field in header_fields
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        revenue = float(first["order_total"])
        if not math.isfinite(revenue):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        month = first["order_date"][:7]
        monthly_revenue[month].append(revenue)
        orders.append((first, item_rows))

    months = sorted(monthly_revenue)
    if len(months) < 2:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    month_totals = {month: math.fsum(monthly_revenue[month]) for month in months}
    comparisons = [
        (month_totals[current] - month_totals[previous], previous, current)
        for previous, current in zip(months, months[1:], strict=False)
    ]
    _, start_month, end_month = min(comparisons, key=lambda row: (row[0], row[2]))

    changes: dict[str, dict[str, list[float]]] = {
        "customer_segment": defaultdict(list),
        "payment_method": defaultdict(list),
        "product_category": defaultdict(list),
    }

    def add(dimension: str, member: str, month: str, value: float) -> None:
        if month not in {start_month, end_month}:
            return
        changes[dimension][member].append(-value if month == start_month else value)

    for first, item_rows in orders:
        month = first["order_date"][:7]
        revenue = float(first["order_total"])
        add("customer_segment", first["customer_segment"], month, revenue)
        add("payment_method", first["payment_method"], month, revenue)
        category_quantities: dict[str, list[float]] = defaultdict(list)
        for row in item_rows:
            category_quantities[row["product_category"]].append(float(row["quantity"]))
        quantities = {
            category: math.fsum(values) for category, values in category_quantities.items()
        }
        total_quantity = math.fsum(quantities.values())
        for category, quantity in quantities.items():
            share = (
                quantity / total_quantity
                if total_quantity > 0
                else 1.0 / len(category_quantities)
            )
            add("product_category", category, month, revenue * share)

    drivers: list[dict[str, Any]] = []
    for dimension in sorted(changes):
        ranked = sorted(
            (
                (math.fsum(values), member)
                for member, values in changes[dimension].items()
            ),
            key=lambda row: (row[0], row[1]),
        )
        if not ranked:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        revenue_change, member = ranked[0]
        drivers.append(
            {
                "dimension": dimension,
                "member": member,
                "revenue_change": revenue_change,
                "start_month": start_month,
                "end_month": end_month,
            }
        )
    return OperatorExecutionResult(
        output={"drivers": drivers},
        sample_size=len(orders),
        group_count=len(drivers),
        family_size=sum(len(members) for members in changes.values()),
        applicability="PASS",
        limitation_codes=(
            "DESCRIPTIVE_DECOMPOSITION_NOT_CAUSAL",
            "ORDER_TOTAL_ALLOCATED_BY_ITEM_QUANTITY",
        ),
    )


__all__ = ["product_shapley_exact", "revenue_segment_drivers"]
