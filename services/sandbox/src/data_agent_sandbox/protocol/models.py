from __future__ import annotations

import copy
import math
import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime as PydanticAwareDatetime,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    PlainSerializer,
    TypeAdapter,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)

from data_agent_sandbox.sql.canonical import canonical_datetime, sha256_content_hash

PROTOCOL_VERSION = "data-agent-sql-sandbox@1.0.0"
MUTATION_PROTOCOL_VERSION = "data-agent-fixture-mutation@1.0.0"
TRANSFORMATION_PROTOCOL_VERSION = "data-agent-query-transformation@1.0.0"

UuidString = Annotated[
    str,
    Field(
        pattern=(
            r"^(?:"
            r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-"
            r"[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}"
            r"|00000000-0000-0000-0000-000000000000"
            r"|[Ff]{8}-[Ff]{4}-[Ff]{4}-[Ff]{4}-[Ff]{12}"
            r")$"
        )
    ),
]
Sha256 = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_$]{0,62}$")]
Environment = Annotated[
    str,
    Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
]
VersionIdentifier = Annotated[
    str,
    Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$",
    ),
]
SearchPathIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=63, pattern=r"^[a-z_][a-z0-9_]*$"),
]
OutputAlias = Annotated[
    str,
    Field(
        min_length=1,
        max_length=63,
        pattern=r"^[A-Za-z_][A-Za-z0-9_.:-]*$",
    ),
]
Placeholder = Annotated[str, Field(pattern=r"^\$[1-9][0-9]*$")]
AwareDatetime = Annotated[
    PydanticAwareDatetime,
    PlainSerializer(canonical_datetime, return_type=str),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Scope(StrictModel):
    app_id: UuidString
    tenant_id: UuidString
    environment: Environment


class ArtifactReference(StrictModel):
    artifact_id: UuidString
    artifact_type: Literal[
        "SqlArtifact",
        "ExecutionPermit",
        "ResourceAdmissionReceipt",
        "PolicyReceipt",
    ]
    app_id: UuidString
    tenant_id: UuidString
    environment: Environment
    run_id: UuidString
    revision: Annotated[int, Field(gt=0)]
    content_hash: Sha256


class SnapshotRequirement(StrictModel):
    mode: Literal["REQUIRE_REPLAYABLE", "ALLOW_LIMITED", "ALLOW_UNAVAILABLE"]


class SandboxBudget(StrictModel):
    timeout_ms: Annotated[int, Field(gt=0, le=300_000)]
    lock_timeout_ms: Annotated[int, Field(gt=0, le=300_000)]
    max_rows: Annotated[int, Field(gt=0, le=10_000)]
    max_bytes: Annotated[int, Field(gt=0, le=67_108_864)]
    max_memory_mb: Annotated[int, Field(gt=0, le=512)]

    @model_validator(mode="after")
    def validate_lock_timeout(self) -> SandboxBudget:
        if self.lock_timeout_ms >= self.timeout_ms:
            raise ValueError("lock_timeout_ms must be less than timeout_ms")
        return self


class SandboxExecutionImmutableIdentity(StrictModel):
    protocol_version: Literal["sandbox-execution-identity@1.0.0"]
    scope: Scope
    scope_hash: Sha256
    run_id: UuidString
    execution_id: UuidString
    principal_id: Annotated[str, Field(min_length=1, max_length=256)]
    idempotency_key: Annotated[str, Field(min_length=1, max_length=256)]
    input_hash: Sha256
    sql_artifact_ref: ArtifactReference
    execution_permit_ref: ArtifactReference
    execution_permit_expires_at: AwareDatetime
    resource_admission_ref: ArtifactReference
    policy_receipt_ref: ArtifactReference
    query_hash: Sha256
    parameters_hash: Sha256
    ordered_parameters_hash: Sha256
    datasource_id: UuidString
    schema_version: VersionIdentifier
    settings_hash: Sha256
    budget: SandboxBudget
    snapshot_requirement: SnapshotRequirement

    @model_validator(mode="after")
    def validate_identity(self) -> SandboxExecutionImmutableIdentity:
        if self.scope_hash != sha256_content_hash(self.scope.model_dump(mode="json")):
            raise ValueError("identity scope_hash must bind scope")
        expected_types = (
            "SqlArtifact",
            "ExecutionPermit",
            "ResourceAdmissionReceipt",
            "PolicyReceipt",
        )
        references = (
            self.sql_artifact_ref,
            self.execution_permit_ref,
            self.resource_admission_ref,
            self.policy_receipt_ref,
        )
        if tuple(reference.artifact_type for reference in references) != expected_types:
            raise ValueError("identity artifact references must have their exact contract types")
        for reference in references:
            if (
                reference.app_id != self.scope.app_id
                or reference.tenant_id != self.scope.tenant_id
                or reference.environment != self.scope.environment
                or reference.run_id != self.run_id
            ):
                raise ValueError("identity references must bind the same scope and run")
        return self


class RelationManifestEntry(StrictModel):
    schema_name: Identifier
    relation_name: Identifier
    relation_oid: Annotated[int, Field(gt=0)]
    schema_hash: Sha256
    data_hash: Sha256


def relation_manifest_hash(
    relations: list[dict[str, object]] | tuple[RelationManifestEntry, ...],
) -> str:
    normalized = [
        item.model_dump(mode="json") if isinstance(item, RelationManifestEntry) else item
        for item in relations
    ]
    return sha256_content_hash(normalized)


def relation_schema_manifest_hash(
    relations: list[dict[str, object]] | tuple[RelationManifestEntry, ...],
) -> str:
    normalized = [
        {
            "schema_name": item.schema_name,
            "relation_name": item.relation_name,
            "relation_oid": item.relation_oid,
            "schema_hash": item.schema_hash,
        }
        if isinstance(item, RelationManifestEntry)
        else {
            key: item[key]
            for key in ("schema_name", "relation_name", "relation_oid", "schema_hash")
        }
        for item in relations
    ]
    return sha256_content_hash(normalized)


def relation_data_manifest_hash(
    relations: list[dict[str, object]] | tuple[RelationManifestEntry, ...],
) -> str:
    normalized = [
        {
            "schema_name": item.schema_name,
            "relation_name": item.relation_name,
            "relation_oid": item.relation_oid,
            "data_hash": item.data_hash,
        }
        if isinstance(item, RelationManifestEntry)
        else {
            key: item[key] for key in ("schema_name", "relation_name", "relation_oid", "data_hash")
        }
        for item in relations
    ]
    return sha256_content_hash(normalized)


class SnapshotBase(StrictModel):
    scope: Scope
    run_id: UuidString
    principal_id: Annotated[str, Field(min_length=1, max_length=256)]
    datasource_id: UuidString


class NoneSnapshot(SnapshotBase):
    strategy: Literal["NONE"]
    snapshot_token: None
    schema_name: None
    schema_manifest_hash: None
    data_manifest_hash: None
    fixture_manifest_hash: None
    relations: tuple[()] = ()


class ControlledRevisionSnapshot(SnapshotBase):
    strategy: Literal["CONTROLLED_REVISION"]
    snapshot_token: Annotated[str, Field(min_length=1, max_length=255)]
    schema_name: Identifier
    schema_manifest_hash: Sha256
    data_manifest_hash: Sha256
    fixture_manifest_hash: Sha256
    relations: Annotated[tuple[RelationManifestEntry, ...], Field(min_length=1)]

    @model_validator(mode="after")
    def validate_full_manifest(self) -> ControlledRevisionSnapshot:
        relation_keys = [(entry.schema_name, entry.relation_name) for entry in self.relations]
        relation_oids = [entry.relation_oid for entry in self.relations]
        if relation_keys != sorted(relation_keys):
            raise ValueError("relations must be in exact sorted order")
        if len(set(relation_keys)) != len(relation_keys) or len(set(relation_oids)) != len(
            relation_oids
        ):
            raise ValueError("relation names and relation OIDs must be unique")
        if any(entry.schema_name != self.schema_name for entry in self.relations):
            raise ValueError("every relation must belong to snapshot schema_name")
        if self.schema_manifest_hash != relation_schema_manifest_hash(self.relations):
            raise ValueError("schema_manifest_hash does not bind the complete relation schema")
        if self.data_manifest_hash != relation_data_manifest_hash(self.relations):
            raise ValueError("data_manifest_hash does not bind the complete relation data")
        expected_fixture_hash = sha256_content_hash(
            {
                "data_manifest_hash": self.data_manifest_hash,
                "schema_manifest_hash": self.schema_manifest_hash,
            }
        )
        if self.fixture_manifest_hash != expected_fixture_hash:
            raise ValueError("fixture_manifest_hash must compose schema and data manifests")
        return self


SnapshotDescriptor = Annotated[
    NoneSnapshot | ControlledRevisionSnapshot,
    Field(discriminator="strategy"),
]


class AuthoritySnapshotDescriptor(StrictModel):
    protocol_version: Literal["postgresql-snapshot@1.0.0"]
    scope_hash: Sha256
    run_id: UuidString
    execution_id: UuidString
    principal_id: Annotated[str, Field(min_length=1, max_length=256)]
    datasource_id: UuidString
    datasource_fingerprint: Annotated[str, Field(min_length=1, max_length=1_024)]
    schema_version: VersionIdentifier
    strategy: Literal["CONTROLLED_REVISION", "NONE"]
    intent: Literal["CREATE", "RESOLVE"]
    snapshot_token: VersionIdentifier | None
    schema_manifest_hash: Sha256 | None
    data_manifest_hash: Sha256 | None
    fixture_manifest_hash: Sha256 | None
    observed_at: AwareDatetime
    replay_state: Literal["REPLAYABLE", "REPLAY_UNAVAILABLE"]
    descriptor_hash: Sha256

    @model_validator(mode="after")
    def validate_descriptor(self) -> AuthoritySnapshotDescriptor:
        manifests = (
            self.schema_manifest_hash,
            self.data_manifest_hash,
            self.fixture_manifest_hash,
        )
        if self.strategy == "CONTROLLED_REVISION":
            if (
                self.replay_state != "REPLAYABLE"
                or self.snapshot_token is None
                or any(value is None for value in manifests)
            ):
                raise ValueError("CONTROLLED_REVISION requires token and all three manifests")
        elif (
            self.replay_state != "REPLAY_UNAVAILABLE"
            or self.snapshot_token is not None
            or any(value is not None for value in manifests)
        ):
            raise ValueError("NONE requires replay unavailable and null token/manifests")
        material = self.model_dump(mode="python", exclude={"descriptor_hash"})
        if self.descriptor_hash != sha256_content_hash(material):
            raise ValueError("descriptor_hash does not bind the exact snapshot descriptor")
        return self


class ExecutionGrant(StrictModel):
    protocol_version: Literal["sandbox-execution-grant@1.0.0"]
    identity: SandboxExecutionImmutableIdentity
    attempt_id: UuidString
    attempt: Annotated[int, Field(gt=0)]
    fencing_token: Annotated[int, Field(gt=0)]
    lease_id: UuidString
    lease_expires_at: AwareDatetime
    cancel_epoch: Annotated[int, Field(ge=0)]
    snapshot_descriptor: AuthoritySnapshotDescriptor
    fixture_manifest_hash: Sha256 | None
    budget: SandboxBudget
    issued_at: AwareDatetime
    grant_hash: Sha256

    @model_validator(mode="after")
    def validate_times_and_hash(self) -> ExecutionGrant:
        if not (
            self.issued_at < self.lease_expires_at <= self.identity.execution_permit_expires_at
        ):
            raise ValueError("lease must be within ExecutionPermit expiry")
        raw = self.model_dump(mode="python", exclude={"grant_hash"})
        if self.grant_hash != sha256_content_hash(raw):
            raise ValueError("grant_hash does not bind the exact contracts ExecutionGrant")
        descriptor = self.snapshot_descriptor
        if (
            descriptor.scope_hash != self.identity.scope_hash
            or descriptor.run_id != self.identity.run_id
            or descriptor.execution_id != self.identity.execution_id
            or descriptor.principal_id != self.identity.principal_id
            or descriptor.datasource_id != self.identity.datasource_id
            or descriptor.schema_version != self.identity.schema_version
        ):
            raise ValueError("snapshot descriptor must bind immutable identity")
        if descriptor.fixture_manifest_hash != self.fixture_manifest_hash:
            raise ValueError("fixture manifest must match snapshot descriptor")
        if self.budget != self.identity.budget:
            raise ValueError("grant budget must exactly equal immutable identity budget")
        return self

    @property
    def scope(self) -> Scope:
        return self.identity.scope

    @property
    def run_id(self) -> str:
        return self.identity.run_id

    @property
    def principal_id(self) -> str:
        return self.identity.principal_id

    @property
    def execution_id(self) -> str:
        return self.identity.execution_id

    @property
    def attempt_no(self) -> int:
        return self.attempt

    @property
    def execution_fence(self) -> int:
        return self.fencing_token

    @property
    def input_hash(self) -> str:
        return self.identity.input_hash

    @property
    def sql_artifact_hash(self) -> str:
        return self.identity.sql_artifact_ref.content_hash

    @property
    def snapshot_descriptor_hash(self) -> str:
        return self.snapshot_descriptor.descriptor_hash


class SqlArtifact(StrictModel):
    dialect: Literal["postgresql"]
    datasource_id: UuidString
    schema_version: Annotated[str, Field(min_length=1, max_length=255)]
    sql_artifact_hash: Sha256
    query: Annotated[str, Field(min_length=1, max_length=100_000)]
    parameters: dict[Placeholder, JsonValue]
    ordered_parameters: tuple[JsonValue, ...]
    query_hash: Sha256

    @field_validator("parameters")
    @classmethod
    def reject_nested_non_json(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        return value

    @model_validator(mode="after")
    def validate_placeholders_and_hash(self) -> SqlArtifact:
        placeholders = {int(item) for item in re.findall(r"\$([1-9][0-9]*)", self.query)}
        parameter_numbers = {int(key[1:]) for key in self.parameters}
        if placeholders != parameter_numbers:
            raise ValueError("query placeholders and parameter keys must match exactly")
        if placeholders and placeholders != set(range(1, max(placeholders) + 1)):
            raise ValueError("numeric placeholders must be contiguous from $1")
        derived_parameters = tuple(
            self.parameters[f"${index}"] for index in range(1, len(self.parameters) + 1)
        )
        if self.ordered_parameters != derived_parameters:
            raise ValueError("ordered_parameters must exactly equal numeric $1..$n map order")
        if self.query_hash != self.expected_query_hash():
            raise ValueError("query_hash does not bind query, parameters, and dialect")
        return self

    def expected_query_hash(self) -> str:
        return sha256_content_hash(
            {
                "dialect": self.dialect,
                "parameters": self.parameters,
                "sql": self.query,
            }
        )

    def positional_parameters(self) -> tuple[JsonValue, ...]:
        return self.ordered_parameters


class SandboxSettings(StrictModel):
    database_role: VersionIdentifier
    search_path: Annotated[tuple[SearchPathIdentifier, ...], Field(min_length=1)]
    plan_cache_mode: Literal["force_custom_plan"]
    statement_timeout_ms: Annotated[int, Field(gt=0, le=300_000)]
    lock_timeout_ms: Annotated[int, Field(gt=0, le=300_000)]
    idle_in_transaction_session_timeout_ms: Annotated[int, Field(gt=0, le=3_600_000)]

    @model_validator(mode="after")
    def validate_timeout_order(self) -> SandboxSettings:
        if self.lock_timeout_ms >= self.statement_timeout_ms:
            raise ValueError("lock_timeout_ms must be less than statement_timeout_ms")
        return self


class ExecuteFrame(StrictModel):
    protocol_version: Literal[PROTOCOL_VERSION]
    frame_type: Literal["EXECUTE"]
    grant: ExecutionGrant
    sql: SqlArtifact
    snapshot: SnapshotDescriptor
    settings: SandboxSettings
    budget: SandboxBudget

    @model_validator(mode="after")
    def validate_bindings(self) -> ExecuteFrame:
        if self.grant.scope != self.snapshot.scope:
            raise ValueError("snapshot scope must equal grant scope")
        if self.grant.run_id != self.snapshot.run_id:
            raise ValueError("snapshot run_id must equal grant run_id")
        if self.grant.principal_id != self.snapshot.principal_id:
            raise ValueError("snapshot principal_id must equal grant principal_id")
        if self.sql.datasource_id != self.snapshot.datasource_id:
            raise ValueError("SQL and snapshot datasource_id must match")
        if self.grant.sql_artifact_hash != self.sql.sql_artifact_hash:
            raise ValueError("grant sql_artifact_hash must equal SQL artifact hash")
        descriptor = self.grant.snapshot_descriptor
        if descriptor.strategy != self.snapshot.strategy:
            raise ValueError("authority snapshot strategy must equal execution snapshot plan")
        if (
            descriptor.snapshot_token != self.snapshot.snapshot_token
            or descriptor.schema_manifest_hash != self.snapshot.schema_manifest_hash
            or descriptor.data_manifest_hash != self.snapshot.data_manifest_hash
            or descriptor.fixture_manifest_hash != self.snapshot.fixture_manifest_hash
        ):
            raise ValueError("execution snapshot plan must match all authority manifest domains")
        if self.grant.identity.query_hash != self.sql.query_hash:
            raise ValueError("immutable identity query_hash must equal SQL query_hash")
        if self.grant.identity.parameters_hash != sha256_content_hash(self.sql.parameters):
            raise ValueError("immutable identity parameters_hash must bind SQL parameters")
        if self.grant.identity.ordered_parameters_hash != sha256_content_hash(
            self.sql.ordered_parameters
        ):
            raise ValueError("immutable identity ordered_parameters_hash must bind numeric array")
        if (
            self.grant.identity.datasource_id != self.sql.datasource_id
            or self.grant.identity.schema_version != self.sql.schema_version
        ):
            raise ValueError("immutable identity must bind datasource and schema version")
        settings_material = {
            "database_role": self.settings.database_role,
            "search_path": list(self.settings.search_path),
            "plan_cache_mode": self.settings.plan_cache_mode,
            "statement_timeout_ms": self.settings.statement_timeout_ms,
            "lock_timeout_ms": self.settings.lock_timeout_ms,
        }
        if self.grant.identity.settings_hash != sha256_content_hash(settings_material):
            raise ValueError("immutable identity settings_hash must bind PostgreSQL settings")
        required_mode = self.grant.identity.snapshot_requirement.mode
        if isinstance(self.snapshot, NoneSnapshot) and required_mode != "ALLOW_UNAVAILABLE":
            raise ValueError("snapshot strategy does not satisfy immutable identity requirement")
        expected_search_path = (
            (self.snapshot.schema_name, "pg_catalog")
            if isinstance(self.snapshot, ControlledRevisionSnapshot)
            else ("pg_catalog",)
        )
        if self.settings.search_path != expected_search_path:
            raise ValueError("search_path must exactly match the selected snapshot strategy")
        if self.settings.statement_timeout_ms != self.budget.timeout_ms:
            raise ValueError("statement timeout must equal execution budget timeout")
        if self.settings.lock_timeout_ms != self.budget.lock_timeout_ms:
            raise ValueError("settings lock timeout must equal execution budget")
        if self.grant.budget != self.budget:
            raise ValueError("EXECUTE budget must exactly equal signed grant budget")
        return self


class CancelFrame(StrictModel):
    protocol_version: Literal[PROTOCOL_VERSION]
    frame_type: Literal["CANCEL"]
    grant_hash: Sha256
    lease_id: UuidString
    execution_id: UuidString
    attempt_id: UuidString
    execution_fence: Annotated[int, Field(gt=0)]
    cancel_epoch: Annotated[int, Field(gt=0)]
    requested_at: AwareDatetime
    reason_code: Literal[
        "USER_CANCELLED",
        "DEADLINE_EXCEEDED",
        "AUTHORITY_REVOKED",
    ]


def validate_cancel_binding(execute: ExecuteFrame, cancel: CancelFrame) -> None:
    expected = {
        "grant_hash": execute.grant.grant_hash,
        "lease_id": execute.grant.lease_id,
        "execution_id": execute.grant.execution_id,
        "attempt_id": execute.grant.attempt_id,
        "execution_fence": execute.grant.execution_fence,
    }
    for field_name, expected_value in expected.items():
        if getattr(cancel, field_name) != expected_value:
            raise ValueError(f"cancel {field_name} does not match execution attempt")
    if cancel.cancel_epoch != execute.grant.cancel_epoch + 1:
        raise ValueError("cancel_epoch must advance exactly once from the execution grant")


class OutcomeColumn(StrictModel):
    name: OutputAlias
    type: Literal["BOOLEAN", "INTEGER", "NUMBER", "STRING", "JSON"]


ResultRow = Annotated[tuple[JsonValue, ...], Field(max_length=256)]


class SandboxResult(StrictModel):
    columns: Annotated[tuple[OutcomeColumn, ...], Field(min_length=1, max_length=256)]
    rows: Annotated[tuple[ResultRow, ...], Field(max_length=10_000)]

    @model_validator(mode="after")
    def validate_width(self) -> SandboxResult:
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("every result row must match the declared columns")
        if len({column.name for column in self.columns}) != len(self.columns):
            raise ValueError("result column names must be unique")
        for row in self.rows:
            for value, column in zip(row, self.columns, strict=True):
                if value is None or column.type == "JSON":
                    continue
                valid = {
                    "BOOLEAN": isinstance(value, bool),
                    "INTEGER": (
                        isinstance(value, int)
                        and not isinstance(value, bool)
                        and abs(value) <= 9_007_199_254_740_991
                    ),
                    "NUMBER": (
                        isinstance(value, (int, float))
                        and not isinstance(value, bool)
                        and (not isinstance(value, float) or math.isfinite(value))
                    ),
                    "STRING": isinstance(value, str),
                }[column.type]
                if not valid:
                    raise ValueError("result cell must match its stable column type")
        return self


class ResourceFacts(StrictModel):
    elapsed_ms: Annotated[int, Field(ge=0)]
    observed_rows: Annotated[int, Field(ge=0)]
    observed_bytes: Annotated[int, Field(ge=0)]
    peak_memory_mb: Annotated[int, Field(ge=0)]
    retained_canonical_bytes: Annotated[int, Field(ge=0)]
    current_batch_estimated_bytes: Annotated[int, Field(ge=0)]
    process_rss_high_water_bytes: Annotated[int, Field(ge=0)]
    cgroup_memory_limit_enforced: bool
    partial_output_discarded: bool
    cutoff_kind: Literal["NONE", "COLUMN", "ROW", "BYTE", "MEMORY", "TIMEOUT"]


class CancelFacts(StrictModel):
    cancel_requested: bool
    query_cancel_dispatched: bool
    query_cancel_confirmed: bool
    cancel_disposition: Literal[
        "NOT_REQUESTED",
        "QUERY_CANCEL_CONFIRMED",
        "QUERY_CANCEL_UNCONFIRMED",
        "AFTER_DATASOURCE_TERMINAL",
    ]
    cancel_epoch_at_start: Annotated[int, Field(ge=0)]
    cancel_epoch_observed: Annotated[int, Field(ge=0)]
    cancel_requested_at: AwareDatetime | None

    @model_validator(mode="after")
    def validate_cancel_facts(self) -> CancelFacts:
        if self.cancel_epoch_observed < self.cancel_epoch_at_start:
            raise ValueError("cancel epoch cannot go backwards")
        if not self.cancel_requested:
            if (
                self.query_cancel_dispatched
                or self.query_cancel_confirmed
                or self.cancel_disposition != "NOT_REQUESTED"
                or self.cancel_requested_at is not None
            ):
                raise ValueError("non-requested cancel facts must remain empty")
        elif self.cancel_requested_at is None or self.cancel_disposition == "NOT_REQUESTED":
            raise ValueError("requested cancel must have time and disposition")
        if self.query_cancel_confirmed and (
            not self.query_cancel_dispatched or self.cancel_disposition != "QUERY_CANCEL_CONFIRMED"
        ):
            raise ValueError("confirmed cancel must have been dispatched")
        return self


class RollbackFacts(StrictModel):
    rollback_confirmed: bool
    datasource_terminal: Literal["ROLLED_BACK_CLEAN", "ROLLBACK_UNCONFIRMED"]


class ConnectionFacts(StrictModel):
    backend_pid: Annotated[int, Field(gt=0)] | None
    transaction_status: Literal["IDLE", "IN_TRANSACTION", "IN_ERROR", "UNKNOWN"]
    connection_reused: bool


class TransactionFacts(StrictModel):
    transaction_id: UuidString
    read_only: Literal[True]
    isolation_level: Literal["REPEATABLE_READ"]


class AppliedExecutionSettings(StrictModel):
    database_role: VersionIdentifier
    search_path: Annotated[tuple[SearchPathIdentifier, ...], Field(min_length=1)]
    plan_cache_mode: Literal["force_custom_plan"]
    statement_timeout_ms: Annotated[int, Field(gt=0, le=300_000)]
    lock_timeout_ms: Annotated[int, Field(gt=0, le=300_000)]


class ManifestFacts(StrictModel):
    snapshot_descriptor_hash: Sha256
    schema_manifest_hash: Sha256 | None
    data_manifest_hash: Sha256 | None
    fixture_manifest_hash: Sha256 | None
    manifest_revalidated: bool
    revalidated_at: AwareDatetime


class CanonicalMultisetFacts(StrictModel):
    canonical_multiset_hash: Sha256 | None
    ordered_result_hash: Sha256 | None


class OutcomeBase(StrictModel):
    protocol_version: Literal["sandbox-execution-outcome@1.0.0"]
    identity: SandboxExecutionImmutableIdentity
    grant_hash: Sha256
    input_hash: Sha256
    execution_id: UuidString
    attempt_id: UuidString
    execution_fence: Annotated[int, Field(gt=0)]
    lease_id: UuidString
    cancel_epoch_at_start: Annotated[int, Field(ge=0)]
    cancel_epoch_observed: Annotated[int, Field(ge=0)]
    sql_artifact_hash: Sha256
    snapshot_descriptor_hash: Sha256
    fixture_manifest_hash: Sha256 | None
    started_at: AwareDatetime
    completed_at: AwareDatetime
    resource_facts: ResourceFacts
    cancel_facts: CancelFacts
    rollback_facts: RollbackFacts
    connection_facts: ConnectionFacts
    transaction: TransactionFacts
    applied_execution_settings: AppliedExecutionSettings
    manifest_facts: ManifestFacts
    canonical_multiset_facts: CanonicalMultisetFacts
    outcome_checksum: Sha256

    @model_validator(mode="after")
    def validate_common_outcome(self, info: ValidationInfo) -> OutcomeBase:
        if (
            self.cancel_epoch_observed < self.cancel_epoch_at_start
            or self.cancel_facts.cancel_epoch_at_start != self.cancel_epoch_at_start
            or self.cancel_facts.cancel_epoch_observed != self.cancel_epoch_observed
        ):
            raise ValueError("top-level and cancel-fact epochs must match and remain monotonic")
        if self.completed_at < self.started_at:
            raise ValueError("completed_at cannot precede started_at")
        if (
            self.snapshot_descriptor_hash != self.manifest_facts.snapshot_descriptor_hash
            or self.fixture_manifest_hash != self.manifest_facts.fixture_manifest_hash
        ):
            raise ValueError("outcome and manifest facts must bind the same snapshot")
        if self.rollback_facts.rollback_confirmed != (
            self.rollback_facts.datasource_terminal == "ROLLED_BACK_CLEAN"
        ):
            raise ValueError("rollback facts must be internally consistent")
        if self.connection_facts.connection_reused and (
            self.connection_facts.transaction_status != "IDLE"
            or not self.rollback_facts.rollback_confirmed
        ):
            raise ValueError("only a clean idle connection may be reused")
        if not (info.context or {}).get("skip_outcome_checksum"):
            material = self.model_dump(mode="python", exclude={"outcome_checksum"})
            expected_checksum = sha256_content_hash(material)
            if self.outcome_checksum != expected_checksum:
                raise ValueError(
                    "outcome_checksum does not bind the exact contracts outcome: "
                    f"expected {expected_checksum}, got {self.outcome_checksum}"
                )
        return self


class CompletedOutcome(OutcomeBase):
    terminal: Literal["COMPLETED"]
    reason_code: Literal["SANDBOX_EXECUTION_COMPLETED"]
    result: SandboxResult

    @model_validator(mode="after")
    def validate_completed_result(self) -> CompletedOutcome:
        if (
            self.canonical_multiset_facts.canonical_multiset_hash is None
            or self.resource_facts.partial_output_discarded
            or self.resource_facts.cutoff_kind != "NONE"
            or not self.rollback_facts.rollback_confirmed
        ):
            raise ValueError("completed outcome requires full result and clean rollback")
        return self

    @property
    def columns(self) -> tuple[OutcomeColumn, ...]:
        return self.result.columns

    @property
    def rows(self) -> tuple[tuple[JsonValue, ...], ...]:
        return self.result.rows

    @property
    def row_count(self) -> int:
        return len(self.result.rows)

    @property
    def canonical_multiset_hash(self) -> str:
        value = self.canonical_multiset_facts.canonical_multiset_hash
        assert value is not None
        return value

    @property
    def partial_discarded(self) -> bool:
        return self.resource_facts.partial_output_discarded


class FailedOutcome(OutcomeBase):
    terminal: Literal["FAILED", "CANCELLED"]
    reason_code: Literal[
        "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
        "SANDBOX_SNAPSHOT_STRATEGY_UNSUPPORTED",
        "SANDBOX_SNAPSHOT_EXPIRED",
        "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
        "SANDBOX_SQL_SHAPE_REJECTED",
        "SANDBOX_DANGEROUS_FUNCTION_REJECTED",
        "SANDBOX_PARAMETER_BINDING_REJECTED",
        "SANDBOX_COLUMN_LIMIT_EXCEEDED",
        "SANDBOX_ROW_LIMIT_EXCEEDED",
        "SANDBOX_BYTE_LIMIT_EXCEEDED",
        "SANDBOX_MEMORY_LIMIT_EXCEEDED",
        "SANDBOX_UNSUPPORTED_RESULT_TYPE",
        "SANDBOX_STATEMENT_TIMEOUT",
        "SANDBOX_QUERY_FAILED",
        "SANDBOX_CANCELLED",
        "SANDBOX_CANCEL_UNCONFIRMED",
    ]
    result: None

    @model_validator(mode="after")
    def validate_failed_result(self) -> FailedOutcome:
        if self.canonical_multiset_facts.canonical_multiset_hash is not None:
            raise ValueError("non-completed outcome cannot carry canonical multiset")
        if self.terminal == "CANCELLED" and self.reason_code != "SANDBOX_CANCELLED":
            raise ValueError("CANCELLED outcome requires SANDBOX_CANCELLED")
        if self.terminal == "FAILED" and self.reason_code == "SANDBOX_CANCELLED":
            raise ValueError("FAILED outcome cannot use SANDBOX_CANCELLED")
        return self

    @property
    def partial_discarded(self) -> bool:
        return self.resource_facts.partial_output_discarded


class ReplayUnavailableOutcome(OutcomeBase):
    terminal: Literal["REPLAY_UNAVAILABLE"]
    reason_code: Literal["SANDBOX_REPLAY_UNAVAILABLE"]
    result: None

    @model_validator(mode="after")
    def validate_replay_unavailable_result(self) -> ReplayUnavailableOutcome:
        if self.canonical_multiset_facts.canonical_multiset_hash is not None:
            raise ValueError("replay-unavailable outcome cannot carry canonical multiset")
        return self

    @property
    def partial_discarded(self) -> bool:
        return self.resource_facts.partial_output_discarded


OutcomeFrame = Annotated[
    CompletedOutcome | FailedOutcome | ReplayUnavailableOutcome,
    Field(discriminator="terminal"),
]


class OutcomeEnvelope(StrictModel):
    protocol_version: Literal[PROTOCOL_VERSION]
    frame_type: Literal["OUTCOME"]
    outcome: OutcomeFrame


InputFrame = Annotated[ExecuteFrame | CancelFrame, Field(discriminator="frame_type")]


def outcome_binding_from_execute(frame: ExecuteFrame) -> dict[str, Any]:
    return {
        "protocol_version": "sandbox-execution-outcome@1.0.0",
        "identity": frame.grant.identity.model_dump(mode="json"),
        "grant_hash": frame.grant.grant_hash,
        "input_hash": frame.grant.input_hash,
        "execution_id": frame.grant.execution_id,
        "attempt_id": frame.grant.attempt_id,
        "execution_fence": frame.grant.execution_fence,
        "lease_id": frame.grant.lease_id,
        "cancel_epoch_at_start": frame.grant.cancel_epoch,
        "cancel_epoch_observed": frame.grant.cancel_epoch,
        "sql_artifact_hash": frame.grant.sql_artifact_hash,
        "snapshot_descriptor_hash": frame.grant.snapshot_descriptor_hash,
        "fixture_manifest_hash": frame.grant.fixture_manifest_hash,
    }


def _plain_json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _plain_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain_json(item) for item in value]
    if isinstance(value, datetime):
        return canonical_datetime(value)
    return value


def bind_outcome(
    candidate: dict[str, Any],
) -> CompletedOutcome | FailedOutcome | ReplayUnavailableOutcome:
    payload = _plain_json(copy.deepcopy(candidate))
    payload["outcome_checksum"] = f"sha256:{'0' * 64}"
    adapter = TypeAdapter(OutcomeFrame)
    preliminary = adapter.validate_python(
        payload,
        context={"skip_outcome_checksum": True},
    )
    normalized = preliminary.model_dump(mode="python")
    normalized["outcome_checksum"] = sha256_content_hash(
        {key: value for key, value in normalized.items() if key != "outcome_checksum"}
    )
    return adapter.validate_python(normalized)


def bind_execute_frame(candidate: dict[str, Any]) -> ExecuteFrame:
    """Bind derived hashes without weakening strict validation of authoritative fields."""

    payload = copy.deepcopy(candidate)
    sql_payload = payload["sql"]
    sql_payload["query_hash"] = sha256_content_hash(
        {
            "dialect": sql_payload["dialect"],
            "parameters": sql_payload["parameters"],
            "sql": sql_payload["query"],
        }
    )
    identity = payload["grant"]["identity"]
    identity["scope_hash"] = sha256_content_hash(identity["scope"])
    identity["query_hash"] = sql_payload["query_hash"]
    identity["parameters_hash"] = sha256_content_hash(sql_payload["parameters"])
    sql_payload["ordered_parameters"] = [
        value
        for _, value in sorted(
            sql_payload["parameters"].items(),
            key=lambda item: int(item[0][1:]),
        )
    ]
    identity["ordered_parameters_hash"] = sha256_content_hash(sql_payload["ordered_parameters"])
    identity["settings_hash"] = sha256_content_hash(
        {
            key: payload["settings"][key]
            for key in (
                "database_role",
                "search_path",
                "plan_cache_mode",
                "statement_timeout_ms",
                "lock_timeout_ms",
            )
        }
    )
    snapshot = TypeAdapter(SnapshotDescriptor).validate_python(payload["snapshot"])
    payload["snapshot"] = snapshot.model_dump(mode="json")
    descriptor = payload["grant"]["snapshot_descriptor"]
    descriptor.update(
        {
            "scope_hash": identity["scope_hash"],
            "run_id": identity["run_id"],
            "execution_id": identity["execution_id"],
            "principal_id": identity["principal_id"],
            "datasource_id": identity["datasource_id"],
            "schema_version": identity["schema_version"],
            "strategy": snapshot.strategy,
            "snapshot_token": snapshot.snapshot_token,
            "schema_manifest_hash": snapshot.schema_manifest_hash,
            "data_manifest_hash": snapshot.data_manifest_hash,
            "fixture_manifest_hash": snapshot.fixture_manifest_hash,
            "replay_state": (
                "REPLAYABLE"
                if isinstance(snapshot, ControlledRevisionSnapshot)
                else "REPLAY_UNAVAILABLE"
            ),
        }
    )
    descriptor["observed_at"] = _plain_json(
        TypeAdapter(AwareDatetime).validate_python(descriptor["observed_at"])
    )
    descriptor["descriptor_hash"] = sha256_content_hash(
        {
            key: (
                TypeAdapter(AwareDatetime).validate_python(value) if key == "observed_at" else value
            )
            for key, value in descriptor.items()
            if key != "descriptor_hash"
        }
    )
    payload["grant"]["fixture_manifest_hash"] = snapshot.fixture_manifest_hash
    payload["grant"]["budget"] = copy.deepcopy(payload["budget"])
    identity["budget"] = copy.deepcopy(payload["budget"])
    grant_material = {key: value for key, value in payload["grant"].items() if key != "grant_hash"}
    grant_material["issued_at"] = TypeAdapter(AwareDatetime).validate_python(
        grant_material["issued_at"]
    )
    grant_material["lease_expires_at"] = TypeAdapter(AwareDatetime).validate_python(
        grant_material["lease_expires_at"]
    )
    grant_material["identity"]["execution_permit_expires_at"] = TypeAdapter(
        AwareDatetime
    ).validate_python(grant_material["identity"]["execution_permit_expires_at"])
    grant_material["snapshot_descriptor"]["observed_at"] = TypeAdapter(
        AwareDatetime
    ).validate_python(grant_material["snapshot_descriptor"]["observed_at"])
    payload["grant"]["grant_hash"] = sha256_content_hash(grant_material)
    return ExecuteFrame.model_validate(payload)


def decode_input_frame(raw: str | bytes) -> ExecuteFrame | CancelFrame:
    try:
        return TypeAdapter(InputFrame).validate_json(raw)
    except ValidationError:
        raise


class FixtureMutationBase(StrictModel):
    protocol_version: Literal[MUTATION_PROTOCOL_VERSION]
    mutation_id: UuidString
    scope: Scope
    run_id: UuidString
    principal_id: Annotated[str, Field(min_length=1, max_length=256)]
    datasource_id: UuidString
    baseline_snapshot_id: Annotated[str, Field(min_length=1)]
    follow_up_snapshot_id: Annotated[str, Field(min_length=1)]
    schema_name: Identifier
    relation_name: Identifier


class FanOutMutation(FixtureMutationBase):
    relation_kind: Literal["FAN_OUT"]
    child_key_column: Identifier
    original_child_key: JsonValue
    added_child_key: JsonValue
    foreign_key_values: dict[Identifier, JsonValue]
    inserted_row: dict[Identifier, JsonValue]

    @model_validator(mode="after")
    def validate_added_row(self) -> FanOutMutation:
        if self.original_child_key == self.added_child_key:
            raise ValueError("added child key must be distinct")
        if self.inserted_row.get(self.child_key_column) != self.added_child_key:
            raise ValueError("inserted row must bind added_child_key")
        if any(
            self.inserted_row.get(key) != value for key, value in self.foreign_key_values.items()
        ):
            raise ValueError("inserted row must preserve every declared foreign key")
        return self


class NullAntiMembershipMutation(FixtureMutationBase):
    relation_kind: Literal["NULL_ANTI_MEMBERSHIP"]
    probe_key_column: Identifier
    probe_key: JsonValue
    null_column: Identifier
    inserted_row: dict[Identifier, JsonValue]

    @model_validator(mode="after")
    def validate_null_probe(self) -> NullAntiMembershipMutation:
        if self.inserted_row.get(self.probe_key_column) != self.probe_key:
            raise ValueError("inserted row must bind probe_key")
        if (
            self.null_column not in self.inserted_row
            or self.inserted_row[self.null_column] is not None
        ):
            raise ValueError("inserted row null_column must be an explicit null")
        return self


class SameValuedDistinctFactMutation(FixtureMutationBase):
    relation_kind: Literal["SAME_VALUED_DISTINCT_FACT"]
    fact_key_column: Identifier
    original_fact_key: JsonValue
    added_fact_key: JsonValue
    value_columns: tuple[Identifier, ...]
    inserted_row: dict[Identifier, JsonValue]

    @model_validator(mode="after")
    def validate_distinct_fact(self) -> SameValuedDistinctFactMutation:
        if self.original_fact_key == self.added_fact_key:
            raise ValueError("added fact key must be distinct")
        if self.inserted_row.get(self.fact_key_column) != self.added_fact_key:
            raise ValueError("inserted row must bind added_fact_key")
        if not self.value_columns or any(
            column not in self.inserted_row for column in self.value_columns
        ):
            raise ValueError("inserted row must contain every declared value column")
        return self


class HalfOpenQueryTransformation(StrictModel):
    protocol_version: Literal[TRANSFORMATION_PROTOCOL_VERSION]
    transformation_kind: Literal["HALF_OPEN_ADDITIVE_PARTITION"]
    query: Annotated[str, Field(min_length=1)]
    parameters: dict[Placeholder, JsonValue]
    lower_placeholder: Placeholder
    upper_placeholder: Placeholder
    start_at: datetime
    midpoint_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def validate_partition(self) -> HalfOpenQueryTransformation:
        if not self.start_at < self.midpoint_at < self.end_at:
            raise ValueError("half-open partition must satisfy start < midpoint < end")
        if (
            self.lower_placeholder not in self.parameters
            or self.upper_placeholder not in self.parameters
        ):
            raise ValueError("half-open placeholders must exist in parameters")
        if self.parameters[self.lower_placeholder] != self.start_at.isoformat().replace(
            "+00:00", "Z"
        ):
            raise ValueError("lower parameter must bind start_at")
        if self.parameters[self.upper_placeholder] != self.end_at.isoformat().replace(
            "+00:00", "Z"
        ):
            raise ValueError("upper parameter must bind end_at")
        return self
