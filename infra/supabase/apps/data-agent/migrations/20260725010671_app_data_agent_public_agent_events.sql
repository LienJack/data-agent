-- public_agent_event_migration_checksum: sha256:c052fbeef90973b50d671e76d11da8bfcf8c415a2c1c07feb976e5d09c43c909
-- 10671 installs the public Team Agent/Tool/Artifact event contract.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U20_PUBLIC_AGENT_EVENT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U20_PUBLIC_AGENT_EVENT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010670_app_data_agent_atomic_team_acceptance')
  then raise exception using errcode='P0001',message='U20_PUBLIC_AGENT_EVENT_BASELINE_10670_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function app_data_agent.public_run_v2_payload_is_valid(
  requested_event_type text,
  requested_payload jsonb,
  requested_scope jsonb,
  requested_run_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  key_count integer;
  reference jsonb;
  started_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(requested_payload)<>'object' then return false; end if;
  select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(requested_payload);

  if requested_event_type='run.agent_status' then
    return key_count=8
      and requested_payload ?& array['profile_id','task_id','status','phase','title','summary','duration_ms','error_code']
      and requested_payload->>'profile_id' in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent')
      and pg_catalog.jsonb_typeof(requested_payload->'task_id') in ('string','null')
      and (requested_payload->>'task_id' is null or requested_payload->>'task_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      and requested_payload->>'status' in ('PENDING','RUNNING','COMPLETED','FAILED','INTERRUPTED','SKIPPED','BLOCKED')
      and (requested_payload->>'task_id' is not null or requested_payload->>'status'='PENDING')
      and pg_catalog.jsonb_typeof(requested_payload->'phase')='string'
      and pg_catalog.length(requested_payload->>'phase') between 1 and 128
      and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
      and pg_catalog.length(requested_payload->>'title') between 1 and 128
      and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
      and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
      and pg_catalog.jsonb_typeof(requested_payload->'duration_ms') in ('number','null')
      and (requested_payload->>'duration_ms' is null or (
        requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991))
      and pg_catalog.jsonb_typeof(requested_payload->'error_code') in ('string','null')
      and (requested_payload->>'error_code' is null or requested_payload->>'error_code' ~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$');
  end if;

  if requested_event_type not in ('run.tool_started','run.tool_completed','run.tool_failed') then return false; end if;
  if key_count <> (case requested_event_type when 'run.tool_failed' then 9 else 8 end) then return false; end if;
  if not requested_payload ?& array['call_id','tool_name','summary','profile_id','task_id','artifact_refs'] then return false; end if;
  if requested_event_type='run.tool_started' and not requested_payload ?& array['title','input'] then return false; end if;
  if requested_event_type='run.tool_completed' and not requested_payload ?& array['output','duration_ms'] then return false; end if;
  if requested_event_type='run.tool_failed' and not requested_payload ?& array['error_code','output','duration_ms'] then return false; end if;
  if pg_catalog.jsonb_typeof(requested_payload->'call_id')<>'string'
    or pg_catalog.length(requested_payload->>'call_id') not between 1 and 256
    or pg_catalog.jsonb_typeof(requested_payload->'tool_name')<>'string'
    or pg_catalog.length(requested_payload->>'tool_name') not between 1 and 128
    or pg_catalog.jsonb_typeof(requested_payload->'summary')<>'string'
    or pg_catalog.length(requested_payload->>'summary') not between 1 and 100000
    or pg_catalog.jsonb_typeof(requested_payload->'profile_id') not in ('string','null')
    or pg_catalog.jsonb_typeof(requested_payload->'task_id') not in ('string','null')
    or ((requested_payload->>'profile_id' is null) <> (requested_payload->>'task_id' is null))
    or (requested_payload->>'profile_id' is not null and requested_payload->>'profile_id' not in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent'))
    or (requested_payload->>'task_id' is not null and requested_payload->>'task_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or pg_catalog.jsonb_typeof(requested_payload->'artifact_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested_payload->'artifact_refs')>32
  then return false; end if;
  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>'app_id')::uuid
        and command.tenant_id=(requested_scope->>'tenant_id')::uuid
        and command.environment=requested_scope->>'environment'
        and command.run_id=requested_run_id
        and command.payload_json->>'kind'='START_DATA_AGENT_TEAM')
    and requested_payload->>'profile_id' is null
  then return false; end if;
  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>'app_id')::uuid
        and command.tenant_id=(requested_scope->>'tenant_id')::uuid
        and command.environment=requested_scope->>'environment'
        and command.run_id=requested_run_id
        and command.payload_json->>'kind'<>'START_DATA_AGENT_TEAM')
    and requested_payload->>'profile_id' is not null
  then return false; end if;
  if requested_event_type='run.tool_started' and (
    pg_catalog.jsonb_array_length(requested_payload->'artifact_refs')<>0
    or pg_catalog.jsonb_typeof(requested_payload->'title')<>'string'
    or pg_catalog.length(requested_payload->>'title') not between 1 and 128
    or pg_catalog.jsonb_typeof(requested_payload->'input') not in ('string','null')
    or pg_catalog.length(coalesce(requested_payload->>'input',''))>100000
  ) then return false; end if;
  if requested_event_type in ('run.tool_completed','run.tool_failed') and (
    pg_catalog.jsonb_typeof(requested_payload->'output') not in ('string','null')
    or pg_catalog.length(coalesce(requested_payload->>'output',''))>200000
    or pg_catalog.jsonb_typeof(requested_payload->'duration_ms')<>'number'
    or requested_payload->>'duration_ms' !~ '^(0|[1-9][0-9]{0,15})$'
    or (requested_payload->>'duration_ms')::numeric>9007199254740991
  ) then return false; end if;
  if requested_event_type='run.tool_failed' and (
    pg_catalog.jsonb_typeof(requested_payload->'error_code')<>'string'
    or requested_payload->>'error_code' !~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
  ) then return false; end if;

  for reference in select value from pg_catalog.jsonb_array_elements(requested_payload->'artifact_refs') loop
    select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(reference);
    if key_count<>8 or not reference ?& array['artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash']
      or reference->>'app_id' is distinct from requested_scope->>'app_id'
      or reference->>'tenant_id' is distinct from requested_scope->>'tenant_id'
      or reference->>'environment' is distinct from requested_scope->>'environment'
      or reference->>'run_id' is distinct from requested_run_id::text
      or reference->>'artifact_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or reference->>'artifact_type' !~ '^[A-Za-z][A-Za-z0-9_.-]{1,126}$'
      or reference->>'revision' !~ '^[1-9][0-9]{0,9}$'
      or reference->>'content_hash' !~ '^sha256:[0-9a-f]{64}$'
      or not exists(select 1 from app_data_agent.artifacts artifact
        where artifact.app_id=(reference->>'app_id')::uuid and artifact.tenant_id=(reference->>'tenant_id')::uuid
          and artifact.environment=reference->>'environment' and artifact.run_id=(reference->>'run_id')::uuid
          and artifact.artifact_id=(reference->>'artifact_id')::uuid and artifact.artifact_type=reference->>'artifact_type'
          and artifact.revision=(reference->>'revision')::integer and artifact.content_hash=reference->>'content_hash' and artifact.is_active)
    then return false; end if;
  end loop;

  if requested_event_type='run.tool_started' then
    return not exists(select 1 from app_data_agent.run_events event
      where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
        and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
        and event.event_type in ('run.tool_started','run.tool_completed','run.tool_failed')
        and event.payload_json->>'call_id'=requested_payload->>'call_id');
  end if;
  select event.payload_json into started_payload from app_data_agent.run_events event
    where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
      and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
      and event.event_type='run.tool_started' and event.event_document->>'schema_version'='run-runtime-event@2.0.0'
      and event.payload_json->>'call_id'=requested_payload->>'call_id'
    order by event.sequence desc limit 1;
  return started_payload is not null
    and started_payload->>'tool_name' is not distinct from requested_payload->>'tool_name'
    and started_payload->>'profile_id' is not distinct from requested_payload->>'profile_id'
    and started_payload->>'task_id' is not distinct from requested_payload->>'task_id'
    and not exists(select 1 from app_data_agent.run_events event
      where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
        and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
        and event.event_type in ('run.tool_completed','run.tool_failed')
        and event.payload_json->>'call_id'=requested_payload->>'call_id');
exception when others then return false;
end
$function$;

create or replace function app_data_agent.reduce_run_projection_document(
  current_projection jsonb,
  requested_event jsonb
)
returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  event_type text;
  payload jsonb;
  expected_projection jsonb;
begin
  if pg_catalog.jsonb_typeof(current_projection) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
  end if;

  event_type := requested_event ->> 'event_type';
  payload := requested_event -> 'payload';

  expected_projection := current_projection || pg_catalog.jsonb_build_object(
    'version',
    (requested_event ->> 'sequence')::bigint,
    'worker_fence',
    (requested_event ->> 'worker_fence')::bigint,
    'last_event_id',
    requested_event ->> 'event_id',
    'last_occurred_at',
    requested_event -> 'occurred_at'
  );

  case event_type
    when 'run.leased' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'RUNNING',
          'attempt_count',
          (payload ->> 'attempt')::bigint
        );
    when 'run.checkpointed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'active_artifact_ref',
          payload -> 'active_artifact_ref',
          'active_snapshot_ref',
          payload -> 'snapshot_ref'
        );
    when 'run.side_effect_committed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'last_side_effect_receipt_id',
          payload ->> 'receipt_id'
        );
    when 'run.progress' then null;
    when 'run.tool_started' then null;
    when 'run.tool_completed' then null;
    when 'run.tool_failed' then null;
    when 'run.answer_delta' then null;
    when 'run.reasoning_started' then null;
    when 'run.reasoning_delta' then null;
    when 'run.reasoning_completed' then null;
    when 'run.agent_status' then null;
    when 'run.suspended' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'WAITING');
    when 'run.resumed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.retry_scheduled' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.cancel_requested' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'CANCELLED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.completed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'COMPLETED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.failed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'FAILED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    else
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_PROJECTION_REDUCER_EVENT_INVALID';
  end case;

  return expected_projection;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
end
$$;
create or replace function app_data_agent.prepare_run_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payload_command_id text;
  payload_hash text;
  expected_document jsonb;
begin
  if new.event_type = 'command.accepted' then
    if new.sequence <> 1 or new.worker_fence <> 0 then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_UNSUPPORTED';
    end if;
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    payload_hash := coalesce(
      new.payload_json ->> 'payload_hash',
      new.payload_json ->> 'payloadHash'
    );
    if payload_command_id is null
      or payload_command_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or payload_hash is null
      or payload_hash !~ '^sha256:[0-9a-f]{64}$'
    then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_INVALID';
    end if;
    new.event_type := 'run.accepted';
    new.command_id := payload_command_id::uuid;
    new.payload_json := pg_catalog.jsonb_build_object(
      'command_id',
      payload_command_id,
      'payload_hash',
      payload_hash
    );
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;

  if new.dedupe_key is null then
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;
  if pg_catalog.length(new.dedupe_key) not between 1 and 256 then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DEDUPE_INVALID';
  end if;

  if new.command_id is null then
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    if payload_command_id is not null
      and payload_command_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      new.command_id := payload_command_id::uuid;
    end if;
  end if;

  expected_document := pg_catalog.jsonb_build_object(
    'schema_version',
    coalesce(new.event_document ->> 'schema_version','1.0.0'),
    'event_id',
    new.event_id,
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      new.app_id,
      'tenant_id',
      new.tenant_id,
      'environment',
      new.environment
    ),
    'run_id',
    new.run_id,
    'sequence',
    new.sequence,
    'worker_fence',
    new.worker_fence,
    'idempotency_key',
    new.dedupe_key,
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(new.created_at),
    'event_type',
    new.event_type,
    'payload',
    new.payload_json
  );

  if new.event_document is null then
    new.event_document := expected_document;
  elsif new.event_document <> expected_document then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_MISMATCH';
  end if;

  if pg_catalog.jsonb_typeof(new.event_document) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_INVALID';
  end if;

  if coalesce(new.event_document->>'schema_version','1.0.0')='1.0.0'
    and new.event_type in ('run.progress',
      'run.tool_started',
      'run.tool_completed',
      'run.tool_failed',
      'run.answer_delta',
      'run.reasoning_started',
      'run.reasoning_delta',
      'run.reasoning_completed')
    and not app_data_agent.public_run_display_payload_is_valid(
      new.event_type,
      new.payload_json
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_DISPLAY_EVENT_PAYLOAD_INVALID';
  end if;

  if coalesce(new.event_document->>'schema_version','1.0.0') not in ('1.0.0','run-runtime-event@2.0.0')
    or (coalesce(new.event_document->>'schema_version','1.0.0')='run-runtime-event@2.0.0'
      and new.event_type not in ('run.tool_started','run.tool_completed','run.tool_failed','run.agent_status'))
  then raise exception using errcode='22023',message='DA_RUN_EVENT_SCHEMA_VERSION_INVALID'; end if;

  if new.event_type not in (
    'run.accepted',
    'run.leased',
    'run.checkpointed',
    'run.side_effect_committed',
    'run.progress',
    'run.tool_started',
    'run.tool_completed',
    'run.tool_failed',
    'run.answer_delta',
    'run.reasoning_started',
    'run.reasoning_delta',
    'run.reasoning_completed',
    'run.agent_status',
    'run.suspended',
    'run.resumed',
    'run.retry_scheduled',
    'run.cancel_requested',
    'run.completed',
    'run.failed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TYPE_INVALID';
  end if;
  if new.event_type = 'run.accepted'
    and (new.sequence <> 1 or new.worker_fence <> 0)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_ACCEPTED_EVENT_INVALID';
  end if;
  if current_user = 'data_agent_backend'
    and new.event_type <> 'run.accepted'
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_DIRECT_WRITE_FORBIDDEN';
  end if;

  if new.event_hash is null then
    new.event_hash :=
      app_data_agent.runtime_canonical_sha256(new.event_document);
  end if;
  if new.event_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_INVALID';
  end if;
  if new.event_hash <>
    app_data_agent.runtime_canonical_sha256(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  return new;
end
$$;
create or replace function app_data_agent.append_run_event(
  requested_lease jsonb,
  requested_event jsonb,
  requested_event_hash text,
  expected_projection_hash text,
  requested_projection jsonb,
  requested_projection_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  target_run app_data_agent.runs%rowtype;
  current_projection app_data_agent.run_projections%rowtype;
  existing_event app_data_agent.run_events%rowtype;
  active_attempt app_data_agent.run_attempts%rowtype;
  requested_event_id uuid;
  requested_run_id uuid;
  requested_outbox_id uuid;
  requested_attempt_id uuid;
  lease_command_id uuid;
  requested_worker_id text;
  expected_lease_token bigint;
  lease_run_id uuid;
  lease_worker_fence bigint;
  requested_sequence bigint;
  requested_worker_fence bigint;
  requested_dedupe_key text;
  requested_event_type text;
  requested_occurred_at timestamptz;
  requested_command_id uuid;
  requested_projection_status text;
  requested_projection_version bigint;
  requested_projection_fence bigint;
  requested_error_code text;
  requested_retry_delay_ms bigint;
  active_delivery_attempt_no integer;
  scheduled_retry_at timestamptz;
  required_status text;
  active_message_lease_expires_at timestamptz;
  now_at timestamptz;
begin
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) <> 'object'
    or pg_catalog.jsonb_typeof(requested_lease -> 'scope') <> 'object'
    or requested_event is null
    or requested_projection is null
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection) <> 'object'
    or requested_event_hash is null
    or requested_event_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_projection_hash is null
    or requested_projection_hash !~ '^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_lease - 'lease_token'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_event)
    or app_data_agent.contains_potential_plaintext_secret(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
  end if;
  if requested_event_hash <>
    app_data_agent.runtime_canonical_sha256(requested_event)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  if requested_projection_hash <>
    app_data_agent.runtime_canonical_sha256(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_HASH_MISMATCH';
  end if;
  if requested_event ->> 'schema_version' not in ('1.0.0','run-runtime-event@2.0.0')
    or (requested_event ->> 'schema_version'='run-runtime-event@2.0.0'
      and requested_event ->> 'event_type' not in ('run.tool_started','run.tool_completed','run.tool_failed','run.agent_status'))
    or requested_projection ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(requested_event -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection -> 'scope') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
  end if;

  begin
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    lease_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    expected_lease_token := (requested_lease ->> 'lease_token')::bigint;
    lease_run_id := (requested_lease ->> 'run_id')::uuid;
    lease_worker_fence := (requested_lease ->> 'worker_fence')::bigint;
    requested_event_id := (requested_event ->> 'event_id')::uuid;
    requested_run_id := (requested_event ->> 'run_id')::uuid;
    requested_sequence := (requested_event ->> 'sequence')::bigint;
    requested_worker_fence := (requested_event ->> 'worker_fence')::bigint;
    requested_dedupe_key := requested_event ->> 'idempotency_key';
    requested_event_type := requested_event ->> 'event_type';
    requested_occurred_at := (requested_event ->> 'occurred_at')::timestamptz;
    requested_projection_version :=
      (requested_projection ->> 'version')::bigint;
    requested_projection_fence :=
      (requested_projection ->> 'worker_fence')::bigint;
    requested_projection_status := requested_projection ->> 'status';
    if requested_event -> 'payload' ? 'command_id' then
      requested_command_id :=
        (requested_event -> 'payload' ->> 'command_id')::uuid;
    end if;
    if requested_event ->> 'event_type' in (
      'run.retry_scheduled',
      'run.failed'
    ) then
      requested_error_code :=
        requested_event -> 'payload' ->> 'error_code';
    end if;
    if requested_event ->> 'event_type' = 'run.retry_scheduled' then
      requested_retry_delay_ms :=
        (requested_event -> 'payload' ->> 'retry_delay_ms')::bigint;
    end if;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_EVENT_INPUT_INVALID';
  end;

  if requested_sequence < 1
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or expected_lease_token < 1
    or lease_run_id <> requested_run_id
    or lease_worker_fence <> requested_worker_fence
    or requested_lease -> 'scope' is distinct from requested_event -> 'scope'
    or requested_worker_fence < 0
    or requested_dedupe_key is null
    or pg_catalog.length(requested_dedupe_key) not between 1 and 256
    or requested_event ->> 'occurred_at' <>
      app_data_agent.runtime_iso_timestamp(requested_occurred_at)
    or requested_event_type not in (
      'run.leased',
      'run.checkpointed',
      'run.side_effect_committed',
      'run.progress',
          'run.tool_started',
          'run.tool_completed',
          'run.tool_failed',
          'run.answer_delta',
          'run.reasoning_started',
          'run.reasoning_delta',
          'run.reasoning_completed',
          'run.agent_status',
      'run.suspended',
      'run.retry_scheduled',
      'run.completed',
      'run.failed'
    )
    or requested_projection_status not in (
      'QUEUED',
      'RUNNING',
      'WAITING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
    or requested_projection_version <> requested_sequence
    or requested_projection_fence <> requested_worker_fence
    or requested_projection ->> 'run_id' <> requested_run_id::text
    or requested_projection ->> 'last_event_id' <> requested_event_id::text
    or requested_event -> 'scope' ->> 'app_id'
      is distinct from requested_projection -> 'scope' ->> 'app_id'
    or requested_event -> 'scope' ->> 'tenant_id'
      is distinct from requested_projection -> 'scope' ->> 'tenant_id'
    or requested_event -> 'scope' ->> 'environment'
      is distinct from requested_projection -> 'scope' ->> 'environment'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_event -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_event -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_event -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_SCOPE_FORBIDDEN';
  end if;

  select run.*
  into target_run
  from app_data_agent.runs as run
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.principal_id = current_authority.principal_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;

  select event.*
  into existing_event
  from app_data_agent.run_events as event
  where event.app_id = current_authority.app_id
    and event.tenant_id = current_authority.tenant_id
    and event.environment = current_authority.environment
    and event.run_id = requested_run_id
    and event.dedupe_key = requested_dedupe_key;
  if found then
    if not exists (
      select 1
      from app_data_agent.run_attempts as replay_attempt
      where replay_attempt.app_id = current_authority.app_id
        and replay_attempt.tenant_id = current_authority.tenant_id
        and replay_attempt.environment = current_authority.environment
        and replay_attempt.run_id = requested_run_id
        and replay_attempt.outbox_id = requested_outbox_id
        and replay_attempt.attempt_id = requested_attempt_id
        and replay_attempt.command_id = lease_command_id
        and replay_attempt.worker_id = requested_worker_id
        and replay_attempt.lease_token = expected_lease_token
        and replay_attempt.worker_fence = requested_worker_fence
    ) then
      raise exception using
        errcode = '40001',
        message = 'DA_RUN_EVENT_LEASE_STALE';
    end if;
    if existing_event.attempt_id is distinct from requested_attempt_id
      or existing_event.event_id <> requested_event_id
      or existing_event.event_hash <> requested_event_hash
      or existing_event.event_document <> requested_event
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    select projection.*
    into current_projection
    from app_data_agent.run_projections as projection
    where projection.app_id = current_authority.app_id
      and projection.tenant_id = current_authority.tenant_id
      and projection.environment = current_authority.environment
      and projection.run_id = requested_run_id
    order by projection.version desc
    limit 1;
    return pg_catalog.jsonb_build_object(
      'replayed',
      true,
      'event',
      existing_event.event_document,
      'event_hash',
      existing_event.event_hash,
      'projection',
      current_projection.projection_json,
      'projection_hash',
      current_projection.projection_hash
    );
  end if;

  select projection.*
  into current_projection
  from app_data_agent.run_projections as projection
  where projection.app_id = current_authority.app_id
    and projection.tenant_id = current_authority.tenant_id
    and projection.environment = current_authority.environment
    and projection.run_id = requested_run_id
  order by projection.version desc
  limit 1
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_PROJECTION_NOT_FOUND';
  end if;
  if expected_projection_hash is null
    or current_projection.projection_hash <> expected_projection_hash
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_PROJECTION_CONFLICT';
  end if;
  if requested_sequence <> current_projection.version + 1 then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_SEQUENCE_INVALID';
  end if;
  if target_run.active_fence <> requested_worker_fence then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_FENCE_STALE';
  end if;
  if current_projection.projection_json ->> 'terminal_event_id' is not null then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_AFTER_TERMINAL';
  end if;
  if requested_projection <>
    app_data_agent.reduce_run_projection_document(
      current_projection.projection_json,
      requested_event
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_SEMANTIC_MISMATCH';
  end if;

  select attempt.*
  into active_attempt
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.run_id = attempt.run_id
   and message.outbox_id = attempt.outbox_id
   and message.command_id = attempt.command_id
   and message.active_attempt_id = attempt.attempt_id
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.run_id = requested_run_id
    and attempt.outbox_id = requested_outbox_id
    and attempt.attempt_id = requested_attempt_id
    and attempt.command_id = lease_command_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = requested_worker_fence
  for update of attempt, message;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.lease_expires_at
  into active_message_lease_expires_at
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;
  now_at := pg_catalog.clock_timestamp();
  if active_attempt.lease_expires_at < now_at
    or active_message_lease_expires_at < now_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.attempt_count
  into active_delivery_attempt_no
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;

  case requested_event_type
    when 'run.leased' then
      if current_projection.status not in ('QUEUED', 'RUNNING')
        or requested_worker_fence <= current_projection.worker_fence
        or (requested_event -> 'payload' ->> 'worker_id')
          is distinct from active_attempt.worker_id
        or (requested_event -> 'payload' ->> 'lease_id')
          is distinct from active_attempt.attempt_id::text
        or (requested_event -> 'payload' ->> 'attempt')::integer
          is distinct from active_attempt.attempt_no
        or requested_command_id is distinct from active_attempt.command_id
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.checkpointed' then
      begin
        perform 1
        from app_data_agent.run_checkpoints as checkpoint
        where checkpoint.app_id = current_authority.app_id
          and checkpoint.tenant_id = current_authority.tenant_id
          and checkpoint.environment = current_authority.environment
          and checkpoint.run_id = requested_run_id
          and checkpoint.attempt_id = active_attempt.attempt_id
          and checkpoint.snapshot_id =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_id')::uuid
          and checkpoint.snapshot_version =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_version')::integer
          and checkpoint.snapshot_hash =
            requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_hash'
          and checkpoint.worker_fence = requested_worker_fence
          and checkpoint.event_sequence = current_projection.version
          and requested_event -> 'payload' -> 'active_artifact_ref'
            is not distinct from
              checkpoint.binding_json -> 'active_artifact_ref'
          and (
            checkpoint.binding_json -> 'active_artifact_ref' = 'null'::jsonb
            or exists (
              select 1
              from app_data_agent.artifacts as artifact
              where artifact.app_id = checkpoint.app_id
                and artifact.tenant_id = checkpoint.tenant_id
                and artifact.environment = checkpoint.environment
                and artifact.run_id = checkpoint.run_id
                and artifact.artifact_id =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_id')::uuid
                and artifact.artifact_type =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_type'
                and artifact.revision =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'revision')::integer
                and artifact.content_hash =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'content_hash'
                and artifact.is_active
            )
          );
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.side_effect_committed' then
      begin
        perform 1
        from app_data_agent.run_effect_receipts as receipt
        where receipt.app_id = current_authority.app_id
          and receipt.tenant_id = current_authority.tenant_id
          and receipt.environment = current_authority.environment
          and receipt.run_id = requested_run_id
          and receipt.receipt_id =
            (requested_event -> 'payload' ->> 'receipt_id')::uuid
          and receipt.effect_kind =
            requested_event -> 'payload' ->> 'effect_kind'
          and receipt.input_hash =
            requested_event -> 'payload' ->> 'input_hash'
          and receipt.output_hash =
            requested_event -> 'payload' ->> 'output_hash';
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.progress',
      'run.tool_started',
      'run.tool_completed',
      'run.tool_failed',
      'run.answer_delta',
      'run.reasoning_started',
      'run.reasoning_delta',
      'run.reasoning_completed',
      'run.agent_status' then
      required_status := 'RUNNING';
    when 'run.suspended' then
      required_status := 'WAITING';
    when 'run.retry_scheduled' then
      if requested_command_id is distinct from active_attempt.command_id
        or active_delivery_attempt_no >= 5
        or requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retry_delay_ms'
        ) <> 'number'
        or requested_event -> 'payload' ->> 'retry_delay_ms'
          !~ '^(0|[1-9][0-9]{0,7})$'
        or requested_retry_delay_ms not between 1000 and 86400000
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      scheduled_retry_at := now_at + pg_catalog.make_interval(
        secs => requested_retry_delay_ms::double precision / 1000.0
      );
      required_status := 'QUEUED';
    when 'run.completed' then
      required_status := 'COMPLETED';
    when 'run.failed' then
      if requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retryable'
        ) <> 'boolean'
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'FAILED';
  end case;

  if requested_event_type <> 'run.leased'
    and (
      current_projection.status <> 'RUNNING'
      or requested_worker_fence <> current_projection.worker_fence
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TRANSITION_INVALID';
  end if;
  if requested_projection_status <> required_status then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

  insert into app_data_agent.run_events (
    app_id,
    tenant_id,
    environment,
    event_id,
    run_id,
    sequence,
    event_type,
    payload_json,
    attempt_id,
    command_id,
    dedupe_key,
    event_hash,
    worker_fence,
    event_document,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_event_id,
    requested_run_id,
    requested_sequence,
    requested_event_type,
    requested_event -> 'payload',
    active_attempt.attempt_id,
    requested_command_id,
    requested_dedupe_key,
    requested_event_hash,
    requested_worker_fence,
    requested_event,
    requested_occurred_at
  );

  insert into app_data_agent.run_projections (
    app_id,
    tenant_id,
    environment,
    run_id,
    version,
    status,
    worker_fence,
    event_id,
    projection_hash,
    projection_json,
    occurred_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_run_id,
    requested_sequence,
    requested_projection_status,
    requested_worker_fence,
    requested_event_id,
    requested_projection_hash,
    requested_projection,
    requested_occurred_at
  );

  if requested_event_type = 'run.suspended' then
    update app_data_agent.run_attempts as suspended_attempt
    set status = 'SUSPENDED',
        finished_at = now_at
    where suspended_attempt.app_id = current_authority.app_id
      and suspended_attempt.tenant_id = current_authority.tenant_id
      and suspended_attempt.environment = current_authority.environment
      and suspended_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as suspended_message
    set status = 'PUBLISHED',
        published_at = now_at,
        lease_owner = null,
        lease_expires_at = null
    where suspended_message.app_id = current_authority.app_id
      and suspended_message.tenant_id = current_authority.tenant_id
      and suspended_message.environment = current_authority.environment
      and suspended_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as suspended_command
    set status = 'SUCCEEDED'
    where suspended_command.app_id = current_authority.app_id
      and suspended_command.tenant_id = current_authority.tenant_id
      and suspended_command.environment = current_authority.environment
      and suspended_command.command_id = active_attempt.command_id
      and suspended_command.status = 'PROCESSING';

    update app_data_agent.runs as suspended_run
    set status = 'WAITING',
        updated_at = now_at
    where suspended_run.app_id = current_authority.app_id
      and suspended_run.tenant_id = current_authority.tenant_id
      and suspended_run.environment = current_authority.environment
      and suspended_run.run_id = requested_run_id;
  elsif requested_event_type = 'run.retry_scheduled' then
    update app_data_agent.run_attempts as retry_attempt
    set status = 'RETRY_SCHEDULED',
        error_code = requested_error_code,
        retry_at = scheduled_retry_at,
        finished_at = now_at
    where retry_attempt.app_id = current_authority.app_id
      and retry_attempt.tenant_id = current_authority.tenant_id
      and retry_attempt.environment = current_authority.environment
      and retry_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as retry_message
    set status = 'PENDING',
        available_at = scheduled_retry_at,
        lease_owner = null,
        lease_expires_at = null,
        published_at = null
    where retry_message.app_id = current_authority.app_id
      and retry_message.tenant_id = current_authority.tenant_id
      and retry_message.environment = current_authority.environment
      and retry_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.runs as retry_run
    set status = 'QUEUED',
        updated_at = now_at
    where retry_run.app_id = current_authority.app_id
      and retry_run.tenant_id = current_authority.tenant_id
      and retry_run.environment = current_authority.environment
      and retry_run.run_id = requested_run_id;
  elsif requested_event_type in ('run.completed', 'run.failed') then
    update app_data_agent.run_attempts as terminal_attempt
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        error_code = case requested_event_type
          when 'run.failed' then requested_error_code
          else null
        end,
        finished_at = now_at
    where terminal_attempt.app_id = current_authority.app_id
      and terminal_attempt.tenant_id = current_authority.tenant_id
      and terminal_attempt.environment = current_authority.environment
      and terminal_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as terminal_message
    set status = case requested_event_type
          when 'run.completed' then 'PUBLISHED'
          else 'DEAD_LETTER'
        end,
        published_at = case requested_event_type
          when 'run.completed' then now_at
          else null
        end,
        lease_owner = null,
        lease_expires_at = null
    where terminal_message.app_id = current_authority.app_id
      and terminal_message.tenant_id = current_authority.tenant_id
      and terminal_message.environment = current_authority.environment
      and terminal_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as terminal_command
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end
    where terminal_command.app_id = current_authority.app_id
      and terminal_command.tenant_id = current_authority.tenant_id
      and terminal_command.environment = current_authority.environment
      and terminal_command.command_id = active_attempt.command_id
      and terminal_command.status = 'PROCESSING';

    update app_data_agent.runs as terminal_run
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        updated_at = now_at
    where terminal_run.app_id = current_authority.app_id
      and terminal_run.tenant_id = current_authority.tenant_id
      and terminal_run.environment = current_authority.environment
      and terminal_run.run_id = requested_run_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'event',
    requested_event,
    'event_hash',
    requested_event_hash,
    'projection',
    requested_projection,
    'projection_hash',
    requested_projection_hash
  );
end
$$;


create function app_data_agent.validate_public_run_v2_event_insert()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.event_document->>'schema_version'='run-runtime-event@2.0.0'
    and not app_data_agent.public_run_v2_payload_is_valid(
      new.event_type,new.payload_json,new.event_document->'scope',new.run_id)
  then raise exception using errcode='22023',message='DA_RUN_PUBLIC_V2_EVENT_INVALID'; end if;
  return new;
end
$function$;

drop trigger if exists run_event_v2_contract on app_data_agent.run_events;
create trigger run_event_v2_contract before insert on app_data_agent.run_events
for each row execute function app_data_agent.validate_public_run_v2_event_insert();

revoke all on function app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.validate_public_run_v2_event_insert()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010671_app_data_agent_public_agent_events','sha256:c052fbeef90973b50d671e76d11da8bfcf8c415a2c1c07feb976e5d09c43c909');
commit;
