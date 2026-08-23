from __future__ import annotations

import json
import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest

from data_agent_sandbox.sql.canonical import (
    canonical_datetime,
    canonical_empty_result_bytes,
    canonical_json,
    canonical_multiset_hash,
    canonical_result_bytes,
    canonical_result_row_increment_bytes,
)

REPO_ROOT = Path(__file__).parents[3]
VECTOR_PATH = (
    REPO_ROOT / "tests" / "fixtures" / "sandbox-protocol" / "v1" / "canonical-vectors.json"
)


def test_canonical_json_uses_utf16_key_order() -> None:
    assert canonical_json({"𐀀": "supplementary", "": "bmp"}) == ('{"𐀀":"supplementary","":"bmp"}')


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (datetime(2026, 7, 27, tzinfo=UTC), "2026-07-27T00:00:00.000Z"),
        (datetime(2026, 7, 27, microsecond=123_999, tzinfo=UTC), "2026-07-27T00:00:00.123Z"),
    ],
)
def test_canonical_datetime_uses_utc_milliseconds(value: datetime, expected: str) -> None:
    assert canonical_datetime(value) == expected


def test_multiset_hash_ignores_row_order_but_preserves_duplicates() -> None:
    left = [[1, "a"], [2, "b"], [1, "a"]]
    reordered = [[1, "a"], [1, "a"], [2, "b"]]
    deduplicated = [[1, "a"], [2, "b"]]

    assert canonical_multiset_hash(left) == canonical_multiset_hash(reordered)
    assert canonical_multiset_hash(left) != canonical_multiset_hash(deduplicated)


def test_result_bytes_cover_unicode_escape_null_decimal_string_and_date() -> None:
    columns = [
        {"name": "label", "type": "STRING"},
        {"name": "optional", "type": "STRING"},
        {"name": "amount", "type": "STRING"},
        {"name": "day", "type": "STRING"},
    ]
    rows = [['中文\n"quote"\\slash 😀', None, "9007199254740993.1250", "2026-07-27"]]
    expected = canonical_json({"columns": columns, "rows": rows}).encode()

    assert canonical_result_bytes(columns, rows) == len(expected)


def test_incremental_result_bytes_are_exactly_equal_to_final_jcs_document() -> None:
    columns = [
        {"name": "label", "type": "STRING"},
        {"name": "optional", "type": "STRING"},
    ]
    rows = [
        ['中文\n"quote"\\slash 😀', None],
        ["𐀀", ""],
        ["third", "row"],
    ]
    retained_bytes = canonical_empty_result_bytes(columns)

    assert retained_bytes == canonical_result_bytes(columns, ())
    for index, row in enumerate(rows):
        retained_bytes += canonical_result_row_increment_bytes(
            row,
            has_retained_rows=index > 0,
        )
        assert retained_bytes == canonical_result_bytes(columns, rows[: index + 1])


def test_checked_in_vectors_match_typescript_contract_canonicalizer() -> None:
    if shutil.which("pnpm") is None:
        pytest.skip("pnpm is required for cross-language canonical-vector verification")
    vectors = json.loads(VECTOR_PATH.read_text(encoding="utf-8"))
    python_values = [canonical_json(vector["value"]) for vector in vectors]
    expected = [vector["canonical"] for vector in vectors]
    source = """
      import { readFileSync } from "node:fs";
      import { canonicalizeJson } from "./packages/contracts/src/common/canonical-json.ts";
      const vectors = JSON.parse(readFileSync(process.env.CANONICAL_VECTOR_PATH, "utf8"));
      process.stdout.write(JSON.stringify(vectors.map((vector) => canonicalizeJson(vector.value))));
    """
    environment = {
        **os.environ,
        "CANONICAL_VECTOR_PATH": str(VECTOR_PATH),
    }
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", source],
        cwd=REPO_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert python_values == expected
    assert json.loads(result.stdout) == expected
