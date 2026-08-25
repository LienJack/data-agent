from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta

import pytest

import data_agent_stats.marketing as marketing_module
from data_agent_stats.manifest import OPERATOR_BY_ID, input_records_match_manifest
from data_agent_stats.marketing import marketing_lag_priority
from data_agent_stats.multiple_testing import bh_fdr as actual_bh_fdr
from data_agent_stats.registry import StatisticalOperatorError

_OUTCOMES = ("order_revenue", "new_customers", "order_count")


def _coefficient(
    label: str, term: str, *, coefficient: float, p_value: float, sample_size: int, rank: int
) -> dict[str, object]:
    return {
        "label": label,
        "term": term,
        "coefficient": coefficient,
        "standard_error": 0.25,
        "statistic": coefficient / 0.25,
        "p_value": p_value,
        "sample_size": sample_size,
        "rank": rank,
        "maxlags": 4,
        "kernel": "bartlett",
        "use_correction": True,
        "use_t": False,
    }


def _inputs() -> dict[str, list[dict[str, object]]]:
    marketing_rows: list[dict[str, object]] = []
    coefficients: list[dict[str, object]] = []
    for group_index, (channel, audience) in enumerate(
        (("channel_a", "audience_a"), ("channel_b", "audience_b"))
    ):
        for week in range(79):
            marketing_rows.append(
                {
                    "week_start": (date(2023, 5, 1) + timedelta(weeks=week)).isoformat(),
                    "channel": channel,
                    "target_audience": audience,
                    "impressions": 100.0 + group_index,
                    "clicks": 10.0,
                    "conversions": 2.0,
                    "campaign_revenue": 30.0,
                    "spend": 20.0,
                }
            )
        spend_label = f"{channel}|{audience}|spend_over_week"
        for term in ("intercept", "week_index", "sin_annual", "cos_annual"):
            coefficients.append(
                _coefficient(
                    spend_label,
                    term,
                    coefficient=(1.0 if group_index == 0 else -1.0)
                    if term == "week_index"
                    else 0.0,
                    p_value=0.5,
                    sample_size=79,
                    rank=4,
                )
            )
        for outcome in _OUTCOMES:
            for lag in range(5):
                label = f"{channel}|{audience}|{outcome}|lag{lag}"
                for term in ("intercept", "spend", "week_index", "sin_annual", "cos_annual"):
                    coefficients.append(
                        _coefficient(
                            label,
                            term,
                            coefficient=2.0 if term == "spend" and group_index == 0 else 0.0,
                            p_value=(0.01 if group_index == 0 and lag == 2 else 0.5)
                            if term == "spend"
                            else 0.9,
                            sample_size=79 - lag,
                            rank=5,
                        )
                    )
    return {"marketing_rows": marketing_rows, "hac_coefficients": coefficients}


def test_marketing_priority_composes_unique_bh_and_returns_complete_groups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[dict[str, object]]] = []

    def tracked_bh(inputs: dict[str, object], parameters: dict[str, object]):
        calls.append(inputs["tests"])  # type: ignore[arg-type]
        return actual_bh_fdr(inputs, parameters)

    monkeypatch.setattr(marketing_module, "bh_fdr", tracked_bh)
    result = marketing_lag_priority(_inputs(), {"alpha": 0.05})

    assert len(calls) == 3
    assert all(len(family) == 2 for family in calls)
    assert result.sample_size == 158
    assert result.group_count == 2
    assert result.family_size == 6
    groups = result.output["channel_audience_results"]
    assert [group["channel"] for group in groups] == ["channel_a", "channel_b"]
    assert groups[0]["group_finding"] == "GROWTH_ASSOCIATION"
    assert groups[1]["group_finding"] == "NO_CLEAR_ASSOCIATION"
    assert [item["metric"] for item in groups[0]["business_outcomes"]] == list(_OUTCOMES)
    assert all(item["selected_lag_weeks"] == 2 for item in groups[0]["business_outcomes"])
    assert all(item["bh_q_value"] == pytest.approx(0.02) for item in groups[0]["business_outcomes"])
    assert groups[0]["click_through_rate"] == pytest.approx(0.1)
    assert groups[0]["conversion_rate"] == pytest.approx(0.2)
    assert groups[0]["roas"] == pytest.approx(1.5)


def test_marketing_priority_is_input_order_invariant() -> None:
    inputs = _inputs()
    reverse = {key: list(reversed(rows)) for key, rows in inputs.items()}

    assert (
        marketing_lag_priority(inputs, {"alpha": 0.05}).output
        == marketing_lag_priority(reverse, {"alpha": 0.05}).output
    )


def test_marketing_priority_manifest_accepts_exact_protected_inputs() -> None:
    inputs = _inputs()
    descriptor = OPERATOR_BY_ID["descriptive.marketing-lag-priority@1"]

    for specification in descriptor["inputs"]:
        assert input_records_match_manifest(specification, inputs[specification["name"]])

    projected = deepcopy(inputs["hac_coefficients"])
    projected[0] = {"label": projected[0]["label"], "term": projected[0]["term"]}
    coefficients = next(item for item in descriptor["inputs"] if item["name"] == "hac_coefficients")
    assert not input_records_match_manifest(coefficients, projected)


@pytest.mark.parametrize("mutation", ["missing_week", "non_monday", "missing_coefficient"])
def test_marketing_priority_rejects_incomplete_authority_closure(mutation: str) -> None:
    inputs = deepcopy(_inputs())
    if mutation == "missing_week":
        inputs["marketing_rows"].pop()
    elif mutation == "non_monday":
        inputs["marketing_rows"][0]["week_start"] = "2023-05-02"
    else:
        inputs["hac_coefficients"].pop()

    with pytest.raises(StatisticalOperatorError):
        marketing_lag_priority(inputs, {"alpha": 0.05})
