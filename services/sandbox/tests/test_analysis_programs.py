from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
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
    PythonOutputReferenceBinding,
    PythonOutputSpec,
)
from data_agent_sandbox.python_runtime.policy import PythonPolicyError, validate_python_source
from data_agent_sandbox.python_runtime.supervisor import (
    PythonSandboxSupervisor,
    SandboxConfiguration,
)

WORKSPACE_ID = "30000000-0000-4000-8000-000000000001"
RUN_ID = "30000000-0000-4000-8000-000000000002"
APP_ID = "30000000-0000-4000-8000-000000000003"
TOKEN = "analysis-program-authorization-token-000000000"
DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64
DIGEST_C = "sha256:" + "c" * 64
PROGRAM_ROOT = Path(__file__).parents[1] / "programs" / "standard"


def digest(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
        )
        + "\n"
    ).encode()


def reference(index: int, artifact_type: str, content_hash: str) -> PythonArtifactReference:
    return PythonArtifactReference(
        artifact_id=f"30000000-0000-4000-8000-{index:012d}",
        artifact_type=artifact_type,
        app_id=APP_ID,
        tenant_id=WORKSPACE_ID,
        environment="test",
        run_id=RUN_ID,
        revision=1,
        content_hash=content_hash,
    )


def configuration(tmp_path: Path, profile: str = "CORE_ANALYSIS") -> SandboxConfiguration:
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
        max_input_bytes=16_777_216,
        max_output_bytes=16_777_216,
        max_pids=32,
        max_open_files=64,
        import_profile=profile,  # type: ignore[arg-type]
    )


def envelope(
    program_name: str,
    input_value: object,
    expected_outputs: dict[str, object],
    *,
    identifier: str | None = None,
    wall_time_ms: int = 3_000,
) -> PythonExecutionEnvelope:
    source = (PROGRAM_ROOT / f"{program_name}.py").read_bytes()
    input_bytes = canonical_bytes(input_value)
    source_ref = reference(10, "SensitiveExecutionArtifact", digest(source))
    input_ref = reference(11, "QueryEvidence", digest(input_bytes))
    output_specs = []
    output_bindings = []
    for index, (name, value) in enumerate(expected_outputs.items(), start=20):
        content = canonical_bytes(value)
        output_specs.append(
            PythonOutputSpec(name=name, type="JSON", required=True, max_bytes=1_048_576)
        )
        output_bindings.append(
            PythonOutputReferenceBinding(
                name=name,
                reference=reference(index, "SandboxResult", digest(content)),
            )
        )
    request = PythonExecutionRequest(
        schema_version="1.0.0",
        workspace_id=WORKSPACE_ID,
        run_id=RUN_ID,
        attempt=0,
        fence_token="analysis-fence-1",
        idempotency_key=identifier or f"standard-{program_name}",
        source_ref=source_ref,
        source_sha256=source_ref.content_hash,
        entrypoint="main",
        input_refs=(input_ref,),
        output_contract=PythonOutputContract(
            schema_version="python-output-contract@1.0.0", outputs=tuple(output_specs)
        ),
        runtime_digest=DIGEST_B,
        dependency_lock_digest=DIGEST_C,
        policy_version="python-policy@1.0.0",
        budgets=PythonExecutionBudgets(
            wall_time_ms=wall_time_ms,
            cpu_seconds=3,
            memory_bytes=536_870_912,
            input_bytes=16_777_216,
            output_bytes=16_777_216,
            max_pids=16,
            max_open_files=64,
            stdout_bytes=1_024,
            stderr_bytes=2_048,
        ),
    )
    return PythonExecutionEnvelope(
        protocol_version="data-agent-python-sandbox-ipc@1.0.0",
        authorization=TOKEN,
        request=request,
        source_code_base64=base64.b64encode(source).decode(),
        inputs=(
            MaterializedPythonInput(
                name="source_rows",
                format="JSON",
                reference=input_ref,
                content_base64=base64.b64encode(input_bytes).decode(),
            ),
        ),
        output_references=tuple(output_bindings),
    )


def output_json(outcome: object, name: str = "result") -> object:
    outputs = outcome.outputs  # type: ignore[attr-defined]
    materialized = next(item for item in outputs if item.name == name)
    return json.loads(base64.b64decode(materialized.content_base64))


def independent_trend_oracle(rows: list[dict[str, object]]) -> dict[str, object]:
    totals: dict[str, float] = {}
    for row in rows:
        value = row.get("value")
        if value is not None:
            period = str(row["period_start"])
            totals[period] = totals.get(period, 0.0) + float(value)  # type: ignore[arg-type]
    points: list[dict[str, object]] = []
    previous: float | None = None
    for period, value in sorted(totals.items()):
        delta = None if previous is None else value - previous
        points.append(
            {
                "period_start": period,
                "value": value,
                "absolute_delta": delta,
                "relative_delta": None if previous in (None, 0) else delta / previous,
            }
        )
        previous = value
    return {
        "result_kind": "TREND_CHANGE",
        "points": points,
        "first_value": points[0]["value"] if points else None,
        "last_value": points[-1]["value"] if points else None,
    }


def test_standard_programs_follow_the_real_sdk_ipc_receipt_path(tmp_path: Path) -> None:
    group_a = "sha256:" + "1" * 64
    group_b = "sha256:" + "2" * 64
    fixtures = [
        (
            "data_profile",
            {"rows": [{"id": 1, "value": 2.5}, {"id": 2, "value": None}]},
            {
                "row_count": 2,
                "columns": [
                    {
                        "name": "id",
                        "physical_type": "integer",
                        "null_count": 0,
                        "distinct_estimate": 2,
                    },
                    {
                        "name": "value",
                        "physical_type": "number",
                        "null_count": 1,
                        "distinct_estimate": 1,
                    },
                ],
                "candidate_grain": [],
            },
        ),
        (
            "trend_change",
            {
                "rows": [
                    {"period_start": "2026-01-02T00:00:00Z", "value": 12},
                    {"period_start": "2026-01-01T00:00:00Z", "value": 10},
                ]
            },
            {
                "result_kind": "TREND_CHANGE",
                "points": [
                    {
                        "period_start": "2026-01-01T00:00:00Z",
                        "value": 10.0,
                        "absolute_delta": None,
                        "relative_delta": None,
                    },
                    {
                        "period_start": "2026-01-02T00:00:00Z",
                        "value": 12.0,
                        "absolute_delta": 2.0,
                        "relative_delta": 0.2,
                    },
                ],
                "first_value": 10.0,
                "last_value": 12.0,
            },
        ),
        (
            "contribution_concentration",
            {
                "rows": [
                    {"group_key_hash": group_b, "baseline": 10, "current": 8},
                    {"group_key_hash": group_a, "baseline": 5, "current": 9},
                ],
                "observed_total_delta": 2,
            },
            {
                "result_kind": "CONTRIBUTION_CONCENTRATION",
                "groups": [
                    {
                        "group_key_hash": group_a,
                        "baseline": 5.0,
                        "current": 9.0,
                        "signed_delta": 4.0,
                        "change_share": 2.0,
                    },
                    {
                        "group_key_hash": group_b,
                        "baseline": 10.0,
                        "current": 8.0,
                        "signed_delta": -2.0,
                        "change_share": -1.0,
                    },
                ],
                "residual": 0.0,
                "closure_tolerance": 1e-9,
                "hhi": 5 / 9,
            },
        ),
    ]
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    for program_name, source, expected in fixtures:
        outcome = supervisor.execute(envelope(program_name, source, {"result": expected}))
        assert outcome.receipt.status == "SUCCEEDED", outcome.stderr
        assert output_json(outcome) == expected


def test_anomaly_association_and_forecast_golden_properties(tmp_path: Path) -> None:
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    anomaly_rows = [
        {"period_start": f"2026-01-0{index + 1}T00:00:00Z", "value": value}
        for index, value in enumerate([8, 9, 10, 11, 12, 100])
    ]
    anomaly_probe = {
        "result_kind": "ROBUST_ANOMALY",
        "anomalies": [
            {
                "period_start": "2026-01-06T00:00:00Z",
                "observed": 100.0,
                "expected": 10.5,
                "robust_score": (100 - 10.5) / (1.4826 * 1.5),
                "direction": "HIGH",
            }
        ],
        "sample_size": 6,
    }
    anomaly = supervisor.execute(
        envelope("robust_anomaly", {"rows": anomaly_rows}, {"result": anomaly_probe})
    )
    assert anomaly.receipt.status == "SUCCEEDED", anomaly.stderr
    assert output_json(anomaly) == anomaly_probe

    association_expected = {
        "result_kind": "ASSOCIATION_OUTLIER_COMPLETENESS",
        "pearson_r": 1.0,
        "spearman_rho": 1.0,
        "q_value": None,
        "paired_sample_size": 3,
        "missing_pair_count": 1,
        "outlier_count": 0,
        "completeness_ratio": 0.75,
    }
    association = supervisor.execute(
        envelope(
            "association_quality",
            {"rows": [{"x": 1, "y": 2}, {"x": 2, "y": 4}, {"x": 3, "y": 6}, {"x": None, "y": 8}]},
            {"result": association_expected},
        )
    )
    assert association.receipt.status == "SUCCEEDED", association.stderr
    assert output_json(association) == association_expected

    backtest_hash = "sha256:" + "9" * 64
    backtest_rows = [
        {"index": 3, "actual": 4.0, "prediction": 2.0},
        {"index": 4, "actual": 5.0, "prediction": 2.5},
    ]
    forecast_expected = {
        "result_kind": "BASELINE_FORECAST_BACKTEST",
        "selected_model": None,
        "baseline_model": "last-value@1.0.0",
        "horizon": 1,
        "mae": 2.25,
        "mase": 2.25,
        "useful": False,
        "forecast_rows_ref": None,
        "backtest_hash": backtest_hash,
    }
    forecast = supervisor.execute(
        envelope(
            "forecast_backtest",
            {
                "rows": [{"value": value} for value in [1, 2, 3, 4, 5]],
                "backtest_hash": backtest_hash,
            },
            {"result": forecast_expected, "backtest_rows": backtest_rows},
        )
    )
    assert forecast.receipt.status == "SUCCEEDED", forecast.stderr
    assert output_json(forecast) == forecast_expected
    assert output_json(forecast, "backtest_rows") == backtest_rows
    assert all(row["prediction"] < row["actual"] for row in backtest_rows)


def test_edge_cases_match_an_independent_oracle_and_remain_finite(tmp_path: Path) -> None:
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    base_rows: list[dict[str, object]] = [
        {"period_start": "2026-01-02T00:00:00Z", "value": 0},
        {"period_start": "2026-01-01T00:00:00Z", "value": -2},
        {"period_start": "2026-01-01T00:00:00Z", "value": 2},
        {"period_start": "2026-01-03T00:00:00Z", "value": None},
    ]
    for index, factor in enumerate((-3.0, 0.5, 4.0), start=1):
        rows = [
            {**row, "value": None if row["value"] is None else float(row["value"]) * factor}
            for row in base_rows
        ]
        expected = independent_trend_oracle(rows)
        outcome = supervisor.execute(
            envelope(
                "trend_change",
                {"rows": rows},
                {"result": expected},
                identifier=f"independent-trend-{index}",
            )
        )
        assert outcome.receipt.status == "SUCCEEDED", outcome.stderr
        assert output_json(outcome) == expected
        assert "NaN" not in canonical_bytes(expected).decode()
        assert "Infinity" not in canonical_bytes(expected).decode()

    group_a = "sha256:" + "1" * 64
    group_b = "sha256:" + "2" * 64
    cancelled = {
        "result_kind": "CONTRIBUTION_CONCENTRATION",
        "groups": [
            {
                "group_key_hash": group_a,
                "baseline": 0.0,
                "current": 5.0,
                "signed_delta": 5.0,
                "change_share": None,
            },
            {
                "group_key_hash": group_b,
                "baseline": 5.0,
                "current": 0.0,
                "signed_delta": -5.0,
                "change_share": None,
            },
        ],
        "residual": 0.0,
        "closure_tolerance": 1e-9,
        "hhi": 0.5,
    }
    contribution = supervisor.execute(
        envelope(
            "contribution_concentration",
            {
                "rows": [
                    {"group_key_hash": group_b, "baseline": 5, "current": 0},
                    {"group_key_hash": group_a, "baseline": 0, "current": 5},
                ],
                "observed_total_delta": 0,
            },
            {"result": cancelled},
            identifier="cancelled-contribution",
        )
    )
    assert contribution.receipt.status == "SUCCEEDED", contribution.stderr
    assert output_json(contribution) == cancelled

    for index, values in enumerate(([4.0] * 6, [1.0, 2.0, 100.0]), start=1):
        rows = [
            {"period_start": f"2026-02-{offset + 1:02d}T00:00:00Z", "value": value}
            for offset, value in enumerate(values)
        ]
        expected = {
            "result_kind": "ROBUST_ANOMALY",
            "anomalies": [],
            "sample_size": len(values),
        }
        anomaly = supervisor.execute(
            envelope(
                "robust_anomaly",
                {"rows": rows},
                {"result": expected},
                identifier=f"anomaly-edge-{index}",
            )
        )
        assert anomaly.receipt.status == "SUCCEEDED", anomaly.stderr
        assert output_json(anomaly) == expected


@pytest.mark.parametrize(
    "source",
    [
        "import os\ndef main(context):\n    pass\n",
        "import socket\ndef main(context):\n    pass\n",
        "import subprocess\ndef main(context):\n    pass\n",
        "import multiprocessing\ndef main(context):\n    pass\n",
        "import ctypes\ndef main(context):\n    pass\n",
        "import pickle\ndef main(context):\n    pass\n",
        "import pathlib\ndef main(context):\n    pathlib.Path('/tmp').read_text()\n",
        "def main(context):\n    open('/tmp/value')\n",
        "import os\ndef main(context):\n    os.fork()\n",
        "import numpy\ndef main(context):\n    numpy.ctypeslib.load_library('x', '.')\n",
        "def main(context):\n    eval('1')\n",
        "def main(context):\n    exec('pass')\n",
        "def main(context):\n    __import__('os')\n",
    ],
)
def test_generated_program_policy_rejects_malicious_surfaces(source: str) -> None:
    with pytest.raises(PythonPolicyError):
        validate_python_source(source)


def test_import_profiles_are_explicit_and_fail_closed() -> None:
    source = "import sklearn\ndef main(context):\n    pass\n"
    with pytest.raises(PythonPolicyError):
        validate_python_source(source, "CORE_ANALYSIS")
    validate_python_source(source, "ML_DIAGNOSTIC")
    with pytest.raises(PythonPolicyError):
        validate_python_source("import dowhy\ndef main(context):\n    pass\n", "ML_DIAGNOSTIC")


def test_cancellation_kills_the_process_group_and_commits_zero_outputs(tmp_path: Path) -> None:
    request = envelope(
        "trend_change",
        {"rows": []},
        {"result": {"unused": True}},
        identifier="standard-cancellation",
        wall_time_ms=3_000,
    )
    request = request.model_copy(
        update={
            "source_code_base64": base64.b64encode(
                b"def main(context):\n    while True:\n        pass\n"
            ).decode(),
            "request": request.request.model_copy(
                update={
                    "source_sha256": digest(b"def main(context):\n    while True:\n        pass\n"),
                    "source_ref": request.request.source_ref.model_copy(
                        update={
                            "content_hash": digest(
                                b"def main(context):\n    while True:\n        pass\n"
                            )
                        }
                    ),
                }
            ),
        }
    )
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    captured = []
    thread = threading.Thread(target=lambda: captured.append(supervisor.execute(request)))
    thread.start()
    for _ in range(100):
        assert not supervisor.cancel(
            workspace_id=WORKSPACE_ID,
            run_id=RUN_ID,
            idempotency_key="standard-cancellation",
            fence_token="wrong-fence",
        )
        if supervisor.cancel(
            workspace_id=WORKSPACE_ID,
            run_id=RUN_ID,
            idempotency_key="standard-cancellation",
            fence_token="analysis-fence-1",
        ):
            break
        time.sleep(0.01)
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert captured[0].receipt.status == "CANCELLED"
    assert captured[0].receipt.failure_code == "PYTHON_CANCELLED"
    assert captured[0].outputs == ()
    assert captured[0].receipt.output_refs == ()


def test_concurrent_idempotent_requests_execute_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = independent_trend_oracle([{"period_start": "2026-01-01T00:00:00Z", "value": 1}])
    request = envelope(
        "trend_change",
        {"rows": [{"period_start": "2026-01-01T00:00:00Z", "value": 1}]},
        {"result": expected},
        identifier="concurrent-idempotency",
    )
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    original_execute_once = supervisor._execute_once
    execution_count = 0
    counter_lock = threading.Lock()

    def counted_execute_once(*args: object, **kwargs: object) -> object:
        nonlocal execution_count
        with counter_lock:
            execution_count += 1
        time.sleep(0.05)
        return original_execute_once(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(supervisor, "_execute_once", counted_execute_once)
    outcomes = []
    threads = [
        threading.Thread(target=lambda: outcomes.append(supervisor.execute(request)))
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert all(not thread.is_alive() for thread in threads)
    assert execution_count == 1
    assert len(outcomes) == 4
    assert all(outcome == outcomes[0] for outcome in outcomes)


def test_replay_is_byte_stable_and_bounded_fixture_finishes(tmp_path: Path) -> None:
    rows = [
        {"period_start": f"2026-01-{index % 28 + 1:02d}T00:00:00Z", "value": index % 17 - 8}
        for index in range(5_000)
    ]
    by_period = {}
    for row in rows:
        by_period[row["period_start"]] = by_period.get(row["period_start"], 0.0) + row["value"]
    points = []
    previous = None
    for period in sorted(by_period):
        value = float(by_period[period])
        delta = None if previous is None else value - previous
        points.append(
            {
                "period_start": period,
                "value": value,
                "absolute_delta": delta,
                "relative_delta": None if previous in (None, 0) else delta / previous,
            }
        )
        previous = value
    expected = {
        "result_kind": "TREND_CHANGE",
        "points": points,
        "first_value": points[0]["value"],
        "last_value": points[-1]["value"],
    }
    request = envelope(
        "trend_change", {"rows": rows}, {"result": expected}, identifier="bounded-replay"
    )
    supervisor = PythonSandboxSupervisor(configuration(tmp_path))
    started = time.monotonic()
    first = supervisor.execute(request)
    replay = supervisor.execute(request)
    assert time.monotonic() - started < 3
    assert first == replay
    assert first.receipt.status == "SUCCEEDED", first.stderr
