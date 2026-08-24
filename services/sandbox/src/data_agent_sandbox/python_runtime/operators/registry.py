from __future__ import annotations

import hashlib
import importlib
import inspect
import json
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import rfc8785

from data_agent_sandbox.python_runtime.models import (
    StatisticalOperatorCallReceipt,
    StatisticalOperatorObligation,
)
from data_agent_sandbox.python_runtime.operators.attestation import OPERATOR_REGISTRY_DIGEST
from data_agent_sandbox.python_runtime.operators.manifest import (
    OPERATOR_BY_ID,
    input_records_match_manifest,
)

MAX_CANONICAL_BYTES = 64 * 1024 * 1024
MAX_CANONICAL_DEPTH = 16
MAX_CANONICAL_NODES = 1_000_000
_COUNT_FIELDS = ("sample_size", "group_count", "family_size", "rank")


class StatisticalOperatorError(ValueError):
    """Stable, scrubbed operator failure projected across the process boundary."""

    def __init__(self, failure_code: str):
        self.failure_code = failure_code
        super().__init__(failure_code)


@dataclass(frozen=True)
class OperatorExecutionResult:
    output: dict[str, Any]
    sample_size: int | None = None
    group_count: int | None = None
    family_size: int | None = None
    rank: int | None = None
    applicability: str = "PASS"
    limitation_codes: tuple[str, ...] = ()


OperatorImplementation = Callable[[dict[str, Any], dict[str, Any]], OperatorExecutionResult]


@dataclass(frozen=True)
class OperatorImplementationBinding:
    implementation: OperatorImplementation
    implementation_digest: str


ImplementationLoader = Callable[[Mapping[str, Any]], OperatorImplementationBinding]


@dataclass(frozen=True)
class _CallRecord:
    obligation: StatisticalOperatorObligation
    implementation_digest: str
    resolved_parameters: dict[str, Any]
    resolved_parameters_hash: str
    input_hash: str
    output: dict[str, Any]
    output_hash: str
    sample_size: int | None
    group_count: int | None
    family_size: int | None
    rank: int | None
    applicability: str
    limitation_codes: tuple[str, ...]


def _sha256(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _canonical_bytes(value: Any) -> bytes:
    try:
        result = rfc8785.dumps(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID") from error
    if len(result) > MAX_CANONICAL_BYTES:
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return result


def _validate_canonical(value: Any, *, failure_code: str) -> Any:
    node_count = 0

    def visit(item: Any, depth: int) -> None:
        nonlocal node_count
        node_count += 1
        if node_count > MAX_CANONICAL_NODES or depth > MAX_CANONICAL_DEPTH:
            raise StatisticalOperatorError(failure_code)
        if item is None or isinstance(item, (bool, int, str)):
            if isinstance(item, str) and len(item) > 4096:
                raise StatisticalOperatorError(failure_code)
            return
        if isinstance(item, float):
            if not math.isfinite(item):
                raise StatisticalOperatorError(failure_code)
            return
        if isinstance(item, list):
            for child in item:
                visit(child, depth + 1)
            return
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or not key or len(key) > 128:
                    raise StatisticalOperatorError(failure_code)
                visit(child, depth + 1)
            return
        raise StatisticalOperatorError(failure_code)

    visit(value, 0)
    try:
        encoded = rfc8785.dumps(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise StatisticalOperatorError(failure_code) from error
    if len(encoded) > MAX_CANONICAL_BYTES:
        raise StatisticalOperatorError(failure_code)
    return json.loads(encoded)


def _resolve_parameters(
    descriptor: Mapping[str, Any], provided: dict[str, Any] | None
) -> dict[str, Any]:
    candidate = (
        {}
        if provided is None
        else _validate_canonical(provided, failure_code="PYTHON_OPERATOR_PARAMETER_INVALID")
    )
    if not isinstance(candidate, dict):
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    specifications = descriptor["parameters"]
    by_name = {specification["name"]: specification for specification in specifications}
    if set(candidate) - by_name.keys():
        raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
    resolved: dict[str, Any] = {}
    for specification in specifications:
        name = specification["name"]
        if name in candidate:
            value = candidate[name]
        elif "default" in specification:
            value = specification["default"]
        elif specification["required"]:
            raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
        else:
            continue
        kind = specification["kind"]
        is_integer = isinstance(value, int) and not isinstance(value, bool)
        is_number = isinstance(value, (int, float)) and not isinstance(value, bool)
        valid = (
            (kind == "BOOLEAN" and isinstance(value, bool))
            or (kind in {"ENUM", "ENUM_INTEGER"} and value in specification["allowed_values"])
            or (kind == "NON_NEGATIVE_INTEGER" and is_integer and value >= 0)
            or (kind == "POSITIVE_INTEGER" and is_integer and value > 0)
            or (kind == "FINITE_NUMBER" and is_number and math.isfinite(float(value)))
        )
        if not valid:
            raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
        numeric = float(value) if is_number else None
        if numeric is not None:
            if (
                "minimum_exclusive" in specification
                and not numeric > specification["minimum_exclusive"]
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
            if (
                "minimum_inclusive" in specification
                and not numeric >= specification["minimum_inclusive"]
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
            if (
                "maximum_exclusive" in specification
                and not numeric < specification["maximum_exclusive"]
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
            if (
                "maximum_inclusive" in specification
                and not numeric <= specification["maximum_inclusive"]
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_PARAMETER_INVALID")
        resolved[name] = value
    return resolved


def _validate_inputs(descriptor: Mapping[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    normalized = _validate_canonical(inputs, failure_code="PYTHON_OPERATOR_INPUT_INVALID")
    if not isinstance(normalized, dict):
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    specifications = descriptor["inputs"]
    by_name = {specification["name"]: specification for specification in specifications}
    if set(normalized) != by_name.keys():
        raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    for name, specification in by_name.items():
        records = normalized[name]
        if not input_records_match_manifest(specification, records):
            raise StatisticalOperatorError("PYTHON_OPERATOR_INPUT_INVALID")
    return normalized


def _validate_output(descriptor: Mapping[str, Any], output: dict[str, Any]) -> dict[str, Any]:
    normalized = _validate_canonical(output, failure_code="PYTHON_OPERATOR_NUMERIC_FAILURE")
    if not isinstance(normalized, dict):
        raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    output_contract = descriptor["outputs"]
    collection = normalized.get(output_contract["collection"])
    if not isinstance(collection, list) or len(collection) > descriptor["batching"]["max_items"]:
        raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
    label_fields = tuple(output_contract["label_fields"])
    required_fields = (
        set(label_fields)
        | set(output_contract["value_fields"])
        | set(output_contract["evidence_fields"])
    )
    seen: set[bytes] = set()
    for row in collection:
        if not isinstance(row, dict) or not required_fields <= row.keys():
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        key = _canonical_bytes([row[field] for field in label_fields])
        if key in seen:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        seen.add(key)
    return normalized


def _default_implementation_loader(
    descriptor: Mapping[str, Any],
) -> OperatorImplementationBinding:
    implementation = descriptor["implementation"]
    try:
        module = importlib.import_module(implementation["module"])
        function = getattr(module, implementation["symbol"])
        source_path = inspect.getsourcefile(function)
        if source_path is None or not callable(function):
            raise TypeError("implementation is not callable source")
        digest = _sha256(Path(source_path).read_bytes())
    except (ImportError, AttributeError, OSError, TypeError) as error:
        raise StatisticalOperatorError("PYTHON_OPERATOR_NOT_REGISTERED") from error
    return OperatorImplementationBinding(function, digest)


def _json_pointer(value: Any, pointer: str) -> Any:
    current = value
    for raw_token in pointer.split("/")[1:]:
        token = raw_token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
            current = current[int(token)]
        else:
            raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
    return current


def _labeled_collection(
    collection: Any, label_fields: tuple[str, ...]
) -> dict[bytes, dict[str, Any]]:
    if not isinstance(collection, list):
        raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
    indexed: dict[bytes, dict[str, Any]] = {}
    for row in collection:
        if not isinstance(row, dict) or any(field not in row for field in label_fields):
            raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
        key = _canonical_bytes([row[field] for field in label_fields])
        if key in indexed:
            raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
        indexed[key] = row
    return indexed


def _values_match(left: Any, right: Any, comparison: Any) -> bool:
    if comparison.comparison == "EXACT":
        return _canonical_bytes(left) == _canonical_bytes(right)
    if (
        isinstance(left, bool)
        or isinstance(right, bool)
        or not isinstance(left, (int, float))
        or not isinstance(right, (int, float))
        or not math.isfinite(float(left))
        or not math.isfinite(float(right))
    ):
        return False
    return math.isclose(
        float(left),
        float(right),
        rel_tol=comparison.relative_tolerance,
        abs_tol=comparison.absolute_tolerance,
    )


class StatisticalOperatorRegistry:
    """Per-execution, exact-call registry bound to one server-authorized program."""

    def __init__(
        self,
        *,
        expected_registry_digest: str,
        obligations: tuple[StatisticalOperatorObligation, ...],
        runtime_profile: str,
        implementation_loader: ImplementationLoader = _default_implementation_loader,
    ) -> None:
        if expected_registry_digest != OPERATOR_REGISTRY_DIGEST:
            raise StatisticalOperatorError("PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH")
        if len({obligation.call_id for obligation in obligations}) != len(obligations):
            raise StatisticalOperatorError("PYTHON_OPERATOR_DUPLICATE_CALL_ID")
        self._registry_digest = expected_registry_digest
        self._obligations = obligations
        self._runtime_profile = runtime_profile
        self._implementation_loader = implementation_loader
        self._records: list[_CallRecord] = []
        self._finalized: tuple[tuple[StatisticalOperatorCallReceipt, ...], str] | None = None

    @property
    def registry_digest(self) -> str:
        return self._registry_digest

    def call(
        self,
        operator_id: str,
        *,
        call_id: str,
        inputs: dict[str, Any],
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self._finalized is not None:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NOT_AUTHORIZED")
        if call_id in {record.obligation.call_id for record in self._records}:
            raise StatisticalOperatorError("PYTHON_OPERATOR_DUPLICATE_CALL_ID")
        if operator_id not in OPERATOR_BY_ID:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NOT_REGISTERED")
        if len(self._records) >= len(self._obligations):
            raise StatisticalOperatorError("PYTHON_OPERATOR_UNDECLARED_CALL")
        obligation = self._obligations[len(self._records)]
        if obligation.call_id != call_id or obligation.operator_id != operator_id:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NOT_AUTHORIZED")
        descriptor = OPERATOR_BY_ID[operator_id]
        if descriptor["runtime_profile"] == "ML_DIAGNOSTIC" and self._runtime_profile not in {
            "ML_DIAGNOSTIC",
            "CAUSAL_L5",
        }:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NOT_AUTHORIZED")
        normalized_inputs = _validate_inputs(descriptor, inputs)
        resolved_parameters = _resolve_parameters(descriptor, parameters)
        binding = self._implementation_loader(descriptor)
        try:
            execution = binding.implementation(normalized_inputs, resolved_parameters)
        except StatisticalOperatorError:
            raise
        except (ArithmeticError, FloatingPointError, OverflowError, ValueError) as error:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE") from error
        if not isinstance(execution, OperatorExecutionResult):
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        for field in _COUNT_FIELDS:
            value = getattr(execution, field)
            if value is not None and (
                not isinstance(value, int) or isinstance(value, bool) or value < 0
            ):
                raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        if len(execution.limitation_codes) > 16 or len(set(execution.limitation_codes)) != len(
            execution.limitation_codes
        ):
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        if execution.applicability not in {"PASS", "ASSUMPTION_BOUND", "HOLD"}:
            raise StatisticalOperatorError("PYTHON_OPERATOR_NUMERIC_FAILURE")
        output = _validate_output(descriptor, execution.output)
        record = _CallRecord(
            obligation=obligation,
            implementation_digest=binding.implementation_digest,
            resolved_parameters=resolved_parameters,
            resolved_parameters_hash=_sha256(_canonical_bytes(resolved_parameters)),
            input_hash=_sha256(_canonical_bytes(normalized_inputs)),
            output=output,
            output_hash=_sha256(_canonical_bytes(output)),
            sample_size=execution.sample_size,
            group_count=execution.group_count,
            family_size=execution.family_size,
            rank=execution.rank,
            applicability=execution.applicability,
            limitation_codes=tuple(sorted(execution.limitation_codes)),
        )
        self._records.append(record)
        return json.loads(_canonical_bytes(output))

    def finalize(
        self, json_outputs: Mapping[str, Any]
    ) -> tuple[tuple[StatisticalOperatorCallReceipt, ...], str]:
        if self._finalized is not None:
            return self._finalized
        if len(self._records) != len(self._obligations):
            raise StatisticalOperatorError("PYTHON_OPERATOR_REQUIRED_CALL_MISSING")
        receipts: list[StatisticalOperatorCallReceipt] = []
        for record in self._records:
            result_binding = record.obligation.result_binding
            final_output = json_outputs.get(result_binding.result_output_name)
            result_collection = _json_pointer(final_output, result_binding.result_collection_path)
            operator_collection = _json_pointer(
                record.output, result_binding.operator_collection_path
            )
            result_rows = _labeled_collection(result_collection, result_binding.label_fields)
            operator_rows = _labeled_collection(operator_collection, result_binding.label_fields)
            if set(result_rows) != set(operator_rows):
                raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
            projection: list[dict[str, Any]] = []
            for label_key in sorted(operator_rows):
                result_row = result_rows[label_key]
                operator_row = operator_rows[label_key]
                values: list[dict[str, Any]] = []
                for binding in result_binding.value_bindings:
                    if (
                        binding.result_field not in result_row
                        or binding.operator_field not in operator_row
                        or not _values_match(
                            result_row[binding.result_field],
                            operator_row[binding.operator_field],
                            binding,
                        )
                    ):
                        raise StatisticalOperatorError("PYTHON_OPERATOR_RESULT_BINDING_MISMATCH")
                    values.append(
                        {
                            "operator_field": binding.operator_field,
                            "operator_value": operator_row[binding.operator_field],
                            "result_field": binding.result_field,
                            "result_value": result_row[binding.result_field],
                        }
                    )
                projection.append(
                    {
                        "label": [operator_row[field] for field in result_binding.label_fields],
                        "values": values,
                    }
                )
            result_binding_hash = _sha256(_canonical_bytes(projection))
            receipts.append(
                StatisticalOperatorCallReceipt(
                    schema_version="statistical-operator-call-receipt@1.0.0",
                    call_id=record.obligation.call_id,
                    operator_id=record.obligation.operator_id,
                    operator_registry_digest=self._registry_digest,
                    implementation_digest=record.implementation_digest,
                    resolved_parameters=record.resolved_parameters,
                    resolved_parameters_hash=record.resolved_parameters_hash,
                    input_hash=record.input_hash,
                    output_hash=record.output_hash,
                    result_binding_hash=result_binding_hash,
                    sample_size=record.sample_size,
                    group_count=record.group_count,
                    family_size=record.family_size,
                    rank=record.rank,
                    applicability=record.applicability,
                    limitation_codes=record.limitation_codes,
                )
            )
        closure_hash = _sha256(
            _canonical_bytes([receipt.model_dump(mode="json") for receipt in receipts])
        )
        self._finalized = (tuple(receipts), closure_hash)
        return self._finalized


__all__ = [
    "ImplementationLoader",
    "OperatorExecutionResult",
    "OperatorImplementationBinding",
    "StatisticalOperatorError",
    "StatisticalOperatorRegistry",
]
