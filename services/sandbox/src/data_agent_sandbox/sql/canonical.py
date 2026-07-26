from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import rfc8785


def _utf16_key(value: str) -> bytes:
    return value.encode("utf-16-be", errors="surrogatepass")


def canonical_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("canonical datetime must include a timezone")
    utc_value = value.astimezone(UTC)
    milliseconds = utc_value.microsecond // 1_000
    normalized = utc_value.replace(microsecond=milliseconds * 1_000)
    return normalized.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _normalize(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("canonical JSON does not permit non-finite numbers")
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("canonical JSON does not permit non-finite decimals")
        return format(value, "f")
    if isinstance(value, datetime):
        return canonical_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("canonical JSON object keys must be strings")
        return {key: _normalize(value[key]) for key in sorted(value, key=_utf16_key)}
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        return [_normalize(item) for item in value]
    raise TypeError(f"unsupported canonical JSON value: {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Return deterministic compact JSON with ECMAScript UTF-16 object-key order."""

    return rfc8785.dumps(_normalize(value)).decode()


def sha256_content_hash(value: Any) -> str:
    payload = canonical_json(value).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def canonical_multiset_hash(rows: Sequence[Any]) -> str:
    """Hash a row multiset: order-insensitive while preserving duplicates."""

    canonical_rows = sorted(canonical_json(row) for row in rows)
    return sha256_content_hash(canonical_rows)


def canonical_result_bytes(columns: Sequence[Any], rows: Sequence[Any]) -> int:
    return len(canonical_json({"columns": columns, "rows": rows}).encode())


def canonical_empty_result_bytes(columns: Sequence[Any]) -> int:
    """Return the exact JCS byte size of the result envelope before retaining rows."""

    return canonical_result_bytes(columns, ())


def canonical_result_row_increment_bytes(
    row: Sequence[Any],
    *,
    has_retained_rows: bool,
) -> int:
    """Return the exact bytes added by one row to the canonical result document."""

    separator_bytes = 1 if has_retained_rows else 0
    return separator_bytes + len(canonical_json(row).encode())
