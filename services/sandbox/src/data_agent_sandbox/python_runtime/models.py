from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from data_agent_stats.models import (
    StatisticalOperatorCallReceipt,
    StatisticalOperatorObligation,
)

PYTHON_IPC_PROTOCOL_VERSION = "data-agent-python-sandbox-ipc@2.0.0"
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


GeneratedSourcePolicy = Literal[
    "NO_GENERATED_SOURCE", "OPEN_ANALYSIS", "GOVERNED_OPERATOR_ORCHESTRATION"
]


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
    generated_source_policy: GeneratedSourcePolicy
    operator_registry_digest: Sha256
    operator_obligations: Annotated[tuple[StatisticalOperatorObligation, ...], Field(max_length=32)]
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
        call_ids = tuple(obligation.call_id for obligation in self.operator_obligations)
        if len(set(call_ids)) != len(call_ids):
            raise ValueError("operator call_ids must be unique")
        governed = self.generated_source_policy == "GOVERNED_OPERATOR_ORCHESTRATION"
        if governed != bool(self.operator_obligations):
            raise ValueError("source policy and operator obligations must close")
        output_by_name = {output.name: output for output in self.output_contract.outputs}
        for obligation in self.operator_obligations:
            output = output_by_name.get(obligation.result_binding.result_output_name)
            if output is None or output.type != "JSON":
                raise ValueError("operator result binding must target a declared JSON output")
        return self


class MaterializedPythonInput(StrictModel):
    name: Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")]
    format: Literal["ARROW", "CSV", "JSON"]
    reference: PythonArtifactReference
    content_base64: Annotated[str, Field(min_length=1)]


class PythonOutputSlot(StrictModel):
    name: Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")]
    artifact_id: UuidString
    artifact_type: Literal["SandboxResult"]
    app_id: UuidString
    tenant_id: UuidString
    environment: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
    run_id: UuidString
    revision: Annotated[int, Field(gt=0)]


class PythonExecutionEnvelope(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-ipc@2.0.0"]
    authorization: Annotated[str, Field(min_length=32, max_length=512)]
    request: PythonExecutionRequest
    source_code_base64: Annotated[str, Field(min_length=1)]
    inputs: Annotated[tuple[MaterializedPythonInput, ...], Field(max_length=64)]
    output_slots: Annotated[tuple[PythonOutputSlot, ...], Field(max_length=32)]

    @model_validator(mode="after")
    def bind_materialized_artifacts(self) -> PythonExecutionEnvelope:
        if len({item.name for item in self.inputs}) != len(self.inputs):
            raise ValueError("materialized input names must be unique")
        if tuple(item.reference for item in self.inputs) != self.request.input_refs:
            raise ValueError("materialized inputs must exactly bind input_refs in order")
        expected = {output.name for output in self.request.output_contract.outputs}
        actual = {output.name for output in self.output_slots}
        if expected != actual or len(actual) != len(self.output_slots):
            raise ValueError("output slots must exactly close the output contract")
        for slot in self.output_slots:
            if (
                slot.tenant_id != self.request.workspace_id
                or slot.run_id != self.request.run_id
                or slot.app_id != self.request.source_ref.app_id
                or slot.environment != self.request.source_ref.environment
            ):
                raise ValueError("output slots must bind request scope and run")
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
    "PYTHON_POLICY_AUTHORIZATION_INVALID",
    "PYTHON_POLICY_RUNTIME_ATTESTATION_MISMATCH",
    "PYTHON_POLICY_IDEMPOTENCY_CONFLICT",
    "PYTHON_POLICY_SOURCE_DIGEST_MISMATCH",
    "PYTHON_POLICY_INPUT_DIGEST_MISMATCH",
    "PYTHON_POLICY_SOURCE_ENCODING_INVALID",
    "PYTHON_POLICY_IMPORT_PROFILE_DENIED",
    "PYTHON_POLICY_SOURCE_TOO_LARGE",
    "PYTHON_POLICY_SOURCE_NUL",
    "PYTHON_POLICY_SOURCE_SYNTAX",
    "PYTHON_POLICY_AST_TOO_LARGE",
    "PYTHON_POLICY_ENTRYPOINT_INVALID",
    "PYTHON_POLICY_ENTRYPOINT_SIGNATURE_INVALID",
    "PYTHON_POLICY_TOP_LEVEL_EFFECT_DENIED",
    "PYTHON_POLICY_IMPORT_DENIED",
    "PYTHON_POLICY_NAME_DENIED",
    "PYTHON_POLICY_PRIVATE_ATTRIBUTE_DENIED",
    "PYTHON_POLICY_ATTRIBUTE_DENIED",
    "PYTHON_POLICY_ATTRIBUTE_ROOT_DENIED",
    "PYTHON_POLICY_GLOBAL_STATE_DENIED",
    "PYTHON_POLICY_ASYNC_GENERATOR_DENIED",
    "PYTHON_POLICY_CALL_DENIED",
    "PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH",
    "PYTHON_OPERATOR_NOT_REGISTERED",
    "PYTHON_OPERATOR_NOT_AUTHORIZED",
    "PYTHON_OPERATOR_REQUIRED_CALL_MISSING",
    "PYTHON_OPERATOR_UNDECLARED_CALL",
    "PYTHON_OPERATOR_DUPLICATE_CALL_ID",
    "PYTHON_OPERATOR_INPUT_INVALID",
    "PYTHON_OPERATOR_PARAMETER_INVALID",
    "PYTHON_OPERATOR_APPLICABILITY_HOLD",
    "PYTHON_OPERATOR_NUMERIC_FAILURE",
    "PYTHON_OPERATOR_RESULT_BINDING_MISMATCH",
    "PYTHON_OPERATOR_RECEIPT_CLOSURE_MISMATCH",
    "PYTHON_TIMEOUT",
    "PYTHON_RESOURCE_LIMIT",
    "PYTHON_CANCELLED",
    "PYTHON_IMPORT_DENIED",
    "PYTHON_INPUT_FORMAT_INVALID",
    "PYTHON_INPUT_NOT_DECLARED",
    "PYTHON_OUTPUT_NOT_DECLARED",
    "PYTHON_OUTPUT_TYPE_MISMATCH",
    "PYTHON_OUTPUT_VALUE_INVALID",
    "PYTHON_VEGA_LITE_INVALID",
    "PYTHON_PNG_VALUE_INVALID",
    "PYTHON_ENTRYPOINT_MISSING",
    "PYTHON_ENTRYPOINT_RETURN_MUST_BE_NONE",
    "PYTHON_TYPE_ERROR",
    "PYTHON_NAME_ERROR",
    "PYTHON_ATTRIBUTE_ERROR",
    "PYTHON_KEY_ERROR",
    "PYTHON_INDEX_ERROR",
    "PYTHON_VALUE_ERROR",
    "PYTHON_ZERO_DIVISION_ERROR",
    "PYTHON_IMPORT_ERROR",
    "PYTHON_MODULE_NOT_FOUND_ERROR",
    "PYTHON_RUNTIME_ERROR",
    "PYTHON_ASSERTION_ERROR",
    "PYTHON_OVERFLOW_ERROR",
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
    generated_source_policy: GeneratedSourcePolicy
    operator_registry_digest: Sha256
    operator_obligations: Annotated[tuple[StatisticalOperatorObligation, ...], Field(max_length=32)]
    operator_receipts: Annotated[tuple[StatisticalOperatorCallReceipt, ...], Field(max_length=32)]
    operator_receipt_closure_hash: Sha256 | None
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
        governed = self.generated_source_policy == "GOVERNED_OPERATOR_ORCHESTRATION"
        if governed != bool(self.operator_obligations):
            raise ValueError("source policy and operator obligations must close")
        if self.status == "SUCCEEDED":
            expected = tuple(
                (obligation.call_id, obligation.operator_id)
                for obligation in self.operator_obligations
            )
            actual = tuple(
                (receipt.call_id, receipt.operator_id) for receipt in self.operator_receipts
            )
            if actual != expected:
                raise ValueError("operator receipts must exactly close ordered obligations")
            if self.operator_receipt_closure_hash is None:
                raise ValueError("successful execution requires operator receipt closure")
        elif self.operator_receipts or self.operator_receipt_closure_hash is not None:
            raise ValueError("failed execution cannot publish operator receipts")
        if any(
            receipt.operator_registry_digest != self.operator_registry_digest
            for receipt in self.operator_receipts
        ):
            raise ValueError("operator receipts must bind the registry digest")
        return self


class MaterializedPythonOutput(StrictModel):
    name: str
    type: Literal["ARROW", "CSV", "JSON", "MARKDOWN", "VEGA_LITE", "PNG"]
    reference: PythonArtifactReference
    content_sha256: Sha256
    content_base64: str
    bytes: Annotated[int, Field(ge=0)]


class PythonSandboxTransportOutcome(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-ipc@2.0.0"]
    receipt: PythonSandboxReceipt
    outputs: tuple[MaterializedPythonOutput, ...]
    stdout: str
    stderr: str

    @model_validator(mode="after")
    def outputs_follow_receipt(self) -> PythonSandboxTransportOutcome:
        if self.receipt.status != "SUCCEEDED" and self.outputs:
            raise ValueError("failed transport outcomes cannot retain outputs")
        if self.receipt.status == "SUCCEEDED":
            if tuple(output.reference for output in self.outputs) != self.receipt.output_refs:
                raise ValueError("successful outputs must exactly bind receipt references")
            if any(
                output.reference.content_hash != output.content_sha256 for output in self.outputs
            ):
                raise ValueError("successful output references must bind content hashes")
        return self


class PythonCancellationRequest(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-control@1.0.0"]
    operation: Literal["CANCEL"]
    authorization: Annotated[str, Field(min_length=32, max_length=512)]
    workspace_id: UuidString
    run_id: UuidString
    idempotency_key: Annotated[str, Field(min_length=8, max_length=256)]
    fence_token: Annotated[str, Field(min_length=1, max_length=256)]


class PythonCancellationOutcome(StrictModel):
    protocol_version: Literal["data-agent-python-sandbox-control@1.0.0"]
    operation: Literal["CANCEL"]
    status: Literal["CANCEL_REQUESTED", "NOT_ACTIVE", "REJECTED"]
