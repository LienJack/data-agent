begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010580_app_data_agent_text2sql_system_store',
  'sha256:6a9c9bea07b882df084bfad8c8ae4f3e91b1e99b755045ad55004ddc6482de05'
);

create table app_data_agent.text2sql_system_artifacts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_type text not null
    check (
      artifact_type in (
        'ResourceAdmissionReceipt',
        'FixtureMutationRecord',
        'MetamorphicFixtureReceipt',
        'MetamorphicOracleReceipt',
        'ResultOracleReceipt',
        'SandboxExecutionReceipt',
        'SandboxResult'
      )
    ),
  revision integer not null check (revision >= 1),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(payload_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(payload_json)
    ),
  payload_checksum text not null
    check (
      payload_checksum ~ '^sha256:[0-9a-f]{64}$'
      and payload_checksum =
        app_data_agent.runtime_canonical_sha256(payload_json)
    ),
  authority_id text not null
    check (
      pg_catalog.length(authority_id) between 1 and 256
      and authority_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  authority_principal_id text not null
    check (
      pg_catalog.length(authority_principal_id) between 1 and 256
      and authority_principal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  authority_key_id text not null
    check (
      pg_catalog.length(authority_key_id) between 1 and 256
      and authority_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  producer_principal_id uuid not null,
  audience_context_hash text not null
    check (audience_context_hash ~ '^sha256:[0-9a-f]{64}$'),
  worker_fence bigint not null check (worker_fence >= 1),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    run_id,
    artifact_id,
    revision
  ),
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    artifact_id,
    artifact_type,
    revision,
    content_hash
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id
    )
    on delete restrict,
  foreign key (
    app_id,
    tenant_id,
    environment,
    producer_principal_id
  )
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict
);

comment on table app_data_agent.text2sql_system_artifacts is
  'U5 专用 append-only System Artifact Authority；通用 artifacts 镜像没有此权威。';
comment on column app_data_agent.text2sql_system_artifacts.content_hash is
  'Contracts kernel 定义的领域 Hash；与完整保存体 payload_checksum 相互独立。';
comment on column app_data_agent.text2sql_system_artifacts.producer_principal_id is
  '产出与 Audience 授权事实，不属于公开 ArtifactReference 身份。';

create table app_data_agent.text2sql_sandbox_claims (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null
    check (pg_catalog.length(idempotency_key) between 1 and 256),
  execution_id uuid not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(request_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(request_json)
    ),
  request_checksum text not null
    check (
      request_checksum ~ '^sha256:[0-9a-f]{64}$'
      and request_checksum =
        app_data_agent.runtime_canonical_sha256(request_json)
    ),
  state text not null
    check (
      state in (
        'CLAIMED',
        'EXECUTING',
        'CANCEL_REQUESTED',
        'FAILED',
        'COMPLETED',
        'RECOVERY_PENDING',
        'CANCELLED',
        'REPLAY_UNAVAILABLE'
      )
    ),
  branch_version bigint not null default 1 check (branch_version >= 1),
  attempt_id uuid not null,
  attempt_sequence integer not null default 1 check (attempt_sequence >= 1),
  owner_id text not null
    check (
      pg_catalog.length(owner_id) between 1 and 256
      and owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  fence bigint not null default 1 check (fence >= 1),
  lease_id uuid,
  lease_expires_at timestamptz,
  cancel_epoch bigint not null default 0 check (cancel_epoch >= 0),
  cancel_requested_at timestamptz,
  grant_hash text
    check (grant_hash is null or grant_hash ~ '^sha256:[0-9a-f]{64}$'),
  grant_cancel_epoch bigint
    check (grant_cancel_epoch is null or grant_cancel_epoch >= 0),
  sql_artifact_hash text
    check (
      sql_artifact_hash is null
      or sql_artifact_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  ordered_parameters_hash text
    check (
      ordered_parameters_hash is null
      or ordered_parameters_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  fixture_manifest_hash text
    check (
      fixture_manifest_hash is null
      or fixture_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  snapshot_descriptor_json jsonb,
  snapshot_descriptor_checksum text,
  result_ref jsonb,
  receipt_ref jsonb,
  terminal_reason_code text
    check (
      terminal_reason_code is null
      or terminal_reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'
    ),
  recovery_deadline timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    idempotency_key
  ),
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    execution_id
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id
    )
    on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    (
      snapshot_descriptor_json is null
      and snapshot_descriptor_checksum is null
    )
    or (
      pg_catalog.jsonb_typeof(snapshot_descriptor_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(
        snapshot_descriptor_json
      )
      and snapshot_descriptor_checksum ~ '^sha256:[0-9a-f]{64}$'
      and snapshot_descriptor_checksum =
        app_data_agent.runtime_canonical_sha256(snapshot_descriptor_json)
    )
  ),
  check (
    (
      state in ('CLAIMED', 'RECOVERY_PENDING')
      and grant_hash is null
      and grant_cancel_epoch is null
      and sql_artifact_hash is null
      and ordered_parameters_hash is null
      and fixture_manifest_hash is null
    )
    or (
      state not in ('CLAIMED', 'RECOVERY_PENDING')
      and grant_hash is not null
      and grant_cancel_epoch is not null
      and sql_artifact_hash is not null
      and ordered_parameters_hash is not null
      and snapshot_descriptor_json is not null
      and snapshot_descriptor_json ->> 'descriptor_hash'
        ~ '^sha256:[0-9a-f]{64}$'
      and (
        snapshot_descriptor_json ->> 'fixture_manifest_hash'
      ) is not distinct from
        fixture_manifest_hash
    )
  ),
  check (
    (
      state in ('FAILED', 'COMPLETED', 'CANCELLED', 'REPLAY_UNAVAILABLE')
      and lease_id is null
      and lease_expires_at is null
    )
    or (
      state not in ('FAILED', 'COMPLETED', 'CANCELLED', 'REPLAY_UNAVAILABLE')
      and lease_id is not null
      and lease_expires_at is not null
    )
  ),
  check (
    (state = 'COMPLETED' and result_ref is not null and receipt_ref is not null)
    or (state <> 'COMPLETED' and result_ref is null and receipt_ref is null)
  ),
  check (
    (
      state in ('CLAIMED', 'EXECUTING', 'CANCEL_REQUESTED', 'RECOVERY_PENDING')
      and terminal_reason_code is null
    )
    or (
      state in ('FAILED', 'COMPLETED', 'CANCELLED', 'REPLAY_UNAVAILABLE')
      and terminal_reason_code is not null
    )
  )
);

comment on table app_data_agent.text2sql_sandbox_claims is
  '可变的 Sandbox Claim/Lease/Fence/Cancel/CAS 投影；不是不可变 Artifact。';

create table app_data_agent.text2sql_sandbox_execution_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  principal_id uuid not null,
  execution_id uuid not null,
  attempt_id uuid not null,
  fence bigint not null check (fence >= 1),
  event_id uuid not null,
  event_sequence bigint not null check (event_sequence >= 1),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  state_before text,
  state_after text not null
    check (
      state_after in (
        'CLAIMED',
        'EXECUTING',
        'CANCEL_REQUESTED',
        'FAILED',
        'COMPLETED',
        'RECOVERY_PENDING',
        'CANCELLED',
        'REPLAY_UNAVAILABLE'
      )
    ),
  cancel_epoch bigint not null check (cancel_epoch >= 0),
  payload_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(payload_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(payload_json)
    ),
  payload_checksum text not null
    check (
      payload_checksum ~ '^sha256:[0-9a-f]{64}$'
      and payload_checksum =
        app_data_agent.runtime_canonical_sha256(payload_json)
    ),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, event_id),
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    execution_id,
    event_sequence
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id
    )
    on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    state_before is null
    or state_before in (
      'CLAIMED',
      'EXECUTING',
      'CANCEL_REQUESTED',
      'FAILED',
      'COMPLETED',
      'RECOVERY_PENDING',
      'CANCELLED',
      'REPLAY_UNAVAILABLE'
    )
  )
);

create table app_data_agent.text2sql_sandbox_execution_records (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  principal_id uuid not null,
  execution_id uuid not null,
  attempt_id uuid not null,
  attempt_sequence integer not null check (attempt_sequence >= 1),
  fence bigint not null check (fence >= 1),
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  record_id uuid not null,
  request_hash text not null
    check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  grant_hash text not null
    check (grant_hash ~ '^sha256:[0-9a-f]{64}$'),
  sql_artifact_hash text not null
    check (sql_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  ordered_parameters_hash text not null
    check (ordered_parameters_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_descriptor_hash text not null
    check (snapshot_descriptor_hash ~ '^sha256:[0-9a-f]{64}$'),
  fixture_manifest_hash text
    check (
      fixture_manifest_hash is null
      or fixture_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  cancel_epoch_at_start bigint not null check (cancel_epoch_at_start >= 0),
  cancel_epoch_observed bigint not null check (cancel_epoch_observed >= 0),
  cancel_epoch_at_record bigint not null check (cancel_epoch_at_record >= 0),
  authority_state_at_record text not null
    check (
      authority_state_at_record in (
        'FAILED',
        'COMPLETED',
        'RECOVERY_PENDING',
        'CANCELLED',
        'REPLAY_UNAVAILABLE'
      )
    ),
  outcome_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(outcome_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(outcome_json)
    ),
  outcome_checksum text not null
    check (
      outcome_checksum ~ '^sha256:[0-9a-f]{64}$'
      and outcome_checksum = outcome_json ->> 'outcome_checksum'
      and outcome_checksum =
        app_data_agent.runtime_canonical_sha256(
          outcome_json - 'outcome_checksum'
        )
    ),
  outcome_payload_checksum text not null
    check (
      outcome_payload_checksum ~ '^sha256:[0-9a-f]{64}$'
      and outcome_payload_checksum =
        app_data_agent.runtime_canonical_sha256(outcome_json)
    ),
  record_checksum text not null
    check (record_checksum ~ '^sha256:[0-9a-f]{64}$'),
  authority_id text not null
    check (
      pg_catalog.length(authority_id) between 1 and 256
      and authority_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  authority_principal_id text not null
    check (
      pg_catalog.length(authority_principal_id) between 1 and 256
      and authority_principal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  authority_key_id text not null
    check (
      pg_catalog.length(authority_key_id) between 1 and 256
      and authority_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    ),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, record_id),
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    execution_id,
    attempt_id,
    fence,
    input_hash
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id
    )
    on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    cancel_epoch_at_start <= cancel_epoch_observed
    and cancel_epoch_observed <= cancel_epoch_at_record
  )
);

comment on table app_data_agent.text2sql_sandbox_execution_records is
  '每个 Attempt/Fence 一条的 append-only 内部 System Record；不是公开 ArtifactReference。';

create index text2sql_system_artifacts_audience_lookup
on app_data_agent.text2sql_system_artifacts (
  app_id,
  tenant_id,
  environment,
  run_id,
  producer_principal_id,
  artifact_id,
  revision
);

create index text2sql_sandbox_claims_lease_lookup
on app_data_agent.text2sql_sandbox_claims (
  app_id,
  tenant_id,
  environment,
  state,
  lease_expires_at
);

create index text2sql_sandbox_records_resolve_lookup
on app_data_agent.text2sql_sandbox_execution_records (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  execution_id,
  input_hash,
  attempt_sequence desc
);

create index text2sql_sandbox_records_completed_resolve_lookup
on app_data_agent.text2sql_sandbox_execution_records (
  app_id,
  tenant_id,
  environment,
  principal_id,
  input_hash,
  attempt_sequence desc
)
include (run_id, execution_id)
where authority_state_at_record = 'COMPLETED';

comment on column app_data_agent.text2sql_sandbox_claims.request_checksum is
  '首次 Claim 的完整 Preparation 校验值；Replay/Recovery 保留原文，动态 revalidation 时间不覆盖它。';

create or replace function app_data_agent.text2sql_audience_context_hash(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_run_id uuid,
  requested_principal_id uuid
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'scope',
      pg_catalog.jsonb_build_object(
        'app_id',
        requested_app_id::text,
        'tenant_id',
        requested_tenant_id::text,
        'environment',
        requested_environment
      ),
      'run_id',
      requested_run_id::text,
      'principal_id',
      requested_principal_id::text
    )
  )
$$;

create or replace function app_data_agent.text2sql_claim_json(
  requested_claim app_data_agent.text2sql_sandbox_claims
)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      requested_claim.app_id::text,
      'tenant_id',
      requested_claim.tenant_id::text,
      'environment',
      requested_claim.environment
    ),
    'run_id',
    requested_claim.run_id::text,
    'principal_id',
    requested_claim.principal_id::text,
    'idempotency_key',
    requested_claim.idempotency_key,
    'input_hash',
    requested_claim.input_hash,
    'execution_id',
    requested_claim.execution_id::text,
    'state',
    requested_claim.state,
    'branch_version',
    requested_claim.branch_version,
    'attempt_id',
    requested_claim.attempt_id::text,
    'attempt',
    requested_claim.attempt_sequence,
    'owner_id',
    requested_claim.owner_id,
    'fencing_token',
    requested_claim.fence,
    'lease_id',
    requested_claim.lease_id::text,
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(requested_claim.lease_expires_at),
    'cancel_epoch',
    requested_claim.cancel_epoch,
    'cancel_requested_at',
    case
      when requested_claim.cancel_requested_at is null then null
      else app_data_agent.runtime_iso_timestamp(
        requested_claim.cancel_requested_at
      )
    end,
    'grant_hash',
    requested_claim.grant_hash,
    'grant_cancel_epoch',
    requested_claim.grant_cancel_epoch,
    'sql_artifact_hash',
    requested_claim.sql_artifact_hash,
    'ordered_parameters_hash',
    requested_claim.ordered_parameters_hash,
    'fixture_manifest_hash',
    requested_claim.fixture_manifest_hash,
    'snapshot_descriptor',
    requested_claim.snapshot_descriptor_json,
    'snapshot_descriptor_checksum',
    requested_claim.snapshot_descriptor_checksum,
    'result_ref',
    requested_claim.result_ref,
    'receipt_ref',
    requested_claim.receipt_ref,
    'terminal_reason_code',
    requested_claim.terminal_reason_code
  )
$$;

create or replace function app_data_agent.text2sql_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'SYSTEM_ARTIFACT_APPEND_ONLY';
end
$$;

create trigger text2sql_system_artifacts_append_only
before update or delete on app_data_agent.text2sql_system_artifacts
for each row execute function app_data_agent.text2sql_append_only_guard();

create trigger text2sql_sandbox_execution_events_append_only
before update or delete on app_data_agent.text2sql_sandbox_execution_events
for each row execute function app_data_agent.text2sql_append_only_guard();

create trigger text2sql_sandbox_execution_records_append_only
before update or delete on app_data_agent.text2sql_sandbox_execution_records
for each row execute function app_data_agent.text2sql_append_only_guard();

create or replace function app_data_agent.text2sql_claim_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.app_id,
    new.tenant_id,
    new.environment,
    new.run_id,
    new.principal_id,
    new.idempotency_key,
    new.execution_id,
    new.input_hash,
    new.request_json,
    new.request_checksum
  ) is distinct from row(
    old.app_id,
    old.tenant_id,
    old.environment,
    old.run_id,
    old.principal_id,
    old.idempotency_key,
    old.execution_id,
    old.input_hash,
    old.request_json,
    old.request_checksum
  ) then
    raise exception using
      errcode = '55000',
      message = 'SANDBOX_CLAIM_IDENTITY_IMMUTABLE';
  end if;
  if old.state in ('FAILED', 'COMPLETED', 'CANCELLED', 'REPLAY_UNAVAILABLE') then
    raise exception using
      errcode = '55000',
      message = 'SANDBOX_CLAIM_TERMINAL';
  end if;
  if new.branch_version <> old.branch_version + 1
    or new.cancel_epoch < old.cancel_epoch
    or (
      new.state <> 'CANCEL_REQUESTED'
      and new.cancel_epoch <> old.cancel_epoch
    )
    or (
      new.state = 'CANCEL_REQUESTED'
      and new.cancel_epoch not in (old.cancel_epoch, old.cancel_epoch + 1)
    )
    or not (
      (old.state = 'CLAIMED' and new.state in (
        'EXECUTING',
        'CANCEL_REQUESTED',
        'FAILED',
        'RECOVERY_PENDING',
        'REPLAY_UNAVAILABLE'
      ))
      or (old.state = 'EXECUTING' and new.state in (
        'CANCEL_REQUESTED',
        'FAILED',
        'COMPLETED',
        'RECOVERY_PENDING',
        'CANCELLED',
        'REPLAY_UNAVAILABLE'
      ))
      or (old.state = 'CANCEL_REQUESTED' and new.state in (
        'CANCEL_REQUESTED',
        'FAILED',
        'RECOVERY_PENDING',
        'CANCELLED',
        'REPLAY_UNAVAILABLE'
      ))
      or (old.state = 'RECOVERY_PENDING' and new.state in (
        'CLAIMED',
        'EXECUTING',
        'CANCEL_REQUESTED',
        'FAILED',
        'REPLAY_UNAVAILABLE'
      ))
    )
  then
    raise exception using
      errcode = '55000',
      message = 'SANDBOX_CLAIM_TRANSITION_INVALID';
  end if;
  return new;
end
$$;

create trigger text2sql_sandbox_claim_transition_guard
before update on app_data_agent.text2sql_sandbox_claims
for each row execute function app_data_agent.text2sql_claim_transition_guard();

create or replace function app_data_agent.text2sql_lock_sandbox_claim(
  command_json jsonb
)
returns app_data_agent.text2sql_sandbox_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_authority record;
  locked_claim app_data_agent.text2sql_sandbox_claims;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_principal_id uuid;
  requested_execution_id uuid;
  requested_input_hash text;
  requested_idempotency_key text;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'scope')
      is distinct from 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;

  requested_app_id := platform.try_uuid(
    command_json #>> '{scope,app_id}'
  );
  requested_tenant_id := platform.try_uuid(
    command_json #>> '{scope,tenant_id}'
  );
  requested_environment := nullif(
    command_json #>> '{scope,environment}',
    ''
  );
  requested_run_id := platform.try_uuid(command_json ->> 'run_id');
  requested_principal_id := platform.try_uuid(
    command_json ->> 'principal_id'
  );
  requested_execution_id := platform.try_uuid(
    command_json ->> 'execution_id'
  );
  requested_input_hash := command_json ->> 'input_hash';
  requested_idempotency_key := nullif(
    command_json ->> 'idempotency_key',
    ''
  );
  if requested_app_id is null
    or requested_tenant_id is null
    or requested_environment is null
    or requested_run_id is null
    or requested_principal_id is null
    or requested_execution_id is null
    or requested_idempotency_key is null
    or coalesce(requested_input_hash, '') !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if current_authority.app_id <> requested_app_id
    or current_authority.tenant_id <> requested_tenant_id
    or current_authority.environment <> requested_environment
    or current_authority.principal_id <> requested_principal_id
  then
    raise exception using
      errcode = '42501',
      message = 'SANDBOX_SCOPE_FORBIDDEN';
  end if;

  select claim.*
  into locked_claim
  from app_data_agent.text2sql_sandbox_claims as claim
  where claim.app_id = requested_app_id
    and claim.tenant_id = requested_tenant_id
    and claim.environment = requested_environment
    and claim.run_id = requested_run_id
    and claim.principal_id = requested_principal_id
    and claim.idempotency_key = requested_idempotency_key
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'SANDBOX_CLAIM_NOT_FOUND';
  end if;
  if locked_claim.execution_id <> requested_execution_id
    or locked_claim.input_hash <> requested_input_hash
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_OUTCOME_BINDING_MISMATCH';
  end if;
  return locked_claim;
end
$$;

create or replace function app_data_agent.text2sql_append_execution_event(
  requested_claim app_data_agent.text2sql_sandbox_claims,
  requested_event_id uuid,
  requested_event_type text,
  requested_state_before text,
  requested_payload jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if requested_event_id is null
    or coalesce(requested_event_type, '') !~
      '^[a-z][a-z0-9_.-]{1,126}$'
    or pg_catalog.jsonb_typeof(requested_payload) is distinct from 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload)
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_EVENT_INVALID';
  end if;
  insert into app_data_agent.text2sql_sandbox_execution_events (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    execution_id,
    attempt_id,
    fence,
    event_id,
    event_sequence,
    event_type,
    state_before,
    state_after,
    cancel_epoch,
    payload_json,
    payload_checksum
  )
  values (
    requested_claim.app_id,
    requested_claim.tenant_id,
    requested_claim.environment,
    requested_claim.run_id,
    requested_claim.principal_id,
    requested_claim.execution_id,
    requested_claim.attempt_id,
    requested_claim.fence,
    requested_event_id,
    requested_claim.branch_version,
    requested_event_type,
    requested_state_before,
    requested_claim.state,
    requested_claim.cancel_epoch,
    requested_payload,
    app_data_agent.runtime_canonical_sha256(requested_payload)
  );
end
$$;

create or replace function app_data_agent.text2sql_validate_bound_outcome(
  requested_claim app_data_agent.text2sql_sandbox_claims,
  requested_outcome jsonb,
  requested_outcome_payload_checksum text
)
returns void
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  outcome_fence bigint;
  epoch_at_start bigint;
  epoch_observed bigint;
begin
  if pg_catalog.jsonb_typeof(requested_outcome) is distinct from 'object'
    or coalesce(requested_outcome_payload_checksum, '') !~
      '^sha256:[0-9a-f]{64}$'
    or requested_outcome_payload_checksum is distinct from
      app_data_agent.runtime_canonical_sha256(requested_outcome)
    or coalesce(requested_outcome ->> 'outcome_checksum', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or requested_outcome ->> 'outcome_checksum' is distinct from
      app_data_agent.runtime_canonical_sha256(
        requested_outcome - 'outcome_checksum'
      )
    or app_data_agent.contains_potential_plaintext_secret(requested_outcome)
    or coalesce(requested_outcome ->> 'execution_fence', '') !~ '^[0-9]+$'
    or coalesce(requested_outcome ->> 'cancel_epoch_at_start', '') !~
      '^[0-9]+$'
    or coalesce(requested_outcome ->> 'cancel_epoch_observed', '') !~
      '^[0-9]+$'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'identity')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'resource_facts')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'cancel_facts')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'rollback_facts')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'connection_facts')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'transaction')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(
      requested_outcome -> 'applied_execution_settings'
    ) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_outcome -> 'manifest_facts')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(
      requested_outcome -> 'canonical_multiset_facts'
    ) is distinct from 'object'
    or pg_catalog.jsonb_typeof(
      requested_outcome #> '{resource_facts,partial_output_discarded}'
    ) is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(
      requested_outcome #> '{manifest_facts,manifest_revalidated}'
    ) is distinct from 'boolean'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_OUTCOME_INVALID';
  end if;

  outcome_fence := (requested_outcome ->> 'execution_fence')::bigint;
  epoch_at_start := (
    requested_outcome ->> 'cancel_epoch_at_start'
  )::bigint;
  epoch_observed := (
    requested_outcome ->> 'cancel_epoch_observed'
  )::bigint;
  if requested_claim.grant_hash is null
    or requested_claim.grant_cancel_epoch is null
    or requested_outcome ->> 'grant_hash' is distinct from
      requested_claim.grant_hash
    or requested_outcome ->> 'input_hash' is distinct from
      requested_claim.input_hash
    or requested_outcome ->> 'execution_id' is distinct from
      requested_claim.execution_id::text
    or requested_outcome ->> 'attempt_id' is distinct from
      requested_claim.attempt_id::text
    or requested_outcome ->> 'lease_id' is distinct from
      requested_claim.lease_id::text
    or outcome_fence <> requested_claim.fence
    or requested_outcome #> '{identity,scope}' is distinct from
      pg_catalog.jsonb_build_object(
        'app_id',
        requested_claim.app_id::text,
        'tenant_id',
        requested_claim.tenant_id::text,
        'environment',
        requested_claim.environment
      )
    or requested_outcome #>> '{identity,run_id}' is distinct from
      requested_claim.run_id::text
    or requested_outcome #>> '{identity,principal_id}' is distinct from
      requested_claim.principal_id::text
    or requested_outcome #>> '{identity,execution_id}' is distinct from
      requested_claim.execution_id::text
    or requested_outcome #>> '{identity,idempotency_key}' is distinct from
      requested_claim.idempotency_key
    or requested_outcome #>> '{identity,input_hash}' is distinct from
      requested_claim.input_hash
    or requested_outcome ->> 'sql_artifact_hash' is distinct from
      requested_claim.sql_artifact_hash
    or requested_outcome #>> '{identity,ordered_parameters_hash}'
      is distinct from
      requested_claim.ordered_parameters_hash
    or requested_outcome ->> 'snapshot_descriptor_hash' is distinct from
      requested_claim.snapshot_descriptor_json ->> 'descriptor_hash'
    or (
      requested_outcome ->> 'fixture_manifest_hash'
    ) is distinct from
      requested_claim.snapshot_descriptor_json ->> 'fixture_manifest_hash'
    or requested_outcome #>> '{manifest_facts,snapshot_descriptor_hash}'
      is distinct from
      requested_claim.snapshot_descriptor_json ->> 'descriptor_hash'
    or requested_outcome #>> '{manifest_facts,schema_manifest_hash}'
      is distinct from
      requested_claim.snapshot_descriptor_json ->> 'schema_manifest_hash'
    or requested_outcome #>> '{manifest_facts,data_manifest_hash}'
      is distinct from
      requested_claim.snapshot_descriptor_json ->> 'data_manifest_hash'
    or (
      requested_outcome #>> '{manifest_facts,fixture_manifest_hash}'
    ) is distinct from
      requested_claim.snapshot_descriptor_json ->> 'fixture_manifest_hash'
    or (
      requested_outcome ->> 'terminal' = 'COMPLETED'
      and requested_outcome #> '{manifest_facts,manifest_revalidated}'
        is distinct from 'true'::jsonb
    )
    or coalesce(
      requested_outcome #>> '{cancel_facts,cancel_epoch_at_start}',
      ''
    ) <> epoch_at_start::text
    or coalesce(
      requested_outcome #>> '{cancel_facts,cancel_epoch_observed}',
      ''
    ) <> epoch_observed::text
    or epoch_at_start <> requested_claim.grant_cancel_epoch
    or epoch_observed < epoch_at_start
    or epoch_observed > requested_claim.cancel_epoch
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_OUTCOME_BINDING_MISMATCH';
  end if;
end
$$;

create or replace function app_data_agent.text2sql_insert_execution_record(
  requested_claim app_data_agent.text2sql_sandbox_claims,
  requested_record_id uuid,
  requested_authority_state text,
  requested_authority jsonb,
  requested_outcome jsonb,
  requested_outcome_payload_checksum text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  computed_record_checksum text;
begin
  if requested_record_id is null
    or coalesce(requested_authority_state, '') not in (
      'FAILED',
      'COMPLETED',
      'RECOVERY_PENDING',
      'CANCELLED',
      'REPLAY_UNAVAILABLE'
    )
    or pg_catalog.jsonb_typeof(requested_authority) is distinct from 'object'
    or nullif(requested_authority ->> 'authority_id', '') is null
    or nullif(requested_authority ->> 'principal_id', '') is null
    or nullif(requested_authority ->> 'key_id', '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_RECORD_INVALID';
  end if;

  computed_record_checksum := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'record_id',
      requested_record_id::text,
      'scope',
      pg_catalog.jsonb_build_object(
        'app_id',
        requested_claim.app_id::text,
        'tenant_id',
        requested_claim.tenant_id::text,
        'environment',
        requested_claim.environment
      ),
      'run_id',
      requested_claim.run_id::text,
      'principal_id',
      requested_claim.principal_id::text,
      'execution_id',
      requested_claim.execution_id::text,
      'attempt_id',
      requested_claim.attempt_id::text,
      'attempt_sequence',
      requested_claim.attempt_sequence,
      'fence',
      requested_claim.fence,
      'input_hash',
      requested_claim.input_hash,
      'authority_state_at_record',
      requested_authority_state,
      'outcome_checksum',
      requested_outcome ->> 'outcome_checksum',
      'outcome_payload_checksum',
      requested_outcome_payload_checksum,
      'authority',
      requested_authority
    )
  );

  insert into app_data_agent.text2sql_sandbox_execution_records (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    execution_id,
    attempt_id,
    attempt_sequence,
    fence,
    input_hash,
    record_id,
    request_hash,
    grant_hash,
    sql_artifact_hash,
    ordered_parameters_hash,
    snapshot_descriptor_hash,
    fixture_manifest_hash,
    cancel_epoch_at_start,
    cancel_epoch_observed,
    cancel_epoch_at_record,
    authority_state_at_record,
    outcome_json,
    outcome_checksum,
    outcome_payload_checksum,
    record_checksum,
    authority_id,
    authority_principal_id,
    authority_key_id
  )
  values (
    requested_claim.app_id,
    requested_claim.tenant_id,
    requested_claim.environment,
    requested_claim.run_id,
    requested_claim.principal_id,
    requested_claim.execution_id,
    requested_claim.attempt_id,
    requested_claim.attempt_sequence,
    requested_claim.fence,
    requested_claim.input_hash,
    requested_record_id,
    requested_claim.request_checksum,
    requested_claim.grant_hash,
    requested_claim.sql_artifact_hash,
    requested_claim.ordered_parameters_hash,
    requested_claim.snapshot_descriptor_json ->> 'descriptor_hash',
    requested_claim.fixture_manifest_hash,
    (requested_outcome ->> 'cancel_epoch_at_start')::bigint,
    (requested_outcome ->> 'cancel_epoch_observed')::bigint,
    requested_claim.cancel_epoch,
    requested_authority_state,
    requested_outcome,
    requested_outcome ->> 'outcome_checksum',
    requested_outcome_payload_checksum,
    computed_record_checksum,
    requested_authority ->> 'authority_id',
    requested_authority ->> 'principal_id',
    requested_authority ->> 'key_id'
  );
end
$$;

create or replace function
  app_data_agent.text2sql_assert_claim_request_integrity(
    requested_request jsonb,
    requested_checksum text
  )
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(requested_request) is distinct from 'object'
    or coalesce(requested_checksum, '') !~ '^sha256:[0-9a-f]{64}$'
    or requested_checksum is distinct from
      app_data_agent.runtime_canonical_sha256(requested_request)
    or app_data_agent.contains_potential_plaintext_secret(requested_request)
  then
    raise exception using
      errcode = '55000',
      message = 'SANDBOX_CLAIM_INTEGRITY_MISMATCH';
  end if;
end
$$;

create or replace function app_data_agent.claim_text2sql_sandbox_execution(
  command_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  current_authority record;
  locked_claim app_data_agent.text2sql_sandbox_claims;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_principal_id uuid;
  requested_execution_id uuid;
  requested_attempt_id uuid;
  requested_lease_id uuid;
  requested_event_id uuid;
  requested_idempotency_key text;
  requested_input_hash text;
  requested_request jsonb;
  requested_request_checksum text;
  requested_owner_id text;
  requested_lease_expires_at timestamptz;
  expected_branch_version bigint;
  expected_attempt_id uuid;
  expected_fencing_token bigint;
  recovery_requested_at timestamptz;
  recovery_authority_now timestamptz;
  recovery_outcome jsonb;
  recovery_outcome_payload_checksum text;
  recovery_authority jsonb;
  inserted boolean := false;
  prior_state text;
  disposition text;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or command_json ->> 'schema_version' is distinct from
      'text2sql_sandbox_claim@1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'scope')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'request_json')
      is distinct from 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;

  requested_app_id := platform.try_uuid(
    command_json #>> '{scope,app_id}'
  );
  requested_tenant_id := platform.try_uuid(
    command_json #>> '{scope,tenant_id}'
  );
  requested_environment := nullif(
    command_json #>> '{scope,environment}',
    ''
  );
  requested_run_id := platform.try_uuid(command_json ->> 'run_id');
  requested_principal_id := platform.try_uuid(
    command_json ->> 'principal_id'
  );
  requested_execution_id := platform.try_uuid(
    command_json ->> 'execution_id'
  );
  requested_attempt_id := platform.try_uuid(command_json ->> 'attempt_id');
  requested_lease_id := platform.try_uuid(command_json ->> 'lease_id');
  requested_event_id := platform.try_uuid(command_json ->> 'event_id');
  requested_idempotency_key := nullif(
    command_json ->> 'idempotency_key',
    ''
  );
  requested_input_hash := command_json ->> 'input_hash';
  requested_request := command_json -> 'request_json';
  requested_request_checksum := command_json ->> 'request_checksum';
  requested_owner_id := nullif(command_json ->> 'owner_id', '');
  if coalesce(command_json ->> 'lease_expires_at', '') = '' then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;
  begin
    requested_lease_expires_at :=
      (command_json ->> 'lease_expires_at')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_COMMAND_INVALID';
  end;
  if command_json ? 'expected_branch_version' then
    if coalesce(command_json ->> 'expected_branch_version', '') !~ '^[0-9]+$'
    then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_COMMAND_INVALID';
    end if;
    expected_branch_version :=
      (command_json ->> 'expected_branch_version')::bigint;
  end if;
  if command_json ? 'expected_attempt_id'
    or command_json ? 'expected_fencing_token'
    or command_json ? 'recovery_requested_at'
  then
    expected_attempt_id := platform.try_uuid(
      command_json ->> 'expected_attempt_id'
    );
    if coalesce(command_json ->> 'expected_fencing_token', '') !~
      '^[1-9][0-9]*$'
    then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_COMMAND_INVALID';
    end if;
    expected_fencing_token :=
      (command_json ->> 'expected_fencing_token')::bigint;
    begin
      recovery_requested_at :=
        (command_json ->> 'recovery_requested_at')::timestamptz;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'SANDBOX_COMMAND_INVALID';
    end;
    if expected_attempt_id is null
      or recovery_requested_at is null
      or recovery_requested_at <
        pg_catalog.clock_timestamp() - interval '5 minutes'
      or recovery_requested_at >
        pg_catalog.clock_timestamp() + interval '5 minutes'
    then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_COMMAND_INVALID';
    end if;
  end if;

  if requested_app_id is null
    or requested_tenant_id is null
    or requested_environment is null
    or requested_run_id is null
    or requested_principal_id is null
    or requested_execution_id is null
    or requested_attempt_id is null
    or requested_lease_id is null
    or requested_event_id is null
    or requested_idempotency_key is null
    or pg_catalog.length(requested_idempotency_key) > 256
    or coalesce(requested_input_hash, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(requested_request_checksum, '') !~
      '^sha256:[0-9a-f]{64}$'
    or requested_request_checksum is distinct from
      app_data_agent.runtime_canonical_sha256(requested_request)
    or app_data_agent.contains_potential_plaintext_secret(requested_request)
    or requested_owner_id is null
    or requested_lease_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if current_authority.app_id <> requested_app_id
    or current_authority.tenant_id <> requested_tenant_id
    or current_authority.environment <> requested_environment
    or current_authority.principal_id <> requested_principal_id
    or not exists (
      select 1
      from app_data_agent.runs as run
      where run.app_id = requested_app_id
        and run.tenant_id = requested_tenant_id
        and run.environment = requested_environment
        and run.run_id = requested_run_id
        and run.principal_id = requested_principal_id
        and run.status in ('RUNNING', 'WAITING')
    )
  then
    raise exception using
      errcode = '42501',
      message = 'SANDBOX_SCOPE_FORBIDDEN';
  end if;

  insert into app_data_agent.text2sql_sandbox_claims (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    idempotency_key,
    execution_id,
    input_hash,
    request_json,
    request_checksum,
    state,
    branch_version,
    attempt_id,
    attempt_sequence,
    owner_id,
    fence,
    lease_id,
    lease_expires_at
  )
  values (
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    requested_run_id,
    requested_principal_id,
    requested_idempotency_key,
    requested_execution_id,
    requested_input_hash,
    requested_request,
    requested_request_checksum,
    'CLAIMED',
    1,
    requested_attempt_id,
    1,
    requested_owner_id,
    1,
    requested_lease_id,
    requested_lease_expires_at
  )
  on conflict (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    idempotency_key
  )
  do nothing
  returning true into inserted;

  select claim.*
  into locked_claim
  from app_data_agent.text2sql_sandbox_claims as claim
  where claim.app_id = requested_app_id
    and claim.tenant_id = requested_tenant_id
    and claim.environment = requested_environment
    and claim.run_id = requested_run_id
    and claim.principal_id = requested_principal_id
    and claim.idempotency_key = requested_idempotency_key
  for update;

  perform app_data_agent.text2sql_assert_claim_request_integrity(
    locked_claim.request_json,
    locked_claim.request_checksum
  );
  if locked_claim.input_hash is distinct from requested_input_hash
    or locked_claim.execution_id is distinct from requested_execution_id
  then
    raise exception using
      errcode = '23505',
      message = 'SANDBOX_IDEMPOTENCY_CONFLICT';
  end if;

  if inserted then
    if expected_attempt_id is not null then
      raise exception using
        errcode = '40001',
        message = 'SANDBOX_STALE_EXECUTION_FENCE';
    end if;
    perform app_data_agent.text2sql_append_execution_event(
      locked_claim,
      requested_event_id,
      'sandbox.execution.claimed',
      null,
      pg_catalog.jsonb_build_object(
        'disposition',
        'ACCEPTED',
        'request_checksum',
        locked_claim.request_checksum
      )
    );
    disposition := 'ACCEPTED';
  elsif expected_attempt_id is not null
  then
    recovery_authority_now := pg_catalog.clock_timestamp();
    if locked_claim.state not in ('EXECUTING', 'CANCEL_REQUESTED')
      or locked_claim.lease_expires_at >= recovery_authority_now
      or locked_claim.attempt_id <> expected_attempt_id
      or locked_claim.fence <> expected_fencing_token
      or (
        expected_branch_version is not null
        and expected_branch_version <> locked_claim.branch_version
      )
      or requested_attempt_id = expected_attempt_id
      or requested_lease_id = locked_claim.lease_id
      or requested_lease_expires_at <= recovery_authority_now
    then
      raise exception using
        errcode = '40001',
        message = 'SANDBOX_STALE_EXECUTION_FENCE';
    end if;
    prior_state := locked_claim.state;
    recovery_outcome := pg_catalog.jsonb_build_object(
      'record_kind',
      'AUTHORITY_RECOVERY_PENDING',
      'outcome_unknown',
      true,
      'input_hash',
      locked_claim.input_hash,
      'execution_id',
      locked_claim.execution_id::text,
      'attempt_id',
      locked_claim.attempt_id::text,
      'execution_fence',
      locked_claim.fence,
      'grant_hash',
      locked_claim.grant_hash,
      'cancel_epoch_at_start',
      locked_claim.grant_cancel_epoch,
      'cancel_epoch_observed',
      locked_claim.cancel_epoch,
      'recovery_requested_at',
      app_data_agent.runtime_iso_timestamp(recovery_requested_at),
      'reason_code',
      'SANDBOX_EXECUTION_OUTCOME_UNKNOWN'
    );
    recovery_outcome := recovery_outcome ||
      pg_catalog.jsonb_build_object(
        'outcome_checksum',
        app_data_agent.runtime_canonical_sha256(recovery_outcome)
      );
    recovery_outcome_payload_checksum :=
      app_data_agent.runtime_canonical_sha256(recovery_outcome);
    recovery_authority := pg_catalog.jsonb_build_object(
      'authority_id',
      'data-agent-platform',
      'principal_id',
      locked_claim.principal_id::text,
      'key_id',
      'postgresql-authority@1.0.0'
    );
    perform app_data_agent.text2sql_insert_execution_record(
      locked_claim,
      pg_catalog.gen_random_uuid(),
      'RECOVERY_PENDING',
      recovery_authority,
      recovery_outcome,
      recovery_outcome_payload_checksum
    );
    update app_data_agent.text2sql_sandbox_claims as claim
    set
      state = 'RECOVERY_PENDING',
      branch_version = claim.branch_version + 1,
      grant_hash = null,
      grant_cancel_epoch = null,
      sql_artifact_hash = null,
      ordered_parameters_hash = null,
      fixture_manifest_hash = null,
      snapshot_descriptor_json = null,
      snapshot_descriptor_checksum = null,
      recovery_deadline = recovery_authority_now,
      updated_at = recovery_authority_now
    where claim.app_id = locked_claim.app_id
      and claim.tenant_id = locked_claim.tenant_id
      and claim.environment = locked_claim.environment
      and claim.run_id = locked_claim.run_id
      and claim.principal_id = locked_claim.principal_id
      and claim.idempotency_key = locked_claim.idempotency_key
    returning claim.* into locked_claim;
    perform app_data_agent.text2sql_append_execution_event(
      locked_claim,
      pg_catalog.gen_random_uuid(),
      'sandbox.execution.recovery_pending',
      prior_state,
      pg_catalog.jsonb_build_object(
        'reason_code',
        'SANDBOX_EXECUTION_OUTCOME_UNKNOWN',
        'outcome_unknown',
        true,
        'old_attempt_id',
        expected_attempt_id::text,
        'old_fence',
        expected_fencing_token
      )
    );
    prior_state := locked_claim.state;
    update app_data_agent.text2sql_sandbox_claims as claim
    set
      state = 'CLAIMED',
      branch_version = claim.branch_version + 1,
      attempt_id = requested_attempt_id,
      attempt_sequence = claim.attempt_sequence + 1,
      owner_id = requested_owner_id,
      fence = claim.fence + 1,
      lease_id = requested_lease_id,
      lease_expires_at = requested_lease_expires_at,
      grant_hash = null,
      grant_cancel_epoch = null,
      sql_artifact_hash = null,
      ordered_parameters_hash = null,
      fixture_manifest_hash = null,
      snapshot_descriptor_json = null,
      snapshot_descriptor_checksum = null,
      recovery_deadline = null,
      updated_at = recovery_authority_now
    where claim.app_id = locked_claim.app_id
      and claim.tenant_id = locked_claim.tenant_id
      and claim.environment = locked_claim.environment
      and claim.run_id = locked_claim.run_id
      and claim.principal_id = locked_claim.principal_id
      and claim.idempotency_key = locked_claim.idempotency_key
    returning claim.* into locked_claim;
    perform app_data_agent.text2sql_append_execution_event(
      locked_claim,
      requested_event_id,
      'sandbox.execution.recovered',
      prior_state,
      pg_catalog.jsonb_build_object(
        'disposition',
        'ACCEPTED',
        'attempt',
        locked_claim.attempt_sequence,
        'fence',
        locked_claim.fence,
        'old_attempt_id',
        expected_attempt_id::text,
        'old_fence',
        expected_fencing_token
      )
    );
    disposition := 'ACCEPTED';
  elsif locked_claim.state = 'COMPLETED' then
    disposition := 'REPLAYED';
  elsif locked_claim.state in ('FAILED', 'CANCELLED', 'REPLAY_UNAVAILABLE') then
    disposition := 'REPLAY_UNAVAILABLE';
  else
    disposition := 'IN_PROGRESS';
  end if;

  return pg_catalog.jsonb_build_object(
    'disposition',
    disposition,
    'claim',
    app_data_agent.text2sql_claim_json(locked_claim)
  );
end
$$;

create or replace function app_data_agent.mark_text2sql_sandbox_executing(
  command_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  locked_claim app_data_agent.text2sql_sandbox_claims;
  prior_state text;
  requested_attempt_id uuid;
  requested_lease_id uuid;
  requested_event_id uuid;
  requested_owner_id text;
  requested_grant_hash text;
  requested_sql_artifact_hash text;
  requested_ordered_parameters_hash text;
  requested_fixture_manifest_hash text;
  requested_snapshot jsonb;
  requested_snapshot_checksum text;
  expected_branch_version bigint;
  requested_fence bigint;
  requested_grant_cancel_epoch bigint;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or coalesce(command_json ->> 'expected_branch_version', '') !~ '^[0-9]+$'
    or coalesce(command_json ->> 'fence', '') !~ '^[0-9]+$'
    or coalesce(command_json ->> 'grant_cancel_epoch', '') !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;
  locked_claim :=
    app_data_agent.text2sql_lock_sandbox_claim(command_json);
  prior_state := locked_claim.state;
  requested_attempt_id := platform.try_uuid(command_json ->> 'attempt_id');
  requested_lease_id := platform.try_uuid(command_json ->> 'lease_id');
  requested_event_id := platform.try_uuid(command_json ->> 'event_id');
  requested_owner_id := command_json ->> 'owner_id';
  requested_grant_hash := command_json ->> 'grant_hash';
  requested_sql_artifact_hash := command_json ->> 'sql_artifact_hash';
  requested_ordered_parameters_hash :=
    command_json ->> 'ordered_parameters_hash';
  requested_fixture_manifest_hash :=
    command_json ->> 'fixture_manifest_hash';
  requested_snapshot := command_json -> 'snapshot_descriptor_json';
  requested_snapshot_checksum :=
    command_json ->> 'snapshot_descriptor_checksum';
  expected_branch_version :=
    (command_json ->> 'expected_branch_version')::bigint;
  requested_fence := (command_json ->> 'fence')::bigint;
  requested_grant_cancel_epoch :=
    (command_json ->> 'grant_cancel_epoch')::bigint;

  if locked_claim.branch_version <> expected_branch_version then
    raise exception using
      errcode = '40001',
      message = 'SANDBOX_CLAIM_CAS_MISMATCH';
  end if;
  if locked_claim.state not in ('CLAIMED', 'RECOVERY_PENDING')
    or locked_claim.attempt_id is distinct from requested_attempt_id
    or locked_claim.lease_id is distinct from requested_lease_id
    or locked_claim.owner_id is distinct from requested_owner_id
    or locked_claim.fence <> requested_fence
    or locked_claim.lease_expires_at < pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = '40001',
      message = 'SANDBOX_STALE_EXECUTION_FENCE';
  end if;
  if requested_event_id is null
    or coalesce(requested_grant_hash, '') !~
      '^sha256:[0-9a-f]{64}$'
    or coalesce(requested_sql_artifact_hash, '') !~
      '^sha256:[0-9a-f]{64}$'
    or coalesce(requested_ordered_parameters_hash, '') !~
      '^sha256:[0-9a-f]{64}$'
    or (
      requested_fixture_manifest_hash is not null
      and requested_fixture_manifest_hash !~ '^sha256:[0-9a-f]{64}$'
    )
    or requested_grant_cancel_epoch <> locked_claim.cancel_epoch
    or pg_catalog.jsonb_typeof(requested_snapshot) is distinct from 'object'
    or requested_snapshot ->> 'descriptor_hash'
      !~ '^sha256:[0-9a-f]{64}$'
    or requested_snapshot ->> 'descriptor_hash' is distinct from
      app_data_agent.runtime_canonical_sha256(
        requested_snapshot - 'descriptor_hash'
      )
    or requested_snapshot ->> 'run_id' is distinct from
      locked_claim.run_id::text
    or requested_snapshot ->> 'execution_id' is distinct from
      locked_claim.execution_id::text
    or requested_snapshot ->> 'principal_id' is distinct from
      locked_claim.principal_id::text
    or (
      requested_snapshot ->> 'fixture_manifest_hash'
    ) is distinct from
      requested_fixture_manifest_hash
    or coalesce(requested_snapshot ->> 'strategy', '') not in (
      'CONTROLLED_REVISION',
      'NONE'
    )
    or (
      requested_snapshot ->> 'strategy' = 'CONTROLLED_REVISION'
      and requested_fixture_manifest_hash is null
    )
    or (
      requested_snapshot ->> 'strategy' = 'NONE'
      and requested_fixture_manifest_hash is not null
    )
    or coalesce(requested_snapshot_checksum, '') !~
      '^sha256:[0-9a-f]{64}$'
    or requested_snapshot_checksum is distinct from
      app_data_agent.runtime_canonical_sha256(requested_snapshot)
    or app_data_agent.contains_potential_plaintext_secret(requested_snapshot)
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_GRANT_INVALID';
  end if;

  update app_data_agent.text2sql_sandbox_claims as claim
  set
    state = 'EXECUTING',
    branch_version = claim.branch_version + 1,
    grant_hash = requested_grant_hash,
    grant_cancel_epoch = requested_grant_cancel_epoch,
    sql_artifact_hash = requested_sql_artifact_hash,
    ordered_parameters_hash = requested_ordered_parameters_hash,
    fixture_manifest_hash = requested_fixture_manifest_hash,
    snapshot_descriptor_json = requested_snapshot,
    snapshot_descriptor_checksum = requested_snapshot_checksum,
    updated_at = pg_catalog.clock_timestamp()
  where claim.app_id = locked_claim.app_id
    and claim.tenant_id = locked_claim.tenant_id
    and claim.environment = locked_claim.environment
    and claim.run_id = locked_claim.run_id
    and claim.principal_id = locked_claim.principal_id
    and claim.idempotency_key = locked_claim.idempotency_key
  returning claim.* into locked_claim;

  perform app_data_agent.text2sql_append_execution_event(
    locked_claim,
    requested_event_id,
    'sandbox.execution.started',
    prior_state,
    pg_catalog.jsonb_build_object(
      'grant_hash',
      locked_claim.grant_hash,
      'snapshot_descriptor_checksum',
      locked_claim.snapshot_descriptor_checksum
    )
  );
  return pg_catalog.jsonb_build_object(
    'disposition',
    'ACCEPTED',
    'claim',
    app_data_agent.text2sql_claim_json(locked_claim)
  );
end
$$;

create or replace function app_data_agent.request_text2sql_sandbox_cancel(
  command_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  locked_claim app_data_agent.text2sql_sandbox_claims;
  prior_state text;
  expected_branch_version bigint;
  expected_cancel_epoch bigint;
  requested_event_id uuid;
  requested_reason_code text;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or coalesce(command_json ->> 'expected_branch_version', '') !~ '^[0-9]+$'
    or coalesce(command_json ->> 'expected_cancel_epoch', '') !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;
  locked_claim :=
    app_data_agent.text2sql_lock_sandbox_claim(command_json);
  expected_branch_version :=
    (command_json ->> 'expected_branch_version')::bigint;
  expected_cancel_epoch :=
    (command_json ->> 'expected_cancel_epoch')::bigint;
  if locked_claim.branch_version <> expected_branch_version
    or locked_claim.cancel_epoch <> expected_cancel_epoch
  then
    raise exception using
      errcode = '40001',
      message = 'SANDBOX_CLAIM_CAS_MISMATCH';
  end if;
  if locked_claim.state in (
    'FAILED',
    'COMPLETED',
    'CANCELLED',
    'REPLAY_UNAVAILABLE'
  ) then
    return pg_catalog.jsonb_build_object(
      'disposition',
      'CANCEL_ALREADY_TERMINAL',
      'claim',
      app_data_agent.text2sql_claim_json(locked_claim)
    );
  end if;

  requested_event_id := platform.try_uuid(command_json ->> 'event_id');
  requested_reason_code := command_json ->> 'reason_code';
  if requested_event_id is null
    or coalesce(requested_reason_code, '') !~
      '^[A-Z][A-Z0-9_]{1,126}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_CANCEL_INVALID';
  end if;
  if locked_claim.state = 'CANCEL_REQUESTED' then
    return pg_catalog.jsonb_build_object(
      'disposition',
      'CANCEL_ACCEPTED',
      'claim',
      app_data_agent.text2sql_claim_json(locked_claim)
    );
  end if;

  prior_state := locked_claim.state;
  update app_data_agent.text2sql_sandbox_claims as claim
  set
    state = 'CANCEL_REQUESTED',
    branch_version = claim.branch_version + 1,
    cancel_epoch = claim.cancel_epoch + 1,
    cancel_requested_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
  where claim.app_id = locked_claim.app_id
    and claim.tenant_id = locked_claim.tenant_id
    and claim.environment = locked_claim.environment
    and claim.run_id = locked_claim.run_id
    and claim.principal_id = locked_claim.principal_id
    and claim.idempotency_key = locked_claim.idempotency_key
  returning claim.* into locked_claim;

  perform app_data_agent.text2sql_append_execution_event(
    locked_claim,
    requested_event_id,
    'sandbox.execution.cancel_requested',
    prior_state,
    pg_catalog.jsonb_build_object(
      'reason_code',
      requested_reason_code,
      'cancel_epoch',
      locked_claim.cancel_epoch
    )
  );
  return pg_catalog.jsonb_build_object(
    'disposition',
    'CANCEL_ACCEPTED',
    'claim',
    app_data_agent.text2sql_claim_json(locked_claim)
  );
end
$$;

create or replace function app_data_agent.finalize_text2sql_sandbox_execution(
  command_json jsonb,
  artifacts_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  locked_claim app_data_agent.text2sql_sandbox_claims;
  prior_state text;
  requested_attempt_id uuid;
  requested_lease_id uuid;
  requested_record_id uuid;
  requested_event_id uuid;
  requested_owner_id text;
  requested_authority jsonb;
  requested_outcome jsonb;
  requested_outcome_payload_checksum text;
  requested_fence bigint;
  observed_cancel_epoch bigint;
  requested_audience_hash text;
  artifact_item jsonb;
  artifact_reference jsonb;
  artifact_payload jsonb;
  artifact_payload_checksum text;
  artifact_type text;
  artifact_id uuid;
  artifact_revision integer;
  artifact_content_hash text;
  result_reference jsonb;
  receipt_reference jsonb;
  result_count integer := 0;
  receipt_count integer := 0;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'authority')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'outcome_json')
      is distinct from 'object'
    or coalesce(command_json ->> 'fence', '') !~ '^[0-9]+$'
    or coalesce(command_json ->> 'outcome_payload_checksum', '') !~
      '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;
  locked_claim :=
    app_data_agent.text2sql_lock_sandbox_claim(command_json);
  prior_state := locked_claim.state;
  requested_attempt_id := platform.try_uuid(command_json ->> 'attempt_id');
  requested_lease_id := platform.try_uuid(command_json ->> 'lease_id');
  requested_record_id := platform.try_uuid(command_json ->> 'record_id');
  requested_event_id := platform.try_uuid(command_json ->> 'event_id');
  requested_owner_id := command_json ->> 'owner_id';
  requested_authority := command_json -> 'authority';
  requested_outcome := command_json -> 'outcome_json';
  requested_outcome_payload_checksum :=
    command_json ->> 'outcome_payload_checksum';
  requested_fence := (command_json ->> 'fence')::bigint;
  if locked_claim.state not in ('EXECUTING', 'CANCEL_REQUESTED')
    or locked_claim.attempt_id is distinct from requested_attempt_id
    or locked_claim.lease_id is distinct from requested_lease_id
    or locked_claim.owner_id is distinct from requested_owner_id
    or locked_claim.fence <> requested_fence
    or locked_claim.lease_expires_at < pg_catalog.clock_timestamp()
    or locked_claim.grant_hash is distinct from command_json ->> 'grant_hash'
  then
    raise exception using
      errcode = '40001',
      message = 'SANDBOX_STALE_EXECUTION_FENCE';
  end if;
  if requested_record_id is null or requested_event_id is null then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;

  perform app_data_agent.text2sql_validate_bound_outcome(
    locked_claim,
    requested_outcome,
    requested_outcome_payload_checksum
  );
  observed_cancel_epoch :=
    (requested_outcome ->> 'cancel_epoch_observed')::bigint;

  if locked_claim.cancel_epoch > observed_cancel_epoch then
    if locked_claim.state <> 'CANCEL_REQUESTED' then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_OUTCOME_BINDING_MISMATCH';
    end if;
    perform app_data_agent.text2sql_insert_execution_record(
      locked_claim,
      requested_record_id,
      'CANCELLED',
      requested_authority,
      requested_outcome,
      requested_outcome_payload_checksum
    );
    update app_data_agent.text2sql_sandbox_claims as claim
    set
      state = 'CANCELLED',
      branch_version = claim.branch_version + 1,
      lease_id = null,
      lease_expires_at = null,
      terminal_reason_code = 'SANDBOX_CANCELLED',
      updated_at = pg_catalog.clock_timestamp()
    where claim.app_id = locked_claim.app_id
      and claim.tenant_id = locked_claim.tenant_id
      and claim.environment = locked_claim.environment
      and claim.run_id = locked_claim.run_id
      and claim.principal_id = locked_claim.principal_id
      and claim.idempotency_key = locked_claim.idempotency_key
    returning claim.* into locked_claim;
    perform app_data_agent.text2sql_append_execution_event(
      locked_claim,
      requested_event_id,
      'sandbox.execution.cancelled',
      prior_state,
      pg_catalog.jsonb_build_object(
        'reason_code',
        'SANDBOX_CANCELLED',
        'cancel_disposition',
        'AFTER_DATASOURCE_TERMINAL',
        'candidate_discarded',
        true
      )
    );
    return pg_catalog.jsonb_build_object(
      'disposition',
      'CANCEL_ACCEPTED',
      'cancel_disposition',
      'AFTER_DATASOURCE_TERMINAL',
      'claim',
      app_data_agent.text2sql_claim_json(locked_claim)
    );
  end if;

  if locked_claim.state <> 'EXECUTING'
    or requested_outcome ->> 'terminal' is distinct from 'COMPLETED'
    or requested_outcome ->> 'reason_code' is distinct from
      'SANDBOX_EXECUTION_COMPLETED'
    or requested_outcome #>> '{rollback_facts,datasource_terminal}'
      is distinct from
      'ROLLED_BACK_CLEAN'
    or requested_outcome #> '{resource_facts,partial_output_discarded}'
      is distinct from
      'false'::jsonb
  then
    raise exception using
      errcode = '55000',
      message = 'SANDBOX_FINALIZE_NOT_COMPLETED';
  end if;
  if pg_catalog.jsonb_typeof(artifacts_json) is distinct from 'array'
    or pg_catalog.jsonb_array_length(artifacts_json) <> 2
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
  end if;

  requested_audience_hash :=
    app_data_agent.text2sql_audience_context_hash(
      locked_claim.app_id,
      locked_claim.tenant_id,
      locked_claim.environment,
      locked_claim.run_id,
      locked_claim.principal_id
    );

  for artifact_item in
    select element.value
    from pg_catalog.jsonb_array_elements(artifacts_json) as element(value)
  loop
    artifact_reference := artifact_item -> 'reference';
    artifact_payload := artifact_item -> 'payload_json';
    artifact_payload_checksum := artifact_item ->> 'payload_checksum';
    artifact_type := artifact_reference ->> 'artifact_type';
    artifact_id := platform.try_uuid(artifact_reference ->> 'artifact_id');
    artifact_content_hash := artifact_reference ->> 'content_hash';
    if coalesce(artifact_reference ->> 'revision', '') !~ '^[1-9][0-9]*$'
    then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
    end if;
    artifact_revision := (artifact_reference ->> 'revision')::integer;

    if pg_catalog.jsonb_typeof(artifact_item) is distinct from 'object'
      or pg_catalog.jsonb_typeof(artifact_reference)
        is distinct from 'object'
      or pg_catalog.jsonb_typeof(artifact_payload)
        is distinct from 'object'
      or coalesce(artifact_type, '') not in (
        'SandboxResult',
        'SandboxExecutionReceipt'
      )
      or artifact_id is null
      or artifact_reference ->> 'app_id' is distinct from
        locked_claim.app_id::text
      or artifact_reference ->> 'tenant_id' is distinct from
        locked_claim.tenant_id::text
      or artifact_reference ->> 'environment' is distinct from
        locked_claim.environment
      or artifact_reference ->> 'run_id' is distinct from
        locked_claim.run_id::text
      or coalesce(artifact_content_hash, '') !~
        '^sha256:[0-9a-f]{64}$'
      or coalesce(artifact_payload_checksum, '') !~
        '^sha256:[0-9a-f]{64}$'
      or artifact_payload_checksum is distinct from
        app_data_agent.runtime_canonical_sha256(artifact_payload)
      or artifact_item -> 'authority' is distinct from requested_authority
      or platform.try_uuid(
        artifact_item ->> 'producer_principal_id'
      ) is distinct from locked_claim.principal_id
      or artifact_item ->> 'audience_context_hash' is distinct from
        requested_audience_hash
      or coalesce(artifact_item ->> 'worker_fence', '') !~ '^[0-9]+$'
      or (artifact_item ->> 'worker_fence')::bigint <> locked_claim.fence
      or artifact_payload ->> 'execution_id' is distinct from
        locked_claim.execution_id::text
      or artifact_payload -> 'scope' is distinct from command_json -> 'scope'
      or artifact_payload ->> 'run_id' is distinct from
        locked_claim.run_id::text
      or app_data_agent.contains_potential_plaintext_secret(artifact_payload)
    then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
    end if;

    if artifact_type = 'SandboxResult' then
      if artifact_payload -> 'result_ref' is distinct from artifact_reference
        or artifact_payload ->> 'result_hash' is distinct from
          artifact_content_hash
      then
        raise exception using
          errcode = '22023',
          message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
      end if;
      result_count := result_count + 1;
      result_reference := artifact_reference;
    else
      if artifact_payload -> 'receipt_ref' is distinct from
        artifact_reference
        or artifact_payload ->> 'execution_hash' is distinct from
          artifact_content_hash
        or artifact_payload ->> 'input_hash' is distinct from
          locked_claim.input_hash
      then
        raise exception using
          errcode = '22023',
          message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
      end if;
      receipt_count := receipt_count + 1;
      receipt_reference := artifact_reference;
    end if;

    insert into app_data_agent.text2sql_system_artifacts (
      app_id,
      tenant_id,
      environment,
      run_id,
      artifact_id,
      artifact_type,
      revision,
      content_hash,
      payload_json,
      payload_checksum,
      authority_id,
      authority_principal_id,
      authority_key_id,
      producer_principal_id,
      audience_context_hash,
      worker_fence
    )
    values (
      locked_claim.app_id,
      locked_claim.tenant_id,
      locked_claim.environment,
      locked_claim.run_id,
      artifact_id,
      artifact_type,
      artifact_revision,
      artifact_content_hash,
      artifact_payload,
      artifact_payload_checksum,
      requested_authority ->> 'authority_id',
      requested_authority ->> 'principal_id',
      requested_authority ->> 'key_id',
      locked_claim.principal_id,
      requested_audience_hash,
      locked_claim.fence
    );
  end loop;

  if result_count <> 1
    or receipt_count <> 1
    or (
      select item.value -> 'payload_json' -> 'result_artifact_ref'
      from pg_catalog.jsonb_array_elements(artifacts_json) as item(value)
      where item.value -> 'reference' ->> 'artifact_type' =
        'SandboxExecutionReceipt'
    ) is distinct from result_reference
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_FINALIZE_ARTIFACTS_INVALID';
  end if;

  perform app_data_agent.text2sql_insert_execution_record(
    locked_claim,
    requested_record_id,
    'COMPLETED',
    requested_authority,
    requested_outcome,
    requested_outcome_payload_checksum
  );
  update app_data_agent.text2sql_sandbox_claims as claim
  set
    state = 'COMPLETED',
    branch_version = claim.branch_version + 1,
    result_ref = result_reference,
    receipt_ref = receipt_reference,
    lease_id = null,
    lease_expires_at = null,
    terminal_reason_code = 'SANDBOX_EXECUTION_COMPLETED',
    updated_at = pg_catalog.clock_timestamp()
  where claim.app_id = locked_claim.app_id
    and claim.tenant_id = locked_claim.tenant_id
    and claim.environment = locked_claim.environment
    and claim.run_id = locked_claim.run_id
    and claim.principal_id = locked_claim.principal_id
    and claim.idempotency_key = locked_claim.idempotency_key
  returning claim.* into locked_claim;
  perform app_data_agent.text2sql_append_execution_event(
    locked_claim,
    requested_event_id,
    'sandbox.execution.completed',
    prior_state,
    pg_catalog.jsonb_build_object(
      'reason_code',
      'SANDBOX_EXECUTION_COMPLETED',
      'result_ref',
      result_reference,
      'receipt_ref',
      receipt_reference,
      'record_id',
      requested_record_id::text
    )
  );
  return pg_catalog.jsonb_build_object(
    'disposition',
    'ACCEPTED',
    'claim',
    app_data_agent.text2sql_claim_json(locked_claim)
  );
end
$$;

create or replace function app_data_agent.fail_text2sql_sandbox_execution(
  command_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  locked_claim app_data_agent.text2sql_sandbox_claims;
  prior_state text;
  requested_attempt_id uuid;
  requested_lease_id uuid;
  requested_record_id uuid;
  requested_event_id uuid;
  requested_owner_id text;
  requested_authority jsonb;
  requested_outcome jsonb;
  requested_outcome_payload_checksum text;
  requested_authority_state text;
  requested_reason_code text;
  requested_fence bigint;
  observed_cancel_epoch bigint;
  final_state text;
  final_reason_code text;
  disposition text;
  cancel_disposition text;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'authority')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'outcome_json')
      is distinct from 'object'
    or coalesce(command_json ->> 'fence', '') !~ '^[0-9]+$'
    or coalesce(command_json ->> 'outcome_payload_checksum', '') !~
      '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_COMMAND_INVALID';
  end if;
  locked_claim :=
    app_data_agent.text2sql_lock_sandbox_claim(command_json);
  prior_state := locked_claim.state;
  requested_attempt_id := platform.try_uuid(command_json ->> 'attempt_id');
  requested_lease_id := platform.try_uuid(command_json ->> 'lease_id');
  requested_record_id := platform.try_uuid(command_json ->> 'record_id');
  requested_event_id := platform.try_uuid(command_json ->> 'event_id');
  requested_owner_id := command_json ->> 'owner_id';
  requested_authority := command_json -> 'authority';
  requested_outcome := command_json -> 'outcome_json';
  requested_outcome_payload_checksum :=
    command_json ->> 'outcome_payload_checksum';
  requested_authority_state :=
    command_json ->> 'authority_state_at_record';
  requested_reason_code := command_json ->> 'terminal_reason_code';
  requested_fence := (command_json ->> 'fence')::bigint;

  if coalesce(requested_authority_state, '') not in (
    'FAILED',
    'CANCELLED',
    'RECOVERY_PENDING',
    'REPLAY_UNAVAILABLE'
  )
    or coalesce(requested_reason_code, '') !~
      '^[A-Z][A-Z0-9_]{1,126}$'
    or requested_record_id is null
    or requested_event_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_FAILURE_INVALID';
  end if;
  if locked_claim.state not in ('EXECUTING', 'CANCEL_REQUESTED')
    or locked_claim.attempt_id is distinct from requested_attempt_id
    or locked_claim.lease_id is distinct from requested_lease_id
    or locked_claim.owner_id is distinct from requested_owner_id
    or locked_claim.fence <> requested_fence
    or (
      requested_authority_state <> 'RECOVERY_PENDING'
      and locked_claim.lease_expires_at < pg_catalog.clock_timestamp()
    )
    or locked_claim.grant_hash is distinct from command_json ->> 'grant_hash'
  then
    raise exception using
      errcode = '40001',
      message = 'SANDBOX_STALE_EXECUTION_FENCE';
  end if;

  perform app_data_agent.text2sql_validate_bound_outcome(
    locked_claim,
    requested_outcome,
    requested_outcome_payload_checksum
  );
  observed_cancel_epoch :=
    (requested_outcome ->> 'cancel_epoch_observed')::bigint;
  final_state := requested_authority_state;
  final_reason_code := requested_reason_code;
  disposition := 'ACCEPTED';
  if requested_outcome ->> 'reason_code' is distinct from
    requested_reason_code
    or (
      requested_authority_state <> 'RECOVERY_PENDING'
      and requested_outcome ->> 'terminal' is distinct from
        requested_authority_state
    )
    or (
      requested_authority_state = 'RECOVERY_PENDING'
      and requested_outcome ->> 'terminal' is distinct from 'FAILED'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_OUTCOME_BINDING_MISMATCH';
  end if;

  if locked_claim.cancel_epoch > observed_cancel_epoch then
    if locked_claim.state <> 'CANCEL_REQUESTED' then
      raise exception using
        errcode = '22023',
        message = 'SANDBOX_OUTCOME_BINDING_MISMATCH';
    end if;
    final_state := 'CANCELLED';
    final_reason_code := 'SANDBOX_CANCELLED';
    disposition := 'CANCEL_ACCEPTED';
    cancel_disposition := 'AFTER_DATASOURCE_TERMINAL';
  elsif final_state = 'CANCELLED' then
    if locked_claim.state <> 'CANCEL_REQUESTED'
      or requested_outcome ->> 'terminal' is distinct from 'CANCELLED'
    then
      raise exception using
        errcode = '55000',
        message = 'SANDBOX_CANCEL_NOT_CONFIRMED';
    end if;
    disposition := 'CANCEL_ACCEPTED';
    cancel_disposition := 'DURING_DATASOURCE_EXECUTION';
  elsif final_state = 'REPLAY_UNAVAILABLE' then
    disposition := 'REPLAY_UNAVAILABLE';
  end if;

  perform app_data_agent.text2sql_insert_execution_record(
    locked_claim,
    requested_record_id,
    final_state,
    requested_authority,
    requested_outcome,
    requested_outcome_payload_checksum
  );
  update app_data_agent.text2sql_sandbox_claims as claim
  set
    state = final_state,
    branch_version = claim.branch_version + 1,
    lease_id = case
      when final_state = 'RECOVERY_PENDING' then claim.lease_id
      else null
    end,
    lease_expires_at = case
      when final_state = 'RECOVERY_PENDING'
      then pg_catalog.clock_timestamp() - interval '1 millisecond'
      else null
    end,
    grant_hash = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.grant_hash
    end,
    grant_cancel_epoch = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.grant_cancel_epoch
    end,
    sql_artifact_hash = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.sql_artifact_hash
    end,
    ordered_parameters_hash = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.ordered_parameters_hash
    end,
    fixture_manifest_hash = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.fixture_manifest_hash
    end,
    snapshot_descriptor_json = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.snapshot_descriptor_json
    end,
    snapshot_descriptor_checksum = case
      when final_state = 'RECOVERY_PENDING' then null
      else claim.snapshot_descriptor_checksum
    end,
    terminal_reason_code = case
      when final_state = 'RECOVERY_PENDING' then null
      else final_reason_code
    end,
    recovery_deadline = case
      when final_state = 'RECOVERY_PENDING'
      then pg_catalog.clock_timestamp() + interval '5 minutes'
      else null
    end,
    updated_at = pg_catalog.clock_timestamp()
  where claim.app_id = locked_claim.app_id
    and claim.tenant_id = locked_claim.tenant_id
    and claim.environment = locked_claim.environment
    and claim.run_id = locked_claim.run_id
    and claim.principal_id = locked_claim.principal_id
    and claim.idempotency_key = locked_claim.idempotency_key
  returning claim.* into locked_claim;

  perform app_data_agent.text2sql_append_execution_event(
    locked_claim,
    requested_event_id,
    case final_state
      when 'RECOVERY_PENDING' then 'sandbox.execution.recovery_pending'
      when 'CANCELLED' then 'sandbox.execution.cancelled'
      when 'REPLAY_UNAVAILABLE' then 'sandbox.execution.replay_unavailable'
      else 'sandbox.execution.failed'
    end,
    prior_state,
    pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'reason_code',
        final_reason_code,
        'record_id',
        requested_record_id::text,
        'cancel_disposition',
        cancel_disposition
      )
    )
  );
  return pg_catalog.jsonb_build_object(
    'disposition',
    disposition,
    'claim',
    app_data_agent.text2sql_claim_json(locked_claim)
  ) || case
    when cancel_disposition is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object(
      'cancel_disposition',
      cancel_disposition
    )
  end;
end
$$;

create or replace function
  app_data_agent.resolve_text2sql_sandbox_execution_record(
    command_json jsonb
  )
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  current_authority record;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_principal_id uuid;
  requested_execution_id uuid;
  requested_attempt_id uuid;
  requested_input_hash text;
  requested_fence bigint;
  resolved_record app_data_agent.text2sql_sandbox_execution_records;
begin
  if pg_catalog.jsonb_typeof(command_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command_json -> 'scope')
      is distinct from 'object'
    or coalesce(command_json ->> 'fence', '') !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_RECORD_REFERENCE_INVALID';
  end if;
  requested_app_id := platform.try_uuid(
    command_json #>> '{scope,app_id}'
  );
  requested_tenant_id := platform.try_uuid(
    command_json #>> '{scope,tenant_id}'
  );
  requested_environment := command_json #>> '{scope,environment}';
  requested_run_id := platform.try_uuid(command_json ->> 'run_id');
  requested_principal_id := platform.try_uuid(
    command_json ->> 'principal_id'
  );
  requested_execution_id := platform.try_uuid(
    command_json ->> 'execution_id'
  );
  requested_attempt_id := platform.try_uuid(command_json ->> 'attempt_id');
  requested_input_hash := command_json ->> 'input_hash';
  requested_fence := (command_json ->> 'fence')::bigint;
  if requested_app_id is null
    or requested_tenant_id is null
    or requested_run_id is null
    or requested_principal_id is null
    or requested_execution_id is null
    or requested_attempt_id is null
    or coalesce(requested_input_hash, '') !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SANDBOX_RECORD_REFERENCE_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(false);
  if current_authority.app_id <> requested_app_id
    or current_authority.tenant_id <> requested_tenant_id
    or current_authority.environment <> requested_environment
    or current_authority.principal_id <> requested_principal_id
  then
    raise exception using
      errcode = '42501',
      message = 'SANDBOX_SCOPE_FORBIDDEN';
  end if;

  select record.*
  into resolved_record
  from app_data_agent.text2sql_sandbox_execution_records as record
  where record.app_id = requested_app_id
    and record.tenant_id = requested_tenant_id
    and record.environment = requested_environment
    and record.run_id = requested_run_id
    and record.principal_id = requested_principal_id
    and record.execution_id = requested_execution_id
    and record.attempt_id = requested_attempt_id
    and record.fence = requested_fence
    and record.input_hash = requested_input_hash;
  if not found then
    return null;
  end if;
  return pg_catalog.to_jsonb(resolved_record);
end
$$;

create or replace function app_data_agent.resolve_text2sql_system_artifact(
  reference_json jsonb
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
declare
  current_authority record;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_artifact_id uuid;
  requested_artifact_type text;
  requested_revision integer;
  requested_content_hash text;
  required_audience_hash text;
  resolved_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(reference_json) is distinct from 'object'
    or coalesce(reference_json ->> 'revision', '') !~ '^[1-9][0-9]*$'
  then
    raise exception using
      errcode = '22023',
      message = 'SYSTEM_ARTIFACT_REFERENCE_INVALID';
  end if;
  requested_app_id := platform.try_uuid(reference_json ->> 'app_id');
  requested_tenant_id := platform.try_uuid(reference_json ->> 'tenant_id');
  requested_environment := reference_json ->> 'environment';
  requested_run_id := platform.try_uuid(reference_json ->> 'run_id');
  requested_artifact_id := platform.try_uuid(
    reference_json ->> 'artifact_id'
  );
  requested_artifact_type := reference_json ->> 'artifact_type';
  requested_revision := (reference_json ->> 'revision')::integer;
  requested_content_hash := reference_json ->> 'content_hash';
  if requested_app_id is null
    or requested_tenant_id is null
    or requested_run_id is null
    or requested_artifact_id is null
    or coalesce(requested_artifact_type, '') not in (
      'ResourceAdmissionReceipt',
      'FixtureMutationRecord',
      'MetamorphicFixtureReceipt',
      'MetamorphicOracleReceipt',
      'ResultOracleReceipt',
      'SandboxExecutionReceipt',
      'SandboxResult'
    )
    or coalesce(requested_content_hash, '') !~
      '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'SYSTEM_ARTIFACT_REFERENCE_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(false);
  if current_authority.app_id <> requested_app_id
    or current_authority.tenant_id <> requested_tenant_id
    or current_authority.environment <> requested_environment
  then
    raise exception using
      errcode = '42501',
      message = 'SANDBOX_SCOPE_FORBIDDEN';
  end if;
  required_audience_hash :=
    app_data_agent.text2sql_audience_context_hash(
      requested_app_id,
      requested_tenant_id,
      requested_environment,
      requested_run_id,
      current_authority.principal_id
    );

  select artifact.payload_json
  into resolved_payload
  from app_data_agent.text2sql_system_artifacts as artifact
  where artifact.app_id = requested_app_id
    and artifact.tenant_id = requested_tenant_id
    and artifact.environment = requested_environment
    and artifact.run_id = requested_run_id
    and artifact.artifact_id = requested_artifact_id
    and artifact.artifact_type = requested_artifact_type
    and artifact.revision = requested_revision
    and artifact.content_hash = requested_content_hash
    and artifact.producer_principal_id =
      current_authority.principal_id
    and artifact.audience_context_hash = required_audience_hash;
  return resolved_payload;
end
$$;

create or replace function app_data_agent.verify_text2sql_system_artifact(
  reference_json jsonb
)
returns boolean
language plpgsql
volatile
strict
security definer
set search_path = ''
as $$
begin
  return app_data_agent.resolve_text2sql_system_artifact(reference_json)
    is not null;
end
$$;

alter table app_data_agent.text2sql_system_artifacts
  enable row level security;
alter table app_data_agent.text2sql_system_artifacts
  force row level security;
alter table app_data_agent.text2sql_sandbox_claims
  enable row level security;
alter table app_data_agent.text2sql_sandbox_claims
  force row level security;
alter table app_data_agent.text2sql_sandbox_execution_events
  enable row level security;
alter table app_data_agent.text2sql_sandbox_execution_events
  force row level security;
alter table app_data_agent.text2sql_sandbox_execution_records
  enable row level security;
alter table app_data_agent.text2sql_sandbox_execution_records
  force row level security;

create policy text2sql_system_artifacts_backend_select
on app_data_agent.text2sql_system_artifacts
for select
to data_agent_backend
using (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    producer_principal_id,
    false
  )
  and audience_context_hash =
    app_data_agent.text2sql_audience_context_hash(
      app_id,
      tenant_id,
      environment,
      run_id,
      producer_principal_id
    )
);

create policy text2sql_sandbox_claims_backend_select
on app_data_agent.text2sql_sandbox_claims
for select
to data_agent_backend
using (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);

create policy text2sql_sandbox_execution_events_backend_select
on app_data_agent.text2sql_sandbox_execution_events
for select
to data_agent_backend
using (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);

create policy text2sql_sandbox_execution_records_backend_select
on app_data_agent.text2sql_sandbox_execution_records
for select
to data_agent_backend
using (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);

revoke all privileges on table
  app_data_agent.text2sql_system_artifacts,
  app_data_agent.text2sql_sandbox_claims,
  app_data_agent.text2sql_sandbox_execution_events,
  app_data_agent.text2sql_sandbox_execution_records
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

grant select on table
  app_data_agent.text2sql_system_artifacts,
  app_data_agent.text2sql_sandbox_claims,
  app_data_agent.text2sql_sandbox_execution_events,
  app_data_agent.text2sql_sandbox_execution_records
to data_agent_backend;

revoke all privileges on function app_data_agent.text2sql_audience_context_hash(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function app_data_agent.text2sql_claim_json(
  app_data_agent.text2sql_sandbox_claims
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

grant execute on function app_data_agent.text2sql_audience_context_hash(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) to data_agent_backend;

revoke all privileges on function
  app_data_agent.text2sql_assert_claim_request_integrity(jsonb, text)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

revoke all privileges on function app_data_agent.text2sql_append_only_guard()
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.text2sql_claim_transition_guard()
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.text2sql_lock_sandbox_claim(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.text2sql_append_execution_event(
    app_data_agent.text2sql_sandbox_claims,
    uuid,
    text,
    text,
    jsonb
  )
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.text2sql_validate_bound_outcome(
    app_data_agent.text2sql_sandbox_claims,
    jsonb,
    text
  )
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.text2sql_insert_execution_record(
    app_data_agent.text2sql_sandbox_claims,
    uuid,
    text,
    jsonb,
    jsonb,
    text
  )
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

revoke all privileges on function
  app_data_agent.claim_text2sql_sandbox_execution(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.mark_text2sql_sandbox_executing(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.request_text2sql_sandbox_cancel(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.finalize_text2sql_sandbox_execution(jsonb, jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.fail_text2sql_sandbox_execution(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.resolve_text2sql_sandbox_execution_record(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.resolve_text2sql_system_artifact(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.verify_text2sql_system_artifact(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

grant execute on function
  app_data_agent.claim_text2sql_sandbox_execution(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.mark_text2sql_sandbox_executing(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.request_text2sql_sandbox_cancel(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.finalize_text2sql_sandbox_execution(jsonb, jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.fail_text2sql_sandbox_execution(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.resolve_text2sql_sandbox_execution_record(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.resolve_text2sql_system_artifact(jsonb)
to data_agent_backend;
grant execute on function
  app_data_agent.verify_text2sql_system_artifact(jsonb)
to data_agent_backend;

commit;
