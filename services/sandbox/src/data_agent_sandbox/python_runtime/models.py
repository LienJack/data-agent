from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PYTHON_IPC_PROTOCOL_VERSION = "data-agent-python-sandbox-ipc@1.0.0"
Sha256 = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
UuidString = Annotated[
    str,
    Field(
        pattern=(
            r"^(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-"
            r"[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})$"
        )
    ),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PythonArtifactReference(StrictModel):
    artifact_id: UuidString
    artifact_type: Annotated[str, Field(min_length=1, max_length=128)]
    app_id: UuidString
    tenant_id: UuidString
    environment: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
    run_id: UuidString
    revision: Annotated[int, Field(gt=0)]
    content_hash: Sha256


class PythonOutputSpec(StrictModel):
    name: Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")]
    type: Literal["ARROW", "CSV", "JSON", "MARKDOWN", "VEGA_LITE", "PNG"]
    required: bool
    max_bytes: Annotated[int, Field(gt=0, le=67_108_864)]


class PythonOutputContract(StrictModel):
    schema_version: Literal["python-output-contract@1.0.0"]
    outputs: Annotated[tuple[PythonOutputSpec, ...], Field(min_length=1, max_length=32)]

    @model_validator(mode="after")
    def unique_names(self) -> PythonOutputContract:
        if len({output.name for output in self.outputs}) != len(self.outputs):
            raise ValueError("output names must be unique")
        return self


class PythonExecutionBudgets(StrictModel):
    wall_time_ms: Annotated[int, Field(gt=0, le=600_000)]
    cpu_seconds: Annotated[int, Field(gt=0, le=600)]
    memory_bytes: Annotated[int, Field(gt=0, le=2_147_483_648)]
    input_bytes: Annotated[int, Field(gt=0, le=536_870_912)]
    output_bytes: Annotated[int, Field(gt=0, le=268_435_456)]
    max_pids: Annotated[int, Field(gt=0, le=64)]
    max_open_files: Annotated[int, Field(gt=0, le=256)]
    stdout_bytes: Annotated[int, Field(ge=0, le=1_048_576)]
    stderr_bytes: Annotated[int, Field(ge=0, le=1_048_576)]


class PythonExecutionRequest(StrictModel):
    schema_version: Literal["1.0.0"]
    workspace_id: UuidString
    run_id: UuidString
    attempt: Literal[0, 1]
    fence_token: Annotated[str, Field(min_length=1, max_length=256)]
    idempotency_key: Annotated[str, Field(min_length=8, max_length=256)]
    source_ref: PythonArtifactReference
    source_sha256: Sha256
    entrypoint: Literal["main"]
    input_refs: Annotated[tuple[PythonArtifactReference, ...], Field(max_length=64)]
    output_contract: PythonOutputContract
    runtime_digest: Sha256
    dependency_lock_digest: Sha256
    policy_version: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$")]
    budgets: PythonExecutionBudgets

    @model_validator(mode="after")
    def bind_references(self) -> PythonExecutionRequest:
        for reference in (self.source_ref, *self.input_refs):
            if reference.tenant_id != self.workspace_id or reference.run_id != self.run_id:
                raise ValueError("source and input references must bind workspace and run")
        if self.source_ref.content_hash != self.source_sha256:
            raise ValueError("source_sha256 must bind source_ref")
        return self


class MaterializedPythonInput(StrictModel):
    name: Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")]
    format: Literal["ARROW", "CSV", "JSON"]
    reference: PythonArtifactReference
    content_base64: Annotated[str, Field(min_length=1)]


class PythonOutputReferenceBinding(StrictModel):
    name: Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")]
    reference: PythonArtifactReference


class PythonExecutionEnvelope(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-ipc@1.0.0"]
    authorization: Annotated[str, Field(min_length=32, max_length=512)]
    request: PythonExecutionRequest
    source_code_base64: Annotated[str, Field(min_length=1)]
    inputs: Annotated[tuple[MaterializedPythonInput, ...], Field(max_length=64)]
    output_references: Annotated[tuple[PythonOutputReferenceBinding, ...], Field(max_length=32)]

    @model_validator(mode="after")
    def bind_materialized_artifacts(self) -> PythonExecutionEnvelope:
        if len({item.name for item in self.inputs}) != len(self.inputs):
            raise ValueError("materialized input names must be unique")
        if tuple(item.reference for item in self.inputs) != self.request.input_refs:
            raise ValueError("materialized inputs must exactly bind input_refs in order")
        expected = {output.name for output in self.request.output_contract.outputs}
        actual = {output.name for output in self.output_references}
        if expected != actual or len(actual) != len(self.output_references):
            raise ValueError("output reference bindings must exactly close the output contract")
        for binding in self.output_references:
            reference = binding.reference
            if (
                reference.tenant_id != self.request.workspace_id
                or reference.run_id != self.request.run_id
            ):
                raise ValueError("output references must bind workspace and run")
        return self


class PythonObservedResources(StrictModel):
    peak_memory_bytes: Annotated[int, Field(ge=0)]
    cpu_seconds: Annotated[float, Field(ge=0)]
    output_bytes: Annotated[int, Field(ge=0)]
    stdout_bytes: Annotated[int, Field(ge=0)]
    stderr_bytes: Annotated[int, Field(ge=0)]
    exit_code: int | None
    signal: int | None


class PythonHardControls(StrictModel):
    network_isolated: bool
    filesystem_isolated: bool
    memory_limit_enforced: bool
    cpu_limit_enforced: bool
    pid_limit_enforced: bool


PythonFailureCode = Literal[
    "PYTHON_POLICY_REJECTED",
    "PYTHON_TIMEOUT",
    "PYTHON_RESOURCE_LIMIT",
    "PYTHON_CANCELLED",
    "PYTHON_ERROR",
    "PYTHON_OUTPUT_INVALID",
    "PYTHON_SANDBOX_UNAVAILABLE",
]


class PythonSandboxReceipt(StrictModel):
    schema_version: Literal["1.0.0"]
    workspace_id: UuidString
    run_id: UuidString
    attempt: Literal[0, 1]
    fence_token: str
    idempotency_key: str
    request_hash: Sha256
    sandbox_image_digest: Sha256
    python_version: Annotated[str, Field(pattern=r"^3\.12(?:\.[0-9]+)?$")]
    sdk_version: str
    dependency_lock_digest: Sha256
    policy_version: str
    started_at: str
    finished_at: str
    elapsed_ms: Annotated[int, Field(ge=0)]
    observed_resources: PythonObservedResources
    hard_controls: PythonHardControls
    status: Literal["SUCCEEDED", "FAILED", "CANCELLED"]
    failure_code: PythonFailureCode | None
    output_refs: tuple[PythonArtifactReference, ...]
    stdout_ref: PythonArtifactReference | None
    stderr_ref: PythonArtifactReference | None

    @model_validator(mode="after")
    def validate_terminal_state(self) -> PythonSandboxReceipt:
        if (self.status == "SUCCEEDED") != (self.failure_code is None):
            raise ValueError("only success has no failure code")
        if self.status != "SUCCEEDED" and self.output_refs:
            raise ValueError("failed execution cannot retain output refs")
        return self


class MaterializedPythonOutput(StrictModel):
    name: str
    type: Literal["ARROW", "CSV", "JSON", "MARKDOWN", "VEGA_LITE", "PNG"]
    content_sha256: Sha256
    content_base64: str
    bytes: Annotated[int, Field(ge=0)]


class PythonSandboxTransportOutcome(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-ipc@1.0.0"]
    receipt: PythonSandboxReceipt
    outputs: tuple[MaterializedPythonOutput, ...]
    stdout: str
    stderr: str

    @model_validator(mode="after")
    def outputs_follow_receipt(self) -> PythonSandboxTransportOutcome:
        if self.receipt.status != "SUCCEEDED" and self.outputs:
            raise ValueError("failed transport outcomes cannot retain outputs")
        return self
