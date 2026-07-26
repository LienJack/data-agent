begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010540_app_data_agent_runtime_checkpoint_effect',
  'sha256:1fe1d5ac461e8e73923e0bca39e744134a6ba5ad2d2417f6ec3c05b3e981e75c'
);

create or replace function app_data_agent.commit_run_checkpoint(
  requested_lease jsonb,
  requested_binding jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  requested_outbox_id uuid;
  requested_run_id uuid;
  requested_attempt_id uuid;
  requested_command_id uuid;
  requested_worker_id text;
  expected_lease_token bigint;
  requested_snapshot_id uuid;
  requested_snapshot_version integer;
  requested_event_sequence bigint;
  requested_worker_fence bigint;
  requested_created_at timestamptz;
  authoritative_snapshot_hash text;
  authoritative_binding jsonb;
  existing_checkpoint app_data_agent.run_checkpoints%rowtype;
  message_lease_expires_at timestamptz;
  attempt_lease_expires_at timestamptz;
  now_at timestamptz;
begin
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) <> 'object'
    or pg_catalog.jsonb_typeof(requested_lease -> 'scope') <> 'object'
    or requested_binding is null
    or pg_catalog.jsonb_typeof(requested_binding) <> 'object'
    or requested_binding ->> 'schema_version' <> '1.0.0'
    or requested_binding ->> 'authority' <> 'EXECUTION_SNAPSHOT_ONLY'
    or requested_binding ? 'snapshot_hash'
    or pg_catalog.jsonb_typeof(requested_binding -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_binding -> 'mastra_snapshot') <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_lease - 'lease_token'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_binding)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_CHECKPOINT_INPUT_INVALID';
  end if;

  begin
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_run_id := (requested_binding ->> 'run_id')::uuid;
    requested_attempt_id := (requested_binding ->> 'attempt_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    expected_lease_token := (requested_lease ->> 'lease_token')::bigint;
    requested_snapshot_id := (requested_binding ->> 'snapshot_id')::uuid;
    requested_snapshot_version :=
      (requested_binding ->> 'snapshot_version')::integer;
    requested_event_sequence :=
      (requested_binding ->> 'event_sequence')::bigint;
    requested_worker_fence :=
      (requested_binding ->> 'worker_fence')::bigint;
    requested_created_at :=
      (requested_binding ->> 'created_at')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_CHECKPOINT_INPUT_INVALID';
  end;

  if requested_snapshot_version < 1
    or requested_event_sequence < 1
    or requested_worker_fence < 1
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or expected_lease_token < 1
    or requested_lease ->> 'run_id' <> requested_run_id::text
    or requested_lease ->> 'attempt_id' <> requested_attempt_id::text
    or (requested_lease ->> 'worker_fence')::bigint <> requested_worker_fence
    or requested_lease -> 'scope' is distinct from requested_binding -> 'scope'
    or requested_binding ->> 'created_at' <>
      app_data_agent.runtime_iso_timestamp(requested_created_at)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_CHECKPOINT_INPUT_INVALID';
  end if;
  authoritative_snapshot_hash :=
    app_data_agent.runtime_canonical_sha256(requested_binding);
  authoritative_binding :=
    requested_binding ||
    pg_catalog.jsonb_build_object(
      'snapshot_hash',
      authoritative_snapshot_hash
    );

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_binding -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_binding -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_binding -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_CHECKPOINT_SCOPE_FORBIDDEN';
  end if;

  select
    message.lease_expires_at,
    attempt.lease_expires_at
  into
    message_lease_expires_at,
    attempt_lease_expires_at
  from app_data_agent.runs as run
  join app_data_agent.outbox as message
    on message.app_id = run.app_id
   and message.tenant_id = run.tenant_id
   and message.environment = run.environment
   and message.run_id = run.run_id
  join app_data_agent.run_attempts as attempt
    on attempt.app_id = message.app_id
   and attempt.tenant_id = message.tenant_id
   and attempt.environment = message.environment
   and attempt.run_id = message.run_id
   and attempt.outbox_id = message.outbox_id
   and attempt.command_id = message.command_id
   and attempt.attempt_id = message.active_attempt_id
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.status = 'RUNNING'
    and run.active_fence = requested_worker_fence
    and message.outbox_id = requested_outbox_id
    and message.command_id = requested_command_id
    and message.active_attempt_id = requested_attempt_id
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = requested_worker_fence
    and attempt.attempt_id = requested_attempt_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and run.principal_id = current_authority.principal_id
  for update of run, message, attempt;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_CHECKPOINT_STALE_LEASE';
  end if;
  now_at := pg_catalog.clock_timestamp();
  if message_lease_expires_at < now_at
    or attempt_lease_expires_at < now_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_CHECKPOINT_STALE_LEASE';
  end if;

  select checkpoint.*
  into existing_checkpoint
  from app_data_agent.run_checkpoints as checkpoint
  where checkpoint.app_id = current_authority.app_id
    and checkpoint.tenant_id = current_authority.tenant_id
    and checkpoint.environment = current_authority.environment
    and checkpoint.run_id = requested_run_id
    and (
      (
        checkpoint.snapshot_id = requested_snapshot_id
        and checkpoint.snapshot_version = requested_snapshot_version
      )
      or checkpoint.snapshot_hash = authoritative_snapshot_hash
    );
  if found then
    if existing_checkpoint.snapshot_id <> requested_snapshot_id
      or existing_checkpoint.snapshot_version <> requested_snapshot_version
      or existing_checkpoint.snapshot_hash <> authoritative_snapshot_hash
      or existing_checkpoint.binding_json <> authoritative_binding
      or existing_checkpoint.snapshot_hash <>
        app_data_agent.runtime_canonical_sha256(
          existing_checkpoint.binding_json - 'snapshot_hash'
        )
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_CHECKPOINT_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'created',
      false,
      'binding',
      existing_checkpoint.binding_json
    );
  end if;

  perform 1
  from app_data_agent.runs as run
  join app_data_agent.run_projections as projection
    on projection.app_id = run.app_id
   and projection.tenant_id = run.tenant_id
   and projection.environment = run.environment
   and projection.run_id = run.run_id
   and projection.version = requested_event_sequence
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.status = 'RUNNING'
    and run.active_fence = requested_worker_fence
    and projection.worker_fence = requested_worker_fence
    and not exists (
      select 1
      from app_data_agent.run_projections as newer
      where newer.app_id = projection.app_id
        and newer.tenant_id = projection.tenant_id
        and newer.environment = projection.environment
        and newer.run_id = projection.run_id
        and newer.version > projection.version
    )
    and run.principal_id = current_authority.principal_id
  for update of run;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_CHECKPOINT_STALE_FENCE';
  end if;

  if requested_binding -> 'active_artifact_ref' <> 'null'::jsonb
    and not exists (
      select 1
      from app_data_agent.artifacts as artifact
      where artifact.app_id = current_authority.app_id
        and artifact.tenant_id = current_authority.tenant_id
        and artifact.environment = current_authority.environment
        and artifact.run_id = requested_run_id
        and artifact.artifact_id =
          (requested_binding -> 'active_artifact_ref' ->> 'artifact_id')::uuid
        and artifact.artifact_type =
          requested_binding -> 'active_artifact_ref' ->> 'artifact_type'
        and artifact.revision =
          (requested_binding -> 'active_artifact_ref' ->> 'revision')::integer
        and artifact.content_hash =
          requested_binding -> 'active_artifact_ref' ->> 'content_hash'
        and artifact.is_active
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_CHECKPOINT_ARTIFACT_INVALID';
  end if;

  insert into app_data_agent.run_checkpoints (
    app_id,
    tenant_id,
    environment,
    run_id,
    attempt_id,
    snapshot_id,
    snapshot_version,
    snapshot_hash,
    event_sequence,
    worker_fence,
    binding_json,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_run_id,
    requested_attempt_id,
    requested_snapshot_id,
    requested_snapshot_version,
    authoritative_snapshot_hash,
    requested_event_sequence,
    requested_worker_fence,
    authoritative_binding,
    now_at
  );
  return pg_catalog.jsonb_build_object(
    'created',
    true,
    'binding',
    authoritative_binding
  );
end
$$;

create or replace function app_data_agent.commit_run_effect_receipt(
  requested_lease jsonb,
  requested_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  requested_outbox_id uuid;
  requested_attempt_id uuid;
  requested_command_id uuid;
  requested_worker_id text;
  expected_lease_token bigint;
  requested_receipt_id uuid;
  requested_run_id uuid;
  requested_effect_kind text;
  requested_input_hash text;
  requested_output_hash text;
  requested_worker_fence bigint;
  requested_committed_at timestamptz;
  existing_receipt app_data_agent.run_effect_receipts%rowtype;
  message_lease_expires_at timestamptz;
  attempt_lease_expires_at timestamptz;
  now_at timestamptz;
begin
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) <> 'object'
    or pg_catalog.jsonb_typeof(requested_lease -> 'scope') <> 'object'
    or requested_receipt is null
    or pg_catalog.jsonb_typeof(requested_receipt) <> 'object'
    or requested_receipt ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(requested_receipt -> 'scope') <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_lease - 'lease_token'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_receipt)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EFFECT_INPUT_INVALID';
  end if;

  begin
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    requested_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    expected_lease_token := (requested_lease ->> 'lease_token')::bigint;
    requested_receipt_id := (requested_receipt ->> 'receipt_id')::uuid;
    requested_run_id := (requested_receipt ->> 'run_id')::uuid;
    requested_effect_kind := requested_receipt ->> 'effect_kind';
    requested_input_hash := requested_receipt ->> 'input_hash';
    requested_output_hash := requested_receipt ->> 'output_hash';
    requested_worker_fence :=
      (requested_receipt ->> 'worker_fence')::bigint;
    requested_committed_at :=
      (requested_receipt ->> 'committed_at')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_EFFECT_INPUT_INVALID';
  end;
  if requested_effect_kind not in ('SQL', 'EVAL')
    or requested_input_hash is null
    or requested_input_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_output_hash is null
    or requested_output_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_worker_fence < 1
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or expected_lease_token < 1
    or requested_lease ->> 'run_id' <> requested_run_id::text
    or (requested_lease ->> 'worker_fence')::bigint <> requested_worker_fence
    or requested_lease -> 'scope' is distinct from requested_receipt -> 'scope'
    or requested_receipt ->> 'committed_at' <>
      app_data_agent.runtime_iso_timestamp(requested_committed_at)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EFFECT_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_receipt -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_receipt -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_receipt -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EFFECT_SCOPE_FORBIDDEN';
  end if;

  select
    message.lease_expires_at,
    attempt.lease_expires_at
  into
    message_lease_expires_at,
    attempt_lease_expires_at
  from app_data_agent.runs as run
  join app_data_agent.outbox as message
    on message.app_id = run.app_id
   and message.tenant_id = run.tenant_id
   and message.environment = run.environment
   and message.run_id = run.run_id
  join app_data_agent.run_attempts as attempt
    on attempt.app_id = message.app_id
   and attempt.tenant_id = message.tenant_id
   and attempt.environment = message.environment
   and attempt.run_id = message.run_id
   and attempt.outbox_id = message.outbox_id
   and attempt.command_id = message.command_id
   and attempt.attempt_id = message.active_attempt_id
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.status = 'RUNNING'
    and run.active_fence = requested_worker_fence
    and message.outbox_id = requested_outbox_id
    and message.command_id = requested_command_id
    and message.active_attempt_id = requested_attempt_id
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = requested_worker_fence
    and attempt.attempt_id = requested_attempt_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and run.principal_id = current_authority.principal_id
  for update of run, message, attempt;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EFFECT_STALE_LEASE';
  end if;
  now_at := pg_catalog.clock_timestamp();
  if message_lease_expires_at < now_at
    or attempt_lease_expires_at < now_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EFFECT_STALE_LEASE';
  end if;

  select receipt.*
  into existing_receipt
  from app_data_agent.run_effect_receipts as receipt
  where receipt.app_id = current_authority.app_id
    and receipt.tenant_id = current_authority.tenant_id
    and receipt.environment = current_authority.environment
    and (
      receipt.receipt_id = requested_receipt_id
      or (
        receipt.run_id = requested_run_id
        and receipt.effect_kind = requested_effect_kind
        and receipt.input_hash = requested_input_hash
      )
    );
  if found then
    if existing_receipt.run_id <> requested_run_id
      or existing_receipt.effect_kind <> requested_effect_kind
      or existing_receipt.input_hash <> requested_input_hash
      or existing_receipt.output_hash <> requested_output_hash
      or existing_receipt.receipt_json -> 'artifact_ref'
        is distinct from requested_receipt -> 'artifact_ref'
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_EFFECT_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'created',
      false,
      'receipt',
      existing_receipt.receipt_json
    );
  end if;

  if requested_receipt ? 'artifact_ref'
    and not exists (
      select 1
      from app_data_agent.artifacts as artifact
      where artifact.app_id = current_authority.app_id
        and artifact.tenant_id = current_authority.tenant_id
        and artifact.environment = current_authority.environment
        and artifact.run_id = requested_run_id
        and artifact.artifact_id =
          (requested_receipt -> 'artifact_ref' ->> 'artifact_id')::uuid
        and artifact.artifact_type =
          requested_receipt -> 'artifact_ref' ->> 'artifact_type'
        and artifact.revision =
          (requested_receipt -> 'artifact_ref' ->> 'revision')::integer
        and artifact.content_hash =
          requested_receipt -> 'artifact_ref' ->> 'content_hash'
        and artifact.is_active
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EFFECT_ARTIFACT_INVALID';
  end if;

  insert into app_data_agent.run_effect_receipts (
    app_id,
    tenant_id,
    environment,
    run_id,
    attempt_id,
    receipt_id,
    effect_kind,
    input_hash,
    output_hash,
    worker_fence,
    receipt_json,
    committed_at,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_run_id,
    requested_attempt_id,
    requested_receipt_id,
    requested_effect_kind,
    requested_input_hash,
    requested_output_hash,
    requested_worker_fence,
    requested_receipt,
    requested_committed_at,
    now_at
  );
  return pg_catalog.jsonb_build_object(
    'created',
    true,
    'receipt',
    requested_receipt
  );
end
$$;

commit;
