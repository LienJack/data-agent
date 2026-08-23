from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol, TextIO

from data_agent_sandbox.protocol.models import (
    CancelFrame,
    ExecuteFrame,
    OutcomeEnvelope,
    decode_input_frame,
)
from data_agent_sandbox.sql.executor import SqlSandboxExecutor

logger = logging.getLogger(__name__)


class AsyncLineReader(Protocol):
    async def readline(self) -> bytes: ...


async def serve_single_execution(
    reader: AsyncLineReader,
    writer: TextIO,
    *,
    executor: Any | None = None,
) -> None:
    """Consume one EXECUTE plus optional bound CANCEL frames and emit one outcome."""

    first_line = await reader.readline()
    if not first_line:
        raise ValueError("sandbox NDJSON stream must begin with EXECUTE")
    first_frame = decode_input_frame(first_line)
    if not isinstance(first_frame, ExecuteFrame):
        raise ValueError("first sandbox NDJSON frame must be EXECUTE")

    sandbox = executor or SqlSandboxExecutor()
    execution_task = asyncio.create_task(sandbox.execute(first_frame))
    while not execution_task.done():
        read_task = asyncio.create_task(reader.readline())
        done, _ = await asyncio.wait(
            {execution_task, read_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if execution_task in done:
            read_task.cancel()
            break
        line = read_task.result()
        if not line:
            break
        frame = decode_input_frame(line)
        if not isinstance(frame, CancelFrame):
            execution_task.cancel()
            raise ValueError("only CANCEL may follow the initial EXECUTE")
        accepted = await sandbox.request_cancel(first_frame, frame)
        logger.info("bound cancel requested; accepted=%s", accepted)

    outcome = await execution_task
    envelope = OutcomeEnvelope(
        protocol_version=first_frame.protocol_version,
        frame_type="OUTCOME",
        outcome=outcome,
    )
    writer.write(envelope.model_dump_json() + "\n")
    writer.flush()
