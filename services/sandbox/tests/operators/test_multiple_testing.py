from __future__ import annotations

import math

import pytest

from data_agent_sandbox.python_runtime.operators.multiple_testing import bh_fdr
from data_agent_sandbox.python_runtime.operators.registry import StatisticalOperatorError


def _manual_bh(values: dict[str, float]) -> dict[str, float]:
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 1.0
    family_size = len(ordered)
    for rank in range(family_size, 0, -1):
        label, p_value = ordered[rank - 1]
        running = min(running, p_value * family_size / rank)
        adjusted[label] = running
    return adjusted


def test_bh_fdr_matches_independent_vector_and_is_permutation_invariant() -> None:
    values = {"d": 0.2, "a": 0.01, "c": 0.04, "b": 0.04}
    parameters = {"alpha": 0.05, "method": "bh"}
    forward = bh_fdr(
        {"tests": [{"label": label, "p_value": value} for label, value in values.items()]},
        parameters,
    )
    reverse = bh_fdr(
        {
            "tests": [
                {"label": label, "p_value": value}
                for label, value in reversed(tuple(values.items()))
            ]
        },
        parameters,
    )

    expected = _manual_bh(values)
    assert forward.output == reverse.output
    assert [row["label"] for row in forward.output["tests"]] == sorted(values)
    for row in forward.output["tests"]:
        assert row["adjusted_p_value"] == pytest.approx(expected[row["label"]], abs=1e-15)
        assert row["rejected"] is (expected[row["label"]] <= 0.05)
        assert row["family_size"] == 4
    assert forward.family_size == 4
    assert forward.applicability == "ASSUMPTION_BOUND"
    assert set(forward.limitation_codes) == {
        "DEPENDENCE_STRUCTURE_NOT_VERIFIED",
        "FAMILY_DEFINITION_MUST_BE_PREDECLARED",
    }


@pytest.mark.parametrize(
    "tests",
    [
        [],
        [{"label": "a", "p_value": 0.1}, {"label": "a", "p_value": 0.2}],
        [{"label": "a", "p_value": -0.1}],
        [{"label": "a", "p_value": 1.1}],
        [{"label": "a", "p_value": math.nan}],
    ],
)
def test_bh_fdr_rejects_invalid_or_ambiguous_families(tests: list[dict[str, object]]) -> None:
    with pytest.raises(StatisticalOperatorError):
        bh_fdr({"tests": tests}, {"alpha": 0.05, "method": "bh"})


def test_splitting_a_family_is_detectably_not_equivalent() -> None:
    values = [0.01, 0.03, 0.04, 0.2]
    whole = bh_fdr(
        {"tests": [{"label": str(index), "p_value": value} for index, value in enumerate(values)]},
        {"alpha": 0.05, "method": "bh"},
    )
    split = []
    for start in (0, 2):
        result = bh_fdr(
            {
                "tests": [
                    {"label": str(index), "p_value": values[index]}
                    for index in range(start, start + 2)
                ]
            },
            {"alpha": 0.05, "method": "bh"},
        )
        split.extend(result.output["tests"])

    assert {row["label"]: row["adjusted_p_value"] for row in whole.output["tests"]} != {
        row["label"]: row["adjusted_p_value"] for row in split
    }


def test_bh_adjusted_values_are_bounded_and_monotone_in_p_order() -> None:
    values = {"a": 0.001, "b": 0.02, "c": 0.02, "d": 0.5, "e": 1.0}
    result = bh_fdr(
        {"tests": [{"label": label, "p_value": value} for label, value in values.items()]},
        {"alpha": 0.05, "method": "bh"},
    )
    adjusted = {row["label"]: row["adjusted_p_value"] for row in result.output["tests"]}
    ordered = sorted(values, key=lambda label: (values[label], label))

    assert all(values[label] <= adjusted[label] <= 1 for label in values)
    assert all(
        adjusted[left] <= adjusted[right] for left, right in zip(ordered, ordered[1:], strict=False)
    )
