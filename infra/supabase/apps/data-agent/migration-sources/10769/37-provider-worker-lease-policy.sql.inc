create or replace function app_data_agent.assert_provider_active_worker_lease(
  requested_lease jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  locked_fence bigint;
  attempt_record app_data_agent.run_attempts%rowtype;
  requested_run_id uuid;
  requested_attempt_id uuid;
  requested_outbox_id uuid;
  requested_command_id uuid;
  requested_worker_id text;
  requested_lease_token bigint;
  requested_worker_fence bigint;
  requested_attempt_no bigint;
  requested_delivery_attempt_no bigint;
  requested_lease_duration_ms bigint;
  requested_expires_at timestamptz;
  authoritative_policy jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
      'scope','principal_id','outbox_id','run_id','command_id','command_kind','attempt_id',
      'attempt_no','delivery_attempt_no','lease_duration_ms','worker_id','lease_token',
      'worker_fence','expires_at','execution_policy','payload']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(
      requested_lease->'scope',array['app_id','tenant_id','environment']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(requested_lease->'principal_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'outbox_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'command_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'command_kind') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'attempt_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'attempt_no') is distinct from 'number'
    or pg_catalog.jsonb_typeof(requested_lease->'delivery_attempt_no') is distinct from 'number'
    or pg_catalog.jsonb_typeof(requested_lease->'lease_duration_ms') is distinct from 'number'
    or pg_catalog.jsonb_typeof(requested_lease->'worker_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'lease_token') is distinct from 'number'
    or pg_catalog.jsonb_typeof(requested_lease->'worker_fence') is distinct from 'number'
    or pg_catalog.jsonb_typeof(requested_lease->'expires_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_lease->'execution_policy') is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_lease->'payload') is distinct from 'object'
    or requested_lease->>'command_kind' not in('START_DATA_AGENT_TEAM','START_L2_RESEARCH')
    or requested_lease->>'command_kind' is distinct from requested_lease#>>'{payload,kind}'
    or app_data_agent.command_payload_is_valid(requested_lease->'payload') is distinct from true
    or app_data_agent.contains_potential_plaintext_secret(requested_lease->'payload')
    or requested_lease->>'expires_at'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  then
    raise exception using errcode='22023',message='PROVIDER_WORKER_LEASE_INVALID';
  end if;
  begin
    requested_run_id:=(requested_lease->>'run_id')::uuid;
    requested_attempt_id:=(requested_lease->>'attempt_id')::uuid;
    requested_outbox_id:=(requested_lease->>'outbox_id')::uuid;
    requested_command_id:=(requested_lease->>'command_id')::uuid;
    requested_worker_id:=requested_lease->>'worker_id';
    requested_lease_token:=(requested_lease->>'lease_token')::bigint;
    requested_worker_fence:=(requested_lease->>'worker_fence')::bigint;
    requested_attempt_no:=(requested_lease->>'attempt_no')::bigint;
    requested_delivery_attempt_no:=(requested_lease->>'delivery_attempt_no')::bigint;
    requested_lease_duration_ms:=(requested_lease->>'lease_duration_ms')::bigint;
    requested_expires_at:=(requested_lease->>'expires_at')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='PROVIDER_WORKER_LEASE_INVALID';
  end;
  if requested_run_id::text is distinct from requested_lease->>'run_id'
    or requested_attempt_id::text is distinct from requested_lease->>'attempt_id'
    or requested_outbox_id::text is distinct from requested_lease->>'outbox_id'
    or requested_command_id::text is distinct from requested_lease->>'command_id'
    or requested_worker_id is null
    or requested_worker_id!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_token not between 1 and 9007199254740991
    or requested_worker_fence not between 1 and 9007199254740991
    or requested_attempt_no not between 1 and 9007199254740991
    or requested_delivery_attempt_no not between 1 and 9007199254740991
    or requested_lease_duration_ms not between 5000 and 900000
    or requested_expires_at is null
  then
    raise exception using errcode='22023',message='PROVIDER_WORKER_LEASE_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_lease#>>'{scope,app_id}' is distinct from authority.app_id::text
    or requested_lease#>>'{scope,tenant_id}' is distinct from authority.tenant_id::text
    or requested_lease#>>'{scope,environment}' is distinct from authority.environment
    or requested_lease->>'principal_id' is distinct from authority.principal_id::text
  then
    raise exception using errcode='42501',message='PROVIDER_WORKER_LEASE_NOT_OWNED';
  end if;

  authoritative_policy:=app_data_agent.resolve_falcon24_run_execution_policy(requested_run_id);
  if authoritative_policy is null then
    authoritative_policy:=pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,
      'case_id',null,
      'run_variant',null,
      'repetition',null,
      'policy_id','default-run-retry@1.0.0',
      'mode','DEFAULT',
      'max_run_attempts',5,
      'max_provider_attempts_per_call',2,
      'max_root_turns',2,
      'max_text2sql_candidate_attempts',2,
      'analysis_repair_budget_per_category',1,
      'max_file_transfer_attempts',5,
      'allow_stage_recovery',true,
      'hold_on_failure',false);
  end if;
  if requested_lease->'execution_policy' is distinct from authoritative_policy then
    raise exception using errcode='55000',message='RUN_EXECUTION_POLICY_CORRUPT';
  end if;

  locked_fence:=app_data_agent.lock_owned_run_fence(requested_run_id);
  if locked_fence is null or locked_fence<>requested_worker_fence then
    raise exception using errcode='40001',message='PROVIDER_WORKER_LEASE_STALE';
  end if;
  select attempt.* into attempt_record
  from app_data_agent.run_attempts attempt
  join app_data_agent.outbox message
    on message.app_id=attempt.app_id
    and message.tenant_id=attempt.tenant_id
    and message.environment=attempt.environment
    and message.outbox_id=attempt.outbox_id
    and message.run_id=attempt.run_id
    and message.command_id=attempt.command_id
  join app_data_agent.commands command
    on command.app_id=message.app_id
    and command.tenant_id=message.tenant_id
    and command.environment=message.environment
    and command.command_id=message.command_id
    and command.run_id=message.run_id
  where attempt.app_id=authority.app_id
    and attempt.tenant_id=authority.tenant_id
    and attempt.environment=authority.environment
    and attempt.run_id=requested_run_id
    and attempt.attempt_id=requested_attempt_id
    and attempt.attempt_no=requested_attempt_no
    and attempt.outbox_id=requested_outbox_id
    and attempt.command_id=requested_command_id
    and attempt.worker_id=requested_worker_id
    and attempt.lease_token=requested_lease_token
    and attempt.worker_fence=requested_worker_fence
    and attempt.status='ACTIVE'
    and attempt.lease_expires_at>pg_catalog.clock_timestamp()
    and message.status='LEASED'
    and message.active_attempt_id=requested_attempt_id
    and message.attempt_count=requested_delivery_attempt_no
    and message.lease_owner=requested_worker_id
    and message.lease_token=requested_lease_token
    and message.run_fence=requested_worker_fence
    and message.lease_expires_at>pg_catalog.clock_timestamp()
    and command.payload_json=requested_lease->'payload'
    and command.payload_json->>'kind'=requested_lease->>'command_kind'
    and pg_catalog.date_part('epoch',
      message.lease_expires_at-message.last_heartbeat_at)*1000=requested_lease_duration_ms
  for update of attempt,message;
  if not found then
    raise exception using errcode='40001',message='PROVIDER_WORKER_LEASE_STALE';
  end if;
  return pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,
    'tenant_id',authority.tenant_id,
    'environment',authority.environment,
    'deployment_id',authority.deployment_id,
    'workspace_id',authority.tenant_id,
    'principal_id',authority.principal_id,
    'run_id',attempt_record.run_id,
    'attempt_id',attempt_record.attempt_id,
    'attempt_no',attempt_record.attempt_no,
    'outbox_id',attempt_record.outbox_id,
    'command_id',attempt_record.command_id,
    'worker_id',attempt_record.worker_id,
    'lease_token',attempt_record.lease_token,
    'worker_fence',attempt_record.worker_fence);
end
$function$;

drop function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb);
