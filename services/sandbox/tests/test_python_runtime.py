from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from pathlib import Path

import pytest

from data_agent_sandbox.python_runtime.models import (
    MaterializedPythonInput,
    PythonArtifactReference,
    PythonExecutionBudgets,
    PythonExecutionEnvelope,
    PythonExecutionRequest,
    PythonHardControls,
    PythonOutputContract,
    PythonOutputSlot,
    PythonOutputSpec,
)
from data_agent_sandbox.python_runtime.policy import PythonPolicyError, validate_python_source
from data_agent_sandbox.python_runtime.supervisor import (
    PythonSandboxSupervisor,
    SandboxConfiguration,
)

WORKSPACE_ID = "10000000-0000-4000-8000-000000000001"
RUN_ID = "10000000-0000-4000-8000-000000000002"
SOURCE_ID = "10000000-0000-4000-8000-000000000003"
INPUT_ID = "10000000-0000-4000-8000-000000000004"
OUTPUT_ID = "10000000-0000-4000-8000-000000000005"
DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64
DIGEST_C = "sha256:" + "c" * 64
TOKEN = "sandbox-test-authorization-token-000000000000"


def digest(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def reference(artifact_id: str, content_hash: str, artifact_type: str) -> PythonArtifactReference:
    return PythonArtifactReference(
        artifact_id=artifact_id,
        artifact_type=artifact_type,
        app_id="10000000-0000-4000-8000-000000000006",
        tenant_id=WORKSPACE_ID,
        environment="test",
        run_id=RUN_ID,
        revision=1,
        content_hash=content_hash,
    )


def configuration(tmp_path: Path) -> SandboxConfiguration:
    return SandboxConfiguration(
        authorization=TOKEN,
        image_digest=DIGEST_A,
        runtime_digest=DIGEST_B,
        dependency_lock_digest=DIGEST_C,
        policy_version="python-policy@1.0.0",
        job_root=tmp_path,
        executor_uid=None,
        executor_gid=None,
        hard_controls=PythonHardControls(
            network_isolated=True,
            filesystem_isolated=True,
            memory_limit_enforced=True,
            cpu_limit_enforced=True,
            pid_limit_enforced=True,
        ),
        max_wall_ms=5_000,
        max_cpu_seconds=5,
        max_memory_bytes=1_073_741_824,
        max_input_bytes=1_048_576,
        max_output_bytes=1_048_576,
        max_pids=32,
        max_open_files=64,
    )


def envelope_for(
    source: str,
    expected_output: bytes,
    *,
    identifier: str = "sandbox-request-one",
    wall_time_ms: int = 2_000,
    authorization: str = TOKEN,
    input_value: bytes = b'{"numbers":[1,2,3]}',
) -> PythonExecutionEnvelope:
    source_bytes = source.encode()
    source_ref = reference(SOURCE_ID, digest(source_bytes), "python-source")
    input_ref = reference(INPUT_ID, digest(input_value), "analysis-input")
    output_ref = reference(OUTPUT_ID, digest(expected_output), "SandboxResult")
    request = PythonExecutionRequest(
        schema_version="1.0.0",
        workspace_id=WORKSPACE_ID,
        run_id=RUN_ID,
        attempt=0,
        fence_token="fence-1",
        idempotency_key=identifier,
        source_ref=source_ref,
        source_sha256=source_ref.content_hash,
        entrypoint="main",
        input_refs=(input_ref,),
        output_contract=PythonOutputContract(
            schema_version="python-output-contract@1.0.0",
            outputs=(PythonOutputSpec(name="result", type="JSON", required=True, max_bytes=4096),),
        ),
        runtime_digest=DIGEST_B,
        dependency_lock_digest=DIGEST_C,
        policy_version="python-policy@1.0.0",
        budgets=PythonExecutionBudgets(
            wall_time_ms=wall_time_ms,
            cpu_seconds=2,
            memory_bytes=536_870_912,
            input_bytes=1_048_576,
            output_bytes=1_048_576,
            max_pids=16,
            max_open_files=64,
            stdout_bytes=1024,
            stderr_bytes=2048,
        ),
    )
    return PythonExecutionEnvelope(
        protocol_version="data-agent-python-sandbox-ipc@2.0.0",
        authorization=authorization,
        request=request,
        source_code_base64=base64.b64encode(source_bytes).decode(),
        inputs=(
            MaterializedPythonInput(
                name="source_rows",
                format="JSON",
                reference=input_ref,
                content_base64=base64.b64encode(input_value).decode(),
            ),
        ),
        output_slots=(
            PythonOutputSlot(name="result", **output_ref.model_dump(exclude={"content_hash"})),
        ),
    )


@pytest.mark.parametrize(
    "source",
    [
        "import os\ndef main(context):\n    pass\n",
        "import socket\ndef main(context):\n    pass\n",
        "import subprocess\ndef main(context):\n    pass\n",
        "import pickle\ndef main(context):\n    pass\n",
        "import marshal\ndef main(context):\n    pass\n",
        "import ctypes\ndef main(context):\n    pass\n",
        "def main(context):\n    open('/etc/passwd').read()\n",
        "def main(context):\n    eval('1 + 1')\n",
        "def main(context):\n    __import__('os')\n",
        "def main(context):\n    context.__class__\n",
        "import pandas as pd\ndef main(context):\n    pd.read_csv('/etc/passwd')\n",
        "x = print('effect')\ndef main(context):\n    pass\n",
    ],
)
def test_policy_rejects_escape_surfaces(source: str) -> None:
    with pytest.raises(PythonPolicyError):
        validate_python_source(source)


def test_policy_accepts_capability_shaped_analysis() -> None:
    validate_python_source(
        "import statistics\n"
        "def main(context):\n"
        "    rows = context.read('source_rows')\n"
        "    context.write_json('result', {'mean': statistics.mean(rows['numbers'])})\n"
    )


def test_attested_target_platform_mismatch_fails_before_runtime_start(monkeypatch) -> None:
    monkeypatch.setenv("PYTHON_SANDBOX_AUTH_TOKEN", TOKEN)
    monkeypatch.setenv("PYTHON_SANDBOX_TARGET_PLATFORM", "linux/not-this-architecture")
    with pytest.raises(RuntimeError, match="does not match the executing platform"):
        SandboxConfiguration.from_environment()


def test_supervisor_executes_in_fresh_process_and_replays_receipt(tmp_path: Path) -> None:
    expected = b'{"sum":6}\n'
    request = envelope_for(
        "def main(context):\n"
        "    data = context.read('source_rows')\n"
        "    context.write_json('result', {'sum': sum(data['numbers'])})\n",
        expected,
    )
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    outcome = supervisor.execute(request)
    replay = supervisor.execute(request)

    assert outcome.receipt.status == "SUCCEEDED"
    assert outcome.receipt.hard_controls.model_dump() == {
        "network_isolated": True,
        "filesystem_isolated": True,
        "memory_limit_enforced": True,
        "cpu_limit_enforced": True,
        "pid_limit_enforced": True,
    }
    assert base64.b64decode(outcome.outputs[0].content_base64) == expected
    assert replay == outcome
    assert list(tmp_path.iterdir()) == []


def test_supervisor_rejects_unattested_runtime_without_starting(tmp_path: Path) -> None:
    request = envelope_for("def main(context):\n    pass\n", b"{}\n")
    config = replace(
        configuration(tmp_path),
        hard_controls=PythonHardControls(
            network_isolated=False,
            filesystem_isolated=False,
            memory_limit_enforced=False,
            cpu_limit_enforced=False,
            pid_limit_enforced=False,
        ),
    )
    outcome = PythonSandboxSupervisor(config).execute(request)
    assert outcome.receipt.failure_code == "PYTHON_SANDBOX_UNAVAILABLE"
    assert outcome.outputs == ()
    assert not tmp_path.exists() or list(tmp_path.iterdir()) == []


def test_supervisor_rejects_bad_auth_and_hashes_dynamic_output(tmp_path: Path) -> None:
    source = "def main(context):\n    context.write_json('result', {'ok': True})\n"
    bad_auth = envelope_for(source, b'{"ok":true}\n', authorization="x" * 32)
    auth_outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(bad_auth)
    assert auth_outcome.receipt.failure_code == "PYTHON_POLICY_AUTHORIZATION_INVALID"

    dynamic_output = envelope_for(source, b'{"ok":false}\n', identifier="sandbox-dynamic-output")
    output_outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(dynamic_output)
    assert output_outcome.receipt.status == "SUCCEEDED"
    assert output_outcome.outputs[0].content_sha256 == digest(b'{"ok":true}\n')
    assert output_outcome.outputs[0].reference == output_outcome.receipt.output_refs[0]


def test_supervisor_kills_process_group_on_timeout_and_commits_nothing(tmp_path: Path) -> None:
    request = envelope_for(
        "def main(context):\n    while True:\n        pass\n",
        b"{}\n",
        identifier="sandbox-timeout",
        wall_time_ms=100,
    )
    outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(request)
    assert outcome.receipt.failure_code == "PYTHON_TIMEOUT"
    assert outcome.receipt.output_refs == ()
    assert outcome.outputs == ()


def test_supervisor_projects_safe_sdk_failure_code_without_exposing_stderr(tmp_path: Path) -> None:
    request = envelope_for(
        "def main(context):\n    context.read('missing_input')\n",
        b"{}\n",
        identifier="sandbox-safe-failure-code",
    )
    outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(request)

    assert outcome.receipt.failure_code == "PYTHON_INPUT_NOT_DECLARED"
    assert outcome.receipt.status == "FAILED"


@pytest.mark.parametrize(
    ("statement", "failure_code"),
    [
        ("1 + 'x'", "PYTHON_TYPE_ERROR"),
        ("{}['missing']", "PYTHON_KEY_ERROR"),
        ("[][0]", "PYTHON_INDEX_ERROR"),
        ("int('x')", "PYTHON_VALUE_ERROR"),
        ("1 / 0", "PYTHON_ZERO_DIVISION_ERROR"),
    ],
)
def test_supervisor_projects_fixed_python_exception_types(
    tmp_path: Path, statement: str, failure_code: str
) -> None:
    request = envelope_for(
        f"def main(context):\n    {statement}\n",
        b"{}\n",
        identifier=f"sandbox-{failure_code.lower()}",
    )
    outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(request)

    assert outcome.receipt.failure_code == failure_code
    assert outcome.receipt.status == "FAILED"
    assert outcome.outputs == ()


def test_each_request_has_fresh_module_state(tmp_path: Path) -> None:
    source = (
        "STATE = []\n"
        "def main(context):\n"
        "    STATE.append('x')\n"
        "    context.write_json('result', {'state_size': len(STATE)})\n"
    )
    expected = b'{"state_size":1}\n'
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    first = supervisor.execute(envelope_for(source, expected, identifier="sandbox-state-one"))
    second = supervisor.execute(envelope_for(source, expected, identifier="sandbox-state-two"))
    assert first.receipt.status == second.receipt.status == "SUCCEEDED"


def test_same_idempotency_key_with_different_hash_fails_closed(tmp_path: Path) -> None:
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    first = envelope_for(
        "def main(context):\n    context.write_json('result', {'value': 1})\n",
        b'{"value":1}\n',
        identifier="sandbox-conflict",
    )
    second = envelope_for(
        "def main(context):\n    context.write_json('result', {'value': 2})\n",
        b'{"value":2}\n',
        identifier="sandbox-conflict",
    )
    assert supervisor.execute(first).receipt.status == "SUCCEEDED"
    assert supervisor.execute(second).receipt.failure_code == "PYTHON_POLICY_IDEMPOTENCY_CONFLICT"


def test_same_idempotency_key_with_different_output_slot_fails_closed(tmp_path: Path) -> None:
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    first = envelope_for(
        "def main(context):\n    context.write_json('result', {'value': 1})\n",
        b'{"value":1}\n',
        identifier="sandbox-output-slot-conflict",
    )
    changed_slot = first.output_slots[0].model_copy(
        update={"artifact_id": "10000000-0000-4000-8000-000000000007"}
    )
    second = first.model_copy(update={"output_slots": (changed_slot,)})
    assert supervisor.execute(first).receipt.status == "SUCCEEDED"
    assert supervisor.execute(second).receipt.failure_code == "PYTHON_POLICY_IDEMPOTENCY_CONFLICT"


def test_supervisor_projects_exact_ast_policy_violation(tmp_path: Path) -> None:
    request = envelope_for(
        "def main(sdk):\n    pass\n",
        b"{}\n",
        identifier="sandbox-entrypoint-policy",
    )

    outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(request)

    assert outcome.receipt.failure_code == "PYTHON_POLICY_ENTRYPOINT_SIGNATURE_INVALID"


def test_envelope_forbids_unknown_fields_and_cross_run_refs() -> None:
    request = envelope_for("def main(context):\n    pass\n", b"{}\n")
    payload = request.model_dump(mode="json")
    payload["unexpected"] = True
    with pytest.raises(ValueError):
        PythonExecutionEnvelope.model_validate(payload)

    payload.pop("unexpected")
    payload["inputs"][0]["reference"]["run_id"] = "20000000-0000-4000-8000-000000000002"
    with pytest.raises(ValueError):
        PythonExecutionEnvelope.model_validate(payload)
