from __future__ import annotations

import argparse
import hmac
import json
import os
import socketserver
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from data_agent_sandbox.python_runtime.models import (
    PythonCancellationOutcome,
    PythonCancellationRequest,
    PythonExecutionEnvelope,
)
from data_agent_sandbox.python_runtime.supervisor import (
    PythonSandboxSupervisor,
    SandboxConfiguration,
)

_MAX_MESSAGE_BYTES = 768 * 1024 * 1024


class _PythonSandboxHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw = self.rfile.readline(_MAX_MESSAGE_BYTES + 1)
        if not raw or len(raw) > _MAX_MESSAGE_BYTES or not raw.endswith(b"\n"):
            self._write_error("PYTHON_PROTOCOL_INVALID")
            return
        try:
            document: Any = json.loads(raw)
            if document.get("operation") == "CANCEL":
                cancellation = PythonCancellationRequest.model_validate(document)
                if not hmac.compare_digest(
                    cancellation.authorization,
                    self.server.supervisor.configuration.authorization,  # type: ignore[attr-defined]
                ):
                    status = "REJECTED"
                else:
                    status = (
                        "CANCEL_REQUESTED"
                        if self.server.supervisor.cancel(  # type: ignore[attr-defined]
                            workspace_id=cancellation.workspace_id,
                            run_id=cancellation.run_id,
                            idempotency_key=cancellation.idempotency_key,
                            fence_token=cancellation.fence_token,
                        )
                        else "NOT_ACTIVE"
                    )
                outcome = PythonCancellationOutcome(
                    protocol_version="data-agent-python-sandbox-control@1.0.0",
                    operation="CANCEL",
                    status=status,
                )
                self.wfile.write(outcome.model_dump_json().encode("utf-8") + b"\n")
                return
            envelope = PythonExecutionEnvelope.model_validate(document)
            outcome = self.server.supervisor.execute(envelope)  # type: ignore[attr-defined]
            self.wfile.write(outcome.model_dump_json().encode("utf-8") + b"\n")
        except (json.JSONDecodeError, ValidationError):
            self._write_error("PYTHON_PROTOCOL_INVALID")
        except Exception:
            self._write_error("PYTHON_SANDBOX_UNAVAILABLE")

    def _write_error(self, code: str) -> None:
        self.wfile.write(
            json.dumps(
                {
                    "protocol_version": "data-agent-python-sandbox-ipc@1.0.0",
                    "transport_error": code,
                },
                separators=(",", ":"),
            ).encode("utf-8")
            + b"\n"
        )


class PythonSandboxUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, path: str, supervisor: PythonSandboxSupervisor):
        self.supervisor = supervisor
        super().__init__(path, _PythonSandboxHandler)


def serve(socket_path: Path) -> None:
    configuration = SandboxConfiguration.from_environment()
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    if socket_path.exists():
        socket_path.unlink()
    with PythonSandboxUnixServer(
        str(socket_path), PythonSandboxSupervisor(configuration)
    ) as server:
        os.chmod(socket_path, 0o660)
        socket_gid = os.environ.get("PYTHON_SANDBOX_SOCKET_GID")
        if socket_gid and socket_path.stat().st_gid != int(socket_gid):
            # The setgid IPC directory makes the socket inherit its group in the
            # hardened container. chown is only a fallback for non-container
            # development because the production service intentionally lacks CAP_CHOWN.
            os.chown(socket_path, -1, int(socket_gid))
        server.serve_forever(poll_interval=0.25)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--socket",
        default=os.environ.get("PYTHON_SANDBOX_SOCKET_PATH", "/run/data-agent-python/sandbox.sock"),
    )
    args = parser.parse_args()
    serve(Path(args.socket))


if __name__ == "__main__":
    main()
