from __future__ import annotations

import asyncio
import os
import uuid

import psycopg
import pytest
from psycopg import sql

from data_agent_sandbox.protocol.models import (
    CancelFrame,
    bind_execute_frame,
)
from data_agent_sandbox.sql.canonical import canonical_result_bytes
from data_agent_sandbox.sql.executor import SqlSandboxExecutor
from data_agent_sandbox.sql.snapshots import (
    U5_SNAPSHOT_MANIFEST_BUDGET,
    SnapshotManifestBudget,
    build_controlled_snapshot,
)

ADMIN_DSN = os.getenv("DATA_AGENT_SANDBOX_TEST_ADMIN_DSN")
READER_DSN = os.getenv("DATA_AGENT_SANDBOX_DSN")
DATASOURCE_ID = "00000000-0000-4000-8000-00000000d101"
DATASOURCE_FINGERPRINT = "postgresql-test-datasource@1.0.0"

pytestmark = pytest.mark.skipif(
    not ADMIN_DSN or not READER_DSN,
    reason="PostgreSQL sandbox integration DSNs are not configured",
)


@pytest.fixture
async def controlled_schema():
    schema = f"sandbox_{uuid.uuid4().hex[:12]}"
    async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as conn:
        await conn.execute(sql.SQL("create schema {}").format(sql.Identifier(schema)))
        await conn.execute(
            sql.SQL(
                "create table {}.orders ("
                "id integer primary key, region text not null, amount_minor integer not null)"
            ).format(sql.Identifier(schema))
        )
        await conn.execute(
            sql.SQL(
                "insert into {}.orders (id, region, amount_minor) "
                "select value, case when value % 2 = 0 then 'south' else 'north' end, value * 100 "
                "from generate_series(1, 1000) as value"
            ).format(sql.Identifier(schema))
        )
        await conn.execute(
            sql.SQL("revoke all on schema {} from public").format(sql.Identifier(schema))
        )
        await conn.execute(
            sql.SQL("grant usage on schema {} to sandbox_reader").format(sql.Identifier(schema))
        )
        await conn.execute(
            sql.SQL("grant select on all tables in schema {} to sandbox_reader").format(
                sql.Identifier(schema)
            )
        )
    try:
        yield schema
    finally:
        async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as conn:
            await conn.execute(sql.SQL("drop schema {} cascade").format(sql.Identifier(schema)))


async def controlled_frame(execute_payload, schema: str, query: str, parameters: dict):
    async with await psycopg.AsyncConnection.connect(READER_DSN, autocommit=False) as conn:
        snapshot = await build_controlled_snapshot(
            conn,
            scope=execute_payload["grant"]["identity"]["scope"],
            run_id=execute_payload["grant"]["identity"]["run_id"],
            principal_id=execute_payload["grant"]["identity"]["principal_id"],
            datasource_id=execute_payload["sql"]["datasource_id"],
            snapshot_id=f"{schema}@1.0.0",
            schema_name=schema,
            budget=U5_SNAPSHOT_MANIFEST_BUDGET,
        )
        await conn.rollback()
    execute_payload["sql"]["query"] = query
    execute_payload["sql"]["parameters"] = parameters
    execute_payload["snapshot"] = snapshot.model_dump(mode="json")
    execute_payload["grant"]["identity"]["snapshot_requirement"] = {"mode": "REQUIRE_REPLAYABLE"}
    execute_payload["settings"]["search_path"] = [schema, "pg_catalog"]
    return bind_execute_frame(execute_payload)


async def test_real_postgres_execution_is_rr_ro_streamed_and_rolled_back(
    execute_payload,
    controlled_schema,
) -> None:
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select id, amount_minor from orders where region = $1 order by id",
        {"$1": "south"},
    )
    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        fetch_size=37,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    )

    outcome = await executor.execute(frame)

    assert outcome.terminal == "COMPLETED", outcome.model_dump(mode="json")
    assert outcome.row_count == 500
    assert outcome.transaction.read_only is True
    assert outcome.transaction.isolation_level == "REPEATABLE_READ"
    assert executor.last_locked_relation_oids == (frame.snapshot.relations[0].relation_oid,)
    assert outcome.connection_facts.transaction_status == "IDLE"
    assert outcome.rollback_facts.rollback_confirmed is True
    assert executor.last_fetch_batches > 1


async def test_real_postgres_crosswired_identity_fails_before_user_query(
    execute_payload,
) -> None:
    frame = bind_execute_frame(execute_payload)
    async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as conn:
        await conn.execute(
            """
            update data_agent_sandbox_control.datasource_identity
            set datasource_fingerprint = 'postgresql-crosswired-datasource@1.0.0'
            where singleton = true
            """
        )
    try:
        outcome = await SqlSandboxExecutor(
            dsn=READER_DSN,
            datasource_id=DATASOURCE_ID,
            datasource_fingerprint=DATASOURCE_FINGERPRINT,
        ).execute(frame)
    finally:
        async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as conn:
            await conn.execute(
                """
                update data_agent_sandbox_control.datasource_identity
                set datasource_fingerprint = %s
                where singleton = true
                """,
                (DATASOURCE_FINGERPRINT,),
            )

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_SNAPSHOT_AUTHORITY_BREACH"
    assert outcome.connection_facts.backend_pid is None
    assert outcome.manifest_facts.manifest_revalidated is False


async def test_row_limit_discards_partial_result(execute_payload, controlled_schema) -> None:
    execute_payload["budget"]["max_rows"] = 10
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select id from orders order by id",
        {},
    )

    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        fetch_size=7,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_ROW_LIMIT_EXCEEDED"
    assert outcome.partial_discarded is True
    assert not hasattr(outcome, "rows")
    assert outcome.resource_facts.observed_rows == 10


async def test_byte_limit_discards_partial_result(execute_payload, controlled_schema) -> None:
    execute_payload["budget"]["max_bytes"] = 64
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select id, region, amount_minor from orders order by id",
        {},
    )

    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        fetch_size=4,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_BYTE_LIMIT_EXCEEDED"
    assert outcome.partial_discarded is True


async def test_deadline_cancels_and_rolls_back(execute_payload) -> None:
    execute_payload["budget"]["timeout_ms"] = 50
    execute_payload["settings"]["statement_timeout_ms"] = 50
    execute_payload["settings"]["lock_timeout_ms"] = 10
    execute_payload["budget"]["lock_timeout_ms"] = 10
    execute_payload["sql"]["query"] = "select 1::integer as result from pg_sleep($1)"
    execute_payload["sql"]["parameters"] = {"$1": 1}
    frame = bind_execute_frame(execute_payload)

    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    )
    outcome = await executor.execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_STATEMENT_TIMEOUT"
    assert outcome.partial_discarded is True
    assert outcome.connection_facts.transaction_status == "IDLE"
    wall_span_ms = (outcome.completed_at - outcome.started_at).total_seconds() * 1_000
    assert wall_span_ms <= frame.grant.budget.timeout_ms
    assert outcome.resource_facts.elapsed_ms <= frame.grant.budget.timeout_ms
    assert abs(wall_span_ms - outcome.resource_facts.elapsed_ms) < 1


async def test_database_role_mismatch_still_returns_strict_failed_outcome(
    execute_payload,
) -> None:
    execute_payload["settings"]["database_role"] = "different_reader"
    frame = bind_execute_frame(execute_payload)

    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_QUERY_FAILED"
    assert outcome.outcome_checksum.startswith("sha256:")


async def test_native_ordered_parameters_keep_10_after_9(execute_payload) -> None:
    execute_payload["sql"]["query"] = (
        "select $10::integer as tenth, $2::integer as second, "
        "$12::integer as twelfth where "
        "$1::integer + $3::integer + $4::integer + $5::integer + "
        "$6::integer + $7::integer + $8::integer + $9::integer + "
        "$11::integer > 0"
    )
    execute_payload["sql"]["parameters"] = {
        f"${index}": index for index in (1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9)
    }
    frame = bind_execute_frame(execute_payload)

    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(frame)

    assert outcome.terminal == "COMPLETED"
    assert outcome.rows == ((10, 2, 12),)


async def test_column_limit_is_checked_before_any_row_is_retained(
    execute_payload,
) -> None:
    execute_payload["sql"]["query"] = "select " + ", ".join(
        f"{index}::integer as c{index}" for index in range(1, 257)
    )
    execute_payload["sql"]["parameters"] = {}
    allowed = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))
    assert allowed.terminal == "COMPLETED"
    assert len(allowed.columns) == 256

    execute_payload["sql"]["query"] += ", 257::integer as c257"
    rejected = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))
    assert rejected.terminal == "FAILED"
    assert rejected.reason_code == "SANDBOX_COLUMN_LIMIT_EXCEEDED"
    assert rejected.resource_facts.observed_rows == 0
    assert rejected.resource_facts.retained_canonical_bytes == 0


async def test_unknown_result_oid_fails_closed(execute_payload) -> None:
    execute_payload["sql"]["query"] = "select decode('00', 'hex') as payload"
    execute_payload["sql"]["parameters"] = {}

    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_UNSUPPORTED_RESULT_TYPE"
    assert outcome.resource_facts.observed_rows == 0


async def test_result_types_preserve_unicode_null_int8_numeric_and_date(
    execute_payload,
) -> None:
    label = '中文\n"quote"\\slash 😀'
    execute_payload["sql"]["query"] = (
        "select $1::text as label, null::text as optional, "
        "9007199254740993::bigint as big_id, "
        "12345678901234567890.1250::numeric as exact_amount, "
        "date '2026-07-27' as day"
    )
    execute_payload["sql"]["parameters"] = {"$1": label}
    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))

    assert outcome.terminal == "COMPLETED"
    assert [column.type for column in outcome.columns] == [
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
    ]
    assert outcome.rows == (
        (
            label,
            None,
            "9007199254740993",
            "12345678901234567890.1250",
            "2026-07-27",
        ),
    )
    assert outcome.resource_facts.retained_canonical_bytes == canonical_result_bytes(
        [column.model_dump(mode="json") for column in outcome.columns],
        outcome.rows,
    )


async def test_json_and_jsonb_are_recursively_stable_and_byte_exact(
    execute_payload,
) -> None:
    document = {
        "label": "中文 😀",
        "nested": {
            "items": [1, True, None, {"amount": 1.25}],
        },
    }
    execute_payload["sql"]["query"] = (
        "select "
        """'{"label":"中文 😀","nested":{"items":[1,true,null,{"amount":1.25}]}}'"""
        "::json as json_doc, "
        """'{"label":"中文 😀","nested":{"items":[1,true,null,{"amount":1.25}]}}'"""
        "::jsonb as jsonb_doc"
    )
    execute_payload["sql"]["parameters"] = {}
    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))

    assert outcome.terminal == "COMPLETED"
    assert [column.type for column in outcome.columns] == ["JSON", "JSON"]
    assert outcome.rows == ((document, document),)
    assert outcome.resource_facts.retained_canonical_bytes == canonical_result_bytes(
        [column.model_dump(mode="json") for column in outcome.columns],
        outcome.rows,
    )


async def test_ten_thousand_rows_remain_linear_and_byte_exact(execute_payload) -> None:
    execute_payload["budget"]["max_rows"] = 10_000
    execute_payload["budget"]["max_bytes"] = 1_048_576
    execute_payload["sql"]["query"] = (
        "select value::integer as id from generate_series(1, 10000) as value"
    )
    execute_payload["sql"]["parameters"] = {}
    outcome = await SqlSandboxExecutor(
        dsn=READER_DSN,
        fetch_size=128,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    ).execute(bind_execute_frame(execute_payload))

    assert outcome.terminal == "COMPLETED"
    assert outcome.row_count == 10_000
    assert outcome.resource_facts.retained_canonical_bytes == canonical_result_bytes(
        [column.model_dump(mode="json") for column in outcome.columns],
        outcome.rows,
    )


async def test_external_cancel_is_bound_and_discards_result(execute_payload) -> None:
    execute_payload["sql"]["query"] = "select 1::integer as result from pg_sleep($1)"
    execute_payload["sql"]["parameters"] = {"$1": 2}
    frame = bind_execute_frame(execute_payload)
    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    )
    task = asyncio.create_task(executor.execute(frame))
    await executor.wait_until_active(timeout_seconds=1)
    cancel = CancelFrame.model_validate(
        {
            "protocol_version": frame.protocol_version,
            "frame_type": "CANCEL",
            "grant_hash": frame.grant.grant_hash,
            "lease_id": frame.grant.lease_id,
            "execution_id": frame.grant.execution_id,
            "attempt_id": frame.grant.attempt_id,
            "execution_fence": frame.grant.execution_fence,
            "cancel_epoch": frame.grant.cancel_epoch + 1,
            "requested_at": frame.grant.issued_at,
            "reason_code": "USER_CANCELLED",
        }
    )

    assert await executor.request_cancel(frame, cancel) is True
    outcome = await task

    assert outcome.terminal == "CANCELLED"
    assert outcome.reason_code == "SANDBOX_CANCELLED"
    assert outcome.cancel_facts.cancel_requested is True
    assert outcome.cancel_facts.query_cancel_dispatched is True
    assert outcome.partial_discarded is True


async def test_snapshot_manifest_tamper_fails_before_query(
    execute_payload,
    controlled_schema,
) -> None:
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select count(*) as count from orders",
        {},
    )
    async with await psycopg.AsyncConnection.connect(ADMIN_DSN, autocommit=True) as conn:
        await conn.execute(
            sql.SQL(
                "insert into {}.orders (id, region, amount_minor) values (2000, 'south', 1)"
            ).format(sql.Identifier(controlled_schema))
        )

    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    )
    outcome = await executor.execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_SNAPSHOT_AUTHORITY_BREACH"
    assert outcome.manifest_facts.manifest_revalidated is False
    assert executor.last_fetch_batches == 0


async def test_snapshot_manifest_row_budget_fails_before_query(
    execute_payload,
    controlled_schema,
) -> None:
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select 1 / 0 as must_not_execute",
        {},
    )
    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
        snapshot_manifest_budget=SnapshotManifestBudget(
            max_relations=256,
            max_columns_per_relation=256,
            max_rows=999,
            max_bytes=67_108_864,
            fetch_size=7,
        ),
    )

    outcome = await executor.execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_ROW_LIMIT_EXCEEDED"
    assert outcome.resource_facts.cutoff_kind == "ROW"
    assert outcome.manifest_facts.manifest_revalidated is False
    assert executor.last_fetch_batches == 0


async def test_snapshot_manifest_byte_budget_fails_before_query(
    execute_payload,
    controlled_schema,
) -> None:
    frame = await controlled_frame(
        execute_payload,
        controlled_schema,
        "select 1 / 0 as must_not_execute",
        {},
    )
    executor = SqlSandboxExecutor(
        dsn=READER_DSN,
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
        snapshot_manifest_budget=SnapshotManifestBudget(
            max_relations=256,
            max_columns_per_relation=256,
            max_rows=10_000,
            max_bytes=64,
            fetch_size=7,
        ),
    )

    outcome = await executor.execute(frame)

    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_BYTE_LIMIT_EXCEEDED"
    assert outcome.resource_facts.cutoff_kind == "BYTE"
    assert outcome.manifest_facts.manifest_revalidated is False
    assert executor.last_fetch_batches == 0
