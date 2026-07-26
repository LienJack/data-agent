from __future__ import annotations

import asyncio
import math
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import psycopg
from psycopg import AsyncRawServerCursor, sql
from psycopg.pq import TransactionStatus
from pydantic import ValidationError

from data_agent_sandbox.protocol.models import (
    CancelFacts,
    CancelFrame,
    CanonicalMultisetFacts,
    ExecuteFrame,
    ManifestFacts,
    OutcomeColumn,
    OutcomeFrame,
    ResourceFacts,
    RollbackFacts,
    SandboxResult,
    TransactionFacts,
    bind_outcome,
    outcome_binding_from_execute,
    validate_cancel_binding,
)
from data_agent_sandbox.sql.canonical import (
    canonical_empty_result_bytes,
    canonical_json,
    canonical_multiset_hash,
    canonical_result_row_increment_bytes,
    sha256_content_hash,
)
from data_agent_sandbox.sql.memory import observe_process_rss_high_water_bytes
from data_agent_sandbox.sql.snapshots import (
    U5_SNAPSHOT_MANIFEST_BUDGET,
    SnapshotAuthorityBreach,
    SnapshotManifestBudget,
    SnapshotManifestBudgetExceeded,
    validate_and_lock_snapshot,
)


class SandboxCutoff(RuntimeError):
    def __init__(
        self,
        reason_code: str,
        *,
        observed_rows: int = 0,
        observed_bytes: int = 0,
        fetch_batches: int = 0,
        locked_oids: tuple[int, ...] = (),
        retained_canonical_bytes: int = 0,
        current_batch_estimated_bytes: int = 0,
    ) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.observed_rows = observed_rows
        self.observed_bytes = observed_bytes
        self.fetch_batches = fetch_batches
        self.locked_oids = locked_oids
        self.retained_canonical_bytes = retained_canonical_bytes
        self.current_batch_estimated_bytes = current_batch_estimated_bytes


@dataclass(frozen=True)
class _QueryResult:
    columns: tuple[OutcomeColumn, ...]
    rows: tuple[tuple[Any, ...], ...]
    observed_rows: int
    observed_bytes: int
    fetch_batches: int
    locked_relation_oids: tuple[int, ...]
    retained_canonical_bytes: int
    current_batch_estimated_bytes: int


def _stable_type(type_oid: int) -> str:
    if type_oid == 16:
        return "BOOLEAN"
    if type_oid in {21, 23}:
        return "INTEGER"
    if type_oid in {700, 701}:
        return "NUMBER"
    if type_oid in {20, 26, 790, 1700}:
        return "STRING"
    if type_oid in {114, 3802}:
        return "JSON"
    if type_oid in {
        18,
        19,
        25,
        1042,
        1043,
        1082,
        1083,
        1114,
        1184,
        1186,
        1266,
        2950,
    }:
        return "STRING"
    raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")


def _json_document_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")
        return value
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")
        return {key: _json_document_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_document_value(item) for item in value]
    raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")


def _json_value(value: Any, type_oid: int) -> Any:
    if type_oid in {114, 3802}:
        return _json_document_value(value)
    if value is not None and type_oid in {20, 26}:
        return str(value)
    if value is not None and type_oid == 1700:
        if not isinstance(value, Decimal):
            raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")
        return format(value, "f")
    if value is not None and type_oid == 790:
        return str(value)
    if value is None or isinstance(value, (bool, str, int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    raise SandboxCutoff("SANDBOX_UNSUPPORTED_RESULT_TYPE")


def _transaction_status(conn: psycopg.AsyncConnection[Any] | None) -> str:
    if conn is None:
        return "UNKNOWN"
    return conn.info.transaction_status.name


class SqlSandboxExecutor:
    """One-shot PostgreSQL executor. Instances intentionally run one execution at a time."""

    def __init__(
        self,
        *,
        dsn: str | None = None,
        fetch_size: int = 1,
        datasource_id: str | None = None,
        datasource_fingerprint: str | None = None,
        snapshot_manifest_budget: SnapshotManifestBudget = U5_SNAPSHOT_MANIFEST_BUDGET,
        connection_factory: Callable[..., Awaitable[psycopg.AsyncConnection[Any]]] | None = None,
    ) -> None:
        if fetch_size <= 0:
            raise ValueError("fetch_size must be positive")
        self._dsn = dsn
        self._datasource_id = datasource_id
        self._datasource_fingerprint = datasource_fingerprint
        self._snapshot_manifest_budget = snapshot_manifest_budget
        self._connection_factory = (
            connection_factory
            if connection_factory is not None
            else psycopg.AsyncConnection.connect
        )
        self.fetch_size = fetch_size
        self._active = asyncio.Event()
        self._active_conn: psycopg.AsyncConnection[Any] | None = None
        self._active_frame: ExecuteFrame | None = None
        self._datasource_terminal = True
        self._cancel_requested = False
        self._cancel_dispatched = False
        self._cancel_confirmed = False
        self._cancel_epoch_observed = 0
        self._cancel_requested_at: datetime | None = None
        self._manifest_revalidated = False
        self.last_locked_relation_oids: tuple[int, ...] = ()
        self.last_fetch_batches = 0

    async def wait_until_active(self, *, timeout_seconds: float) -> None:
        await asyncio.wait_for(self._active.wait(), timeout=timeout_seconds)

    async def request_cancel(self, execute: ExecuteFrame, cancel: CancelFrame) -> bool:
        validate_cancel_binding(execute, cancel)
        active_frame = self._active_frame
        if (
            active_frame is None
            or active_frame.grant.grant_hash != execute.grant.grant_hash
            or self._datasource_terminal
        ):
            return False
        if self._cancel_requested:
            return True
        self._cancel_requested = True
        self._cancel_epoch_observed = cancel.cancel_epoch
        self._cancel_requested_at = cancel.requested_at
        conn = self._active_conn
        if conn is None:
            return True
        # Record dispatch synchronously. request_cancel must not mutate outcome
        # facts after the datasource-terminal boundary while cancel_safe awaits.
        self._cancel_dispatched = True
        try:
            await conn.cancel_safe(timeout=1.0)
        except Exception:
            return False
        return True

    def _validate_datasource_binding(self, frame: ExecuteFrame) -> None:
        datasource_id = (
            self._datasource_id
            if self._datasource_id is not None
            else os.getenv("DATA_AGENT_SANDBOX_DATASOURCE_ID")
        )
        datasource_fingerprint = (
            self._datasource_fingerprint
            if self._datasource_fingerprint is not None
            else os.getenv("DATA_AGENT_SANDBOX_DATASOURCE_FINGERPRINT")
        )
        descriptor = frame.grant.snapshot_descriptor
        if (
            not datasource_id
            or not datasource_fingerprint
            or datasource_id != frame.grant.identity.datasource_id
            or datasource_fingerprint != descriptor.datasource_fingerprint
        ):
            raise SandboxCutoff("SANDBOX_SNAPSHOT_AUTHORITY_BREACH")

    async def _validate_connected_datasource(
        self,
        conn: psycopg.AsyncConnection[Any],
        frame: ExecuteFrame,
        bounded: Callable[[Awaitable[Any]], Awaitable[Any]],
    ) -> None:
        try:
            cursor = await bounded(
                conn.execute(
                    """
                    select datasource_id::text, datasource_fingerprint
                    from data_agent_sandbox_control.datasource_identity
                    where singleton = true
                    """
                )
            )
            identity = await bounded(cursor.fetchone())
        except psycopg.Error as error:
            raise SandboxCutoff("SANDBOX_SNAPSHOT_AUTHORITY_BREACH") from error
        descriptor = frame.grant.snapshot_descriptor
        if (
            identity is None
            or len(identity) != 2
            or str(identity[0]) != frame.grant.identity.datasource_id
            or str(identity[1]) != descriptor.datasource_fingerprint
        ):
            raise SandboxCutoff("SANDBOX_SNAPSHOT_AUTHORITY_BREACH")

    def _raise_if_cancel_pending(self) -> None:
        if self._cancel_requested:
            raise SandboxCutoff("SANDBOX_CANCELLED")

    async def execute(self, frame: ExecuteFrame) -> OutcomeFrame:
        started_at = datetime.now(UTC)
        loop = asyncio.get_running_loop()
        timeout_seconds = min(
            frame.budget.timeout_ms / 1_000,
            max(0.001, (frame.grant.lease_expires_at - started_at).total_seconds()),
        )
        deadline_monotonic = loop.time() + timeout_seconds
        deadline_at = started_at + timedelta(seconds=timeout_seconds)
        datasource_terminal_at: datetime | None = None

        async def bounded(awaitable: Awaitable[Any]) -> Any:
            remaining = deadline_monotonic - loop.time()
            if remaining <= 0:
                raise TimeoutError
            return await asyncio.wait_for(awaitable, timeout=remaining)

        transaction_id = str(uuid.uuid4())
        conn: psycopg.AsyncConnection[Any] | None = None
        backend_pid = 0
        locked_oids: tuple[int, ...] = ()
        status_after_rollback = "UNKNOWN"
        rollback_confirmed = False
        query_result: _QueryResult | None = None
        reason_code = "SANDBOX_QUERY_FAILED"
        terminal = "FAILED"
        observed_rows = 0
        observed_bytes = 0
        fetch_batches = 0
        retained_canonical_bytes = 0
        current_batch_estimated_bytes = 0
        cancel_for_timeout = False

        self._active.clear()
        self._active_frame = frame
        self._datasource_terminal = False
        self._cancel_requested = False
        self._cancel_dispatched = False
        self._cancel_confirmed = False
        self._cancel_epoch_observed = frame.grant.cancel_epoch
        self._cancel_requested_at = None
        self._manifest_revalidated = False
        self.last_locked_relation_oids = ()
        self.last_fetch_batches = 0

        try:
            now = datetime.now(UTC)
            if now >= frame.grant.lease_expires_at:
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")
            self._validate_datasource_binding(frame)
            dsn = self._dsn or os.getenv("DATA_AGENT_SANDBOX_DSN")
            if not dsn:
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")

            self._raise_if_cancel_pending()
            conn = await bounded(self._connection_factory(dsn, autocommit=True))
            self._active_conn = conn
            self._raise_if_cancel_pending()
            await self._validate_connected_datasource(conn, frame, bounded)
            self._raise_if_cancel_pending()
            await bounded(conn.execute("begin isolation level repeatable read read only"))
            await bounded(
                conn.execute(
                    f"set local statement_timeout = '{frame.settings.statement_timeout_ms}ms'"
                )
            )
            await bounded(
                conn.execute(f"set local lock_timeout = '{frame.settings.lock_timeout_ms}ms'")
            )
            await bounded(
                conn.execute(
                    "set local idle_in_transaction_session_timeout = "
                    f"'{frame.settings.idle_in_transaction_session_timeout_ms}ms'"
                )
            )
            await bounded(conn.execute("set local plan_cache_mode = force_custom_plan"))
            await bounded(
                conn.execute(
                    sql.SQL("set local search_path to {}").format(
                        sql.SQL(", ").join(
                            sql.Identifier(item) for item in frame.settings.search_path
                        )
                    )
                )
            )
            facts_cursor = await bounded(
                conn.execute(
                    """
                select
                  current_user,
                  current_setting('transaction_read_only'),
                  current_setting('transaction_isolation'),
                  pg_catalog.pg_backend_pid(),
                  current_setting('plan_cache_mode'),
                  current_setting('search_path'),
                  (
                    extract(epoch from current_setting('statement_timeout')::interval)
                    * 1000
                  )::integer,
                  (
                    extract(epoch from current_setting('lock_timeout')::interval)
                    * 1000
                  )::integer
                    """
                )
            )
            facts = await bounded(facts_cursor.fetchone())
            if facts is None:
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")
            (
                database_role,
                read_only,
                isolation,
                backend_pid_raw,
                plan_cache_mode,
                search_path,
                statement_timeout_ms,
                lock_timeout_ms,
            ) = facts
            backend_pid = int(backend_pid_raw)
            if str(database_role) != frame.settings.database_role:
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")
            if str(read_only) != "on" or str(isolation).lower() != "repeatable read":
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")
            observed_search_path = tuple(
                item.strip().strip('"') for item in str(search_path).split(",")
            )
            if (
                str(plan_cache_mode) != frame.settings.plan_cache_mode
                or observed_search_path != frame.settings.search_path
                or int(statement_timeout_ms) != frame.settings.statement_timeout_ms
                or int(lock_timeout_ms) != frame.settings.lock_timeout_ms
            ):
                raise SandboxCutoff("SANDBOX_QUERY_FAILED")
            self._active.set()

            self._raise_if_cancel_pending()
            query_result = await bounded(self._execute_query(conn, frame))
            observed_rows = query_result.observed_rows
            observed_bytes = query_result.observed_bytes
            fetch_batches = query_result.fetch_batches
            locked_oids = query_result.locked_relation_oids
            retained_canonical_bytes = query_result.retained_canonical_bytes
            self.last_locked_relation_oids = locked_oids
            self.last_fetch_batches = fetch_batches
            if self._cancel_requested:
                raise SandboxCutoff(
                    "SANDBOX_CANCELLED" if self._cancel_confirmed else "SANDBOX_CANCEL_UNCONFIRMED"
                )
            terminal = "COMPLETED"
            reason_code = "SANDBOX_EXECUTION_COMPLETED"
        except SnapshotManifestBudgetExceeded as error:
            reason_code = error.reason_code
        except SnapshotAuthorityBreach:
            reason_code = "SANDBOX_SNAPSHOT_AUTHORITY_BREACH"
        except TimeoutError:
            # The signed datasource deadline is the terminal resource boundary.
            # Cancel confirmation and rollback are cleanup facts outside it.
            datasource_terminal_at = deadline_at
            reason_code = "SANDBOX_STATEMENT_TIMEOUT"
            cancel_for_timeout = conn is not None
        except psycopg.errors.QueryCanceled:
            if self._cancel_requested:
                # The datasource QueryCanceled response is itself confirmation.
                # cancel_safe() may still be returning on the caller task.
                self._cancel_dispatched = True
                self._cancel_confirmed = True
                terminal = "CANCELLED"
                reason_code = "SANDBOX_CANCELLED"
            else:
                datasource_terminal_at = deadline_at
                reason_code = "SANDBOX_STATEMENT_TIMEOUT"
        except SandboxCutoff as error:
            reason_code = error.reason_code
            observed_rows = error.observed_rows
            observed_bytes = error.observed_bytes
            fetch_batches = error.fetch_batches
            locked_oids = error.locked_oids
            retained_canonical_bytes = error.retained_canonical_bytes
            current_batch_estimated_bytes = error.current_batch_estimated_bytes
            self.last_locked_relation_oids = locked_oids
            self.last_fetch_batches = fetch_batches
            if reason_code == "SANDBOX_CANCELLED":
                terminal = "CANCELLED"
        except psycopg.Error:
            reason_code = "SANDBOX_QUERY_FAILED"
        finally:
            if datasource_terminal_at is None:
                datasource_terminal_at = datetime.now(UTC)
            # There is deliberately no await between the query terminal decision
            # and this boundary. Cancels accepted after it cannot alter outcome
            # epochs or facts while rollback/close are still awaiting cleanup.
            self._datasource_terminal = True
            if conn is not None:
                if cancel_for_timeout:
                    try:
                        await conn.cancel_safe(timeout=1.0)
                    except Exception:
                        pass
                try:
                    await conn.rollback()
                except Exception:
                    pass
                status_after_rollback = _transaction_status(conn)
                rollback_confirmed = conn.info.transaction_status == TransactionStatus.IDLE
                await conn.close()
            self._active_conn = None
            self._active_frame = None
            self._active.set()

        completed_at = datasource_terminal_at
        elapsed_ms = max(
            0,
            int((completed_at - started_at).total_seconds() * 1_000),
        )
        if query_result is not None:
            observed_rows = query_result.observed_rows
            observed_bytes = query_result.observed_bytes
            fetch_batches = query_result.fetch_batches
            locked_oids = query_result.locked_relation_oids
            retained_canonical_bytes = query_result.retained_canonical_bytes
            current_batch_estimated_bytes = query_result.current_batch_estimated_bytes
        transaction = TransactionFacts(
            transaction_id=transaction_id,
            read_only=True,
            isolation_level="REPEATABLE_READ",
        )
        cutoff_kind = {
            "SANDBOX_COLUMN_LIMIT_EXCEEDED": "COLUMN",
            "SANDBOX_ROW_LIMIT_EXCEEDED": "ROW",
            "SANDBOX_BYTE_LIMIT_EXCEEDED": "BYTE",
            "SANDBOX_MEMORY_LIMIT_EXCEEDED": "MEMORY",
            "SANDBOX_STATEMENT_TIMEOUT": "TIMEOUT",
        }.get(reason_code, "NONE")
        reported_rows = min(observed_rows, frame.budget.max_rows)
        reported_bytes = min(observed_bytes, frame.budget.max_bytes)
        usage = ResourceFacts(
            elapsed_ms=elapsed_ms,
            observed_rows=reported_rows,
            observed_bytes=reported_bytes,
            peak_memory_mb=min(
                frame.budget.max_memory_mb,
                (retained_canonical_bytes + current_batch_estimated_bytes + 1_048_575) // 1_048_576,
            ),
            retained_canonical_bytes=retained_canonical_bytes,
            current_batch_estimated_bytes=current_batch_estimated_bytes,
            process_rss_high_water_bytes=observe_process_rss_high_water_bytes(),
            cgroup_memory_limit_enforced=False,
            partial_output_discarded=terminal != "COMPLETED",
            cutoff_kind=cutoff_kind,
        )
        if not self._cancel_requested:
            cancel_disposition = "NOT_REQUESTED"
        elif self._cancel_confirmed:
            cancel_disposition = "QUERY_CANCEL_CONFIRMED"
        elif self._cancel_dispatched:
            cancel_disposition = "QUERY_CANCEL_UNCONFIRMED"
        else:
            cancel_disposition = "AFTER_DATASOURCE_TERMINAL"
        cancel_facts = CancelFacts(
            cancel_requested=self._cancel_requested,
            query_cancel_dispatched=self._cancel_dispatched,
            query_cancel_confirmed=self._cancel_confirmed,
            cancel_disposition=cancel_disposition,
            cancel_epoch_at_start=frame.grant.cancel_epoch,
            cancel_epoch_observed=self._cancel_epoch_observed,
            cancel_requested_at=self._cancel_requested_at,
        )
        rollback_facts = RollbackFacts(
            rollback_confirmed=rollback_confirmed,
            datasource_terminal=(
                "ROLLED_BACK_CLEAN" if rollback_confirmed else "ROLLBACK_UNCONFIRMED"
            ),
        )
        connection_status = {
            "IDLE": "IDLE",
            "INTRANS": "IN_TRANSACTION",
            "INERROR": "IN_ERROR",
        }.get(status_after_rollback, "UNKNOWN")
        descriptor = frame.grant.snapshot_descriptor
        common = {
            **outcome_binding_from_execute(frame),
            "terminal": terminal,
            "reason_code": reason_code,
            "started_at": started_at,
            "completed_at": completed_at,
            "cancel_epoch_observed": self._cancel_epoch_observed,
            "resource_facts": usage,
            "cancel_facts": cancel_facts,
            "rollback_facts": rollback_facts,
            "connection_facts": {
                "backend_pid": backend_pid or None,
                "transaction_status": connection_status,
                "connection_reused": False,
            },
            "transaction": transaction,
            "applied_execution_settings": {
                "database_role": frame.settings.database_role,
                "search_path": frame.settings.search_path,
                "plan_cache_mode": frame.settings.plan_cache_mode,
                "statement_timeout_ms": frame.settings.statement_timeout_ms,
                "lock_timeout_ms": frame.settings.lock_timeout_ms,
            },
            "manifest_facts": ManifestFacts(
                snapshot_descriptor_hash=descriptor.descriptor_hash,
                schema_manifest_hash=descriptor.schema_manifest_hash,
                data_manifest_hash=descriptor.data_manifest_hash,
                fixture_manifest_hash=descriptor.fixture_manifest_hash,
                manifest_revalidated=self._manifest_revalidated,
                revalidated_at=completed_at,
            ),
        }
        if terminal == "COMPLETED" and query_result is not None:
            result = SandboxResult(
                columns=query_result.columns,
                rows=query_result.rows,
            )
            return bind_outcome(
                {
                    **common,
                    "result": result,
                    "canonical_multiset_facts": CanonicalMultisetFacts(
                        canonical_multiset_hash=canonical_multiset_hash(query_result.rows),
                        ordered_result_hash=sha256_content_hash(result.model_dump(mode="json")),
                    ),
                }
            )
        return bind_outcome(
            {
                **common,
                "result": None,
                "canonical_multiset_facts": CanonicalMultisetFacts(
                    canonical_multiset_hash=None,
                    ordered_result_hash=None,
                ),
            }
        )

    async def _execute_query(
        self,
        conn: psycopg.AsyncConnection[Any],
        frame: ExecuteFrame,
    ) -> _QueryResult:
        self._raise_if_cancel_pending()
        locked_oids = tuple(
            await validate_and_lock_snapshot(
                conn,
                frame.snapshot,
                budget=self._snapshot_manifest_budget,
            )
        )
        self._manifest_revalidated = True
        self._raise_if_cancel_pending()
        cursor = AsyncRawServerCursor(
            conn,
            f"data_agent_{frame.grant.execution_id.replace('-', '')[:24]}",
            scrollable=False,
            withhold=False,
        )
        await cursor.execute(frame.sql.query, frame.sql.positional_parameters())
        description = cursor.description or ()
        if len(description) > 256:
            raise SandboxCutoff(
                "SANDBOX_COLUMN_LIMIT_EXCEEDED",
                locked_oids=locked_oids,
            )
        type_oids = tuple(item.type_code for item in description)
        try:
            columns = tuple(
                OutcomeColumn(name=item.name, type=_stable_type(item.type_code))
                for item in description
            )
        except SandboxCutoff as error:
            raise SandboxCutoff(
                error.reason_code,
                locked_oids=locked_oids,
            ) from error
        except ValidationError as error:
            raise SandboxCutoff(
                "SANDBOX_SQL_SHAPE_REJECTED",
                locked_oids=locked_oids,
            ) from error
        if len({column.name for column in columns}) != len(columns):
            raise SandboxCutoff(
                "SANDBOX_SQL_SHAPE_REJECTED",
                locked_oids=locked_oids,
            )

        rows: list[tuple[Any, ...]] = []
        column_payload = [column.model_dump(mode="json") for column in columns]
        observed_bytes = canonical_empty_result_bytes(column_payload)
        fetch_batches = 0
        if observed_bytes > frame.budget.max_bytes:
            raise SandboxCutoff(
                "SANDBOX_BYTE_LIMIT_EXCEEDED",
                observed_bytes=0,
                fetch_batches=0,
                locked_oids=locked_oids,
                retained_canonical_bytes=0,
                current_batch_estimated_bytes=observed_bytes,
            )
        while True:
            batch = await cursor.fetchmany(self.fetch_size)
            if not batch:
                break
            fetch_batches += 1
            for raw_row in batch:
                try:
                    normalized_row = tuple(
                        _json_value(value, type_oid)
                        for value, type_oid in zip(
                            raw_row,
                            type_oids,
                            strict=True,
                        )
                    )
                except SandboxCutoff as error:
                    raise SandboxCutoff(
                        error.reason_code,
                        observed_rows=len(rows),
                        observed_bytes=observed_bytes,
                        fetch_batches=fetch_batches,
                        locked_oids=locked_oids,
                        retained_canonical_bytes=observed_bytes,
                        current_batch_estimated_bytes=len(
                            canonical_json([str(value) for value in raw_row]).encode()
                        ),
                    ) from error
                current_batch_bytes = canonical_result_row_increment_bytes(
                    normalized_row,
                    has_retained_rows=bool(rows),
                )
                candidate_bytes = observed_bytes + current_batch_bytes
                if len(rows) >= frame.budget.max_rows:
                    raise SandboxCutoff(
                        "SANDBOX_ROW_LIMIT_EXCEEDED",
                        observed_rows=len(rows),
                        observed_bytes=observed_bytes,
                        fetch_batches=fetch_batches,
                        locked_oids=locked_oids,
                        retained_canonical_bytes=observed_bytes,
                        current_batch_estimated_bytes=current_batch_bytes,
                    )
                if candidate_bytes > frame.budget.max_bytes:
                    raise SandboxCutoff(
                        "SANDBOX_BYTE_LIMIT_EXCEEDED",
                        observed_rows=len(rows),
                        observed_bytes=observed_bytes,
                        fetch_batches=fetch_batches,
                        locked_oids=locked_oids,
                        retained_canonical_bytes=observed_bytes,
                        current_batch_estimated_bytes=current_batch_bytes,
                    )
                if candidate_bytes > frame.budget.max_memory_mb * 1_048_576:
                    raise SandboxCutoff(
                        "SANDBOX_MEMORY_LIMIT_EXCEEDED",
                        observed_rows=len(rows),
                        observed_bytes=observed_bytes,
                        fetch_batches=fetch_batches,
                        locked_oids=locked_oids,
                        retained_canonical_bytes=observed_bytes,
                        current_batch_estimated_bytes=current_batch_bytes,
                    )
                rows.append(normalized_row)
                observed_bytes = candidate_bytes
        await cursor.close()
        return _QueryResult(
            columns=columns,
            rows=tuple(rows),
            observed_rows=len(rows),
            observed_bytes=observed_bytes,
            fetch_batches=fetch_batches,
            locked_relation_oids=locked_oids,
            retained_canonical_bytes=observed_bytes,
            current_batch_estimated_bytes=0,
        )
