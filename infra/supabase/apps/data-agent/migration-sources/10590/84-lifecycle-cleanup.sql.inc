create table app_data_agent.research_lifecycle_cleanup_operations (
  app_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  operation_id uuid not null,
  app_epoch bigint not null
    check (app_epoch between 1 and 9007199254740991),
  component text not null default 'U6_AUTHORITY_RELATIONS'
    check (component = 'U6_AUTHORITY_RELATIONS'),
  operation_hash text not null
    check (operation_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_manifest_id uuid not null,
  resource_manifest_hash text not null
    check (resource_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_boundary_receipt_id uuid not null,
  export_boundary_receipt_hash text not null
    check (export_boundary_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_operation_receipt_id uuid not null,
  export_operation_receipt_hash text not null
    check (export_operation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  backup_operation_receipt_id uuid not null,
  backup_operation_receipt_hash text not null
    check (backup_operation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_inventory_hash text not null
    check (schema_inventory_hash ~ '^sha256:[0-9a-f]{64}$'),
  next_batch_seq bigint not null default 1
    check (next_batch_seq between 1 and 9007199254740991),
  total_live_result_bodies_destroyed bigint not null default 0
    check (total_live_result_bodies_destroyed between 0 and 9007199254740991),
  total_metadata_only_results_deleted bigint not null default 0
    check (total_metadata_only_results_deleted between 0 and 9007199254740991),
  state text not null default 'RUNNING'
    check (state in ('RUNNING', 'COMMITTED')),
  final_receipt_hash text
    check (final_receipt_hash is null or final_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, operation_id),
  unique (app_id, environment, app_epoch, component),
  check (
    (state = 'RUNNING' and final_receipt_hash is null)
    or (state = 'COMMITTED' and final_receipt_hash is not null)
  )
);

create table app_data_agent.research_lifecycle_cleanup_batch_receipts (
  app_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  batch_id uuid not null,
  operation_id uuid not null,
  batch_seq bigint not null
    check (batch_seq between 1 and 9007199254740991),
  app_epoch bigint not null
    check (app_epoch between 1 and 9007199254740991),
  component text not null default 'U6_AUTHORITY_RELATIONS'
    check (component = 'U6_AUTHORITY_RELATIONS'),
  operation_hash text not null
    check (operation_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null
    check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  cleanup_rank bigint not null
    check (cleanup_rank between 0 and 9007199254740991),
  deleted_rows bigint not null
    check (deleted_rows between 0 and 9007199254740991),
  live_result_bodies_destroyed bigint not null
    check (live_result_bodies_destroyed between 0 and 9007199254740991),
  metadata_only_results_deleted bigint not null
    check (metadata_only_results_deleted between 0 and 9007199254740991),
  component_residual_rows bigint not null
    check (component_residual_rows between 0 and 9007199254740991),
  state text not null check (state in ('RUNNING', 'COMMITTED')),
  committed_at timestamptz not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, environment, batch_id),
  unique (app_id, environment, operation_id, batch_seq),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.research_lifecycle_cleanup_operations (
      app_id, environment, operation_id
    )
    on delete restrict not deferrable
);

create function app_data_agent.cleanup_u6_delete_pending_environment(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  requested_app_id uuid;
  requested_environment text;
  requested_operation_id uuid;
  requested_batch_id uuid;
  requested_app_epoch bigint;
  requested_manifest_id uuid;
  requested_boundary_receipt_id uuid;
  requested_export_operation_id uuid;
  requested_backup_operation_id uuid;
  requested_batch_limit bigint;
  expected_operation_hash text;
  expected_request_hash text;
  locked_evidence jsonb;
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_job_authority',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_JOB_AUTHORITY_REQUIRED';
  end if;

  if input_json is null
    or pg_catalog.jsonb_typeof(input_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(input_json) = 'object' then input_json
          else '{}'::jsonb
        end
      )
    ) <> 18
    or input_json ->> 'protocol_version'
      <> 'u6-app-lifecycle-cleanup@1.0.0'
    or pg_catalog.jsonb_typeof(input_json -> 'operation_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'batch_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'app_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'environment') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'expected_app_epoch') <> 'number'
    or pg_catalog.jsonb_typeof(input_json -> 'resource_manifest_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'resource_manifest_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_boundary_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_boundary_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_operation_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_operation_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'backup_operation_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'backup_operation_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'schema_inventory_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'batch_limit') <> 'number'
    or pg_catalog.jsonb_typeof(input_json -> 'operation_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'request_hash') <> 'string'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end if;

  begin
    requested_app_id := (input_json ->> 'app_id')::uuid;
    requested_environment := input_json ->> 'environment';
    requested_operation_id := (input_json ->> 'operation_id')::uuid;
    requested_batch_id := (input_json ->> 'batch_id')::uuid;
    requested_app_epoch := (input_json ->> 'expected_app_epoch')::bigint;
    requested_manifest_id := (input_json ->> 'resource_manifest_id')::uuid;
    requested_boundary_receipt_id :=
      (input_json ->> 'export_boundary_receipt_id')::uuid;
    requested_export_operation_id :=
      (input_json ->> 'export_operation_receipt_id')::uuid;
    requested_backup_operation_id :=
      (input_json ->> 'backup_operation_receipt_id')::uuid;
    requested_batch_limit := (input_json ->> 'batch_limit')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end;

  if requested_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or input_json ->> 'expected_app_epoch' !~ '^[0-9]+$'
    or input_json ->> 'batch_limit' !~ '^[0-9]+$'
    or requested_app_epoch not between 1 and 9007199254740991
    or requested_batch_limit not between 1 and 500
    or input_json ->> 'resource_manifest_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'export_boundary_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'export_operation_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'backup_operation_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'schema_inventory_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'operation_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'request_hash' !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end if;

  expected_operation_hash := app_data_agent.u6_domain_sha256(
    'u6-cleanup-operation@1.0.0',
    pg_catalog.jsonb_build_array(
      input_json ->> 'protocol_version',
      requested_operation_id,
      requested_app_id,
      requested_environment,
      requested_app_epoch,
      requested_manifest_id,
      input_json ->> 'resource_manifest_hash',
      requested_boundary_receipt_id,
      input_json ->> 'export_boundary_receipt_hash',
      requested_export_operation_id,
      input_json ->> 'export_operation_receipt_hash',
      requested_backup_operation_id,
      input_json ->> 'backup_operation_receipt_hash',
      input_json ->> 'schema_inventory_hash'
    )
  );
  expected_request_hash := app_data_agent.u6_domain_sha256(
    'u6-cleanup-batch-request@1.0.0',
    pg_catalog.jsonb_build_array(
      expected_operation_hash,
      requested_batch_id,
      requested_batch_limit
    )
  );
  if input_json ->> 'operation_hash' <> expected_operation_hash
    or input_json ->> 'request_hash' <> expected_request_hash
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_HASH_INVALID';
  end if;

  perform platform.acquire_lifecycle_exclusive_lock(
    requested_app_id,
    requested_environment
  );
  locked_evidence := platform.lock_u6_cleanup_platform_evidence(
    requested_app_id,
    requested_environment,
    requested_app_epoch,
    requested_manifest_id,
    input_json ->> 'resource_manifest_hash',
    requested_boundary_receipt_id,
    input_json ->> 'export_boundary_receipt_hash',
    requested_export_operation_id,
    input_json ->> 'export_operation_receipt_hash',
    requested_backup_operation_id,
    input_json ->> 'backup_operation_receipt_hash'
  );

  perform pg_catalog.set_config(
    'app.u6_cleanup_app_id',
    requested_app_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_environment',
    requested_environment,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_operation_id',
    requested_operation_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_batch_id',
    requested_batch_id::text,
    true
  );
  if pg_catalog.current_setting('app.u6_cleanup_app_id', true)
       is distinct from requested_app_id::text
    or pg_catalog.current_setting('app.u6_cleanup_environment', true)
       is distinct from requested_environment
    or pg_catalog.current_setting('app.u6_cleanup_operation_id', true)
       is distinct from requested_operation_id::text
    or pg_catalog.current_setting('app.u6_cleanup_batch_id', true)
       is distinct from requested_batch_id::text
    or locked_evidence ->> 'app_id' is distinct from requested_app_id::text
    or locked_evidence ->> 'environment' is distinct from requested_environment
    or (locked_evidence ->> 'app_epoch')::bigint is distinct from requested_app_epoch
  then
    raise exception using
      errcode = '42501',
      message = 'DA_U6_CLEANUP_BINDING_INVALID';
  end if;

  -- The destructive branch is deliberately unavailable until the signed
  -- external signature and backup-restore verifier is wired. Returning HOLD
  -- here occurs before retained-control writes or any U6 resource deletion.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-app-lifecycle-cleanup-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'U6_CLEANUP_EXTERNAL_VERIFIER_UNAVAILABLE',
      'retryable', false
    )
  );
end
$function$;
