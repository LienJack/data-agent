from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any

from data_agent_sandbox.python_runtime.operators.registry import (
    OperatorExecutionResult,
    StatisticalOperatorError,
)

_MONTH = re.compile(r"^(?P<year>[1-9][0-9]{3})-(?P<month>0[1-9]|1[0-2])$")


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return value


def _month_index(value: Any) -> int:
    if not isinstance(value, str):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    matched = _MONTH.fullmatch(value)
    if matched is None:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return int(matched.group("year")) * 12 + int(matched.group("month")) - 1


def _finite_nonnegative(value: Any) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or float(value) < 0
    ):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return float(value)


def _optional_measure(value: Any, *, minimum: float, maximum: float | None = None) -> float | None:
    if value is None:
        return None
    result = _finite_nonnegative(value)
    if result < minimum or (maximum is not None and result > maximum):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return result


def registration_retention_m0_m6(
    inputs: dict[str, Any], parameters: dict[str, Any]
) -> OperatorExecutionResult:
    """Registration-cohort M0-M6 grid with primary HOLD and sensitivity semantics."""

    customers = inputs["customers"]
    events = inputs["events"]
    observation = inputs["observation"]
    if not customers or not isinstance(observation, list) or len(observation) != 1:
        raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
    observation_end_month = observation[0].get("observation_end_month")
    observation_end = _month_index(observation_end_month)
    policy = parameters["pre_registration_policy"]
    if (
        parameters.get("horizon_months") != 6
        or parameters.get("duplicate_customer_policy") != "reject"
        or policy not in {"hold_primary", "exclude_sensitivity"}
    ):
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")

    customer_by_id: dict[str, tuple[str, int, str]] = {}
    cohort_members: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in customers:
        customer_id = _identifier(row["customer_id"])
        registration_month = row["registration_month"]
        registration_index = _month_index(registration_month)
        customer_type = _identifier(row["customer_type"])
        if customer_id in customer_by_id:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        if registration_index + 6 > observation_end:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        customer_by_id[customer_id] = (
            registration_month,
            registration_index,
            customer_type,
        )
        cohort_members[(registration_month, customer_type)].add(customer_id)

    normalized_events: list[dict[str, Any]] = []
    order_ids: set[str] = set()
    invalid_timeline_customers: set[str] = set()
    pre_registration_order_ids: set[str] = set()
    orphan_order_ids: set[str] = set()
    for row in events:
        customer_id = _identifier(row["customer_id"])
        order_id = _identifier(row["order_id"])
        if order_id in order_ids:
            raise StatisticalOperatorError("PYTHON_OPERATOR_APPLICABILITY_HOLD")
        order_ids.add(order_id)
        event_month = row["event_month"]
        event_index = _month_index(event_month)
        if event_index > observation_end:
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
        event = {
            "customer_id": customer_id,
            "event_index": event_index,
            "order_id": order_id,
            "revenue": _finite_nonnegative(row["revenue"]),
            "delivery_minutes": _optional_measure(row["delivery_minutes"], minimum=0),
            "rating": _optional_measure(row["rating"], minimum=1, maximum=5),
        }
        normalized_events.append(event)
        customer = customer_by_id.get(customer_id)
        if customer is None:
            orphan_order_ids.add(order_id)
        elif event_index < customer[1]:
            invalid_timeline_customers.add(customer_id)
            pre_registration_order_ids.add(order_id)

    excluded_customers = invalid_timeline_customers if policy == "exclude_sensitivity" else set()
    events_by_group_period: dict[tuple[str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for event in normalized_events:
        customer = customer_by_id.get(event["customer_id"])
        if customer is None or event["customer_id"] in excluded_customers:
            continue
        registration_month, registration_index, customer_type = customer
        month_offset = event["event_index"] - registration_index
        if 0 <= month_offset <= 6:
            events_by_group_period[(registration_month, customer_type, month_offset)].append(event)

    pre_registration_count = len(pre_registration_order_ids)
    orphan_count = len(orphan_order_ids)
    if policy == "hold_primary":
        if pre_registration_count and orphan_count:
            data_quality_status = "HOLD_TEMPORAL_AND_RELATIONSHIP_ANOMALIES"
        elif pre_registration_count:
            data_quality_status = "HOLD_PRE_REGISTRATION_EVENTS"
        elif orphan_count:
            data_quality_status = "HOLD_ORPHAN_EVENTS"
        else:
            data_quality_status = "PASS"
    else:
        data_quality_status = (
            "SENSITIVITY_WITH_DISCLOSED_ANOMALIES"
            if (pre_registration_count or orphan_count)
            else "SENSITIVITY"
        )

    output_rows: list[dict[str, Any]] = []
    for registration_month, customer_type in sorted(cohort_members):
        original_members = cohort_members[(registration_month, customer_type)]
        eligible_members = original_members - excluded_customers
        for month_offset in range(7):
            period_events = events_by_group_period.get(
                (registration_month, customer_type, month_offset), []
            )
            active_customers = {event["customer_id"] for event in period_events}
            orders_by_customer: dict[str, int] = defaultdict(int)
            for event in period_events:
                orders_by_customer[event["customer_id"]] += 1
            repeat_customers = sum(count >= 2 for count in orders_by_customer.values())
            delivery_values = [
                event["delivery_minutes"]
                for event in period_events
                if event["delivery_minutes"] is not None
            ]
            rating_values = [
                event["rating"] for event in period_events if event["rating"] is not None
            ]
            eligible_count = len(eligible_members)
            period_revenue = math.fsum(event["revenue"] for event in period_events)
            output_rows.append(
                {
                    "registration_month": registration_month,
                    "customer_type": customer_type,
                    "month_index": month_offset,
                    "eligible_customers": eligible_count,
                    "active_customers": len(active_customers),
                    "retention_rate": (
                        len(active_customers) / eligible_count if eligible_count else 0.0
                    ),
                    "repeat_customers": repeat_customers,
                    "repeat_purchase_rate": (
                        repeat_customers / eligible_count if eligible_count else 0.0
                    ),
                    "order_count": len(period_events),
                    "revenue": period_revenue,
                    "average_spend": (
                        period_revenue / len(active_customers) if active_customers else None
                    ),
                    "average_delivery_minutes": (
                        math.fsum(delivery_values) / len(delivery_values)
                        if delivery_values
                        else None
                    ),
                    "average_rating": (
                        math.fsum(rating_values) / len(rating_values) if rating_values else None
                    ),
                    "cohort_size": len(original_members),
                    "matured": True,
                    "pre_registration_event_count": pre_registration_count,
                    "orphan_event_count": orphan_count,
                    "data_quality_status": data_quality_status,
                }
            )

    limitation_codes: list[str] = []
    if policy == "hold_primary" and pre_registration_count:
        limitation_codes.append("PRIMARY_HOLD_ON_PRE_REGISTRATION_EVENTS")
    if policy == "exclude_sensitivity":
        limitation_codes.append("SENSITIVITY_MUST_RETAIN_QUALITY_COUNTS")
    if orphan_count:
        limitation_codes.append("ORPHAN_EVENTS_EXCLUDED")
    return OperatorExecutionResult(
        output={"cohort_periods": output_rows},
        sample_size=len(customers) + len(events),
        group_count=len(cohort_members),
        limitation_codes=tuple(limitation_codes),
    )


__all__ = ["registration_retention_m0_m6"]
