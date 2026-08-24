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
RUNTIME_DIGEST = "sha256:64760a1d47d8957c4b73d9d1f62036224290b62bfaa4b76a032952023c4f2ba4"
LOCK_DIGEST = "sha256:0bbe3f0927d415634b6f520505b06594601cfb7a0ff707e1c9fae905124100d8"
OPERATOR_REGISTRY_DIGEST = "sha256:2a933715899a37022349415a88ef42987d67914bbcfe2472c4f6ddc80d278f18"
IMAGE_DIGEST = "sha256:51f584d8f62464bb3553d164449c8b4c9a8e69b6f314172f4e9d12a1fdea5228"


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
        "operator": (
            b"def main(context):\n"
            b"    adjusted = context.operators.call(\n"
            b"        'multiple-testing.bh-fdr@1',\n"
            b"        call_id='smoke_bh',\n"
            b"        inputs={'tests': [\n"
            b"            {'label': 'a', 'p_value': 0.01},\n"
            b"            {'label': 'b', 'p_value': 0.2},\n"
            b"        ]},\n"
            b"    )\n"
            b"    context.write_json('result', {'tests': adjusted['tests']})\n"
        ),
        "malicious": b"import os\ndef main(context):\n    context.write_json('result', {})\n",
        "resource": b"def main(context):\n    while True:\n        pass\n",
        "cancel": b"def main(context):\n    while True:\n        pass\n",
    }
    source = sources[case]
    input_value = b'{"numbers":[1,2,3]}'
    output_value = (
        json.dumps(
            {
                "tests": [
                    {
                        "adjusted_p_value": 0.02,
                        "alpha": 0.05,
                        "family_size": 2,
                        "label": "a",
                        "method": "bh",
                        "rejected": True,
                    },
                    {
                        "adjusted_p_value": 0.2,
                        "alpha": 0.05,
                        "family_size": 2,
                        "label": "b",
                        "method": "bh",
                        "rejected": False,
                    },
                ]
            }
            if case == "operator"
            else {"sum": 6},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        + b"\n"
    )
    source_ref = reference("10000000-0000-4000-8000-000000000003", "SandboxProgram", digest(source))
    input_ref = reference(
        "10000000-0000-4000-8000-000000000004", "QueryEvidence", digest(input_value)
    )
    output_ref = reference(
        "10000000-0000-4000-8000-000000000005", "SandboxResult", digest(output_value)
    )
    output_slot = {key: value for key, value in output_ref.items() if key != "content_hash"}
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
        "generated_source_policy": (
            "GOVERNED_OPERATOR_ORCHESTRATION" if case == "operator" else "OPEN_ANALYSIS"
        ),
        "operator_registry_digest": OPERATOR_REGISTRY_DIGEST,
        "operator_obligations": (
            [
                {
                    "call_id": "smoke_bh",
                    "operator_id": "multiple-testing.bh-fdr@1",
                    "result_binding": {
                        "result_output_name": "result",
                        "result_collection_path": "/tests",
                        "operator_collection_path": "/tests",
                        "label_fields": ["label"],
                        "value_bindings": [
                            {
                                "result_field": "adjusted_p_value",
                                "operator_field": "adjusted_p_value",
                                "comparison": "NUMERIC_TOLERANCE",
                                "absolute_tolerance": 1e-12,
                                "relative_tolerance": 1e-12,
                            },
                            {
                                "result_field": "rejected",
                                "operator_field": "rejected",
                                "comparison": "EXACT",
                                "absolute_tolerance": 0,
                                "relative_tolerance": 0,
                            },
                        ],
                        "require_exact_label_set": True,
                    },
                }
            ]
            if case == "operator"
            else []
        ),
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
        "protocol_version": "data-agent-python-sandbox-ipc@2.0.0",
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
        "output_slots": [{"name": "result", **output_slot}],
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
        choices=("success", "operator", "malicious", "resource", "cancel"),
        default="success",
    )
    parser.add_argument("--runtime-digest", default=RUNTIME_DIGEST)
    parser.add_argument("--lock-digest", default=LOCK_DIGEST)
    parser.add_argument("--image-digest", default=IMAGE_DIGEST)
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
        "operator": ("SUCCEEDED", None),
        "malicious": ("FAILED", "PYTHON_POLICY_IMPORT_DENIED"),
        "resource": ("FAILED", "PYTHON_TIMEOUT"),
        "cancel": ("CANCELLED", "PYTHON_CANCELLED"),
    }[args.case]
    receipt = outcome.get("receipt", {})
    if (receipt.get("status"), receipt.get("failure_code")) != expected:
        raise SystemExit(1)
    if args.case in {"malicious", "resource", "cancel"} and (
        outcome.get("outputs") or receipt.get("output_refs")
    ):
        raise SystemExit(1)
    if receipt.get("operator_registry_digest") != OPERATOR_REGISTRY_DIGEST:
        raise SystemExit(1)
    if receipt.get("sandbox_image_digest") != args.image_digest:
        raise SystemExit(1)
    if args.case == "operator":
        operator_receipts = receipt.get("operator_receipts", [])
        if len(operator_receipts) != 1 or operator_receipts[0].get("call_id") != "smoke_bh":
            raise SystemExit(1)
        output = json.loads(base64.b64decode(outcome["outputs"][0]["content_base64"]))
        if [row["adjusted_p_value"] for row in output["tests"]] != [0.02, 0.2]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
