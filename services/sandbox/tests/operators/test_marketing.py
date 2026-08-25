from __future__ import annotations

import math
from copy import deepcopy
from datetime import date, timedelta

import pytest

import data_agent_stats.marketing as marketing_module
from data_agent_stats.manifest import OPERATOR_BY_ID, input_records_match_manifest
from data_agent_stats.marketing import marketing_lag_priority
from data_agent_stats.multiple_testing import bh_fdr as actual_bh_fdr
from data_agent_stats.registry import StatisticalOperatorError
from data_agent_stats.regression import ols_hac as actual_ols_hac

_OUTCOMES = ("order_revenue", "new_customers", "order_count")


def _inputs() -> dict[str, list[dict[str, object]]]:
    spend_by_group = {
        ("channel_a", "audience_a"): [
            20.0 + 0.2 * week + 2.0 * (week % 7) + math.sin(week / 3) for week in range(79)
        ],
        ("channel_b", "audience_b"): [
            25.0 + 0.3 * week + 1.5 * ((week * 3) % 11) + math.cos(week / 4) for week in range(79)
        ],
    }
    primary_spend = spend_by_group[("channel_a", "audience_a")]
    marketing_rows: list[dict[str, object]] = []
    for group_index, ((channel, audience), spend_series) in enumerate(spend_by_group.items()):
        for week in range(79):
            lagged_spend = primary_spend[max(0, week - 2)]
            marketing_rows.append(
                {
                    "week_start": (date(2023, 5, 1) + timedelta(weeks=week)).isoformat(),
                    "channel": channel,
                    "target_audience": audience,
                    "impressions": 100.0 + group_index + week,
                    "clicks": 10.0 + week / 10,
                    "conversions": 2.0 + week / 100,
                    "campaign_revenue": 30.0 + week,
                    "spend": spend_series[week],
                    "order_revenue": 1000.0 + 8.0 * lagged_spend + 3.0 * week,
                    "new_customers": 20.0 + 0.2 * lagged_spend + 0.1 * week,
                    "order_count": 40.0 + 0.3 * lagged_spend + 0.2 * week,
                }
            )
    return {"marketing_rows": marketing_rows}


def test_marketing_priority_composes_unique_hac_and_bh_and_returns_complete_groups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hac_calls: list[list[dict[str, object]]] = []
    bh_calls: list[list[dict[str, object]]] = []

    def tracked_hac(inputs: dict[str, object], parameters: dict[str, object]):
        hac_calls.append(inputs["models"])  # type: ignore[arg-type]
        return actual_ols_hac(inputs, parameters)

    def tracked_bh(inputs: dict[str, object], parameters: dict[str, object]):
        bh_calls.append(inputs["tests"])  # type: ignore[arg-type]
        return actual_bh_fdr(inputs, parameters)

    monkeypatch.setattr(marketing_module, "ols_hac", tracked_hac)
    monkeypatch.setattr(marketing_module, "bh_fdr", tracked_bh)
    result = marketing_lag_priority(_inputs(), {"alpha": 0.05})

    assert len(hac_calls) == 1
    assert len(hac_calls[0]) == 32
    assert len(bh_calls) == 3
    assert all(len(family) == 2 for family in bh_calls)
    assert result.sample_size == 158
    assert result.group_count == 2
    assert result.family_size == 6
    assert result.output["hac_summary"] == {
        "operator_id": "regression.ols-hac@1",
        "model_count": 32,
        "coefficient_count": 158,
        "maxlags": 4,
        "kernel": "bartlett",
        "use_correction": True,
        "use_t": False,
    }
    groups = result.output["channel_audience_results"]
    assert [group["channel"] for group in groups] == ["channel_a", "channel_b"]
    assert [item["metric"] for item in groups[0]["business_outcomes"]] == list(_OUTCOMES)
    assert all(0 <= item["selected_lag_weeks"] <= 4 for item in groups[0]["business_outcomes"])
    assert all(0 <= item["bh_q_value"] <= 1 for item in groups[0]["business_outcomes"])
    assert groups[0]["click_through_rate"] == pytest.approx(
        groups[0]["clicks"] / groups[0]["impressions"]
    )
    assert groups[0]["conversion_rate"] == pytest.approx(
        groups[0]["conversions"] / groups[0]["clicks"]
    )
    assert groups[0]["roas"] == pytest.approx(groups[0]["revenue_generated"] / groups[0]["spend"])


def test_marketing_priority_is_input_order_invariant() -> None:
    inputs = _inputs()
    reverse = {"marketing_rows": list(reversed(inputs["marketing_rows"]))}

    assert (
        marketing_lag_priority(inputs, {"alpha": 0.05}).output
        == marketing_lag_priority(reverse, {"alpha": 0.05}).output
    )


def test_marketing_priority_manifest_accepts_exact_raw_rows() -> None:
    inputs = _inputs()
    descriptor = OPERATOR_BY_ID["descriptive.marketing-lag-priority@1"]

    assert len(descriptor["inputs"]) == 1
    assert input_records_match_manifest(descriptor["inputs"][0], inputs["marketing_rows"])

    projected = deepcopy(inputs["marketing_rows"])
    projected[0].pop("order_revenue")
    assert not input_records_match_manifest(descriptor["inputs"][0], projected)


@pytest.mark.parametrize("mutation", ["missing_week", "non_monday", "business_conflict"])
def test_marketing_priority_rejects_incomplete_authority_closure(mutation: str) -> None:
    inputs = deepcopy(_inputs())
    if mutation == "missing_week":
        inputs["marketing_rows"].pop()
    elif mutation == "non_monday":
        inputs["marketing_rows"][0]["week_start"] = "2023-05-02"
    else:
        inputs["marketing_rows"][-1]["order_revenue"] += 1.0

    with pytest.raises(StatisticalOperatorError):
        marketing_lag_priority(inputs, {"alpha": 0.05})
