from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
import statsmodels.api as sm
from statsmodels.tools.sm_exceptions import PerfectSeparationError, PerfectSeparationWarning

from data_agent_sandbox.python_runtime.operators.registry import (
    OperatorExecutionResult,
    StatisticalOperatorError,
)

MAX_MODEL_ROWS = 100_000
MAX_PREDICTORS = 64


def _label(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return value


def _finite_vector(value: Any) -> np.ndarray:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_MODEL_ROWS:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    if any(
        isinstance(item, bool)
        or not isinstance(item, (int, float))
        or not math.isfinite(float(item))
        for item in value
    ):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return np.asarray(value, dtype=np.float64)


def _strict_order(value: Any, expected_length: int) -> None:
    if not isinstance(value, list) or len(value) != expected_length:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    if not value:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    if all(
        isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(float(item))
        for item in value
    ):
        normalized: list[float] | list[str] = [float(item) for item in value]
    elif all(isinstance(item, str) and bool(item) for item in value):
        normalized = value
    else:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    if any(right <= left for left, right in zip(normalized, normalized[1:], strict=False)):
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")


def _design(
    outcome: Any, predictors: Any, *, add_intercept: bool
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    y = _finite_vector(outcome)
    if not isinstance(predictors, dict) or not 1 <= len(predictors) <= MAX_PREDICTORS:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    if any(
        not isinstance(term, str) or not term or len(term) > 128 or term == "const"
        for term in predictors
    ):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    terms = sorted(predictors)
    columns = [_finite_vector(predictors[term]) for term in terms]
    if any(len(column) != len(y) for column in columns):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    matrix = np.column_stack(columns)
    if add_intercept:
        matrix = np.column_stack((np.ones(len(y), dtype=np.float64), matrix))
        terms.insert(0, "const")
    if not np.isfinite(matrix).all():
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return y, np.asarray(matrix, dtype=np.float64), terms


def _validated_rank(matrix: np.ndarray) -> int:
    sample_size, column_count = matrix.shape
    rank = int(np.linalg.matrix_rank(matrix))
    if sample_size <= column_count or rank != column_count:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    return rank


def _finite_fit_vectors(*vectors: Any) -> tuple[np.ndarray, ...]:
    normalized = tuple(np.asarray(vector, dtype=np.float64) for vector in vectors)
    if any(not np.isfinite(vector).all() for vector in normalized):
        raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    return normalized


def ols_hac(inputs: dict[str, Any], parameters: dict[str, Any]) -> OperatorExecutionResult:
    """OLS coefficients with an explicit statsmodels Newey-West HAC covariance."""

    if parameters.get("kernel") != "bartlett":
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    models = inputs["models"]
    if not models:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    rows: list[dict[str, Any]] = []
    labels: set[str] = set()
    total_sample_size = 0
    ranks: list[int] = []
    maxlags = int(parameters["maxlags"])
    use_correction = bool(parameters["use_correction"])
    use_t = bool(parameters["use_t"])
    add_intercept = bool(parameters["add_intercept"])
    for model in models:
        label = _label(model["label"])
        if label in labels:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        labels.add(label)
        y, matrix, terms = _design(
            model["outcome"], model["predictors"], add_intercept=add_intercept
        )
        _strict_order(model["row_order"], len(y))
        rank = _validated_rank(matrix)
        if maxlags >= len(y):
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        try:
            fit = sm.OLS(y, matrix, hasconst=add_intercept).fit(
                cov_type="HAC",
                cov_kwds={
                    "maxlags": maxlags,
                    "kernel": "bartlett",
                    "use_correction": use_correction,
                },
                use_t=use_t,
            )
        except (ValueError, np.linalg.LinAlgError) as error:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE") from error
        coefficients, standard_errors, statistics, p_values = _finite_fit_vectors(
            fit.params, fit.bse, fit.tvalues, fit.pvalues
        )
        for term, coefficient, standard_error, statistic, p_value in zip(
            terms,
            coefficients,
            standard_errors,
            statistics,
            p_values,
            strict=True,
        ):
            rows.append(
                {
                    "label": label,
                    "term": term,
                    "coefficient": float(coefficient),
                    "standard_error": float(standard_error),
                    "statistic": float(statistic),
                    "p_value": float(p_value),
                    "sample_size": len(y),
                    "rank": rank,
                    "maxlags": maxlags,
                    "kernel": "bartlett",
                    "use_correction": use_correction,
                    "use_t": use_t,
                }
            )
        total_sample_size += len(y)
        ranks.append(rank)
    rows.sort(key=lambda row: (row["label"], row["term"]))
    return OperatorExecutionResult(
        output={"coefficients": rows},
        sample_size=total_sample_size,
        group_count=len(models),
        rank=min(ranks),
        limitation_codes=("ASSOCIATION_NOT_CAUSATION", "ORDERING_DEFINES_HAC_DEPENDENCE"),
    )


def binomial_logit_wald(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Binomial-logit GLM with convergence and two-sided Wald evidence."""

    models = inputs["models"]
    if not models:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    rows: list[dict[str, Any]] = []
    labels: set[str] = set()
    total_sample_size = 0
    ranks: list[int] = []
    add_intercept = bool(parameters["add_intercept"])
    max_iterations = int(parameters["max_iterations"])
    tolerance = float(parameters["tolerance"])
    for model in models:
        label = _label(model["label"])
        if label in labels:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        labels.add(label)
        y, matrix, terms = _design(
            model["outcome"], model["predictors"], add_intercept=add_intercept
        )
        if not set(y.tolist()) <= {0.0, 1.0} or len(set(y.tolist())) != 2:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        rank = _validated_rank(matrix)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", PerfectSeparationWarning)
                fit = sm.GLM(y, matrix, family=sm.families.Binomial()).fit(
                    method="irls",
                    maxiter=max_iterations,
                    tol=tolerance,
                    disp=0,
                )
        except (PerfectSeparationError, PerfectSeparationWarning) as error:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD") from error
        except (ValueError, np.linalg.LinAlgError) as error:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE") from error
        if not bool(fit.converged):
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        iterations = fit.fit_history.get("iteration")
        if not isinstance(iterations, int) or iterations < 0:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        coefficients, standard_errors, statistics, p_values = _finite_fit_vectors(
            fit.params, fit.bse, fit.tvalues, fit.pvalues
        )
        for term, coefficient, standard_error, statistic, p_value in zip(
            terms,
            coefficients,
            standard_errors,
            statistics,
            p_values,
            strict=True,
        ):
            rows.append(
                {
                    "label": label,
                    "term": term,
                    "coefficient": float(coefficient),
                    "standard_error": float(standard_error),
                    "wald_z": float(statistic),
                    "p_value": float(p_value),
                    "sample_size": len(y),
                    "rank": rank,
                    "converged": True,
                    "iterations": iterations,
                }
            )
        total_sample_size += len(y)
        ranks.append(rank)
    rows.sort(key=lambda row: (row["label"], row["term"]))
    return OperatorExecutionResult(
        output={"coefficients": rows},
        sample_size=total_sample_size,
        group_count=len(models),
        rank=min(ranks),
        limitation_codes=("ASSOCIATION_NOT_CAUSATION",),
    )


__all__ = ["binomial_logit_wald", "ols_hac"]
