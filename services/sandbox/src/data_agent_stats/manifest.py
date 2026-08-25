from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from datetime import date
from pathlib import Path
from types import MappingProxyType
from typing import Any

MANIFEST_PATH = Path(__file__).with_name("manifest.json")
_OPERATOR_ID = re.compile(r"^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$")
_INPUT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_FIELD_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_MONTH_KEY = re.compile(r"^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$")
_DATE_KEY = re.compile(r"^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$")
_FORBIDDEN_KEYS = frozenset(
    {"alias", "aliases", "overwrite", "overwrites", "legacy_id", "fallback"}
)
_TOP_LEVEL_KEYS = frozenset({"schema_version", "registry_id", "operators"})
_OPERATOR_KEYS = frozenset(
    {
        "operator_id",
        "description_zh",
        "implementation",
        "runtime_profile",
        "batching",
        "inputs",
        "parameters",
        "outputs",
        "applicability_checks",
        "limitations",
    }
)
_INPUT_KEYS = frozenset(
    {
        "name",
        "container",
        "min_items",
        "max_items",
        "record_shape",
        "record_example",
        "limits",
    }
)
_LIMIT_KEYS = frozenset(
    {"max_named_fields_per_record", "max_points_per_record", "max_rows_per_record"}
)
_RECORD_FIELD_SHAPES = frozenset(
    {
        "BINARY_NUMBER_ARRAY",
        "DATE_KEY",
        "FINITE_NUMBER",
        "FINITE_NUMBER_ARRAY",
        "MONTH_KEY",
        "NAMED_FINITE_NUMBER_ARRAY_MAP",
        "NAMED_FINITE_NUMBER_MAP",
        "NON_EMPTY_STRING",
        "NON_NEGATIVE_FINITE_NUMBER",
        "NULLABLE_NON_NEGATIVE_FINITE_NUMBER",
        "NULLABLE_RATING_1_TO_5",
        "STRICT_ORDER_ARRAY",
        "UNIT_INTERVAL_NUMBER",
    }
)


class OperatorManifestError(RuntimeError):
    """The sole operator manifest is malformed or contains forbidden legacy metadata."""


def _reject_forbidden_keys(value: Any, path: str = "manifest") -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_forbidden_keys(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        if key in _FORBIDDEN_KEYS:
            raise OperatorManifestError(f"{path}.{key} is forbidden")
        _reject_forbidden_keys(child, f"{path}.{key}")


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value) <= 128


def _finite_number_array(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(_finite_number(item) for item in value)


def _date_key(value: Any) -> bool:
    if not isinstance(value, str) or _DATE_KEY.fullmatch(value) is None:
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def record_value_matches_shape(value: Any, shape: str) -> bool:
    """Validate one nested input value against the sole manifest vocabulary."""

    if shape == "BINARY_NUMBER_ARRAY":
        return (
            isinstance(value, list)
            and bool(value)
            and all(_finite_number(item) and float(item) in {0.0, 1.0} for item in value)
        )
    if shape == "DATE_KEY":
        return _date_key(value)
    if shape == "FINITE_NUMBER":
        return _finite_number(value)
    if shape == "FINITE_NUMBER_ARRAY":
        return _finite_number_array(value)
    if shape == "MONTH_KEY":
        return isinstance(value, str) and _MONTH_KEY.fullmatch(value) is not None
    if shape == "NAMED_FINITE_NUMBER_ARRAY_MAP":
        if (
            not isinstance(value, dict)
            or not value
            or not all(
                _non_empty_string(key) and _finite_number_array(child)
                for key, child in value.items()
            )
        ):
            return False
        return len({len(child) for child in value.values()}) == 1
    if shape == "NAMED_FINITE_NUMBER_MAP":
        return (
            isinstance(value, dict)
            and bool(value)
            and all(
                _non_empty_string(key) and _finite_number(child) for key, child in value.items()
            )
        )
    if shape == "NON_EMPTY_STRING":
        return _non_empty_string(value)
    if shape == "NON_NEGATIVE_FINITE_NUMBER":
        return _finite_number(value) and float(value) >= 0
    if shape == "NULLABLE_NON_NEGATIVE_FINITE_NUMBER":
        return value is None or (_finite_number(value) and float(value) >= 0)
    if shape == "NULLABLE_RATING_1_TO_5":
        return value is None or (_finite_number(value) and 1 <= float(value) <= 5)
    if shape == "STRICT_ORDER_ARRAY":
        if not isinstance(value, list) or not value:
            return False
        if all(_finite_number(item) for item in value):
            normalized: list[float] | list[str] = [float(item) for item in value]
        elif all(_non_empty_string(item) for item in value):
            normalized = value
        else:
            return False
        return all(right > left for left, right in zip(normalized, normalized[1:], strict=False))
    if shape == "UNIT_INTERVAL_NUMBER":
        return _finite_number(value) and 0 <= float(value) <= 1
    return False


def input_records_match_manifest(specification: Mapping[str, Any], records: Any) -> bool:
    """Enforce the manifest's exact outer container, record fields, shapes and limits."""

    if not isinstance(records, list):
        return False
    minimum = specification["min_items"]
    maximum = specification["max_items"]
    if not minimum <= len(records) <= maximum:
        return False
    shape = specification["record_shape"]
    expected_fields = set(shape)
    limits = specification["limits"]
    for record in records:
        if not isinstance(record, dict) or set(record) != expected_fields:
            return False
        if any(
            not record_value_matches_shape(record[field], field_shape)
            for field, field_shape in shape.items()
        ):
            return False
        named_limit = limits.get("max_named_fields_per_record")
        if named_limit is not None and any(
            isinstance(record[field], dict) and len(record[field]) > named_limit for field in shape
        ):
            return False
        sequence_limit = limits.get("max_points_per_record", limits.get("max_rows_per_record"))
        if sequence_limit is not None:
            sequence_lengths = [
                len(record[field])
                for field, field_shape in shape.items()
                if field_shape
                in {"BINARY_NUMBER_ARRAY", "FINITE_NUMBER_ARRAY", "STRICT_ORDER_ARRAY"}
            ]
            sequence_lengths.extend(
                len(vector)
                for field, field_shape in shape.items()
                if field_shape == "NAMED_FINITE_NUMBER_ARRAY_MAP"
                for vector in record[field].values()
            )
            if any(length > sequence_limit for length in sequence_lengths):
                return False
    return True


def _validate_input(specification: Any, *, context: str) -> None:
    if not isinstance(specification, dict) or set(specification) != _INPUT_KEYS:
        raise OperatorManifestError(f"{context} fields are not closed")
    name = specification["name"]
    if not isinstance(name, str) or _INPUT_NAME.fullmatch(name) is None:
        raise OperatorManifestError(f"{context} name is invalid")
    if specification["container"] != "RECORD_ARRAY":
        raise OperatorManifestError(f"{context} container is invalid")
    minimum = specification["min_items"]
    maximum = specification["max_items"]
    if (
        not isinstance(minimum, int)
        or isinstance(minimum, bool)
        or minimum < 0
        or not isinstance(maximum, int)
        or isinstance(maximum, bool)
        or not minimum <= maximum <= 500_000
    ):
        raise OperatorManifestError(f"{context} item bounds are invalid")
    shape = specification["record_shape"]
    example = specification["record_example"]
    if not isinstance(shape, dict) or not shape:
        raise OperatorManifestError(f"{context} record shape is invalid")
    if any(
        not isinstance(field, str)
        or _FIELD_NAME.fullmatch(field) is None
        or field_shape not in _RECORD_FIELD_SHAPES
        for field, field_shape in shape.items()
    ):
        raise OperatorManifestError(f"{context} record shape is invalid")
    if not isinstance(example, dict) or set(example) != set(shape):
        raise OperatorManifestError(f"{context} record example is not exact")
    limits = specification["limits"]
    if (
        not isinstance(limits, dict)
        or set(limits) - _LIMIT_KEYS
        or any(
            not isinstance(value, int) or isinstance(value, bool) or value <= 0
            for value in limits.values()
        )
    ):
        raise OperatorManifestError(f"{context} limits are invalid")
    example_specification = dict(specification)
    example_specification["min_items"] = 1
    if not input_records_match_manifest(example_specification, [example]):
        raise OperatorManifestError(f"{context} record example violates its shape")


def _validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != _TOP_LEVEL_KEYS:
        raise OperatorManifestError("manifest top-level fields are not closed")
    if value["schema_version"] != "statistical-operator-manifest@2.0.0":
        raise OperatorManifestError("manifest schema version is unsupported")
    operators = value["operators"]
    if not isinstance(operators, list) or len(operators) != 8:
        raise OperatorManifestError("manifest must contain exactly eight operators")
    identifiers: set[str] = set()
    implementations: set[tuple[str, str]] = set()
    for index, operator in enumerate(operators):
        if not isinstance(operator, dict) or set(operator) != _OPERATOR_KEYS:
            raise OperatorManifestError(f"operator {index} fields are not closed")
        operator_id = operator["operator_id"]
        if not isinstance(operator_id, str) or not _OPERATOR_ID.fullmatch(operator_id):
            raise OperatorManifestError(f"operator {index} id is invalid")
        if operator_id in identifiers:
            raise OperatorManifestError(f"operator {index} id is duplicated")
        identifiers.add(operator_id)
        implementation = operator["implementation"]
        if not isinstance(implementation, dict) or set(implementation) != {"module", "symbol"}:
            raise OperatorManifestError(f"operator {index} implementation is invalid")
        module = implementation["module"]
        symbol = implementation["symbol"]
        if not isinstance(module, str) or not isinstance(symbol, str):
            raise OperatorManifestError(f"operator {index} implementation is invalid")
        implementation_key = (module, symbol)
        if implementation_key in implementations:
            raise OperatorManifestError(f"operator {index} implementation is duplicated")
        implementations.add(implementation_key)
        if operator["runtime_profile"] not in {"CORE_ANALYSIS", "ML_DIAGNOSTIC"}:
            raise OperatorManifestError(f"operator {index} runtime profile is invalid")
        batching = operator["batching"]
        if (
            not isinstance(batching, dict)
            or set(batching) != {"mode", "max_items"}
            or batching["mode"] != "LABELED_BATCH"
            or not isinstance(batching["max_items"], int)
            or isinstance(batching["max_items"], bool)
            or not 0 < batching["max_items"] <= 5000
        ):
            raise OperatorManifestError(f"operator {index} batching is invalid")
        inputs = operator["inputs"]
        if not isinstance(inputs, list) or not inputs:
            raise OperatorManifestError(f"operator {index} inputs are invalid")
        input_names: set[str] = set()
        for input_index, specification in enumerate(inputs):
            _validate_input(specification, context=f"operator {index} input {input_index}")
            if specification["name"] in input_names:
                raise OperatorManifestError(f"operator {index} input name is duplicated")
            input_names.add(specification["name"])
    _reject_forbidden_keys(value)
    return value


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(child) for child in value)
    return value


def _load_manifest() -> tuple[Mapping[str, Any], str]:
    source = MANIFEST_PATH.read_bytes()
    if b"\r" in source or not source.endswith(b"\n") or source.endswith(b"\n\n"):
        raise OperatorManifestError("manifest source must use LF and one trailing newline")
    try:
        candidate = json.loads(source)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OperatorManifestError("manifest source is not valid UTF-8 JSON") from error
    manifest = _validate_manifest(candidate)
    digest = f"sha256:{hashlib.sha256(source).hexdigest()}"
    return _freeze(manifest), digest


OPERATOR_MANIFEST, OPERATOR_MANIFEST_DIGEST = _load_manifest()
OPERATOR_IDS = tuple(operator["operator_id"] for operator in OPERATOR_MANIFEST["operators"])
OPERATOR_BY_ID = MappingProxyType(
    {operator["operator_id"]: operator for operator in OPERATOR_MANIFEST["operators"]}
)

__all__ = [
    "MANIFEST_PATH",
    "OPERATOR_BY_ID",
    "OPERATOR_IDS",
    "OPERATOR_MANIFEST",
    "OPERATOR_MANIFEST_DIGEST",
    "OperatorManifestError",
    "input_records_match_manifest",
    "record_value_matches_shape",
]
