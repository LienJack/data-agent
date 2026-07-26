from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

import psycopg
from psycopg import sql
from pydantic import BaseModel, ConfigDict

from data_agent_sandbox.protocol.models import (
    FanOutMutation,
    HalfOpenQueryTransformation,
    NullAntiMembershipMutation,
    SameValuedDistinctFactMutation,
)
from data_agent_sandbox.sql.canonical import canonical_json, sha256_content_hash


class QueryVariant(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    variant: Literal["WHOLE", "LEFT", "RIGHT"]
    query: str
    parameters: dict[str, object]
    query_hash: str


ControlledMutation = FanOutMutation | NullAntiMembershipMutation | SameValuedDistinctFactMutation


def verify_expected_insert_delta(
    before: Sequence[Mapping[str, object]],
    after: Sequence[Mapping[str, object]],
    expected_insert: Mapping[str, object],
) -> None:
    expected = sorted([*(canonical_json(row) for row in before), canonical_json(expected_insert)])
    observed = sorted(canonical_json(row) for row in after)
    if observed != expected:
        raise ValueError(
            "snapshot delta must contain the exact expected insert and no other change"
        )


def apply_half_open_query_transformation(
    transformation: HalfOpenQueryTransformation,
) -> tuple[QueryVariant, QueryVariant, QueryVariant]:
    midpoint = transformation.midpoint_at.isoformat().replace("+00:00", "Z")
    variants: list[QueryVariant] = []
    for name, lower, upper in (
        (
            "WHOLE",
            transformation.start_at.isoformat().replace("+00:00", "Z"),
            transformation.end_at.isoformat().replace("+00:00", "Z"),
        ),
        (
            "LEFT",
            transformation.start_at.isoformat().replace("+00:00", "Z"),
            midpoint,
        ),
        (
            "RIGHT",
            midpoint,
            transformation.end_at.isoformat().replace("+00:00", "Z"),
        ),
    ):
        parameters = dict(transformation.parameters)
        parameters[transformation.lower_placeholder] = lower
        parameters[transformation.upper_placeholder] = upper
        query_hash = sha256_content_hash(
            {
                "dialect": "postgresql",
                "parameters": parameters,
                "sql": transformation.query,
            }
        )
        variants.append(
            QueryVariant(
                variant=name,
                query=transformation.query,
                parameters=parameters,
                query_hash=query_hash,
            )
        )
    return tuple(variants)  # type: ignore[return-value]


async def clone_controlled_fixture(
    conn: psycopg.AsyncConnection,
    *,
    baseline_schema: str,
    follow_up_schema: str,
    relation_name: str,
    mutation_role: str,
    execution_role: str,
) -> None:
    """Clone exactly one controlled relation and grant the two bounded roles."""

    await conn.execute(sql.SQL("create schema {}").format(sql.Identifier(follow_up_schema)))
    await conn.execute(
        sql.SQL("create table {}.{} (like {}.{} including all)").format(
            sql.Identifier(follow_up_schema),
            sql.Identifier(relation_name),
            sql.Identifier(baseline_schema),
            sql.Identifier(relation_name),
        )
    )
    await conn.execute(
        sql.SQL("insert into {}.{} select * from {}.{}").format(
            sql.Identifier(follow_up_schema),
            sql.Identifier(relation_name),
            sql.Identifier(baseline_schema),
            sql.Identifier(relation_name),
        )
    )
    for role in (mutation_role, execution_role):
        await conn.execute(
            sql.SQL("grant usage on schema {} to {}").format(
                sql.Identifier(follow_up_schema),
                sql.Identifier(role),
            )
        )
        await conn.execute(
            sql.SQL("grant select on {}.{} to {}").format(
                sql.Identifier(follow_up_schema),
                sql.Identifier(relation_name),
                sql.Identifier(role),
            )
        )
    await conn.execute(
        sql.SQL("grant insert on {}.{} to {}").format(
            sql.Identifier(follow_up_schema),
            sql.Identifier(relation_name),
            sql.Identifier(mutation_role),
        )
    )


async def _relation_rows(
    conn: psycopg.AsyncConnection,
    schema_name: str,
    relation_name: str,
) -> list[dict[str, object]]:
    cursor = await conn.execute(
        sql.SQL("select pg_catalog.to_jsonb(row_value) from {}.{} as row_value").format(
            sql.Identifier(schema_name),
            sql.Identifier(relation_name),
        )
    )
    return [row[0] for row in await cursor.fetchall()]


async def apply_and_seal_controlled_mutation(
    conn: psycopg.AsyncConnection,
    mutation: ControlledMutation,
    *,
    mutation_role: str,
    execution_role: str,
) -> None:
    """Apply an exact insert and seal it in one authority-owned transaction."""

    if conn.autocommit:
        raise ValueError("controlled fixture apply/seal requires a transaction")
    before = await _relation_rows(conn, mutation.schema_name, mutation.relation_name)
    columns = tuple(mutation.inserted_row)
    values = tuple(mutation.inserted_row[column] for column in columns)
    try:
        await conn.execute(sql.SQL("set local role {}").format(sql.Identifier(mutation_role)))
        await conn.execute(
            sql.SQL("insert into {}.{} ({}) values ({})").format(
                sql.Identifier(mutation.schema_name),
                sql.Identifier(mutation.relation_name),
                sql.SQL(", ").join(sql.Identifier(column) for column in columns),
                sql.SQL(", ").join(sql.Placeholder() for _ in columns),
            ),
            values,
        )
        after = await _relation_rows(conn, mutation.schema_name, mutation.relation_name)
        verify_expected_insert_delta(before, after, mutation.inserted_row)
        await conn.execute("reset role")
        for role in (mutation_role, execution_role):
            await conn.execute(
                sql.SQL("revoke insert, update, delete, truncate on {}.{} from {}").format(
                    sql.Identifier(mutation.schema_name),
                    sql.Identifier(mutation.relation_name),
                    sql.Identifier(role),
                )
            )
        function_name = f"reject_{mutation.relation_name}_dml"
        trigger_name = f"immutable_{mutation.relation_name}"
        await conn.execute(
            sql.SQL(
                """
                create function {}.{}() returns trigger
                language plpgsql
                as 'begin raise exception ''controlled fixture is immutable''; end'
                """
            ).format(
                sql.Identifier(mutation.schema_name),
                sql.Identifier(function_name),
            )
        )
        await conn.execute(
            sql.SQL(
                """
                create trigger {}
                before insert or update or delete or truncate on {}.{}
                for each statement execute function {}.{}()
                """
            ).format(
                sql.Identifier(trigger_name),
                sql.Identifier(mutation.schema_name),
                sql.Identifier(mutation.relation_name),
                sql.Identifier(mutation.schema_name),
                sql.Identifier(function_name),
            )
        )
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
