from __future__ import annotations

import math
import random
import statistics

import pytest

from data_agent_stats.registry import StatisticalOperatorError
from data_agent_stats.robust_trend import (
    mann_kendall_original,
    theil_sen_slope,
)


def _theil(label: str, x: list[float], y: list[float]) -> dict[str, object]:
    result = theil_sen_slope(
        {"series": [{"label": label, "x": x, "y": y}]},
        {},
    )
    return result.output["series"][0]


def _manual_slope(x: list[float], y: list[float]) -> float:
    return statistics.median(
        (y[right] - y[left]) / (x[right] - x[left])
        for left in range(len(x))
        for right in range(left + 1, len(x))
    )


@pytest.mark.parametrize(
    ("x", "y"),
    [
        ([0, 1, 2], [1, 4, 5]),
        ([0, 1, 2, 3], [0, 2, 3, 8]),
    ],
)
def test_theil_sen_uses_exact_all_pair_median_for_odd_and_even_counts(
    x: list[float], y: list[float]
) -> None:
    row = _theil("series", x, y)

    assert row["slope"] == pytest.approx(_manual_slope(x, y), abs=1e-15)
    assert row["pair_count"] == len(x) * (len(x) - 1) // 2
    assert set(row) == {"label", "slope", "sample_size", "pair_count"}


def test_theil_sen_transformations_and_outlier_robustness_are_explicit() -> None:
    x = [0, 1, 2, 3, 4]
    y = [1, 3, 5, 7, 100]
    base = _theil("base", x, y)
    shifted = _theil("shifted", [value + 10 for value in x], y)
    scaled = _theil("scaled", [value * 86_400 for value in x], y)

    assert base["slope"] == pytest.approx(2.0)
    assert shifted["slope"] == pytest.approx(base["slope"])
    assert scaled["slope"] == pytest.approx(float(base["slope"]) / 86_400)


@pytest.mark.parametrize(
    ("x", "y"),
    [
        ([0], [1]),
        ([0, 0], [1, 2]),
        ([1, 0], [1, 2]),
        ([0, 1], [1, math.inf]),
    ],
)
def test_theil_sen_rejects_unusable_series(x: list[float], y: list[float]) -> None:
    with pytest.raises(StatisticalOperatorError):
        _theil("series", x, y)


def _manual_mk(values: list[float], *, correction: bool) -> tuple[int, float, float, float]:
    statistic = sum(
        (values[right] > values[left]) - (values[right] < values[left])
        for left in range(len(values))
        for right in range(left + 1, len(values))
    )
    tie_sizes = [values.count(value) for value in set(values) if values.count(value) > 1]
    sample_size = len(values)
    variance = (
        sample_size * (sample_size - 1) * (2 * sample_size + 5)
        - sum(size * (size - 1) * (2 * size + 5) for size in tie_sizes)
    ) / 18
    if statistic == 0 or variance <= 0:
        return statistic, variance, 0.0, 1.0
    adjusted = statistic - 1 if correction and statistic > 0 else statistic
    adjusted = statistic + 1 if correction and statistic < 0 else adjusted
    z_value = adjusted / math.sqrt(variance)
    return statistic, variance, z_value, math.erfc(abs(z_value) / math.sqrt(2))


def _mk(values: list[float], *, correction: bool = True) -> tuple[dict[str, object], object]:
    result = mann_kendall_original(
        {
            "series": [
                {
                    "label": "series",
                    "order": list(range(len(values))),
                    "value": values,
                }
            ]
        },
        {"alpha": 0.05, "continuity_correction": correction, "variant": "original"},
    )
    return result.output["series"][0], result


def test_mann_kendall_matches_independent_tie_corrected_oracle() -> None:
    values = [1, 2, 2, 4, 3, 5]
    row, result = _mk(values)
    statistic, variance, z_value, p_value = _manual_mk(values, correction=True)

    assert row["s"] == statistic
    assert row["variance_s"] == pytest.approx(variance)
    assert row["z"] == pytest.approx(z_value)
    assert row["p_value"] == pytest.approx(p_value)
    assert row["tau"] == pytest.approx(statistic / 15)
    assert row["tie_group_count"] == 1
    assert result.applicability == "ASSUMPTION_BOUND"
    assert set(result.limitation_codes) == {
        "SERIAL_CORRELATION_NOT_CORRECTED",
        "SEASONALITY_NOT_CORRECTED",
    }


def test_mann_kendall_continuity_setting_changes_inference_but_not_s_or_tau() -> None:
    corrected, _ = _mk([1, 3, 2, 4, 5], correction=True)
    uncorrected, _ = _mk([1, 3, 2, 4, 5], correction=False)

    assert corrected["s"] == uncorrected["s"]
    assert corrected["tau"] == uncorrected["tau"]
    assert corrected["z"] != uncorrected["z"]
    assert corrected["p_value"] != uncorrected["p_value"]


def test_mann_kendall_constant_series_has_stable_degenerate_result() -> None:
    row, _ = _mk([2, 2, 2, 2])

    assert row["s"] == 0
    assert row["variance_s"] == 0
    assert row["z"] == 0
    assert row["p_value"] == 1
    assert row["tau"] == 0
    assert row["trend"] == "NO_TREND"


def test_mann_kendall_rejects_duplicate_or_nonmonotonic_order() -> None:
    for order in ([0, 0, 1], [0, 2, 1]):
        with pytest.raises(StatisticalOperatorError):
            mann_kendall_original(
                {"series": [{"label": "series", "order": order, "value": [1, 2, 3]}]},
                {"alpha": 0.05, "continuity_correction": True, "variant": "original"},
            )


def test_mann_kendall_fast_statistic_matches_pairwise_property_vectors() -> None:
    generator = random.Random(20260824)
    for sample_size in range(3, 25):
        values = [float(generator.randrange(0, 7)) for _ in range(sample_size)]
        row, _ = _mk(values)
        statistic, variance, z_value, p_value = _manual_mk(values, correction=True)
        assert row["s"] == statistic
        assert row["variance_s"] == pytest.approx(variance)
        assert row["z"] == pytest.approx(z_value)
        assert row["p_value"] == pytest.approx(p_value)
