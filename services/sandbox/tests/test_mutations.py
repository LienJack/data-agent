from __future__ import annotations

import pytest
from pydantic import ValidationError

from data_agent_sandbox.protocol.models import (
    FanOutMutation,
    HalfOpenQueryTransformation,
    NullAntiMembershipMutation,
    SameValuedDistinctFactMutation,
)
from data_agent_sandbox.sql.mutations import (
    apply_half_open_query_transformation,
    verify_expected_insert_delta,
)

BASE = {
    "protocol_version": "data-agent-fixture-mutation@1.0.0",
    "mutation_id": "00000000-0000-4000-8000-00000000f101",
    "scope": {
        "app_id": "00000000-0000-4000-8000-00000000da01",
        "tenant_id": "00000000-0000-4000-8000-00000000aa11",
        "environment": "test",
    },
    "run_id": "00000000-0000-4000-8000-00000000a101",
    "principal_id": "00000000-0000-4000-8000-000000001001",
    "datasource_id": "00000000-0000-4000-8000-00000000d101",
    "baseline_snapshot_id": "baseline@1.0.0",
    "follow_up_snapshot_id": "follow-up@1.0.0",
    "schema_name": "follow_up_snapshot",
    "relation_name": "facts",
}


def test_fan_out_protocol_binds_the_added_child_row() -> None:
    mutation = FanOutMutation.model_validate(
        {
            **BASE,
            "relation_kind": "FAN_OUT",
            "child_key_column": "child_id",
            "original_child_key": "child-1",
            "added_child_key": "child-2",
            "foreign_key_values": {"fact_id": "fact-1"},
            "inserted_row": {
                "child_id": "child-2",
                "fact_id": "fact-1",
                "label": "controlled",
            },
        }
    )
    verify_expected_insert_delta(
        [{"child_id": "child-1", "fact_id": "fact-1", "label": "controlled"}],
        [
            {"child_id": "child-1", "fact_id": "fact-1", "label": "controlled"},
            mutation.inserted_row,
        ],
        mutation.inserted_row,
    )


def test_mutation_principal_is_a_contract_string_not_a_uuid() -> None:
    mutation = FanOutMutation.model_validate(
        {
            **BASE,
            "principal_id": "principal:fixture-writer",
            "relation_kind": "FAN_OUT",
            "child_key_column": "child_id",
            "original_child_key": "child-1",
            "added_child_key": "child-2",
            "foreign_key_values": {"fact_id": "fact-1"},
            "inserted_row": {
                "child_id": "child-2",
                "fact_id": "fact-1",
            },
        }
    )

    assert mutation.principal_id == "principal:fixture-writer"


def test_null_anti_membership_requires_the_declared_null() -> None:
    with pytest.raises(ValidationError, match="null_column"):
        NullAntiMembershipMutation.model_validate(
            {
                **BASE,
                "relation_kind": "NULL_ANTI_MEMBERSHIP",
                "probe_key_column": "row_id",
                "probe_key": "row-null",
                "null_column": "member_id",
                "inserted_row": {"row_id": "row-null", "member_id": "not-null"},
            }
        )


def test_same_valued_fact_requires_a_distinct_key_and_declared_value_columns() -> None:
    mutation = SameValuedDistinctFactMutation.model_validate(
        {
            **BASE,
            "relation_kind": "SAME_VALUED_DISTINCT_FACT",
            "fact_key_column": "fact_id",
            "original_fact_key": "fact-1",
            "added_fact_key": "fact-2",
            "value_columns": ["amount_minor"],
            "inserted_row": {"fact_id": "fact-2", "amount_minor": 500},
        }
    )
    assert mutation.inserted_row["fact_id"] == "fact-2"


def test_snapshot_delta_rejects_any_change_beyond_the_expected_insert() -> None:
    before = [{"id": 1, "amount": 10}]
    after = [{"id": 1, "amount": 11}, {"id": 2, "amount": 10}]

    with pytest.raises(ValueError, match="exact expected insert"):
        verify_expected_insert_delta(before, after, {"id": 2, "amount": 10})


def test_half_open_is_a_query_transformation_not_a_data_mutation() -> None:
    transformation = HalfOpenQueryTransformation.model_validate(
        {
            "protocol_version": "data-agent-query-transformation@1.0.0",
            "transformation_kind": "HALF_OPEN_ADDITIVE_PARTITION",
            "query": (
                "select sum(amount_minor) from facts where occurred_at >= $1 and occurred_at < $2"
            ),
            "parameters": {"$1": "2026-01-01T00:00:00Z", "$2": "2026-02-01T00:00:00Z"},
            "lower_placeholder": "$1",
            "upper_placeholder": "$2",
            "start_at": "2026-01-01T00:00:00Z",
            "midpoint_at": "2026-01-15T00:00:00Z",
            "end_at": "2026-02-01T00:00:00Z",
        }
    )
    variants = apply_half_open_query_transformation(transformation)

    assert [variant.variant for variant in variants] == ["WHOLE", "LEFT", "RIGHT"]
    assert variants[0].parameters == {
        "$1": "2026-01-01T00:00:00Z",
        "$2": "2026-02-01T00:00:00Z",
    }
    assert variants[1].parameters["$2"] == "2026-01-15T00:00:00Z"
    assert variants[2].parameters["$1"] == "2026-01-15T00:00:00Z"
    assert len({variant.query_hash for variant in variants}) == 3
