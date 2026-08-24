from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Any, Literal

import rfc8785
from pydantic import Field, model_validator

from data_agent_stats.attestation import OPERATOR_REGISTRY_DIGEST
from data_agent_stats.models import (
    StatisticalOperatorObligation,
    StrictModel,
)
from data_agent_stats.registry import StatisticalOperatorRegistry

MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
_INPUT_PATH = re.compile(r"^/workspace/operator-inputs/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$")
_OUTPUT_PATH = re.compile(
    r"^/workspace/operator-outputs/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$"
)


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


__all__ = [
    "StatisticalOperatorToolCall",
    "execute_call",
    "execute_call_file",
]
