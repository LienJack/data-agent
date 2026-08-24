from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from data_agent_stats.manifest import (
    MANIFEST_PATH,
    OPERATOR_MANIFEST,
)

_DIGEST_PREFIX = "sha256:"
_REGISTRY_SCHEMA_VERSION = "statistical-operator-registry@1.0.0"


def _sha256(value: bytes) -> str:
    return f"{_DIGEST_PREFIX}{hashlib.sha256(value).hexdigest()}"


def _implementation_path(module_name: str) -> Path:
    operators_root = Path(__file__).parent
    prefix = "data_agent_stats."
    if not module_name.startswith(prefix):
        raise RuntimeError("PYTHON_OPERATOR_IMPLEMENTATION_PATH_INVALID")
    relative = module_name.removeprefix(prefix)
    if not relative or "." in relative:
        raise RuntimeError("PYTHON_OPERATOR_IMPLEMENTATION_PATH_INVALID")
    path = operators_root / f"{relative}.py"
    if not path.is_file():
        raise RuntimeError("PYTHON_OPERATOR_IMPLEMENTATION_SOURCE_MISSING")
    return path


def compute_operator_registry_digest(manifest: Any = OPERATOR_MANIFEST) -> str:
    """Bind the sole manifest to the exact active implementation source set."""

    rows = [
        _REGISTRY_SCHEMA_VERSION,
        f"manifest={_sha256(MANIFEST_PATH.read_bytes())}",
    ]
    implementations: set[tuple[str, str]] = set()
    for descriptor in manifest["operators"]:
        implementation = descriptor["implementation"]
        module_name = implementation["module"]
        symbol = implementation["symbol"]
        key = (module_name, symbol)
        if key in implementations:
            raise RuntimeError("PYTHON_OPERATOR_IMPLEMENTATION_DUPLICATED")
        implementations.add(key)
        rows.append(
            f"implementation={module_name}:{symbol}:"
            f"{_sha256(_implementation_path(module_name).read_bytes())}"
        )
    return _sha256("\n".join(sorted(rows)).encode("utf-8"))


OPERATOR_REGISTRY_DIGEST = compute_operator_registry_digest()

__all__ = ["OPERATOR_REGISTRY_DIGEST", "compute_operator_registry_digest"]
