from __future__ import annotations

import math
from bisect import bisect_left
from collections import Counter
from typing import Any

from scipy import stats

from data_agent_stats.registry import (
    OperatorExecutionResult,
    StatisticalOperatorError,
)

MAX_THEIL_SEN_POINTS = 512
MAX_MANN_KENDALL_POINTS = 5000


def _label(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return value


def _finite_vector(value: Any, *, minimum: int, maximum: int) -> list[float]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    result: list[float] = []
    for item in value:
        if (
            isinstance(item, bool)
            or not isinstance(item, (int, float))
            or not math.isfinite(float(item))
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        result.append(float(item))
    return result


def theil_sen_slope(inputs: dict[str, Any], parameters: dict[str, Any]) -> OperatorExecutionResult:
    """Return only the exact all-pairs Theil-Sen slope for each labeled series."""

    if parameters:
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    rows: list[dict[str, Any]] = []
    labels: set[str] = set()
    total_points = 0
    for series in inputs["series"]:
        label = _label(series["label"])
        if label in labels:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        labels.add(label)
        x = _finite_vector(series["x"], minimum=2, maximum=MAX_THEIL_SEN_POINTS)
        y = _finite_vector(series["y"], minimum=2, maximum=MAX_THEIL_SEN_POINTS)
        if len(x) != len(y):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        if any(right <= left for left, right in zip(x, x[1:], strict=False)):
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        estimate = stats.theilslopes(y, x, method="separate")
        slope = float(estimate.slope)
        if not math.isfinite(slope):
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        sample_size = len(x)
        pair_count = sample_size * (sample_size - 1) // 2
        rows.append(
            {
                "label": label,
                "slope": slope,
                "sample_size": sample_size,
                "pair_count": pair_count,
            }
        )
        total_points += sample_size
    if not rows:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    rows.sort(key=lambda row: row["label"])
    return OperatorExecutionResult(
        output={"series": rows},
        sample_size=total_points,
        group_count=len(rows),
        limitation_codes=("SLOPE_UNIT_DEPENDS_ON_DECLARED_X_SCALE",),
    )


def _validate_order(value: Any, expected_length: int) -> None:
    if not isinstance(value, list) or len(value) != expected_length:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    if not value:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    first = value[0]
    numeric = isinstance(first, (int, float)) and not isinstance(first, bool)
    textual = isinstance(first, str) and bool(first)
    if not numeric and not textual:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    normalized: list[float] | list[str]
    if numeric:
        normalized = []
        for item in value:
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or not math.isfinite(float(item))
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
            normalized.append(float(item))
    else:
        if any(not isinstance(item, str) or not item for item in value):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        normalized = value
    if any(right <= left for left, right in zip(normalized, normalized[1:], strict=False)):
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")


def _mann_kendall_s(values: list[float]) -> int:
    unique = sorted(set(values))
    tree = [0] * (len(unique) + 1)

    def prefix(index: int) -> int:
        total = 0
        while index > 0:
            total += tree[index]
            index -= index & -index
        return total

    def insert(index: int) -> None:
        while index < len(tree):
            tree[index] += 1
            index += index & -index

    statistic = 0
    for seen, value in enumerate(values):
        rank = bisect_left(unique, value) + 1
        less = prefix(rank - 1)
        less_or_equal = prefix(rank)
        statistic += less - (seen - less_or_equal)
        insert(rank)
    return statistic


def mann_kendall_original(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Original Mann-Kendall with exact ties and optional continuity correction."""

    if parameters.get("variant") != "original":
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    rows: list[dict[str, Any]] = []
    labels: set[str] = set()
    total_points = 0
    alpha = float(parameters["alpha"])
    correction = bool(parameters["continuity_correction"])
    for series in inputs["series"]:
        label = _label(series["label"])
        if label in labels:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        labels.add(label)
        values = _finite_vector(series["value"], minimum=3, maximum=MAX_MANN_KENDALL_POINTS)
        _validate_order(series["order"], len(values))
        sample_size = len(values)
        statistic = _mann_kendall_s(values)
        tie_sizes = [count for count in Counter(values).values() if count > 1]
        tie_term = sum(size * (size - 1) * (2 * size + 5) for size in tie_sizes)
        variance = (sample_size * (sample_size - 1) * (2 * sample_size + 5) - tie_term) / 18.0
        if statistic == 0 or variance <= 0:
            z_value = 0.0
            p_value = 1.0
        else:
            adjusted_s = statistic
            if correction:
                adjusted_s = statistic - 1 if statistic > 0 else statistic + 1
            z_value = adjusted_s / math.sqrt(variance)
            p_value = math.erfc(abs(z_value) / math.sqrt(2.0))
        pair_count = sample_size * (sample_size - 1) // 2
        tau = statistic / pair_count
        rejected = p_value <= alpha
        trend = (
            "INCREASING" if rejected and statistic > 0 else "DECREASING" if rejected else "NO_TREND"
        )
        rows.append(
            {
                "label": label,
                "s": statistic,
                "variance_s": variance,
                "z": z_value,
                "p_value": p_value,
                "tau": tau,
                "trend": trend,
                "rejected": rejected,
                "sample_size": sample_size,
                "tie_group_count": len(tie_sizes),
                "alpha": alpha,
                "variant": "original",
            }
        )
        total_points += sample_size
    if not rows:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    rows.sort(key=lambda row: row["label"])
    return OperatorExecutionResult(
        output={"series": rows},
        sample_size=total_points,
        group_count=len(rows),
        applicability="ASSUMPTION_BOUND",
        limitation_codes=(
            "SEASONALITY_NOT_CORRECTED",
            "SERIAL_CORRELATION_NOT_CORRECTED",
        ),
    )


__all__ = ["mann_kendall_original", "theil_sen_slope"]
