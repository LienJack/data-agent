from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from data_agent_stats.multiple_testing import bh_fdr
from data_agent_stats.registry import OperatorExecutionResult, StatisticalOperatorError

_BUSINESS_OUTCOMES = ("order_revenue", "new_customers", "order_count")
_WEEK_COUNT = 79


def _week_key(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD") from error
    if parsed.weekday() != 0:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    return parsed


def _finite(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return number


def _coefficient_index(rows: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    indexed: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["label"], row["term"])
        if key in indexed:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        if (
            int(row["maxlags"]) != 4
            or row["kernel"] != "bartlett"
            or row["use_correction"] is not True
            or row["use_t"] is not False
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        indexed[key] = row
    return indexed


def marketing_lag_priority(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Select governed lag evidence, reuse the sole BH implementation and classify groups."""

    alpha = float(parameters["alpha"])
    by_group: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in inputs["marketing_rows"]:
        channel = row["channel"]
        audience = row["target_audience"]
        if "|" in channel or "|" in audience:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        by_group[(channel, audience)].append(row)
    if not by_group:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    expected_weeks = tuple(
        date(2023, 5, 1) + timedelta(weeks=index) for index in range(_WEEK_COUNT)
    )
    summaries: dict[tuple[str, str], dict[str, Any]] = {}
    for key, rows in by_group.items():
        ordered = sorted(rows, key=lambda row: _week_key(row["week_start"]))
        weeks = tuple(_week_key(row["week_start"]) for row in ordered)
        if weeks != expected_weeks:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        impressions = math.fsum(_finite(row["impressions"]) for row in ordered)
        clicks = math.fsum(_finite(row["clicks"]) for row in ordered)
        conversions = math.fsum(_finite(row["conversions"]) for row in ordered)
        spend = math.fsum(_finite(row["spend"]) for row in ordered)
        revenue = math.fsum(_finite(row["campaign_revenue"]) for row in ordered)
        summaries[key] = {
            "channel": key[0],
            "target_audience": key[1],
            "impressions": impressions,
            "clicks": clicks,
            "conversions": conversions,
            "spend": spend,
            "revenue_generated": revenue,
            "click_through_rate": 0.0 if impressions == 0 else clicks / impressions,
            "conversion_rate": 0.0 if clicks == 0 else conversions / clicks,
            "roas": 0.0 if spend == 0 else revenue / spend,
        }

    coefficients = _coefficient_index(inputs["hac_coefficients"])
    expected_coefficient_keys: set[tuple[str, str]] = set()
    for channel, audience in summaries:
        spend_label = f"{channel}|{audience}|spend_over_week"
        for term in ("intercept", "week_index", "sine", "cosine"):
            expected_coefficient_keys.add((spend_label, term))
        for outcome in _BUSINESS_OUTCOMES:
            for lag in range(5):
                lag_label = f"{channel}|{audience}|{outcome}|lag{lag}"
                for term in ("intercept", "spend", "week_index", "sine", "cosine"):
                    expected_coefficient_keys.add((lag_label, term))
    if set(coefficients) != expected_coefficient_keys:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")

    selected: dict[tuple[str, str, str], dict[str, Any]] = {}
    spend_slopes: dict[tuple[str, str], float] = {}
    for channel, audience in summaries:
        spend_label = f"{channel}|{audience}|spend_over_week"
        spend_row = coefficients.get((spend_label, "week_index"))
        if spend_row is None:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        if int(spend_row["sample_size"]) != _WEEK_COUNT or int(spend_row["rank"]) != 4:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        spend_slopes[(channel, audience)] = _finite(spend_row["coefficient"])
        for outcome in _BUSINESS_OUTCOMES:
            candidates: list[dict[str, Any]] = []
            for lag in range(5):
                label = f"{channel}|{audience}|{outcome}|lag{lag}"
                row = coefficients.get((label, "spend"))
                if row is None:
                    raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
                if int(row["sample_size"]) != _WEEK_COUNT - lag or int(row["rank"]) != 5:
                    raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
                candidates.append(
                    {
                        "label": label,
                        "lag": lag,
                        "coefficient": _finite(row["coefficient"]),
                        "p_value": _finite(row["p_value"]),
                    }
                )
            selected[(channel, audience, outcome)] = min(
                candidates, key=lambda item: (item["p_value"], item["lag"])
            )

    adjusted_by_outcome: dict[str, dict[str, dict[str, Any]]] = {}
    fdr_tests: list[dict[str, Any]] = []
    for outcome in _BUSINESS_OUTCOMES:
        family = [
            {
                "label": f"{channel}|{audience}",
                "p_value": selected[(channel, audience, outcome)]["p_value"],
            }
            for channel, audience in sorted(summaries)
        ]
        adjusted = bh_fdr({"tests": family}, {"alpha": alpha, "method": "bh"}).output["tests"]
        adjusted_by_outcome[outcome] = {row["label"]: row for row in adjusted}
        fdr_tests.extend({"outcome": outcome, **row} for row in adjusted)

    results: list[dict[str, Any]] = []
    for channel, audience in sorted(summaries):
        label = f"{channel}|{audience}"
        spend_growth = spend_slopes[(channel, audience)] > 0
        business_outcomes: list[dict[str, Any]] = []
        for outcome in _BUSINESS_OUTCOMES:
            statistic = selected[(channel, audience, outcome)]
            adjusted = adjusted_by_outcome[outcome].get(label)
            if adjusted is None:
                raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
            q_value = _finite(adjusted["adjusted_p_value"])
            finding = (
                "GROWTH_ASSOCIATION"
                if statistic["coefficient"] > 0 and q_value <= alpha
                else "SPEND_WITHOUT_IMPROVEMENT"
                if spend_growth
                else "NO_CLEAR_ASSOCIATION"
            )
            business_outcomes.append(
                {
                    "metric": outcome,
                    "selected_lag_weeks": statistic["lag"],
                    "lag_coefficient": statistic["coefficient"],
                    "hac_p_value": statistic["p_value"],
                    "bh_q_value": q_value,
                    "finding": finding,
                }
            )
        group_finding = (
            "GROWTH_ASSOCIATION"
            if any(item["finding"] == "GROWTH_ASSOCIATION" for item in business_outcomes)
            else "SPEND_WITHOUT_IMPROVEMENT"
            if spend_growth
            else "NO_CLEAR_ASSOCIATION"
        )
        results.append(
            {
                **summaries[(channel, audience)],
                "business_outcomes": business_outcomes,
                "group_finding": group_finding,
            }
        )

    return OperatorExecutionResult(
        output={"channel_audience_results": results, "fdr_tests": fdr_tests},
        sample_size=len(inputs["marketing_rows"]),
        group_count=len(results),
        family_size=len(results) * len(_BUSINESS_OUTCOMES),
        applicability="ASSUMPTION_BOUND",
        limitation_codes=(
            "ASSOCIATION_NOT_CAUSATION",
            "BH_FDR_COMPOSED_FROM_UNIQUE_OPERATOR",
            "ORDERING_DEFINES_HAC_DEPENDENCE",
        ),
    )


__all__ = ["marketing_lag_priority"]
