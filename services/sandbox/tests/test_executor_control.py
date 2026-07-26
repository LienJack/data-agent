from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from psycopg.pq import TransactionStatus
from pydantic import TypeAdapter

from data_agent_sandbox.protocol.models import (
    CancelFrame,
    ExecuteFrame,
    OutcomeColumn,
    OutcomeFrame,
    bind_execute_frame,
)
from data_agent_sandbox.sql import executor as executor_module
from data_agent_sandbox.sql.canonical import canonical_result_bytes
from data_agent_sandbox.sql.executor import SandboxCutoff, SqlSandboxExecutor, _QueryResult

DATASOURCE_ID = "00000000-0000-4000-8000-00000000d101"
DATASOURCE_FINGERPRINT = "postgresql-test-datasource@1.0.0"


def _cancel_for(frame: ExecuteFrame) -> CancelFrame:
    return CancelFrame.model_validate(
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


class _FactsCursor:
    def __init__(self, frame: ExecuteFrame) -> None:
        self._frame = frame

    async def fetchone(self) -> tuple[object, ...]:
        settings = self._frame.settings
        return (
            settings.database_role,
            "on",
            "repeatable read",
            4321,
            settings.plan_cache_mode,
            ", ".join(settings.search_path),
            settings.statement_timeout_ms,
            settings.lock_timeout_ms,
        )


class _DatasourceIdentityCursor:
    def __init__(self, datasource_id: str, datasource_fingerprint: str) -> None:
        self._identity = (datasource_id, datasource_fingerprint)

    async def fetchone(self) -> tuple[str, str]:
        return self._identity


class _EmptyCursor:
    async def fetchone(self) -> None:
        return None


class _ConnectionInfo:
    def __init__(self) -> None:
        self.transaction_status = TransactionStatus.IDLE


class _FakeConnection:
    def __init__(
        self,
        frame: ExecuteFrame,
        *,
        rollback_started: asyncio.Event | None = None,
        release_rollback: asyncio.Event | None = None,
        connected_datasource_id: str = DATASOURCE_ID,
        connected_datasource_fingerprint: str = DATASOURCE_FINGERPRINT,
    ) -> None:
        self.frame = frame
        self.info = _ConnectionInfo()
        self.execute_calls: list[object] = []
        self.cancel_calls = 0
        self.rollback_started = rollback_started
        self.release_rollback = release_rollback
        self.connected_datasource_id = connected_datasource_id
        self.connected_datasource_fingerprint = connected_datasource_fingerprint

    async def execute(
        self,
        query: object,
        *args: object,
    ) -> _FactsCursor | _DatasourceIdentityCursor | _EmptyCursor:
        self.execute_calls.append(query)
        if isinstance(query, str) and "data_agent_sandbox_control.datasource_identity" in query:
            return _DatasourceIdentityCursor(
                self.connected_datasource_id,
                self.connected_datasource_fingerprint,
            )
        if isinstance(query, str) and "current_user" in query:
            return _FactsCursor(self.frame)
        if isinstance(query, str) and query.startswith("begin "):
            self.info.transaction_status = TransactionStatus.INTRANS
        return _EmptyCursor()

    async def cancel_safe(self, **_kwargs: float) -> None:
        self.cancel_calls += 1

    async def rollback(self) -> None:
        if self.rollback_started is not None:
            self.rollback_started.set()
        if self.release_rollback is not None:
            await self.release_rollback.wait()
        self.info.transaction_status = TransactionStatus.IDLE

    async def close(self) -> None:
        return None


class _ConnectBarrier:
    def __init__(self, connection: _FakeConnection) -> None:
        self.connection = connection
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0

    async def __call__(self, dsn: str, *, autocommit: bool) -> _FakeConnection:
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return self.connection


class _ImmediateResultExecutor(SqlSandboxExecutor):
    async def _execute_query(
        self,
        conn: Any,
        frame: ExecuteFrame,
    ) -> _QueryResult:
        columns = (OutcomeColumn(name="result", type="INTEGER"),)
        rows = ((1,),)
        result_bytes = canonical_result_bytes(
            [column.model_dump(mode="json") for column in columns],
            rows,
        )
        return _QueryResult(
            columns=columns,
            rows=rows,
            observed_rows=1,
            observed_bytes=result_bytes,
            fetch_batches=1,
            locked_relation_oids=(),
            retained_canonical_bytes=result_bytes,
            current_batch_estimated_bytes=0,
        )


def _executor(
    *,
    connection_factory: Callable[..., Awaitable[Any]],
    executor_type: type[SqlSandboxExecutor] = SqlSandboxExecutor,
    datasource_id: str | None = DATASOURCE_ID,
    datasource_fingerprint: str | None = DATASOURCE_FINGERPRINT,
) -> SqlSandboxExecutor:
    return executor_type(
        dsn="postgresql://sandbox.invalid/data",
        datasource_id=datasource_id,
        datasource_fingerprint=datasource_fingerprint,
        connection_factory=connection_factory,
    )


@pytest.mark.parametrize(
    ("datasource_id", "datasource_fingerprint"),
    [
        (None, DATASOURCE_FINGERPRINT),
        (DATASOURCE_ID, None),
        ("00000000-0000-4000-8000-00000000d999", DATASOURCE_FINGERPRINT),
        (DATASOURCE_ID, "postgresql-other-datasource@1.0.0"),
    ],
)
async def test_datasource_identity_must_match_before_any_connection(
    execute_payload,
    monkeypatch,
    datasource_id: str | None,
    datasource_fingerprint: str | None,
) -> None:
    monkeypatch.delenv("DATA_AGENT_SANDBOX_DATASOURCE_ID", raising=False)
    monkeypatch.delenv("DATA_AGENT_SANDBOX_DATASOURCE_FINGERPRINT", raising=False)
    frame = ExecuteFrame.model_validate(execute_payload)
    connection = _FakeConnection(frame)
    connector = _ConnectBarrier(connection)
    connector.release.set()
    sandbox = _executor(
        connection_factory=connector,
        datasource_id=datasource_id,
        datasource_fingerprint=datasource_fingerprint,
    )

    outcome = await sandbox.execute(frame)

    assert connector.calls == 0
    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_SNAPSHOT_AUTHORITY_BREACH"
    assert outcome.connection_facts.backend_pid is None
    assert outcome.connection_facts.transaction_status == "UNKNOWN"
    assert outcome.rollback_facts.rollback_confirmed is False
    assert outcome.manifest_facts.manifest_revalidated is False
    TypeAdapter(OutcomeFrame).validate_json(outcome.model_dump_json())


@pytest.mark.parametrize(
    ("connected_datasource_id", "connected_datasource_fingerprint"),
    [
        ("00000000-0000-4000-8000-00000000d999", DATASOURCE_FINGERPRINT),
        (DATASOURCE_ID, "postgresql-crosswired-datasource@1.0.0"),
    ],
)
async def test_connected_database_identity_must_match_before_transaction(
    execute_payload,
    connected_datasource_id: str,
    connected_datasource_fingerprint: str,
) -> None:
    frame = ExecuteFrame.model_validate(execute_payload)
    connection = _FakeConnection(
        frame,
        connected_datasource_id=connected_datasource_id,
        connected_datasource_fingerprint=connected_datasource_fingerprint,
    )
    connector = _ConnectBarrier(connection)
    connector.release.set()
    sandbox = _executor(connection_factory=connector)

    outcome = await sandbox.execute(frame)

    assert connector.calls == 1
    assert outcome.terminal == "FAILED"
    assert outcome.reason_code == "SANDBOX_SNAPSHOT_AUTHORITY_BREACH"
    assert not any(
        isinstance(query, str) and query.startswith("begin ") for query in connection.execute_calls
    )
    assert outcome.manifest_facts.manifest_revalidated is False


async def test_cancel_while_connecting_is_pending_and_stops_before_transaction(
    execute_payload,
) -> None:
    frame = ExecuteFrame.model_validate(execute_payload)
    connection = _FakeConnection(frame)
    connector = _ConnectBarrier(connection)
    sandbox = _executor(connection_factory=connector)
    execution = asyncio.create_task(sandbox.execute(frame))
    await connector.started.wait()

    assert await sandbox.request_cancel(frame, _cancel_for(frame)) is True
    connector.release.set()
    outcome = await execution

    assert connection.execute_calls == []
    assert connection.cancel_calls == 0
    assert outcome.terminal == "CANCELLED"
    assert outcome.reason_code == "SANDBOX_CANCELLED"
    assert outcome.cancel_epoch_observed == frame.grant.cancel_epoch + 1
    assert outcome.cancel_facts.cancel_requested is True
    assert outcome.cancel_facts.query_cancel_dispatched is False


async def test_pending_cancel_after_manifest_check_stops_before_query_dispatch(
    execute_payload,
    monkeypatch,
) -> None:
    frame = ExecuteFrame.model_validate(execute_payload)
    connection = _FakeConnection(frame)
    connector = _ConnectBarrier(connection)
    connector.release.set()
    manifest_started = asyncio.Event()
    release_manifest = asyncio.Event()
    raw_cursor_created = 0

    async def validate_with_barrier(
        conn: Any,
        snapshot: Any,
        *,
        budget: Any,
    ) -> list[int]:
        del conn, snapshot, budget
        manifest_started.set()
        await release_manifest.wait()
        return []

    class ForbiddenRawCursor:
        def __init__(self, *args: object, **kwargs: object) -> None:
            nonlocal raw_cursor_created
            raw_cursor_created += 1
            raise AssertionError("user query must not be dispatched after pending cancel")

    monkeypatch.setattr(executor_module, "validate_and_lock_snapshot", validate_with_barrier)
    monkeypatch.setattr(executor_module, "AsyncRawServerCursor", ForbiddenRawCursor)
    sandbox = _executor(connection_factory=connector)
    execution = asyncio.create_task(sandbox.execute(frame))
    await manifest_started.wait()

    assert await sandbox.request_cancel(frame, _cancel_for(frame)) is True
    release_manifest.set()
    outcome = await execution

    assert raw_cursor_created == 0
    assert outcome.terminal == "CANCELLED"
    assert outcome.cancel_facts.query_cancel_dispatched is True


async def test_cancel_after_datasource_terminal_does_not_change_epoch_or_facts(
    execute_payload,
) -> None:
    frame = ExecuteFrame.model_validate(execute_payload)
    rollback_started = asyncio.Event()
    release_rollback = asyncio.Event()
    connection = _FakeConnection(
        frame,
        rollback_started=rollback_started,
        release_rollback=release_rollback,
    )
    connector = _ConnectBarrier(connection)
    connector.release.set()
    sandbox = _executor(
        connection_factory=connector,
        executor_type=_ImmediateResultExecutor,
    )
    execution = asyncio.create_task(sandbox.execute(frame))
    await rollback_started.wait()

    assert await sandbox.request_cancel(frame, _cancel_for(frame)) is False
    assert connection.cancel_calls == 0
    release_rollback.set()
    outcome = await execution

    assert outcome.terminal == "COMPLETED"
    assert outcome.cancel_epoch_observed == frame.grant.cancel_epoch
    assert outcome.cancel_facts.cancel_requested is False
    assert outcome.cancel_facts.cancel_disposition == "NOT_REQUESTED"


async def test_default_fetch_size_bounds_a_wide_raw_batch_before_retention(
    execute_payload,
    monkeypatch,
) -> None:
    execute_payload["budget"]["max_bytes"] = 64
    frame = bind_execute_frame(execute_payload)
    fetch_sizes: list[int] = []

    async def validate_snapshot(
        conn: Any,
        snapshot: Any,
        *,
        budget: Any,
    ) -> list[int]:
        del conn, snapshot, budget
        return []

    class Description:
        name = "payload"
        type_code = 25

    class WideRawCursor:
        description = (Description(),)

        def __init__(self, *args: object, **kwargs: object) -> None:
            self._returned = False

        async def execute(self, query: str, parameters: tuple[object, ...]) -> None:
            return None

        async def fetchmany(self, size: int) -> list[tuple[str]]:
            fetch_sizes.append(size)
            if self._returned:
                return []
            self._returned = True
            return [("x" * 4_096,)]

        async def close(self) -> None:
            return None

    monkeypatch.setattr(executor_module, "validate_and_lock_snapshot", validate_snapshot)
    monkeypatch.setattr(executor_module, "AsyncRawServerCursor", WideRawCursor)
    sandbox = SqlSandboxExecutor(
        dsn="postgresql://sandbox.invalid/data",
        datasource_id=DATASOURCE_ID,
        datasource_fingerprint=DATASOURCE_FINGERPRINT,
    )

    with pytest.raises(SandboxCutoff, match="SANDBOX_BYTE_LIMIT_EXCEEDED") as captured:
        await sandbox._execute_query(object(), frame)

    assert sandbox.fetch_size == 1
    assert fetch_sizes == [1]
    assert captured.value.observed_rows == 0
    assert captured.value.current_batch_estimated_bytes > frame.budget.max_bytes
