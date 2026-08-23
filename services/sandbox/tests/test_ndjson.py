from __future__ import annotations

import asyncio
import io

from data_agent_sandbox.protocol.models import (
    ExecuteFrame,
    bind_outcome,
    outcome_binding_from_execute,
)
from data_agent_sandbox.protocol.ndjson import serve_single_execution
from data_agent_sandbox.sql.canonical import (
    canonical_multiset_hash,
    sha256_content_hash,
)


class WaitingExecutor:
    def __init__(self) -> None:
        self.cancelled = asyncio.Event()

    async def execute(self, frame: ExecuteFrame):
        await self.cancelled.wait()
        result = {
            "columns": [{"name": "result", "type": "INTEGER"}],
            "rows": [[1]],
        }
        descriptor = frame.grant.snapshot_descriptor
        return bind_outcome(
            {
                **outcome_binding_from_execute(frame),
                "terminal": "COMPLETED",
                "reason_code": "SANDBOX_EXECUTION_COMPLETED",
                "started_at": frame.grant.issued_at,
                "completed_at": frame.grant.issued_at,
                "cancel_epoch_at_start": frame.grant.cancel_epoch,
                "cancel_epoch_observed": frame.grant.cancel_epoch + 1,
                "resource_facts": {
                    "elapsed_ms": 0,
                    "observed_rows": 1,
                    "observed_bytes": 65,
                    "peak_memory_mb": 1,
                    "retained_canonical_bytes": 65,
                    "current_batch_estimated_bytes": 0,
                    "process_rss_high_water_bytes": 0,
                    "cgroup_memory_limit_enforced": False,
                    "partial_output_discarded": False,
                    "cutoff_kind": "NONE",
                },
                "cancel_facts": {
                    "cancel_requested": True,
                    "query_cancel_dispatched": True,
                    "query_cancel_confirmed": True,
                    "cancel_disposition": "QUERY_CANCEL_CONFIRMED",
                    "cancel_epoch_at_start": frame.grant.cancel_epoch,
                    "cancel_epoch_observed": frame.grant.cancel_epoch + 1,
                    "cancel_requested_at": frame.grant.issued_at,
                },
                "rollback_facts": {
                    "rollback_confirmed": True,
                    "datasource_terminal": "ROLLED_BACK_CLEAN",
                },
                "connection_facts": {
                    "backend_pid": 123,
                    "transaction_status": "IDLE",
                    "connection_reused": False,
                },
                "transaction": {
                    "transaction_id": "00000000-0000-4000-8000-00000000ef01",
                    "read_only": True,
                    "isolation_level": "REPEATABLE_READ",
                },
                "applied_execution_settings": {
                    key: value
                    for key, value in frame.settings.model_dump(mode="json").items()
                    if key != "idle_in_transaction_session_timeout_ms"
                },
                "manifest_facts": {
                    "snapshot_descriptor_hash": descriptor.descriptor_hash,
                    "schema_manifest_hash": descriptor.schema_manifest_hash,
                    "data_manifest_hash": descriptor.data_manifest_hash,
                    "fixture_manifest_hash": descriptor.fixture_manifest_hash,
                    "manifest_revalidated": True,
                    "revalidated_at": frame.grant.issued_at,
                },
                "canonical_multiset_facts": {
                    "canonical_multiset_hash": canonical_multiset_hash([[1]]),
                    "ordered_result_hash": sha256_content_hash(result),
                },
                "result": result,
            }
        )

    async def request_cancel(self, execute: ExecuteFrame, cancel) -> bool:
        self.cancelled.set()
        return True


async def test_single_execution_ndjson_accepts_execute_then_cancel(
    execute_payload,
) -> None:
    execute = ExecuteFrame.model_validate(execute_payload)
    cancel = {
        "protocol_version": execute.protocol_version,
        "frame_type": "CANCEL",
        "grant_hash": execute.grant.grant_hash,
        "lease_id": execute.grant.lease_id,
        "execution_id": execute.grant.execution_id,
        "attempt_id": execute.grant.attempt_id,
        "execution_fence": execute.grant.execution_fence,
        "cancel_epoch": execute.grant.cancel_epoch + 1,
        "requested_at": execute.grant.issued_at.isoformat(),
        "reason_code": "USER_CANCELLED",
    }
    reader = asyncio.StreamReader()
    reader.feed_data((execute.model_dump_json() + "\n").encode())
    reader.feed_data((__import__("json").dumps(cancel) + "\n").encode())
    reader.feed_eof()
    output = io.StringIO()

    await serve_single_execution(reader, output, executor=WaitingExecutor())

    lines = output.getvalue().splitlines()
    assert len(lines) == 1
    assert '"frame_type":"OUTCOME"' in lines[0]
    assert "postgresql://" not in lines[0]
