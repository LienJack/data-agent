from __future__ import annotations

import os
import uuid

import psycopg
import pytest
from psycopg import sql

from data_agent_sandbox.protocol.models import (
    FanOutMutation,
    HalfOpenQueryTransformation,
    NullAntiMembershipMutation,
    SameValuedDistinctFactMutation,
)
from data_agent_sandbox.sql.mutations import (
    apply_and_seal_controlled_mutation,
    apply_half_open_query_transformation,
    clone_controlled_fixture,
    verify_expected_insert_delta,
)
from data_agent_sandbox.sql.snapshots import (
    U5_SNAPSHOT_MANIFEST_BUDGET,
    build_controlled_snapshot,
)

ADMIN_DSN = os.getenv("DATA_AGENT_SANDBOX_TEST_ADMIN_DSN")
READER_DSN = os.getenv("DATA_AGENT_SANDBOX_DSN")
MUTATOR_DSN = os.getenv("DATA_AGENT_SANDBOX_MUTATOR_DSN")

pytestmark = pytest.mark.skipif(
    not ADMIN_DSN or not READER_DSN or not MUTATOR_DSN,
    reason="PostgreSQL controlled-mutation DSNs are not configured",
)

SCOPE = {
    "app_id": "00000000-0000-4000-8000-00000000da01",
    "tenant_id": "00000000-0000-4000-8000-00000000aa11",
    "environment": "test",
}
RUN_ID = "00000000-0000-4000-8000-00000000a101"
PRINCIPAL_ID = "00000000-0000-4000-8000-000000001001"
DATASOURCE_ID = "00000000-0000-4000-8000-00000000d101"


async def _rows(conn: psycopg.AsyncConnection, schema_name: str) -> list[dict]:
    cursor = await conn.execute(
        sql.SQL("select pg_catalog.to_jsonb(row_value) from {}.facts as row_value").format(
            sql.Identifier(schema_name)
        )
    )
    return [row[0] for row in await cursor.fetchall()]


async def _snapshot(schema_name: str, snapshot_token: str):
    async with await psycopg.AsyncConnection.connect(READER_DSN) as conn:
        snapshot = await build_controlled_snapshot(
            conn,
            scope=SCOPE,
            run_id=RUN_ID,
            principal_id=PRINCIPAL_ID,
            datasource_id=DATASOURCE_ID,
            snapshot_id=snapshot_token,
            schema_name=schema_name,
            budget=U5_SNAPSHOT_MANIFEST_BUDGET,
        )
        await conn.rollback()
        return snapshot


async def test_three_independent_clones_apply_exact_delta_then_seal() -> None:
    suffix = uuid.uuid4().hex[:10]
    baseline_schema = f"fixture_base_{suffix}"
    follow_up_schemas = {
        "FAN_OUT": f"fixture_fan_{suffix}",
        "NULL_ANTI_MEMBERSHIP": f"fixture_null_{suffix}",
        "SAME_VALUED_DISTINCT_FACT": f"fixture_same_{suffix}",
    }
    all_schemas = [baseline_schema, *follow_up_schemas.values()]
    baseline_token = f"baseline-{suffix}@1.0.0"
    try:
        async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as admin:
            await admin.execute(sql.SQL("create schema {}").format(sql.Identifier(baseline_schema)))
            await admin.execute(
                sql.SQL(
                    """
                    create table {}.facts (
                      row_id text primary key,
                      fact_id text not null,
                      child_id text not null,
                      member_id text,
                      amount_minor integer not null,
                      label text not null
                    )
                    """
                ).format(sql.Identifier(baseline_schema))
            )
            await admin.execute(
                sql.SQL(
                    """
                    insert into {}.facts
                      (row_id, fact_id, child_id, member_id, amount_minor, label)
                    values ('row-1', 'fact-1', 'child-1', 'member-1', 500, 'controlled')
                    """
                ).format(sql.Identifier(baseline_schema))
            )
            for role in ("sandbox_reader", "sandbox_mutator"):
                await admin.execute(
                    sql.SQL("grant usage on schema {} to {}").format(
                        sql.Identifier(baseline_schema),
                        sql.Identifier(role),
                    )
                )
                await admin.execute(
                    sql.SQL("grant select on {}.facts to {}").format(
                        sql.Identifier(baseline_schema),
                        sql.Identifier(role),
                    )
                )
            for schema_name in follow_up_schemas.values():
                await clone_controlled_fixture(
                    admin,
                    baseline_schema=baseline_schema,
                    follow_up_schema=schema_name,
                    relation_name="facts",
                    mutation_role="sandbox_mutator",
                    execution_role="sandbox_reader",
                )

        baseline = await _snapshot(baseline_schema, baseline_token)
        base = {
            "protocol_version": "data-agent-fixture-mutation@1.0.0",
            "scope": SCOPE,
            "run_id": RUN_ID,
            "principal_id": PRINCIPAL_ID,
            "datasource_id": DATASOURCE_ID,
            "baseline_snapshot_id": baseline_token,
            "relation_name": "facts",
        }
        mutations = [
            FanOutMutation.model_validate(
                {
                    **base,
                    "mutation_id": "00000000-0000-4000-8000-00000000f101",
                    "follow_up_snapshot_id": f"fan-{suffix}@1.0.0",
                    "schema_name": follow_up_schemas["FAN_OUT"],
                    "relation_kind": "FAN_OUT",
                    "child_key_column": "child_id",
                    "original_child_key": "child-1",
                    "added_child_key": "child-2",
                    "foreign_key_values": {"fact_id": "fact-1"},
                    "inserted_row": {
                        "row_id": "row-2",
                        "fact_id": "fact-1",
                        "child_id": "child-2",
                        "member_id": "member-2",
                        "amount_minor": 500,
                        "label": "controlled",
                    },
                }
            ),
            NullAntiMembershipMutation.model_validate(
                {
                    **base,
                    "mutation_id": "00000000-0000-4000-8000-00000000f102",
                    "follow_up_snapshot_id": f"null-{suffix}@1.0.0",
                    "schema_name": follow_up_schemas["NULL_ANTI_MEMBERSHIP"],
                    "relation_kind": "NULL_ANTI_MEMBERSHIP",
                    "probe_key_column": "row_id",
                    "probe_key": "row-null",
                    "null_column": "member_id",
                    "inserted_row": {
                        "row_id": "row-null",
                        "fact_id": "fact-null",
                        "child_id": "child-null",
                        "member_id": None,
                        "amount_minor": 500,
                        "label": "controlled",
                    },
                }
            ),
            SameValuedDistinctFactMutation.model_validate(
                {
                    **base,
                    "mutation_id": "00000000-0000-4000-8000-00000000f103",
                    "follow_up_snapshot_id": f"same-{suffix}@1.0.0",
                    "schema_name": follow_up_schemas["SAME_VALUED_DISTINCT_FACT"],
                    "relation_kind": "SAME_VALUED_DISTINCT_FACT",
                    "fact_key_column": "fact_id",
                    "original_fact_key": "fact-1",
                    "added_fact_key": "fact-2",
                    "value_columns": ["amount_minor"],
                    "inserted_row": {
                        "row_id": "row-same",
                        "fact_id": "fact-2",
                        "child_id": "child-same",
                        "member_id": "member-same",
                        "amount_minor": 500,
                        "label": "controlled",
                    },
                }
            ),
        ]

        parents: list[str] = []
        for mutation in mutations:
            async with await psycopg.AsyncConnection.connect(ADMIN_DSN) as authority:
                await apply_and_seal_controlled_mutation(
                    authority,
                    mutation,
                    mutation_role="sandbox_mutator",
                    execution_role="sandbox_reader",
                )
            follow_up = await _snapshot(mutation.schema_name, mutation.follow_up_snapshot_id)
            parents.append(mutation.baseline_snapshot_id)
            assert follow_up.data_manifest_hash != baseline.data_manifest_hash
            async with await psycopg.AsyncConnection.connect(ADMIN_DSN) as admin:
                before = await _rows(admin, baseline_schema)
                after = await _rows(admin, mutation.schema_name)
                verify_expected_insert_delta(before, after, mutation.inserted_row)
                trigger = await admin.execute(
                    """
                    select count(*)
                    from pg_catalog.pg_trigger
                    where tgrelid = %s::regclass and not tgisinternal
                    """,
                    (f"{mutation.schema_name}.facts",),
                )
                assert (await trigger.fetchone())[0] == 1
        assert parents == [baseline_token, baseline_token, baseline_token]

        sealed_schema = mutations[0].schema_name
        for dsn in (READER_DSN, MUTATOR_DSN):
            async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as role_conn:
                with pytest.raises(psycopg.Error):
                    await role_conn.execute(
                        sql.SQL(
                            "insert into {}.facts "
                            "(row_id, fact_id, child_id, amount_minor, label) "
                            "values ('forbidden', 'x', 'x', 1, 'x')"
                        ).format(sql.Identifier(sealed_schema))
                    )

        transformation = HalfOpenQueryTransformation.model_validate(
            {
                "protocol_version": "data-agent-query-transformation@1.0.0",
                "transformation_kind": "HALF_OPEN_ADDITIVE_PARTITION",
                "query": (
                    "select sum(amount_minor) from facts "
                    "where occurred_at >= $1 and occurred_at < $2"
                ),
                "parameters": {
                    "$1": "2026-01-01T00:00:00Z",
                    "$2": "2026-02-01T00:00:00Z",
                },
                "lower_placeholder": "$1",
                "upper_placeholder": "$2",
                "start_at": "2026-01-01T00:00:00Z",
                "midpoint_at": "2026-01-15T00:00:00Z",
                "end_at": "2026-02-01T00:00:00Z",
            }
        )
        assert len(apply_half_open_query_transformation(transformation)) == 3
        baseline_after_query_transform = await _snapshot(baseline_schema, baseline_token)
        assert baseline_after_query_transform.data_manifest_hash == baseline.data_manifest_hash
    finally:
        async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as admin:
            for schema_name in reversed(all_schemas):
                await admin.execute(
                    sql.SQL("drop schema if exists {} cascade").format(sql.Identifier(schema_name))
                )
