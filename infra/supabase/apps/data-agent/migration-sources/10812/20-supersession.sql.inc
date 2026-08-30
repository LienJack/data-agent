do $fence$
declare source_definition text;target_definition text;
  source_clause constant text:='old.next_turn_ordinal=0 and new.next_turn_ordinal=0';
  target_clause constant text:='old.next_turn_ordinal between 0 and 14 and new.next_turn_ordinal=old.next_turn_ordinal';
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.falcon24_four_layer_attempt_state_fence()'::regprocedure)
    into strict source_definition;
  if pg_catalog.strpos(source_definition,source_clause)=0
    or pg_catalog.strpos(pg_catalog.substr(source_definition,
      pg_catalog.strpos(source_definition,source_clause)+pg_catalog.length(source_clause)),source_clause)>0
  then raise exception using errcode='P0001',message='FALCON24_PARTIAL_SUPERSESSION_SOURCE_MISMATCH'; end if;
  target_definition:=pg_catalog.replace(source_definition,source_clause,target_clause);
  execute target_definition;
end
$fence$;

create or replace function app_data_agent.supersede_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  planned_turn_count integer;passed_turn_count integer;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','expected_attempt_version','reason_code','command_hash'
    ]::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-four-layer-attempt-supersede@1.0.0'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or (command->>'expected_attempt_version'~'^[1-9][0-9]*$') is distinct from true
    or command->>'reason_code' is distinct from 'FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||(command->>'attempt_id'),0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if not found then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;

  select pg_catalog.count(*)::integer into strict passed_turn_count
    from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.principal_id=attempt.principal_id
      and row.attempt_id=attempt.attempt_id and row.turn_ordinal<attempt.next_turn_ordinal
      and row.status='PASSED' and row.conversation_id is not null
      and row.conversation_resource_version is not null and row.run_id is not null
      and row.claim_command_hash is not null and row.claimed_at is not null and row.completed_at is not null
      and row.business_receipt_hash is not null and row.business_receipt->>'status'='PASS'
      and row.qa_ui_receipt_hash is not null and row.qa_ui_receipt->>'status'='PASS'
      and row.trace_ui_receipt_hash is not null and row.trace_ui_receipt->>'status'='PASS'
      and row.terminal_receipt_hash is not null and row.terminal_receipt->>'status'='PASS'
      and exists(select 1 from app_data_agent.runs run
        where run.app_id=row.app_id and run.tenant_id=row.tenant_id
          and run.environment=row.environment and run.principal_id=row.principal_id
          and run.run_id=row.run_id and run.status='SUCCEEDED');
  select pg_catalog.count(*)::integer into strict planned_turn_count
    from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.principal_id=attempt.principal_id
      and row.attempt_id=attempt.attempt_id and row.turn_ordinal>=attempt.next_turn_ordinal
      and row.status='PLANNED' and row.conversation_id is null and row.conversation_resource_version is null
      and row.run_id is null and row.claim_command_hash is null
      and row.business_receipt is null and row.qa_ui_receipt is null
      and row.trace_ui_receipt is null and row.terminal_receipt is null
      and row.claimed_at is null and row.completed_at is null;
  if attempt.status<>'READY' or attempt.next_turn_ordinal not between 0 and 14
    or attempt.current_layer<>(case when attempt.next_turn_ordinal<5 then 'L1'
      when attempt.next_turn_ordinal<7 then 'L2' when attempt.next_turn_ordinal<9 then 'L3' else 'L4' end)
    or attempt.first_failure_code is not null or attempt.terminal_receipt is not null
    or passed_turn_count<>attempt.next_turn_ordinal
    or planned_turn_count<>15-attempt.next_turn_ordinal
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_SUPERSEDE_INVALID'; end if;

  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_attempts set status='FAILED',
    first_failure_code='FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED',
    updated_at=now_at,attempt_version=attempt_version+1
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and principal_id=attempt.principal_id
    and attempt_id=attempt.attempt_id and status='READY' and attempt_version=attempt.attempt_version
  returning * into strict attempt;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
alter function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;
grant execute on function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  to data_agent_backend;
