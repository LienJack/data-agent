create function app_data_agent.falcon24_qualification_repair_evidence_present(
  requested_run_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare authority record; detected boolean;
begin
  select * into strict authority from platform.current_backend_authority(false);
  with recursive documents(document) as (
    select event.payload_json from app_data_agent.run_events event
      where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
        and event.environment=authority.environment and event.run_id=requested_run_id
    union all
    select artifact.document_json from app_data_agent.artifacts artifact
      where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
        and artifact.environment=authority.environment and artifact.run_id=requested_run_id
  ), walk(value) as (
    select document from documents
    union all
    select child.value from walk parent
    cross join lateral (
      select object_value value
      from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(parent.value)='object'
        then parent.value else '{}'::jsonb end) object_entry(object_key,object_value)
      union all
      select array_value value
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(parent.value)='array'
        then parent.value else '[]'::jsonb end) array_entry(array_value)
    ) child
  )
  select pg_catalog.coalesce(pg_catalog.bool_or(
      (pg_catalog.jsonb_typeof(value)='string'
        and value#>>'{}' like 'provider:text2sql:repair:%')
      or (pg_catalog.jsonb_typeof(value)='object' and value ? 'repair_attempts'
        and pg_catalog.jsonb_typeof(value->'repair_attempts')='object'
        and exists(select 1 from pg_catalog.jsonb_each(value->'repair_attempts') attempt
          where pg_catalog.jsonb_typeof(attempt.value)='number'
            and (attempt.value#>>'{}')::numeric>0))),false)
    into strict detected from walk;
  if detected then return true; end if;
  if pg_catalog.to_regclass('app_data_agent.provider_invocation_intents') is not null then
    execute $query$
      select exists(select 1 from app_data_agent.provider_invocation_intents intent
        where intent.app_id=$1 and intent.tenant_id=$2 and intent.environment=$3
          and intent.principal_id=$4 and intent.run_id=$5
          and (intent.idempotency_key like '%text2sql%repair%'
            or intent.intent_json::text like '%provider:text2sql:repair:%'))
    $query$ into strict detected using authority.app_id,authority.tenant_id,
      authority.environment,authority.principal_id,requested_run_id;
  end if;
  return pg_catalog.coalesce(detected,false);
end
$function$;

create function app_data_agent.complete_falcon24_qualification_slot(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; now_at timestamptz;
  execution_policy jsonb; attempt_count bigint; succeeded_attempt_count bigint;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','expected_result_hash',
      'sandbox_reclamation_hash','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-slot-complete@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'expected_result_hash') is distinct from 'string'
    or command->>'expected_result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_SLOT_NOT_FOUND'; end if;
  if slot.status='VERIFIED' then
    if slot.result_hash<>command->>'expected_result_hash'
      or slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or slot.trace_gate_receipt is null or slot.ui_trace_gate_receipt is null
      or slot.sandbox_reclamation_receipt is null
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(qualification);
  end if;
  if qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or qualification.next_slot_ordinal<>slot.ordinal
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.claim_fence_consumed_at is null or slot.result_hash is null
    or slot.result_document is null or slot.trace_closure_hash is null
    or slot.trace_gate_receipt_hash is null or slot.trace_gate_receipt is null
    or slot.ui_trace_gate_receipt_hash is null or slot.ui_trace_gate_receipt is null
    or slot.sandbox_reclamation_claim_hash is null
    or slot.sandbox_reclamation_claim_consumed_at is null
    or slot.sandbox_reclamation_hash is null or slot.sandbox_reclamation_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if slot.result_hash<>command->>'expected_result_hash'
    or slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  execution_policy:=app_data_agent.resolve_falcon24_run_execution_policy(slot.run_id);
  if execution_policy is null
    or execution_policy->>'acceptance_authority_kind' is distinct from 'QUALIFICATION'
    or execution_policy->>'campaign_id' is distinct from qualification.qualification_id
    or execution_policy->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or execution_policy->>'mode' is distinct from 'FALCON24_STRICT'
    or execution_policy->>'max_run_attempts' is distinct from '1'
    or execution_policy->>'max_provider_attempts_per_call' is distinct from '1'
    or execution_policy->>'max_root_turns' is distinct from '1'
    or execution_policy->>'max_text2sql_candidate_attempts' is distinct from '1'
    or execution_policy->>'analysis_repair_budget_per_category' is distinct from '0'
    or execution_policy->>'max_file_transfer_attempts' is distinct from '1'
    or execution_policy->>'allow_stage_recovery' is distinct from 'false'
    or execution_policy->>'hold_on_failure' is distinct from 'true'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  select pg_catalog.count(*),pg_catalog.count(*) filter(
      where attempt.attempt_no=1 and attempt.status='SUCCEEDED')
    into strict attempt_count,succeeded_attempt_count
    from app_data_agent.run_attempts attempt
    where attempt.app_id=authority.app_id and attempt.tenant_id=authority.tenant_id
      and attempt.environment=authority.environment and attempt.run_id=slot.run_id;
  if attempt_count<>1 or succeeded_attempt_count<>1
    or exists(select 1 from app_data_agent.run_events event
      where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
        and event.environment=authority.environment and event.run_id=slot.run_id
        and event.event_type='run.retry_scheduled')
    or app_data_agent.falcon24_qualification_repair_evidence_present(slot.run_id)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='VERIFIED',completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and run_id=slot.run_id and status='CLAIMED' returning * into strict slot;
  update app_data_agent.falcon24_qualifications set
    next_slot_ordinal=slot.ordinal+1,
    status=case when slot.ordinal=15 then 'PASSED' else 'READY' end,updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status='RUNNING'
      and next_slot_ordinal=slot.ordinal returning * into strict qualification;
  return pg_catalog.to_jsonb(qualification);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMPLETION_INVALID';
end
$function$;
