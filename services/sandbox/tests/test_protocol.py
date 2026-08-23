from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from data_agent_sandbox.protocol.models import (
    CancelFrame,
    ExecuteFrame,
    OutcomeColumn,
    OutcomeFrame,
    ReplayUnavailableOutcome,
    SandboxSettings,
    UuidString,
    bind_execute_frame,
    bind_outcome,
    decode_input_frame,
    outcome_binding_from_execute,
    relation_data_manifest_hash,
    relation_schema_manifest_hash,
    validate_cancel_binding,
)
from data_agent_sandbox.sql.canonical import sha256_content_hash

FIXTURE_ROOT = Path(__file__).parents[3] / "tests" / "fixtures" / "sandbox-protocol" / "v1"
REPO_ROOT = Path(__file__).parents[3]


def _controlled_execute_payload(
    payload: dict[str, object],
    *,
    requirement_mode: str,
) -> dict[str, object]:
    schema_name = "controlled_snapshot"
    relations = [
        {
            "schema_name": schema_name,
            "relation_name": "orders",
            "relation_oid": 101,
            "schema_hash": f"sha256:{'a' * 64}",
            "data_hash": f"sha256:{'b' * 64}",
        }
    ]
    schema_manifest_hash = relation_schema_manifest_hash(relations)
    data_manifest_hash = relation_data_manifest_hash(relations)
    payload["snapshot"] = {
        "strategy": "CONTROLLED_REVISION",
        "scope": payload["grant"]["identity"]["scope"],
        "run_id": payload["grant"]["identity"]["run_id"],
        "principal_id": payload["grant"]["identity"]["principal_id"],
        "datasource_id": payload["grant"]["identity"]["datasource_id"],
        "snapshot_token": "controlled-snapshot@1.0.0",
        "schema_name": schema_name,
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
    payload["grant"]["identity"]["snapshot_requirement"] = {"mode": requirement_mode}
    payload["settings"]["search_path"] = [schema_name, "pg_catalog"]
    return payload


def _replay_unavailable_candidate(execute: ExecuteFrame) -> dict[str, object]:
    descriptor = execute.grant.snapshot_descriptor
    return {
        **outcome_binding_from_execute(execute),
        "terminal": "REPLAY_UNAVAILABLE",
        "reason_code": "SANDBOX_REPLAY_UNAVAILABLE",
        "started_at": execute.grant.issued_at,
        "completed_at": execute.grant.issued_at,
        "resource_facts": {
            "elapsed_ms": 0,
            "observed_rows": 0,
            "observed_bytes": 0,
            "peak_memory_mb": 0,
            "retained_canonical_bytes": 0,
            "current_batch_estimated_bytes": 0,
            "process_rss_high_water_bytes": 0,
            "cgroup_memory_limit_enforced": False,
            "partial_output_discarded": True,
            "cutoff_kind": "NONE",
        },
        "cancel_facts": {
            "cancel_requested": False,
            "query_cancel_dispatched": False,
            "query_cancel_confirmed": False,
            "cancel_disposition": "NOT_REQUESTED",
            "cancel_epoch_at_start": execute.grant.cancel_epoch,
            "cancel_epoch_observed": execute.grant.cancel_epoch,
            "cancel_requested_at": None,
        },
        "rollback_facts": {
            "rollback_confirmed": True,
            "datasource_terminal": "ROLLED_BACK_CLEAN",
        },
        "connection_facts": {
            "backend_pid": 123,
            "transaction_status": "IDLE",
            "connection_reused": False,
        },
        "transaction": {
            "transaction_id": "00000000-0000-4000-8000-00000000ef01",
            "read_only": True,
            "isolation_level": "REPEATABLE_READ",
        },
        "applied_execution_settings": {
            key: value
            for key, value in execute.settings.model_dump(mode="json").items()
            if key != "idle_in_transaction_session_timeout_ms"
        },
        "manifest_facts": {
            "snapshot_descriptor_hash": descriptor.descriptor_hash,
            "schema_manifest_hash": descriptor.schema_manifest_hash,
            "data_manifest_hash": descriptor.data_manifest_hash,
            "fixture_manifest_hash": descriptor.fixture_manifest_hash,
            "manifest_revalidated": True,
            "revalidated_at": execute.grant.issued_at,
        },
        "canonical_multiset_facts": {
            "canonical_multiset_hash": None,
            "ordered_result_hash": None,
        },
        "result": None,
    }


def test_uuid_vectors_match_contracts_zod_uuid_behavior() -> None:
    vectors = [
        {"value": "0190f3a4-7b6c-7d8e-8f90-123456789abc", "valid": True},
        {"value": "123e4567-e89b-8d3a-a456-426614174000", "valid": True},
        {"value": "0190F3A4-7B6C-7D8E-8F90-123456789ABC", "valid": True},
        {"value": "00000000-0000-0000-0000-000000000000", "valid": True},
        {"value": "ffffffff-ffff-ffff-ffff-ffffffffffff", "valid": True},
        {"value": "123e4567-e89b-9d3a-a456-426614174000", "valid": False},
        {"value": "123e4567-e89b-0d3a-a456-426614174000", "valid": False},
        {"value": "123e4567-e89b-7d3a-7456-426614174000", "valid": False},
        {"value": "not-a-uuid", "valid": False},
    ]
    adapter = TypeAdapter(UuidString)
    python_results: list[bool] = []
    for vector in vectors:
        try:
            adapter.validate_python(vector["value"])
        except ValidationError:
            python_results.append(False)
        else:
            python_results.append(True)

    if shutil.which("pnpm") is None:
        pytest.skip("pnpm is required for UUID parity verification")
    source = """
      import { immutableIdSchema } from "./packages/contracts/src/common/primitives.ts";
      const vectors = JSON.parse(process.env.UUID_PARITY_VECTORS);
      process.stdout.write(JSON.stringify(vectors.map(({ value }) =>
        immutableIdSchema.safeParse(value).success
      )));
    """
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", source],
        cwd=REPO_ROOT,
        env={
            **os.environ,
            "UUID_PARITY_VECTORS": json.dumps(vectors),
        },
        check=True,
        capture_output=True,
        text=True,
    )

    expected = [bool(vector["valid"]) for vector in vectors]
    assert python_results == expected
    assert json.loads(result.stdout) == expected


def test_execute_frame_is_strict_and_never_accepts_a_dsn(copy_execute_payload) -> None:
    payload = copy_execute_payload()
    payload["dsn"] = "postgresql://must-not-cross-the-protocol"

    with pytest.raises(ValidationError):
        ExecuteFrame.model_validate(payload)


def test_execute_frame_binds_query_snapshot_and_grant_hashes(copy_execute_payload) -> None:
    payload = copy_execute_payload()
    payload["sql"]["parameters"]["$1"] = 8
    payload["sql"]["ordered_parameters"] = [8]

    with pytest.raises(ValidationError, match="query_hash"):
        ExecuteFrame.model_validate(payload)


@pytest.mark.parametrize(
    "requirement_mode",
    ["REQUIRE_REPLAYABLE", "ALLOW_LIMITED", "ALLOW_UNAVAILABLE"],
)
def test_controlled_revision_satisfies_every_snapshot_requirement(
    copy_execute_payload,
    requirement_mode: str,
) -> None:
    payload = _controlled_execute_payload(
        copy_execute_payload(),
        requirement_mode=requirement_mode,
    )

    frame = bind_execute_frame(payload)

    assert frame.snapshot.strategy == "CONTROLLED_REVISION"
    assert frame.settings.search_path == ("controlled_snapshot", "pg_catalog")


@pytest.mark.parametrize("requirement_mode", ["REQUIRE_REPLAYABLE", "ALLOW_LIMITED"])
def test_none_snapshot_only_satisfies_allow_unavailable(
    copy_execute_payload,
    requirement_mode: str,
) -> None:
    payload = copy_execute_payload()
    payload["grant"]["identity"]["snapshot_requirement"] = {"mode": requirement_mode}

    with pytest.raises(ValidationError, match="snapshot strategy"):
        bind_execute_frame(payload)


def test_execute_frame_requires_strategy_specific_exact_search_path(
    copy_execute_payload,
) -> None:
    none_payload = copy_execute_payload()
    none_payload["settings"]["search_path"] = ["pg_catalog", "public"]
    with pytest.raises(ValidationError, match="search_path"):
        bind_execute_frame(none_payload)

    controlled_payload = _controlled_execute_payload(
        copy_execute_payload(),
        requirement_mode="REQUIRE_REPLAYABLE",
    )
    controlled_payload["settings"]["search_path"] = ["pg_catalog", "controlled_snapshot"]
    with pytest.raises(ValidationError, match="search_path"):
        bind_execute_frame(controlled_payload)


def test_parameter_placeholders_are_contiguous_and_numeric(copy_execute_payload) -> None:
    payload = copy_execute_payload()
    payload["sql"]["query"] = "select $1, $2, $10"
    payload["sql"]["parameters"] = {"$1": 1, "$10": 10, "$2": 2}

    with pytest.raises(ValidationError, match="contiguous"):
        bind_execute_frame(payload)


def test_parameter_values_are_ordered_by_numeric_placeholder(copy_execute_payload) -> None:
    payload = copy_execute_payload()
    payload["sql"]["query"] = "select " + ", ".join(f"${index}" for index in range(1, 13))
    payload["sql"]["parameters"] = {
        f"${index}": index for index in (1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9)
    }
    frame = bind_execute_frame(payload)

    assert frame.sql.ordered_parameters == tuple(range(1, 13))
    assert frame.sql.positional_parameters() == tuple(range(1, 13))


def test_authority_ordered_parameters_cannot_diverge_from_map(
    copy_execute_payload,
) -> None:
    payload = copy_execute_payload()
    payload["sql"]["ordered_parameters"] = [8]

    with pytest.raises(ValidationError, match="ordered_parameters"):
        ExecuteFrame.model_validate(payload)


def test_query_wire_limit_is_exactly_one_hundred_thousand_characters(
    copy_execute_payload,
) -> None:
    payload = copy_execute_payload()
    prefix = "select 1::integer as result"
    payload["sql"]["query"] = prefix + (" " * (100_000 - len(prefix)))
    payload["sql"]["parameters"] = {}

    assert len(bind_execute_frame(payload).sql.query) == 100_000

    payload["sql"]["query"] += " "
    with pytest.raises(ValidationError, match="at most 100000"):
        bind_execute_frame(payload)


def test_principal_is_a_contract_string_not_a_uuid(copy_execute_payload) -> None:
    payload = copy_execute_payload()
    payload["grant"]["identity"]["principal_id"] = "principal:service-account"
    payload["snapshot"]["principal_id"] = "principal:service-account"

    assert bind_execute_frame(payload).grant.identity.principal_id == "principal:service-account"


def test_cancel_frame_must_advance_epoch_and_match_attempt(copy_execute_payload) -> None:
    execute = ExecuteFrame.model_validate(copy_execute_payload())
    cancel = CancelFrame.model_validate(
        {
            "protocol_version": execute.protocol_version,
            "frame_type": "CANCEL",
            "grant_hash": execute.grant.grant_hash,
            "lease_id": execute.grant.lease_id,
            "execution_id": execute.grant.execution_id,
            "attempt_id": execute.grant.attempt_id,
            "execution_fence": execute.grant.execution_fence,
            "cancel_epoch": execute.grant.cancel_epoch + 1,
            "requested_at": execute.grant.issued_at,
            "reason_code": "USER_CANCELLED",
        }
    )
    validate_cancel_binding(execute, cancel)

    with pytest.raises(ValueError, match="attempt"):
        validate_cancel_binding(
            execute,
            cancel.model_copy(update={"attempt_id": "00000000-0000-4000-8000-00000000ffff"}),
        )


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("execution_fence", 0),
        ("reason_code", "OTHER"),
        ("requested_at", "2099-07-27T00:00:00"),
    ],
)
def test_cancel_rejects_values_outside_platform_wire_contract(
    copy_execute_payload,
    field_name: str,
    invalid_value: object,
) -> None:
    execute = ExecuteFrame.model_validate(copy_execute_payload())
    candidate = {
        "protocol_version": execute.protocol_version,
        "frame_type": "CANCEL",
        "grant_hash": execute.grant.grant_hash,
        "lease_id": execute.grant.lease_id,
        "execution_id": execute.grant.execution_id,
        "attempt_id": execute.grant.attempt_id,
        "execution_fence": execute.grant.execution_fence,
        "cancel_epoch": execute.grant.cancel_epoch + 1,
        "requested_at": execute.grant.issued_at,
        "reason_code": "USER_CANCELLED",
    }
    candidate[field_name] = invalid_value

    with pytest.raises(ValidationError):
        CancelFrame.model_validate(candidate)


def test_settings_and_output_alias_match_contract_bounds() -> None:
    with pytest.raises(ValidationError):
        SandboxSettings.model_validate(
            {
                "database_role": "sandbox_reader",
                "search_path": ["Public"],
                "plan_cache_mode": "force_custom_plan",
                "statement_timeout_ms": 2_000,
                "lock_timeout_ms": 200,
                "idle_in_transaction_session_timeout_ms": 3_000,
            }
        )
    with pytest.raises(ValidationError):
        OutcomeColumn.model_validate({"name": "bad alias!", "type": "STRING"})


def test_replay_unavailable_outcome_round_trips_as_its_own_terminal(
    copy_execute_payload,
) -> None:
    execute = ExecuteFrame.model_validate(copy_execute_payload())

    outcome = bind_outcome(_replay_unavailable_candidate(execute))
    decoded = TypeAdapter(OutcomeFrame).validate_json(outcome.model_dump_json())

    assert isinstance(decoded, ReplayUnavailableOutcome)
    assert decoded.terminal == "REPLAY_UNAVAILABLE"
    assert decoded.reason_code == "SANDBOX_REPLAY_UNAVAILABLE"
    assert decoded.result is None


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("reason_code", "SANDBOX_QUERY_FAILED"),
        (
            "result",
            {
                "columns": [{"name": "result", "type": "INTEGER"}],
                "rows": [[1]],
            },
        ),
    ],
)
def test_replay_unavailable_outcome_rejects_wrong_reason_or_result(
    copy_execute_payload,
    field_name: str,
    invalid_value: object,
) -> None:
    execute = ExecuteFrame.model_validate(copy_execute_payload())
    candidate = _replay_unavailable_candidate(execute)
    candidate[field_name] = invalid_value

    with pytest.raises(ValidationError):
        bind_outcome(candidate)


@pytest.mark.parametrize("name", ["execute.json", "cancel.json"])
def test_checked_in_protocol_fixtures_round_trip(name: str) -> None:
    raw = (FIXTURE_ROOT / name).read_text(encoding="utf-8")
    frame = decode_input_frame(raw)

    assert json.loads(frame.model_dump_json()) == json.loads(raw)
