from __future__ import annotations

import argparse
import base64
import hashlib
import json
import socket
from typing import Any

WORKSPACE_ID = "10000000-0000-4000-8000-000000000001"
RUN_ID = "10000000-0000-4000-8000-000000000002"
RUNTIME_DIGEST = "sha256:fb87dca4ebb60441f626c11504270c1fce2e30dc3f9ab52f0443c81024766841"
LOCK_DIGEST = "sha256:6896730ae912ccb5a5e434f39921de0e6dd718cf070dc4ee18f253422ecf62cf"


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


def envelope(token: str, identifier: str = "container-execution-smoke") -> dict[str, Any]:
    source = (
        b"def main(context):\n"
        b"    values = context.read('source_rows')\n"
        b"    context.write_json('result', {'sum': sum(values['numbers'])})\n"
    )
    input_value = b'{"numbers":[1,2,3]}'
    output_value = b'{"sum":6}\n'
    source_ref = reference(
        "10000000-0000-4000-8000-000000000003", "SandboxProgram", digest(source)
    )
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
        "runtime_digest": RUNTIME_DIGEST,
        "dependency_lock_digest": LOCK_DIGEST,
        "policy_version": "python-policy@1.0.0",
        "budgets": {
            "wall_time_ms": 2000,
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="/run/data-agent-python/sandbox.sock")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(10)
        client.connect(args.socket)
        client.sendall(json.dumps(envelope(args.token), separators=(",", ":")).encode() + b"\n")
        chunks: list[bytes] = []
        while not chunks or not chunks[-1].endswith(b"\n"):
            chunks.append(client.recv(65536))
    outcome = json.loads(b"".join(chunks))
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    if outcome.get("receipt", {}).get("status") != "SUCCEEDED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
