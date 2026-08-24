from __future__ import annotations

import math

import numpy as np
import pytest
import statsmodels.api as sm

from data_agent_sandbox.python_runtime.operators.registry import StatisticalOperatorError
from data_agent_sandbox.python_runtime.operators.regression import (
    binomial_logit_wald,
    ols_hac,
)


def _ols_parameters(**updates: object) -> dict[str, object]:
    parameters: dict[str, object] = {
        "maxlags": 3,
        "kernel": "bartlett",
        "use_correction": True,
        "use_t": False,
        "add_intercept": True,
    }
    parameters.update(updates)
    return parameters


def _ols_model() -> dict[str, object]:
    x = np.arange(30, dtype=float)
    return {
        "label": "growth",
        "row_order": x.tolist(),
        "outcome": (2.0 + 0.5 * x + np.sin(x / 2)).tolist(),
        "predictors": {"spend": x.tolist()},
    }


def test_ols_hac_matches_frozen_statsmodels_configuration() -> None:
    model = _ols_model()
    result = ols_hac({"models": [model]}, _ols_parameters())
    rows = {row["term"]: row for row in result.output["coefficients"]}

    x = np.asarray(model["predictors"]["spend"], dtype=float)  # type: ignore[index]
    y = np.asarray(model["outcome"], dtype=float)
    expected = sm.OLS(y, np.column_stack((np.ones(len(x)), x)), hasconst=True).fit(
        cov_type="HAC",
        cov_kwds={"maxlags": 3, "kernel": "bartlett", "use_correction": True},
        use_t=False,
    )
    for index, term in enumerate(("const", "spend")):
        assert rows[term]["coefficient"] == pytest.approx(expected.params[index], abs=1e-12)
        assert rows[term]["standard_error"] == pytest.approx(expected.bse[index], abs=1e-12)
        assert rows[term]["statistic"] == pytest.approx(expected.tvalues[index], abs=1e-12)
        assert rows[term]["p_value"] == pytest.approx(expected.pvalues[index], abs=1e-12)
        assert rows[term]["maxlags"] == 3
        assert rows[term]["kernel"] == "bartlett"
        assert rows[term]["use_t"] is False
    assert result.rank == 2
    assert result.limitation_codes == (
        "ASSOCIATION_NOT_CAUSATION",
        "ORDERING_DEFINES_HAC_DEPENDENCE",
    )


def test_ols_hac_options_materially_change_standard_error() -> None:
    model = _ols_model()
    corrected = ols_hac({"models": [model]}, _ols_parameters())
    uncorrected = ols_hac({"models": [model]}, _ols_parameters(maxlags=0, use_correction=False))
    corrected_spend = corrected.output["coefficients"][1]
    uncorrected_spend = uncorrected.output["coefficients"][1]

    assert corrected_spend["coefficient"] == pytest.approx(uncorrected_spend["coefficient"])
    assert corrected_spend["standard_error"] != uncorrected_spend["standard_error"]


@pytest.mark.parametrize(
    "mutation",
    ["duplicate_order", "rank_deficient", "insufficient_sample", "maxlags"],
)
def test_ols_hac_holds_when_applicability_is_not_met(mutation: str) -> None:
    model = _ols_model()
    parameters = _ols_parameters()
    if mutation == "duplicate_order":
        model["row_order"] = [0] * 30
    elif mutation == "rank_deficient":
        model["predictors"] = {
            "spend": list(range(30)),
            "spend_copy": list(range(30)),
        }
    elif mutation == "insufficient_sample":
        model = {
            "label": "tiny",
            "row_order": [0, 1],
            "outcome": [1, 2],
            "predictors": {"x": [0, 1]},
        }
    else:
        parameters["maxlags"] = 30

    with pytest.raises(StatisticalOperatorError) as captured:
        ols_hac({"models": [model]}, parameters)
    assert captured.value.failure_code == "PYTHON_OPERATOR_APPLICABILITY_HOLD"


def _logit_parameters(**updates: object) -> dict[str, object]:
    parameters: dict[str, object] = {
        "add_intercept": True,
        "max_iterations": 100,
        "tolerance": 1e-8,
    }
    parameters.update(updates)
    return parameters


def _logit_model() -> dict[str, object]:
    return {
        "label": "delivery",
        "outcome": [0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1],
        "predictors": {
            "amount": [1, 2, 1, 3, 2, 4, 2, 5, 3, 4, 6, 5],
            "delayed": [0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0],
        },
    }


def test_binomial_logit_wald_matches_direct_glm_and_column_permutation() -> None:
    model = _logit_model()
    result = binomial_logit_wald({"models": [model]}, _logit_parameters())
    permuted_model = dict(model)
    permuted_model["predictors"] = {
        "delayed": model["predictors"]["delayed"],  # type: ignore[index]
        "amount": model["predictors"]["amount"],  # type: ignore[index]
    }
    permuted = binomial_logit_wald({"models": [permuted_model]}, _logit_parameters())

    assert result.output == permuted.output
    rows = {row["term"]: row for row in result.output["coefficients"]}
    amount = np.asarray(model["predictors"]["amount"], dtype=float)  # type: ignore[index]
    delayed = np.asarray(model["predictors"]["delayed"], dtype=float)  # type: ignore[index]
    design = np.column_stack((np.ones(len(amount)), amount, delayed))
    expected = sm.GLM(
        np.asarray(model["outcome"], dtype=float),
        design,
        family=sm.families.Binomial(),
    ).fit(method="irls", maxiter=100, tol=1e-8, disp=0)
    for index, term in enumerate(("const", "amount", "delayed")):
        assert rows[term]["coefficient"] == pytest.approx(expected.params[index], abs=1e-12)
        assert rows[term]["standard_error"] == pytest.approx(expected.bse[index], abs=1e-12)
        assert rows[term]["wald_z"] == pytest.approx(expected.tvalues[index], abs=1e-12)
        assert rows[term]["p_value"] == pytest.approx(expected.pvalues[index], abs=1e-12)
        assert rows[term]["converged"] is True
    assert result.rank == 3
    assert result.limitation_codes == ("ASSOCIATION_NOT_CAUSATION",)


@pytest.mark.parametrize("mutation", ["one_class", "separation", "rank", "nonconvergence"])
def test_binomial_logit_holds_on_invalid_statistical_conditions(mutation: str) -> None:
    model = _logit_model()
    parameters = _logit_parameters()
    if mutation == "one_class":
        model["outcome"] = [0] * 12
    elif mutation == "separation":
        model = {
            "label": "separated",
            "outcome": [0, 0, 0, 1, 1, 1],
            "predictors": {"x": [-3, -2, -1, 1, 2, 3]},
        }
    elif mutation == "rank":
        model["predictors"] = {
            "amount": list(range(12)),
            "amount_copy": list(range(12)),
        }
    else:
        parameters["max_iterations"] = 1

    with pytest.raises(StatisticalOperatorError) as captured:
        binomial_logit_wald({"models": [model]}, parameters)
    assert captured.value.failure_code == "PYTHON_OPERATOR_APPLICABILITY_HOLD"


def test_regressions_reject_nonfinite_values_without_coercion() -> None:
    model = _ols_model()
    model["outcome"] = [math.nan] + list(range(1, 30))

    with pytest.raises(StatisticalOperatorError) as captured:
        ols_hac({"models": [model]}, _ols_parameters())
    assert captured.value.failure_code == "PYTHON_OPERATOR_INPUT_INVALID"
