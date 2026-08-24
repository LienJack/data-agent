from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Annotated, Any, Literal

import rfc8785
from pydantic import Field, model_validator

from data_agent_stats.attestation import OPERATOR_REGISTRY_DIGEST
from data_agent_stats.cell_policy import CellPolicyError, validate_cell_source
from data_agent_stats.models import (
    StatisticalOperatorObligation,
    StrictModel,
)
from data_agent_stats.registry import StatisticalOperatorRegistry

MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
_INPUT_PATH = re.compile(r"^/workspace/operator-inputs/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$")
_OUTPUT_PATH = re.compile(r"^/workspace/operator-outputs/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$")


class StatisticalOperatorToolCall(StrictModel):
    schema_version: Literal["statistical-operator-tool-call@1.0.0"]
    call_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")]
    operator_id: Annotated[
        str,
        Field(pattern=r"^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$"),
    ]
    operator_registry_digest: Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
    runtime_profile: Literal["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]
    obligation: StatisticalOperatorObligation
    inputs: dict[str, Any]
    parameters: dict[str, Any] | None = None

    @model_validator(mode="after")
    def exact_obligation(self) -> StatisticalOperatorToolCall:
        if (
            self.call_id != self.obligation.call_id
            or self.operator_id != self.obligation.operator_id
            or self.operator_registry_digest != OPERATOR_REGISTRY_DIGEST
        ):
            raise ValueError("operator tool call must bind the exact obligation and registry")
        return self


class StatisticalOperatorFinalizationRequest(StrictModel):
    schema_version: Literal["statistical-operator-finalization@1.0.0"]
    operator_registry_digest: Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
    runtime_profile: Literal["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]
    calls: Annotated[tuple[StatisticalOperatorToolCall, ...], Field(min_length=1, max_length=32)]
    json_outputs: dict[str, Any]

    @model_validator(mode="after")
    def exact_call_set(self) -> StatisticalOperatorFinalizationRequest:
        if self.operator_registry_digest != OPERATOR_REGISTRY_DIGEST:
            raise ValueError("operator finalization must bind the exact registry")
        if len({call.call_id for call in self.calls}) != len(self.calls):
            raise ValueError("operator finalization call ids must be unique")
        if any(
            call.operator_registry_digest != self.operator_registry_digest
            or call.runtime_profile != self.runtime_profile
            for call in self.calls
        ):
            raise ValueError("operator finalization calls must share one registry and profile")
        return self


class AnalysisCellPolicyRequest(StrictModel):
    schema_version: Literal["analysis-cell-policy-request@1.0.0"]
    cell_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")]
    source: Annotated[str, Field(min_length=1, max_length=100_000)]
    runtime_profile: Literal["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]
    generated_source_policy: Literal["OPEN_ANALYSIS", "GOVERNED_OPERATOR_ORCHESTRATION"]


def execute_call(request: StatisticalOperatorToolCall) -> dict[str, Any]:
    registry = StatisticalOperatorRegistry(
        expected_registry_digest=request.operator_registry_digest,
        obligations=(request.obligation,),
        runtime_profile=request.runtime_profile,
    )
    output = registry.call(
        request.operator_id,
        call_id=request.call_id,
        inputs=request.inputs,
        parameters=request.parameters,
    )
    evidence = registry.execution_evidence()
    if len(evidence) != 1:
        raise RuntimeError("PYTHON_OPERATOR_RECEIPT_CLOSURE_MISMATCH")
    return {
        "schema_version": "statistical-operator-tool-result@1.0.0",
        "call_id": request.call_id,
        "operator_id": request.operator_id,
        "operator_registry_digest": request.operator_registry_digest,
        "output": output,
        "execution_evidence": evidence[0],
    }


def finalize_calls(request: StatisticalOperatorFinalizationRequest) -> dict[str, Any]:
    registry = StatisticalOperatorRegistry(
        expected_registry_digest=request.operator_registry_digest,
        obligations=tuple(call.obligation for call in request.calls),
        runtime_profile=request.runtime_profile,
    )
    for call in request.calls:
        registry.call(
            call.operator_id,
            call_id=call.call_id,
            inputs=call.inputs,
            parameters=call.parameters,
        )
    receipts, closure_hash = registry.finalize(request.json_outputs)
    return {
        "schema_version": "statistical-operator-finalization-result@1.0.0",
        "operator_registry_digest": request.operator_registry_digest,
        "operator_receipts": [receipt.model_dump(mode="json") for receipt in receipts],
        "operator_receipt_closure_hash": closure_hash,
    }


def validate_cell(request: AnalysisCellPolicyRequest) -> dict[str, Any]:
    try:
        validate_cell_source(
            request.source,
            request.runtime_profile,
            request.generated_source_policy,
        )
    except CellPolicyError as error:
        return {
            "schema_version": "analysis-cell-policy-result@1.0.0",
            "cell_id": request.cell_id,
            "status": "REJECTED",
            "violations": [
                {"code": item.code, "line": item.line, "detail": item.detail}
                for item in error.violations
            ],
        }
    return {
        "schema_version": "analysis-cell-policy-result@1.0.0",
        "cell_id": request.cell_id,
        "status": "ADMITTED",
        "violations": [],
    }


def execute_call_file(request_path: str, output_path: str) -> None:
    if _INPUT_PATH.fullmatch(request_path) is None or _OUTPUT_PATH.fullmatch(output_path) is None:
        raise ValueError("PYTHON_OPERATOR_PATH_INVALID")
    request_bytes = Path(request_path).read_bytes()
    if not 0 < len(request_bytes) <= MAX_REQUEST_BYTES:
        raise ValueError("PYTHON_OPERATOR_INPUT_INVALID")
    request = StatisticalOperatorToolCall.model_validate_json(request_bytes)
    encoded = rfc8785.dumps(execute_call(request))
    if len(encoded) > MAX_OUTPUT_BYTES:
        raise ValueError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    Path(output_path).write_bytes(encoded)


def finalize_calls_file(request_path: str, output_path: str) -> None:
    if _INPUT_PATH.fullmatch(request_path) is None or _OUTPUT_PATH.fullmatch(output_path) is None:
        raise ValueError("PYTHON_OPERATOR_PATH_INVALID")
    request_bytes = Path(request_path).read_bytes()
    if not 0 < len(request_bytes) <= MAX_REQUEST_BYTES:
        raise ValueError("PYTHON_OPERATOR_INPUT_INVALID")
    request = StatisticalOperatorFinalizationRequest.model_validate_json(request_bytes)
    encoded = rfc8785.dumps(finalize_calls(request))
    if len(encoded) > MAX_OUTPUT_BYTES:
        raise ValueError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    Path(output_path).write_bytes(encoded)


def validate_cell_file(request_path: str, output_path: str) -> None:
    if _INPUT_PATH.fullmatch(request_path) is None or _OUTPUT_PATH.fullmatch(output_path) is None:
        raise ValueError("PYTHON_OPERATOR_PATH_INVALID")
    request_bytes = Path(request_path).read_bytes()
    if not 0 < len(request_bytes) <= MAX_REQUEST_BYTES:
        raise ValueError("PYTHON_OPERATOR_INPUT_INVALID")
    request = AnalysisCellPolicyRequest.model_validate_json(request_bytes)
    Path(output_path).write_bytes(rfc8785.dumps(validate_cell(request)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="data-agent-statistical-operator")
    parser.add_argument("operation", choices=("call", "finalize", "validate-cell"))
    parser.add_argument("request_path")
    parser.add_argument("output_path")
    arguments = parser.parse_args(argv)
    operations = {
        "call": execute_call_file,
        "finalize": finalize_calls_file,
        "validate-cell": validate_cell_file,
    }
    operations[arguments.operation](arguments.request_path, arguments.output_path)
    return 0


__all__ = [
    "StatisticalOperatorToolCall",
    "AnalysisCellPolicyRequest",
    "execute_call",
    "execute_call_file",
    "StatisticalOperatorFinalizationRequest",
    "finalize_calls",
    "finalize_calls_file",
    "validate_cell",
    "validate_cell_file",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
