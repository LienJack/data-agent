from __future__ import annotations

import math
from typing import Any

from scipy import stats

from data_agent_sandbox.python_runtime.operators.registry import (
    OperatorExecutionResult,
    StatisticalOperatorError,
)


def bh_fdr(inputs: dict[str, Any], parameters: dict[str, Any]) -> OperatorExecutionResult:
    """Adjust one explicitly declared labeled family with Benjamini-Hochberg FDR."""

    if parameters.get("method") != "bh":
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    tests = inputs["tests"]
    if not tests:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    labels: list[str] = []
    p_values: list[float] = []
    for row in tests:
        label = row["label"]
        p_value = row["p_value"]
        if not isinstance(label, str) or not label or len(label) > 128:
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        if (
            isinstance(p_value, bool)
            or not isinstance(p_value, (int, float))
            or not math.isfinite(float(p_value))
            or not 0 <= float(p_value) <= 1
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        labels.append(label)
        p_values.append(float(p_value))
    if len(set(labels)) != len(labels):
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    adjusted = stats.false_discovery_control(p_values, method="bh")
    alpha = float(parameters["alpha"])
    by_label = {
        label: {
            "label": label,
            "adjusted_p_value": float(value),
            "rejected": bool(value <= alpha),
            "family_size": len(labels),
            "alpha": alpha,
            "method": "bh",
        }
        for label, value in zip(labels, adjusted, strict=True)
    }
    return OperatorExecutionResult(
        output={"tests": [by_label[label] for label in sorted(by_label)]},
        sample_size=len(labels),
        family_size=len(labels),
        applicability="ASSUMPTION_BOUND",
        limitation_codes=(
            "DEPENDENCE_STRUCTURE_NOT_VERIFIED",
            "FAMILY_DEFINITION_MUST_BE_PREDECLARED",
        ),
    )


__all__ = ["bh_fdr"]
