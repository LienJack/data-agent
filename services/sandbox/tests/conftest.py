from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

APP_ID = "00000000-0000-4000-8000-00000000da01"
TENANT_ID = "00000000-0000-4000-8000-00000000aa11"
RUN_ID = "00000000-0000-4000-8000-00000000a101"
EXECUTION_ID = "00000000-0000-4000-8000-00000000e101"
ATTEMPT_ID = "00000000-0000-4000-8000-00000000b101"
LEASE_ID = "00000000-0000-4000-8000-00000000ce01"
DATASOURCE_ID = "00000000-0000-4000-8000-00000000d101"
PRINCIPAL_ID = "00000000-0000-4000-8000-000000001001"
INPUT_HASH = f"sha256:{'1' * 64}"
SQL_ARTIFACT_HASH = f"sha256:{'2' * 64}"


@pytest.fixture
def execute_payload() -> dict[str, Any]:
    from data_agent_sandbox.protocol.models import bind_execute_frame

    issued_at = datetime.now(UTC) - timedelta(seconds=1)
    expires_at = issued_at + timedelta(minutes=5)
    candidate: dict[str, Any] = {
        "protocol_version": "data-agent-sql-sandbox@1.0.0",
        "frame_type": "EXECUTE",
        "grant": {
            "protocol_version": "sandbox-execution-grant@1.0.0",
            "identity": {
                "protocol_version": "sandbox-execution-identity@1.0.0",
                "scope": {
                    "app_id": APP_ID,
                    "tenant_id": TENANT_ID,
                    "environment": "test",
                },
                "scope_hash": f"sha256:{'0' * 64}",
                "run_id": RUN_ID,
                "execution_id": EXECUTION_ID,
                "principal_id": PRINCIPAL_ID,
                "idempotency_key": "sandbox-test-execution",
                "input_hash": INPUT_HASH,
                "sql_artifact_ref": {
                    "artifact_id": "00000000-0000-4000-8000-00000000f001",
                    "artifact_type": "SqlArtifact",
                    "app_id": APP_ID,
                    "tenant_id": TENANT_ID,
                    "environment": "test",
                    "run_id": RUN_ID,
                    "revision": 1,
                    "content_hash": SQL_ARTIFACT_HASH,
                },
                "execution_permit_ref": {
                    "artifact_id": "00000000-0000-4000-8000-00000000f002",
                    "artifact_type": "ExecutionPermit",
                    "app_id": APP_ID,
                    "tenant_id": TENANT_ID,
                    "environment": "test",
                    "run_id": RUN_ID,
                    "revision": 1,
                    "content_hash": f"sha256:{'4' * 64}",
                },
                "execution_permit_expires_at": expires_at.isoformat().replace("+00:00", "Z"),
                "resource_admission_ref": {
                    "artifact_id": "00000000-0000-4000-8000-00000000f003",
                    "artifact_type": "ResourceAdmissionReceipt",
                    "app_id": APP_ID,
                    "tenant_id": TENANT_ID,
                    "environment": "test",
                    "run_id": RUN_ID,
                    "revision": 1,
                    "content_hash": f"sha256:{'5' * 64}",
                },
                "policy_receipt_ref": {
                    "artifact_id": "00000000-0000-4000-8000-00000000f004",
                    "artifact_type": "PolicyReceipt",
                    "app_id": APP_ID,
                    "tenant_id": TENANT_ID,
                    "environment": "test",
                    "run_id": RUN_ID,
                    "revision": 1,
                    "content_hash": f"sha256:{'6' * 64}",
                },
                "query_hash": f"sha256:{'0' * 64}",
                "parameters_hash": f"sha256:{'0' * 64}",
                "ordered_parameters_hash": f"sha256:{'0' * 64}",
                "datasource_id": DATASOURCE_ID,
                "schema_version": "commerce@1.0.0",
                "settings_hash": f"sha256:{'0' * 64}",
                "budget": {
                    "timeout_ms": 2_000,
                    "lock_timeout_ms": 200,
                    "max_rows": 1_000,
                    "max_bytes": 65_536,
                    "max_memory_mb": 64,
                },
                "snapshot_requirement": {"mode": "ALLOW_UNAVAILABLE"},
            },
            "attempt_id": ATTEMPT_ID,
            "attempt": 1,
            "fencing_token": 7,
            "lease_id": LEASE_ID,
            "lease_expires_at": expires_at.isoformat().replace("+00:00", "Z"),
            "cancel_epoch": 0,
            "snapshot_descriptor": {
                "protocol_version": "postgresql-snapshot@1.0.0",
                "scope_hash": f"sha256:{'0' * 64}",
                "run_id": RUN_ID,
                "execution_id": EXECUTION_ID,
                "principal_id": PRINCIPAL_ID,
                "datasource_id": DATASOURCE_ID,
                "datasource_fingerprint": "postgresql-test-datasource@1.0.0",
                "schema_version": "commerce@1.0.0",
                "strategy": "NONE",
                "intent": "RESOLVE",
                "snapshot_token": None,
                "schema_manifest_hash": None,
                "data_manifest_hash": None,
                "fixture_manifest_hash": None,
                "observed_at": issued_at.isoformat().replace("+00:00", "Z"),
                "replay_state": "REPLAY_UNAVAILABLE",
                "descriptor_hash": f"sha256:{'0' * 64}",
            },
            "fixture_manifest_hash": None,
            "budget": {
                "timeout_ms": 2_000,
                "lock_timeout_ms": 200,
                "max_rows": 1_000,
                "max_bytes": 65_536,
                "max_memory_mb": 64,
            },
            "issued_at": issued_at.isoformat().replace("+00:00", "Z"),
            "grant_hash": f"sha256:{'0' * 64}",
        },
        "sql": {
            "dialect": "postgresql",
            "datasource_id": DATASOURCE_ID,
            "schema_version": "commerce@1.0.0",
            "sql_artifact_hash": SQL_ARTIFACT_HASH,
            "query": "select $1::integer as result",
            "parameters": {"$1": 7},
            "ordered_parameters": [7],
            "query_hash": f"sha256:{'0' * 64}",
        },
        "snapshot": {
            "strategy": "NONE",
            "scope": {
                "app_id": APP_ID,
                "tenant_id": TENANT_ID,
                "environment": "test",
            },
            "run_id": RUN_ID,
            "principal_id": PRINCIPAL_ID,
            "datasource_id": DATASOURCE_ID,
            "snapshot_token": None,
            "schema_name": None,
            "schema_manifest_hash": None,
            "data_manifest_hash": None,
            "fixture_manifest_hash": None,
            "relations": [],
        },
        "settings": {
            "database_role": "sandbox_reader",
            "search_path": ["pg_catalog"],
            "plan_cache_mode": "force_custom_plan",
            "statement_timeout_ms": 2_000,
            "lock_timeout_ms": 200,
            "idle_in_transaction_session_timeout_ms": 3_000,
        },
        "budget": {
            "timeout_ms": 2_000,
            "lock_timeout_ms": 200,
            "max_rows": 1_000,
            "max_bytes": 65_536,
            "max_memory_mb": 64,
        },
    }
    return bind_execute_frame(candidate).model_dump(mode="json")


@pytest.fixture
def copy_execute_payload(execute_payload: dict[str, Any]):
    def factory() -> dict[str, Any]:
        return copy.deepcopy(execute_payload)

    return factory
