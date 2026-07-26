from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql

from data_agent_sandbox.protocol.models import (
    ControlledRevisionSnapshot,
    NoneSnapshot,
    RelationManifestEntry,
    Scope,
    SnapshotDescriptor,
    relation_data_manifest_hash,
    relation_schema_manifest_hash,
)
from data_agent_sandbox.sql.canonical import canonical_json, sha256_content_hash


@dataclass(frozen=True, slots=True)
class SnapshotManifestBudget:
    """Independent, versioned ceiling for a controlled fixture manifest scan."""

    max_relations: int
    max_columns_per_relation: int
    max_rows: int
    max_bytes: int
    fetch_size: int

    def __post_init__(self) -> None:
        if (
            min(
                self.max_relations,
                self.max_columns_per_relation,
                self.max_rows,
                self.max_bytes,
                self.fetch_size,
            )
            <= 0
        ):
            raise ValueError("snapshot manifest budget values must be positive")


U5_SNAPSHOT_MANIFEST_BUDGET = SnapshotManifestBudget(
    max_relations=256,
    max_columns_per_relation=256,
    max_rows=10_000,
    max_bytes=67_108_864,
    fetch_size=32,
)


class SnapshotManifestBudgetExceeded(RuntimeError):
    def __init__(self, reason_code: str, message: str) -> None:
        super().__init__(message)
        self.reason_code = reason_code


@dataclass(slots=True)
class _SnapshotManifestUsage:
    rows: int = 0
    bytes: int = 0


class SnapshotAuthorityBreach(RuntimeError):
    pass


async def _relations(
    conn: psycopg.AsyncConnection[Any],
    schema_name: str,
    budget: SnapshotManifestBudget,
) -> list[tuple[int, str]]:
    cursor = await conn.execute(
        """
        select c.oid::integer, c.relname
        from pg_catalog.pg_class as c
        join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = %s
          and c.relkind in ('r', 'p')
        order by c.relname
        limit %s
        """,
        (schema_name, budget.max_relations + 1),
    )
    rows = await cursor.fetchall()
    if len(rows) > budget.max_relations:
        raise SnapshotManifestBudgetExceeded(
            "SANDBOX_ROW_LIMIT_EXCEEDED",
            "controlled snapshot relation count exceeds the manifest budget",
        )
    return [(int(row[0]), str(row[1])) for row in rows]


async def _schema_hash(
    conn: psycopg.AsyncConnection[Any],
    relation_oid: int,
    budget: SnapshotManifestBudget,
) -> str:
    cursor = await conn.execute(
        """
        select
          a.attnum,
          a.attname,
          pg_catalog.format_type(a.atttypid, a.atttypmod),
          a.attnotnull,
          a.attidentity,
          a.attgenerated,
          pg_catalog.pg_get_expr(d.adbin, d.adrelid)
        from pg_catalog.pg_attribute as a
        left join pg_catalog.pg_attrdef as d
          on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = %s
          and a.attnum > 0
          and not a.attisdropped
        order by a.attnum
        limit %s
        """,
        (relation_oid, budget.max_columns_per_relation + 1),
    )
    rows = await cursor.fetchall()
    if len(rows) > budget.max_columns_per_relation:
        raise SnapshotManifestBudgetExceeded(
            "SANDBOX_COLUMN_LIMIT_EXCEEDED",
            "controlled snapshot column count exceeds the manifest budget",
        )
    columns = [
        {
            "position": int(row[0]),
            "name": str(row[1]),
            "type": str(row[2]),
            "not_null": bool(row[3]),
            "identity": str(row[4]),
            "generated": str(row[5]),
            "default": None if row[6] is None else str(row[6]),
        }
        for row in rows
    ]
    return sha256_content_hash(columns)


async def _data_hash(
    conn: psycopg.AsyncConnection[Any],
    relation_oid: int,
    schema_name: str,
    relation_name: str,
    budget: SnapshotManifestBudget,
    usage: _SnapshotManifestUsage,
) -> str:
    canonical_rows: list[str] = []
    # Every relation data hash includes the JCS array brackets even when the
    # relation is empty. Account for them before retaining any row material.
    if usage.bytes + 2 > budget.max_bytes:
        raise SnapshotManifestBudgetExceeded(
            "SANDBOX_BYTE_LIMIT_EXCEEDED",
            "controlled snapshot bytes exceed the manifest budget",
        )
    usage.bytes += 2
    cursor = conn.cursor(
        name=f"data_agent_manifest_{relation_oid}",
        scrollable=False,
        withhold=False,
    )
    try:
        await cursor.execute(
            sql.SQL("select pg_catalog.to_jsonb(row_value) from {}.{} as row_value").format(
                sql.Identifier(schema_name),
                sql.Identifier(relation_name),
            )
        )
        while True:
            rows = await cursor.fetchmany(budget.fetch_size)
            if not rows:
                break
            for row in rows:
                canonical_row = canonical_json(row[0])
                prospective_rows = usage.rows + 1
                # Count the exact JCS string representation retained for the
                # multiset digest and the comma preceding every non-first row.
                prospective_bytes = (
                    usage.bytes
                    + len(canonical_json(canonical_row).encode())
                    + (1 if canonical_rows else 0)
                )
                if prospective_rows > budget.max_rows:
                    raise SnapshotManifestBudgetExceeded(
                        "SANDBOX_ROW_LIMIT_EXCEEDED",
                        "controlled snapshot rows exceed the manifest budget",
                    )
                if prospective_bytes > budget.max_bytes:
                    raise SnapshotManifestBudgetExceeded(
                        "SANDBOX_BYTE_LIMIT_EXCEEDED",
                        "controlled snapshot bytes exceed the manifest budget",
                    )
                usage.rows = prospective_rows
                usage.bytes = prospective_bytes
                canonical_rows.append(canonical_row)
    finally:
        await cursor.close()
    return sha256_content_hash(sorted(canonical_rows))


async def build_controlled_snapshot(
    conn: psycopg.AsyncConnection[Any],
    *,
    scope: Scope | dict[str, object],
    run_id: str,
    principal_id: str,
    datasource_id: str,
    snapshot_id: str,
    schema_name: str,
    budget: SnapshotManifestBudget,
) -> ControlledRevisionSnapshot:
    entries: list[RelationManifestEntry] = []
    usage = _SnapshotManifestUsage()
    for relation_oid, relation_name in await _relations(conn, schema_name, budget):
        entries.append(
            RelationManifestEntry(
                schema_name=schema_name,
                relation_name=relation_name,
                relation_oid=relation_oid,
                schema_hash=await _schema_hash(conn, relation_oid, budget),
                data_hash=await _data_hash(
                    conn,
                    relation_oid,
                    schema_name,
                    relation_name,
                    budget,
                    usage,
                ),
            )
        )
    raw_entries = [entry.model_dump(mode="json") for entry in entries]
    schema_manifest_hash = relation_schema_manifest_hash(raw_entries)
    data_manifest_hash = relation_data_manifest_hash(raw_entries)
    return ControlledRevisionSnapshot.model_validate(
        {
            "strategy": "CONTROLLED_REVISION",
            "scope": scope,
            "run_id": run_id,
            "principal_id": principal_id,
            "datasource_id": datasource_id,
            "snapshot_token": snapshot_id,
            "schema_name": schema_name,
            "schema_manifest_hash": schema_manifest_hash,
            "data_manifest_hash": data_manifest_hash,
            "fixture_manifest_hash": sha256_content_hash(
                {
                    "data_manifest_hash": data_manifest_hash,
                    "schema_manifest_hash": schema_manifest_hash,
                }
            ),
            "relations": raw_entries,
        }
    )


async def validate_and_lock_snapshot(
    conn: psycopg.AsyncConnection[Any],
    snapshot: SnapshotDescriptor,
    *,
    budget: SnapshotManifestBudget,
) -> list[int]:
    if isinstance(snapshot, NoneSnapshot):
        return []

    actual_relations = await _relations(conn, snapshot.schema_name, budget)
    expected_relations = [(entry.relation_oid, entry.relation_name) for entry in snapshot.relations]
    if actual_relations != expected_relations:
        raise SnapshotAuthorityBreach(
            "controlled snapshot relation names or OIDs no longer match the descriptor"
        )

    for entry in snapshot.relations:
        await conn.execute(
            sql.SQL("lock table {}.{} in access share mode").format(
                sql.Identifier(entry.schema_name),
                sql.Identifier(entry.relation_name),
            )
        )

    observed = await build_controlled_snapshot(
        conn,
        scope=snapshot.scope,
        run_id=snapshot.run_id,
        principal_id=snapshot.principal_id,
        datasource_id=snapshot.datasource_id,
        snapshot_id=snapshot.snapshot_token,
        schema_name=snapshot.schema_name,
        budget=budget,
    )
    if observed != snapshot:
        raise SnapshotAuthorityBreach(
            "controlled snapshot full schema/data manifest no longer matches"
        )
    return [entry.relation_oid for entry in snapshot.relations]
