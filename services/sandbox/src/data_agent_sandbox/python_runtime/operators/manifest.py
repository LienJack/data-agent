from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any

MANIFEST_PATH = Path(__file__).with_name("manifest.json")
_OPERATOR_ID = re.compile(r"^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$")
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


class OperatorManifestError(RuntimeError):
    """The sole operator manifest is malformed or contains compatibility metadata."""


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


def _validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != _TOP_LEVEL_KEYS:
        raise OperatorManifestError("manifest top-level fields are not closed")
    if value["schema_version"] != "statistical-operator-manifest@1.0.0":
        raise OperatorManifestError("manifest schema version is unsupported")
    operators = value["operators"]
    if not isinstance(operators, list) or len(operators) != 7:
        raise OperatorManifestError("manifest must contain exactly seven operators")
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
]
