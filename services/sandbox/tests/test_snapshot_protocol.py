from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from data_agent_sandbox.protocol.models import (
    ControlledRevisionSnapshot,
    NoneSnapshot,
    relation_data_manifest_hash,
    relation_schema_manifest_hash,
)
from data_agent_sandbox.sql.canonical import canonical_json, sha256_content_hash
from data_agent_sandbox.sql.snapshots import (
    SnapshotManifestBudget,
    SnapshotManifestBudgetExceeded,
    _data_hash,
    _SnapshotManifestUsage,
)


def relation(name: str, oid: int, data_digit: str) -> dict[str, object]:
    return {
        "schema_name": "controlled_snapshot",
        "relation_name": name,
        "relation_oid": oid,
        "schema_hash": f"sha256:{'a' * 64}",
        "data_hash": f"sha256:{data_digit * 64}",
    }


def controlled_payload() -> dict[str, object]:
    relations = [relation("customers", 100, "b"), relation("orders", 101, "c")]
    schema_manifest_hash = relation_schema_manifest_hash(relations)
    data_manifest_hash = relation_data_manifest_hash(relations)
    return {
        "strategy": "CONTROLLED_REVISION",
        "scope": {
            "app_id": "00000000-0000-4000-8000-00000000da01",
            "tenant_id": "00000000-0000-4000-8000-00000000aa11",
            "environment": "test",
        },
        "run_id": "00000000-0000-4000-8000-00000000a101",
        "principal_id": "00000000-0000-4000-8000-000000001001",
        "datasource_id": "00000000-0000-4000-8000-00000000d101",
        "snapshot_token": "controlled-snapshot@1.0.0",
        "schema_name": "controlled_snapshot",
        "schema_manifest_hash": schema_manifest_hash,
        "data_manifest_hash": data_manifest_hash,
        "fixture_manifest_hash": sha256_content_hash(
            {
                "data_manifest_hash": data_manifest_hash,
                "schema_manifest_hash": schema_manifest_hash,
            }
        ),
        "relations": relations,
    }


def test_none_snapshot_cannot_claim_a_manifest() -> None:
    with pytest.raises(ValidationError):
        NoneSnapshot.model_validate(
            {
                **controlled_payload(),
                "strategy": "NONE",
                "snapshot_token": None,
                "schema_name": None,
            }
        )


def test_controlled_snapshot_requires_exact_sorted_full_manifest() -> None:
    snapshot = ControlledRevisionSnapshot.model_validate(controlled_payload())
    assert [item.relation_name for item in snapshot.relations] == ["customers", "orders"]

    tampered = copy.deepcopy(controlled_payload())
    tampered["relations"][0]["data_hash"] = f"sha256:{'d' * 64}"
    with pytest.raises(ValidationError, match="data_manifest_hash"):
        ControlledRevisionSnapshot.model_validate(tampered)


def test_controlled_snapshot_rejects_duplicate_relation_or_oid() -> None:
    duplicate = controlled_payload()
    duplicate["relations"][1]["relation_oid"] = 100
    with pytest.raises(ValidationError, match="unique"):
        ControlledRevisionSnapshot.model_validate(duplicate)


class _ManifestCursor:
    def __init__(self, row: object) -> None:
        self._row = row
        self._returned = False

    async def execute(self, _query: object) -> None:
        return None

    async def fetchmany(self, _size: int) -> list[tuple[object]]:
        if self._returned:
            return []
        self._returned = True
        return [(self._row,)]

    async def close(self) -> None:
        return None


class _ManifestConnection:
    def __init__(self, row: object) -> None:
        self._row = row

    def cursor(self, **_kwargs: object) -> _ManifestCursor:
        return _ManifestCursor(self._row)


async def test_manifest_byte_budget_counts_exact_jcs_array_boundaries() -> None:
    row = {"label": '中"\\'}
    canonical_row = canonical_json(row)
    exact_bytes = len(canonical_json([canonical_row]).encode())
    exact_budget = SnapshotManifestBudget(
        max_relations=1,
        max_columns_per_relation=1,
        max_rows=1,
        max_bytes=exact_bytes,
        fetch_size=1,
    )
    usage = _SnapshotManifestUsage()

    data_hash = await _data_hash(
        _ManifestConnection(row),  # type: ignore[arg-type]
        42,
        "controlled_snapshot",
        "facts",
        exact_budget,
        usage,
    )

    assert usage.bytes == exact_bytes
    assert data_hash == sha256_content_hash([canonical_row])

    with pytest.raises(SnapshotManifestBudgetExceeded, match="bytes"):
        await _data_hash(
            _ManifestConnection(row),  # type: ignore[arg-type]
            42,
            "controlled_snapshot",
            "facts",
            SnapshotManifestBudget(
                max_relations=1,
                max_columns_per_relation=1,
                max_rows=1,
                max_bytes=exact_bytes - 1,
                fetch_size=1,
            ),
            _SnapshotManifestUsage(),
        )
