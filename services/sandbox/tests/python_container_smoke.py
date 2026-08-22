from __future__ import annotations

import argparse
import base64
import hashlib
import json
import socket
import threading
import time
from typing import Any

WORKSPACE_ID = "10000000-0000-4000-8000-000000000001"
RUN_ID = "10000000-0000-4000-8000-000000000002"
RUNTIME_DIGEST = "sha256:ba715fb76f683bb538df7553616dcfb0e54c506ca90bf40c7b88ca6c99d5fe84"
LOCK_DIGEST = "sha256:0bbe3f0927d415634b6f520505b06594601cfb7a0ff707e1c9fae905124100d8"


def digest(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def reference(identifier: str, artifact_type: str, content_hash: str) -> dict[str, Any]:
    return {
        "artifact_id": identifier,
        "artifact_type": artifact_type,
        "app_id": "10000000-0000-4000-8000-000000000006",
        "tenant_id": WORKSPACE_ID,
        "environment": "test",
        "run_id": RUN_ID,
        "revision": 1,
        "content_hash": content_hash,
    }


def envelope(
    token: str,
    identifier: str = "container-execution-smoke",
    *,
    case: str = "success",
    runtime_digest: str = RUNTIME_DIGEST,
    lock_digest: str = LOCK_DIGEST,
) -> dict[str, Any]:
    sources = {
        "success": (
            b"def main(context):\n"
            b"    values = context.read('source_rows')\n"
            b"    context.write_json('result', {'sum': sum(values['numbers'])})\n"
        ),
        "malicious": b"import os\ndef main(context):\n    context.write_json('result', {})\n",
        "resource": b"def main(context):\n    while True:\n        pass\n",
        "cancel": b"def main(context):\n    while True:\n        pass\n",
    }
    source = sources[case]
    input_value = b'{"numbers":[1,2,3]}'
    output_value = b'{"sum":6}\n'
    source_ref = reference("10000000-0000-4000-8000-000000000003", "SandboxProgram", digest(source))
    input_ref = reference(
        "10000000-0000-4000-8000-000000000004", "QueryEvidence", digest(input_value)
    )
    output_ref = reference(
        "10000000-0000-4000-8000-000000000005", "SandboxResult", digest(output_value)
    )
    request = {
        "schema_version": "1.0.0",
        "workspace_id": WORKSPACE_ID,
        "run_id": RUN_ID,
        "attempt": 0,
        "fence_token": "container-fence",
        "idempotency_key": identifier,
        "source_ref": source_ref,
        "source_sha256": source_ref["content_hash"],
        "entrypoint": "main",
        "input_refs": [input_ref],
        "output_contract": {
            "schema_version": "python-output-contract@1.0.0",
            "outputs": [{"name": "result", "type": "JSON", "required": True, "max_bytes": 4096}],
        },
        "runtime_digest": runtime_digest,
        "dependency_lock_digest": lock_digest,
        "policy_version": "python-policy@1.0.0",
        "budgets": {
            "wall_time_ms": 300 if case == "resource" else 5000,
            "cpu_seconds": 2,
            "memory_bytes": 536870912,
            "input_bytes": 1048576,
            "output_bytes": 1048576,
            "max_pids": 16,
            "max_open_files": 64,
            "stdout_bytes": 1024,
            "stderr_bytes": 2048,
        },
    }
    return {
        "protocol_version": "data-agent-python-sandbox-ipc@1.0.0",
        "authorization": token,
        "request": request,
        "source_code_base64": base64.b64encode(source).decode(),
        "inputs": [
            {
                "name": "source_rows",
                "format": "JSON",
                "reference": input_ref,
                "content_base64": base64.b64encode(input_value).decode(),
            }
        ],
        "output_references": [{"name": "result", "reference": output_ref}],
    }


def exchange(socket_path: str, document: dict[str, Any]) -> dict[str, Any]:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(10)
        client.connect(socket_path)
        client.sendall(json.dumps(document, separators=(",", ":")).encode() + b"\n")
        chunks: list[bytes] = []
        while not chunks or not chunks[-1].endswith(b"\n"):
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
    return json.loads(b"".join(chunks))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="/run/data-agent-python/sandbox.sock")
    parser.add_argument("--token", required=True)
    parser.add_argument(
        "--case",
        choices=("success", "malicious", "resource", "cancel"),
        default="success",
    )
    parser.add_argument("--runtime-digest", default=RUNTIME_DIGEST)
    parser.add_argument("--lock-digest", default=LOCK_DIGEST)
    args = parser.parse_args()
    identifier = f"container-{args.case}-smoke"
    execution = envelope(
        args.token,
        identifier,
        case=args.case,
        runtime_digest=args.runtime_digest,
        lock_digest=args.lock_digest,
    )
    if args.case == "cancel":
        captured: list[dict[str, Any]] = []
        thread = threading.Thread(target=lambda: captured.append(exchange(args.socket, execution)))
        thread.start()
        cancellation = {
            "protocol_version": "data-agent-python-sandbox-control@1.0.0",
            "operation": "CANCEL",
            "authorization": args.token,
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "idempotency_key": identifier,
            "fence_token": "container-fence",
        }
        for _ in range(100):
            if exchange(args.socket, cancellation).get("status") == "CANCEL_REQUESTED":
                break
            time.sleep(0.01)
        else:
            raise SystemExit("execution never became cancellable")
        thread.join(timeout=10)
        if thread.is_alive() or not captured:
            raise SystemExit("cancelled execution did not terminate")
        outcome = captured[0]
    else:
        outcome = exchange(args.socket, execution)
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    expected = {
        "success": ("SUCCEEDED", None),
        "malicious": ("FAILED", "PYTHON_POLICY_REJECTED"),
        "resource": ("FAILED", "PYTHON_TIMEOUT"),
        "cancel": ("CANCELLED", "PYTHON_CANCELLED"),
    }[args.case]
    receipt = outcome.get("receipt", {})
    if (receipt.get("status"), receipt.get("failure_code")) != expected:
        raise SystemExit(1)
    if args.case != "success" and (outcome.get("outputs") or receipt.get("output_refs")):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
