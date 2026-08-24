from __future__ import annotations

import itertools
import math
from typing import Any

from data_agent_sandbox.python_runtime.operators.registry import (
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


__all__ = ["product_shapley_exact"]
