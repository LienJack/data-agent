from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import platform
import resource
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import rfc8785

from data_agent_sandbox.python_runtime.models import (
    MaterializedPythonOutput,
    PythonExecutionEnvelope,
    PythonHardControls,
    PythonObservedResources,
    PythonSandboxReceipt,
    PythonSandboxTransportOutcome,
)
from data_agent_sandbox.python_runtime.policy import (
    PROFILE_IMPORT_ROOTS,
    AnalysisImportProfile,
    PythonPolicyError,
    validate_python_source,
)
from data_agent_sandbox.python_runtime.sdk import SDK_VERSION

_OUTPUT_SUFFIX = {
    "ARROW": ".arrow",
    "CSV": ".csv",
    "JSON": ".json",
    "MARKDOWN": ".md",
    "VEGA_LITE": ".vl.json",
    "PNG": ".png",
}
_INPUT_SUFFIX = {"ARROW": ".arrow", "CSV": ".csv", "JSON": ".json"}


@dataclass(frozen=True)
class SandboxConfiguration:
    authorization: str
    image_digest: str
    runtime_digest: str
    dependency_lock_digest: str
    policy_version: str
    job_root: Path
    executor_uid: int | None
    executor_gid: int | None
    hard_controls: PythonHardControls
    max_wall_ms: int
    max_cpu_seconds: int
    max_memory_bytes: int
    max_input_bytes: int
    max_output_bytes: int
    max_pids: int
    max_open_files: int
    import_profile: AnalysisImportProfile = "CORE_ANALYSIS"

    @classmethod
    def from_environment(cls) -> SandboxConfiguration:
        authorization = os.environ.get("PYTHON_SANDBOX_AUTH_TOKEN", "")
        if len(authorization) < 32:
            raise RuntimeError("PYTHON_SANDBOX_AUTH_TOKEN must contain at least 32 characters")
        target_platform = os.environ.get("PYTHON_SANDBOX_TARGET_PLATFORM", "")
        machine = {"aarch64": "arm64", "x86_64": "amd64"}.get(
            platform.machine(), platform.machine()
        )
        actual_platform = f"{sys.platform}/{machine}"
        if target_platform and target_platform != actual_platform:
            raise RuntimeError(
                "PYTHON_SANDBOX_TARGET_PLATFORM does not match the executing platform"
            )

        def integer(name: str, default: int) -> int:
            try:
                value = int(os.environ.get(name, str(default)))
            except ValueError as error:
                raise RuntimeError(f"{name} must be an integer") from error
            if value <= 0:
                raise RuntimeError(f"{name} must be positive")
            return value

        executor_uid = os.environ.get("PYTHON_SANDBOX_EXECUTOR_UID")
        executor_gid = os.environ.get("PYTHON_SANDBOX_EXECUTOR_GID")
        attested = os.environ.get("PYTHON_SANDBOX_CONTAINER_ATTESTED") == "1"
        import_profile = os.environ.get("PYTHON_SANDBOX_IMPORT_PROFILE", "CORE_ANALYSIS")
        if import_profile not in PROFILE_IMPORT_ROOTS:
            raise RuntimeError("PYTHON_SANDBOX_IMPORT_PROFILE is not registered")
        return cls(
            authorization=authorization,
            image_digest=_digest_environment("PYTHON_SANDBOX_IMAGE_DIGEST"),
            runtime_digest=_digest_environment("PYTHON_SANDBOX_RUNTIME_DIGEST"),
            dependency_lock_digest=_digest_environment("PYTHON_SANDBOX_DEPENDENCY_LOCK_DIGEST"),
            policy_version=os.environ.get("PYTHON_SANDBOX_POLICY_VERSION", "python-policy@1.0.0"),
            job_root=Path(os.environ.get("PYTHON_SANDBOX_JOB_ROOT", "/tmp/data-agent-python-jobs")),
            executor_uid=int(executor_uid) if executor_uid else None,
            executor_gid=int(executor_gid) if executor_gid else None,
            hard_controls=PythonHardControls(
                network_isolated=attested and os.environ.get("PYTHON_SANDBOX_NETWORK_NONE") == "1",
                filesystem_isolated=attested
                and os.environ.get("PYTHON_SANDBOX_READ_ONLY_ROOT") == "1",
                memory_limit_enforced=attested,
                cpu_limit_enforced=attested,
                pid_limit_enforced=attested,
            ),
            max_wall_ms=integer("PYTHON_SANDBOX_MAX_WALL_MS", 120_000),
            max_cpu_seconds=integer("PYTHON_SANDBOX_MAX_CPU_SECONDS", 60),
            max_memory_bytes=integer("PYTHON_SANDBOX_MAX_MEMORY_BYTES", 1_073_741_824),
            max_input_bytes=integer("PYTHON_SANDBOX_MAX_INPUT_BYTES", 268_435_456),
            max_output_bytes=integer("PYTHON_SANDBOX_MAX_OUTPUT_BYTES", 67_108_864),
            max_pids=integer("PYTHON_SANDBOX_MAX_PIDS", 32),
            max_open_files=integer("PYTHON_SANDBOX_MAX_OPEN_FILES", 128),
            import_profile=import_profile,  # type: ignore[arg-type]
        )


def _digest_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if len(value) != 71 or not value.startswith("sha256:"):
        raise RuntimeError(f"{name} must be a sha256 digest")
    return value


def _sha256(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _canonical_hash(value: Any) -> str:
    return _sha256(rfc8785.dumps(value))


def _decode(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("invalid base64 content") from error


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bounded(value: bytes, maximum: int) -> tuple[str, int]:
    bounded = value[:maximum]
    return bounded.decode("utf-8", errors="replace").replace("\x00", ""), len(bounded)


def _preexec(configuration: SandboxConfiguration, budgets: Any) -> Any:
    def configure() -> None:
        os.setsid()
        cpu = min(budgets.cpu_seconds, configuration.max_cpu_seconds)
        memory = min(budgets.memory_bytes, configuration.max_memory_bytes)
        output = min(budgets.output_bytes, configuration.max_output_bytes)
        files = min(budgets.max_open_files, configuration.max_open_files)
        pids = min(budgets.max_pids, configuration.max_pids)
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_FSIZE, (output, output))
        resource.setrlimit(resource.RLIMIT_NOFILE, (files, files))
        if (
            configuration.executor_uid is not None
            and sys.platform.startswith("linux")
            and hasattr(resource, "RLIMIT_NPROC")
        ):
            resource.setrlimit(resource.RLIMIT_NPROC, (pids, pids))
        if configuration.executor_gid is not None:
            os.setgroups([])
            os.setgid(configuration.executor_gid)
        if configuration.executor_uid is not None:
            os.setuid(configuration.executor_uid)

    return configure


def _sanitize_environment(job_root: Path) -> dict[str, str]:
    return {
        "HOME": str(job_root),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": str(job_root / "matplotlib"),
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "TZ": "UTC",
    }


def _validate_output(path: Path, output_type: str) -> None:
    if output_type in {"JSON", "VEGA_LITE"}:
        value = json.loads(path.read_text(encoding="utf-8"))
        if output_type == "VEGA_LITE" and (
            not isinstance(value, dict) or not isinstance(value.get("mark"), (str, dict))
        ):
            raise ValueError("invalid Vega-Lite output")
    elif output_type == "MARKDOWN":
        text = path.read_text(encoding="utf-8")
        if "\x00" in text or "<script" in text.lower() or "javascript:" in text.lower():
            raise ValueError("unsafe Markdown output")
    elif output_type == "CSV":
        path.read_text(encoding="utf-8")
    elif output_type == "PNG":
        if not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("invalid PNG output")
    elif output_type == "ARROW":
        import pyarrow.ipc as ipc

        with path.open("rb") as handle:
            ipc.open_file(handle).read_all()


class PythonSandboxSupervisor:
    def __init__(self, configuration: SandboxConfiguration):
        self.configuration = configuration
        self._idempotency: dict[str, tuple[str, PythonSandboxTransportOutcome]] = {}
        self._inflight: dict[str, threading.Event] = {}
        self._active: dict[str, tuple[str, str, str, subprocess.Popen[bytes]]] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.RLock()
        self._execution_slot = threading.Lock()

    def cancel(
        self,
        *,
        workspace_id: str,
        run_id: str,
        idempotency_key: str,
        fence_token: str,
    ) -> bool:
        """Cancel only an exactly scoped active request and its full process group."""

        with self._lock:
            active = self._active.get(idempotency_key)
            if active is None or active[:3] != (workspace_id, run_id, fence_token):
                return False
            process = active[3]
            self._cancelled.add(idempotency_key)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            with self._lock:
                self._cancelled.discard(idempotency_key)
            return False
        return True

    def execute(self, envelope: PythonExecutionEnvelope) -> PythonSandboxTransportOutcome:
        started_at = _utc_now()
        monotonic_started = time.monotonic()
        request_hash = _canonical_hash(envelope.request.model_dump(mode="json"))
        key = envelope.request.idempotency_key
        while True:
            with self._lock:
                prior = self._idempotency.get(key)
                if prior is not None:
                    if prior[0] == request_hash:
                        return prior[1]
                    return self._failure(
                        envelope,
                        request_hash,
                        started_at,
                        monotonic_started,
                        "PYTHON_POLICY_REJECTED",
                    )
                completion = self._inflight.get(key)
                if completion is None:
                    completion = threading.Event()
                    self._inflight[key] = completion
                    break
            completion.wait()
        try:
            with self._execution_slot:
                outcome = self._execute_once(envelope, request_hash, started_at, monotonic_started)
        except BaseException:
            with self._lock:
                self._inflight.pop(key, None)
                completion.set()
            raise
        with self._lock:
            self._idempotency[key] = (request_hash, outcome)
            self._inflight.pop(key, None)
            completion.set()
        return outcome

    def _execute_once(
        self,
        envelope: PythonExecutionEnvelope,
        request_hash: str,
        started_at: str,
        monotonic_started: float,
    ) -> PythonSandboxTransportOutcome:
        request = envelope.request
        if not hmac.compare_digest(envelope.authorization, self.configuration.authorization):
            return self._failure(
                envelope, request_hash, started_at, monotonic_started, "PYTHON_POLICY_REJECTED"
            )
        if (
            request.runtime_digest != self.configuration.runtime_digest
            or request.dependency_lock_digest != self.configuration.dependency_lock_digest
            or request.policy_version != self.configuration.policy_version
        ):
            return self._failure(
                envelope, request_hash, started_at, monotonic_started, "PYTHON_POLICY_REJECTED"
            )
        if not all(self.configuration.hard_controls.model_dump().values()):
            return self._failure(
                envelope, request_hash, started_at, monotonic_started, "PYTHON_SANDBOX_UNAVAILABLE"
            )
        try:
            source = _decode(envelope.source_code_base64)
            if _sha256(source) != request.source_sha256:
                raise ValueError("source digest mismatch")
            source_text = source.decode("utf-8")
            validate_python_source(source_text, self.configuration.import_profile)
            decoded_inputs = [_decode(item.content_base64) for item in envelope.inputs]
            for item, content in zip(envelope.inputs, decoded_inputs, strict=True):
                if _sha256(content) != item.reference.content_hash:
                    raise ValueError("input digest mismatch")
            input_bytes = len(source) + sum(map(len, decoded_inputs))
            if input_bytes > min(request.budgets.input_bytes, self.configuration.max_input_bytes):
                return self._failure(
                    envelope, request_hash, started_at, monotonic_started, "PYTHON_RESOURCE_LIMIT"
                )
        except (UnicodeDecodeError, ValueError, PythonPolicyError):
            return self._failure(
                envelope, request_hash, started_at, monotonic_started, "PYTHON_POLICY_REJECTED"
            )

        self.configuration.job_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="job-", dir=self.configuration.job_root
        ) as temporary:
            job_root = Path(temporary)
            input_root = job_root / "input"
            output_root = job_root / "output"
            input_root.mkdir(mode=0o755)
            output_root.mkdir(mode=0o733)
            (job_root / "matplotlib").mkdir(mode=0o733)
            output_root.chmod(0o733)
            (job_root / "matplotlib").chmod(0o733)
            (job_root / "program.py").write_bytes(source)
            input_descriptors = []
            for item, content in zip(envelope.inputs, decoded_inputs, strict=True):
                file_name = f"{item.name}{_INPUT_SUFFIX[item.format]}"
                target = input_root / file_name
                target.write_bytes(content)
                target.chmod(0o444)
                input_descriptors.append(
                    {"name": item.name, "format": item.format, "file_name": file_name}
                )
            output_descriptors = [
                {
                    "name": output.name,
                    "type": output.type,
                    "file_name": f"{output.name}{_OUTPUT_SUFFIX[output.type]}",
                }
                for output in request.output_contract.outputs
            ]
            control_path = job_root / "control.json"
            control_path.write_text(
                json.dumps(
                    {
                        "inputs": input_descriptors,
                        "outputs": output_descriptors,
                        "import_profile": self.configuration.import_profile,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
            if self.configuration.executor_uid is not None:
                input_root.chmod(0o555)
                (job_root / "program.py").chmod(0o444)
                control_path.chmod(0o444)
                job_root.chmod(0o555)
            before = resource.getrusage(resource.RUSAGE_CHILDREN)
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-I",
                    "-m",
                    "data_agent_sandbox.python_runtime.worker",
                    str(control_path),
                ],
                cwd=job_root,
                env=_sanitize_environment(job_root),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=False,
                preexec_fn=_preexec(self.configuration, request.budgets),
            )
            with self._lock:
                self._active[request.idempotency_key] = (
                    request.workspace_id,
                    request.run_id,
                    request.fence_token,
                    process,
                )
            try:
                stdout_raw, stderr_raw = process.communicate(
                    timeout=min(request.budgets.wall_time_ms, self.configuration.max_wall_ms) / 1000
                )
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout_raw, stderr_raw = process.communicate()
                with self._lock:
                    cancelled = request.idempotency_key in self._cancelled
                    self._cancelled.discard(request.idempotency_key)
                return self._failure(
                    envelope,
                    request_hash,
                    started_at,
                    monotonic_started,
                    "PYTHON_CANCELLED" if cancelled else "PYTHON_TIMEOUT",
                    process,
                    before,
                    stdout_raw,
                    stderr_raw,
                )
            finally:
                with self._lock:
                    self._active.pop(request.idempotency_key, None)
            with self._lock:
                cancelled = request.idempotency_key in self._cancelled
                self._cancelled.discard(request.idempotency_key)
            if cancelled:
                return self._failure(
                    envelope,
                    request_hash,
                    started_at,
                    monotonic_started,
                    "PYTHON_CANCELLED",
                    process,
                    before,
                    stdout_raw,
                    stderr_raw,
                )
            if process.returncode != 0:
                failure: Literal["PYTHON_ERROR", "PYTHON_RESOURCE_LIMIT"] = (
                    "PYTHON_RESOURCE_LIMIT"
                    if process.returncode < 0
                    and -process.returncode in {signal.SIGKILL, signal.SIGXCPU, signal.SIGXFSZ}
                    else "PYTHON_ERROR"
                )
                return self._failure(
                    envelope,
                    request_hash,
                    started_at,
                    monotonic_started,
                    failure,
                    process,
                    before,
                    stdout_raw,
                    stderr_raw,
                )
            try:
                worker_result_path = output_root / ".worker-result.json"
                result = json.loads(worker_result_path.read_text(encoding="utf-8"))
                written = set(result["written"])
                declared = {item.name: item for item in request.output_contract.outputs}
                if any(item.required and item.name not in written for item in declared.values()):
                    raise ValueError("required output missing")
                if not written <= declared.keys():
                    raise ValueError("undeclared output")
                expected_paths = {worker_result_path}
                materialized: list[MaterializedPythonOutput] = []
                output_refs = []
                bindings = {item.name: item.reference for item in envelope.output_references}
                total_output_bytes = 0
                for descriptor in output_descriptors:
                    path = output_root / descriptor["file_name"]
                    if descriptor["name"] not in written:
                        continue
                    expected_paths.add(path)
                    if not path.is_file() or path.is_symlink():
                        raise ValueError("output path invalid")
                    content = path.read_bytes()
                    total_output_bytes += len(content)
                    output_spec = declared[descriptor["name"]]
                    if len(content) > output_spec.max_bytes:
                        raise ValueError("output item too large")
                    _validate_output(path, descriptor["type"])
                    digest = _sha256(content)
                    reference = bindings[descriptor["name"]]
                    if reference.content_hash != digest:
                        raise ValueError("output digest does not match authorized reference")
                    output_refs.append(reference)
                    materialized.append(
                        MaterializedPythonOutput(
                            name=descriptor["name"],
                            type=descriptor["type"],
                            content_sha256=digest,
                            content_base64=base64.b64encode(content).decode("ascii"),
                            bytes=len(content),
                        )
                    )
                if total_output_bytes > min(
                    request.budgets.output_bytes, self.configuration.max_output_bytes
                ):
                    raise ValueError("total output too large")
                actual_files = {path for path in job_root.rglob("*") if path.is_file()}
                allowed_files = {
                    job_root / "program.py",
                    control_path,
                    *{input_root / item["file_name"] for item in input_descriptors},
                    *expected_paths,
                }
                unexpected_files = {
                    path
                    for path in actual_files - allowed_files
                    if job_root / "matplotlib" not in path.parents
                }
                if unexpected_files:
                    raise ValueError("undeclared file created")
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                return self._failure(
                    envelope,
                    request_hash,
                    started_at,
                    monotonic_started,
                    "PYTHON_OUTPUT_INVALID",
                    process,
                    before,
                    stdout_raw,
                    stderr_raw,
                )
            stdout, stdout_bytes = _bounded(stdout_raw, request.budgets.stdout_bytes)
            stderr, stderr_bytes = _bounded(stderr_raw, request.budgets.stderr_bytes)
            observed = self._observed(
                process, before, total_output_bytes, stdout_bytes, stderr_bytes
            )
            receipt = self._receipt(
                envelope,
                request_hash,
                started_at,
                monotonic_started,
                observed,
                "SUCCEEDED",
                None,
                tuple(output_refs),
            )
            return PythonSandboxTransportOutcome(
                protocol_version="data-agent-python-sandbox-ipc@1.0.0",
                receipt=receipt,
                outputs=tuple(materialized),
                stdout=stdout,
                stderr=stderr,
            )

    def _observed(
        self,
        process: subprocess.Popen[bytes] | None,
        before: resource.struct_rusage | None,
        output_bytes: int,
        stdout_bytes: int,
        stderr_bytes: int,
    ) -> PythonObservedResources:
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        cpu = (
            0.0
            if before is None
            else max(0.0, after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime)
        )
        peak = int(after.ru_maxrss * (1024 if sys.platform.startswith("linux") else 1))
        return PythonObservedResources(
            peak_memory_bytes=peak,
            cpu_seconds=cpu,
            output_bytes=output_bytes,
            stdout_bytes=stdout_bytes,
            stderr_bytes=stderr_bytes,
            exit_code=process.returncode
            if process is not None and process.returncode >= 0
            else None,
            signal=-process.returncode if process is not None and process.returncode < 0 else None,
        )

    def _receipt(
        self,
        envelope: PythonExecutionEnvelope,
        request_hash: str,
        started_at: str,
        monotonic_started: float,
        observed: PythonObservedResources,
        status: Literal["SUCCEEDED", "FAILED", "CANCELLED"],
        failure_code: str | None,
        output_refs: tuple[Any, ...],
    ) -> PythonSandboxReceipt:
        request = envelope.request
        return PythonSandboxReceipt(
            schema_version="1.0.0",
            workspace_id=request.workspace_id,
            run_id=request.run_id,
            attempt=request.attempt,
            fence_token=request.fence_token,
            idempotency_key=request.idempotency_key,
            request_hash=request_hash,
            sandbox_image_digest=self.configuration.image_digest,
            python_version=".".join(map(str, sys.version_info[:3])),
            sdk_version=SDK_VERSION,
            dependency_lock_digest=self.configuration.dependency_lock_digest,
            policy_version=self.configuration.policy_version,
            started_at=started_at,
            finished_at=_utc_now(),
            elapsed_ms=max(0, int((time.monotonic() - monotonic_started) * 1000)),
            observed_resources=observed,
            hard_controls=self.configuration.hard_controls,
            status=status,
            failure_code=failure_code,
            output_refs=output_refs,
            stdout_ref=None,
            stderr_ref=None,
        )

    def _failure(
        self,
        envelope: PythonExecutionEnvelope,
        request_hash: str,
        started_at: str,
        monotonic_started: float,
        failure_code: str,
        process: subprocess.Popen[bytes] | None = None,
        before: resource.struct_rusage | None = None,
        stdout_raw: bytes = b"",
        stderr_raw: bytes = b"",
    ) -> PythonSandboxTransportOutcome:
        stdout, stdout_bytes = _bounded(stdout_raw, envelope.request.budgets.stdout_bytes)
        stderr, stderr_bytes = _bounded(stderr_raw, envelope.request.budgets.stderr_bytes)
        observed = self._observed(process, before, 0, stdout_bytes, stderr_bytes)
        receipt = self._receipt(
            envelope,
            request_hash,
            started_at,
            monotonic_started,
            observed,
            "CANCELLED" if failure_code == "PYTHON_CANCELLED" else "FAILED",
            failure_code,
            (),
        )
        return PythonSandboxTransportOutcome(
            protocol_version="data-agent-python-sandbox-ipc@1.0.0",
            receipt=receipt,
            outputs=(),
            stdout=stdout,
            stderr=stderr,
        )
