-- falcon24_trace_gate_authority_migration_checksum: sha256:871d01f306554396da549f1287ab183e63118cb097e23abb001eb3656baa3cd7
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_TRACE_GATE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_TRACE_GATE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010768_app_data_agent_governed_analysis_profile_v2')
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_BASELINE_10768_MISSING'; end if;
  if pg_catalog.to_regclass('app_data_agent.falcon24_acceptance_campaign_runs') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_BASELINE_AUTHORITY_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
lock table app_data_agent.falcon24_acceptance_campaign_runs in access exclusive mode;

do $history_preflight$
begin
  if exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.status='VERIFIED' or run.trace_closure_hash is not null)
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_HISTORY_UNVERIFIABLE'; end if;
end
$history_preflight$;

alter table app_data_agent.falcon24_acceptance_campaign_runs
  drop constraint falcon24_acceptance_campaign_runs_check;

alter table app_data_agent.falcon24_acceptance_campaign_runs
  add column claim_fence_hash text,
  add column claim_fence_consumed_at timestamptz,
  add column trace_gate_receipt_hash text,
  add column trace_gate_receipt jsonb,
  add column sandbox_reclamation_recovery_hash text,
  add column sandbox_reclamation_claim_hash text,
  add column sandbox_reclamation_claimed_at timestamptz,
  add column sandbox_reclamation_claim_expires_at timestamptz,
  add column sandbox_reclamation_claim_consumed_at timestamptz,
  add constraint falcon24_acceptance_campaign_runs_check check(
    run_ordinal between 0 and 29 and repetition between 1 and 3
    and run_variant in('COLD','WARM')
    and case_id in('falcon24-business-review-18m','falcon24-delivery-experience-12m',
      'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
      'falcon24-cohort-retention-m0-m6')
    and (status<>'PLANNED' or (claimed_at is null and claim_fence_hash is null
      and claim_fence_consumed_at is null and trace_closure_hash is null
      and trace_gate_receipt_hash is null and trace_gate_receipt is null
      and result_hash is null and result_document is null
      and sandbox_reclamation_recovery_hash is null
      and sandbox_reclamation_claim_hash is null
      and sandbox_reclamation_claimed_at is null
      and sandbox_reclamation_claim_expires_at is null
      and sandbox_reclamation_claim_consumed_at is null
      and sandbox_reclamation_hash is null and sandbox_reclamation_receipt is null
      and completed_at is null))
    and (status='PLANNED' or claimed_at is not null)
    and (status<>'CLAIMED' or (claim_fence_hash is not null and completed_at is null))
    and (status<>'HOLD' or completed_at is not null)
    and (status<>'VERIFIED' or (claim_fence_hash is not null
      and claim_fence_consumed_at is not null and trace_closure_hash is not null
      and trace_gate_receipt_hash is not null and trace_gate_receipt is not null
      and result_hash is not null and result_document is not null
      and sandbox_reclamation_recovery_hash is not null
      and sandbox_reclamation_claim_hash is not null
      and sandbox_reclamation_claimed_at is not null
      and sandbox_reclamation_claim_expires_at is not null
      and sandbox_reclamation_claim_consumed_at is not null
      and sandbox_reclamation_hash is not null and sandbox_reclamation_receipt is not null
      and completed_at is not null))
    and ((trace_closure_hash is null)=(trace_gate_receipt_hash is null))
    and ((trace_gate_receipt_hash is null)=(trace_gate_receipt is null))
    and ((result_hash is null)=(result_document is null))
    and ((sandbox_reclamation_hash is null)=(sandbox_reclamation_receipt is null))
    and ((sandbox_reclamation_recovery_hash is null)=
      (sandbox_reclamation_claim_hash is null))
    and ((sandbox_reclamation_claim_hash is null)=(sandbox_reclamation_claimed_at is null))
    and ((sandbox_reclamation_claim_hash is null)=
      (sandbox_reclamation_claim_expires_at is null))
    and ((sandbox_reclamation_claim_consumed_at is null)=(sandbox_reclamation_hash is null))
    and (sandbox_reclamation_claim_consumed_at is null
      or sandbox_reclamation_claimed_at is not null)
    and (claim_fence_consumed_at is null or claim_fence_hash is not null)
    and (claim_fence_hash is null or claim_fence_hash~'^sha256:[0-9a-f]{64}$')
    and (trace_closure_hash is null or trace_closure_hash~'^sha256:[0-9a-f]{64}$')
    and (trace_gate_receipt_hash is null
      or trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (result_hash is null or result_hash~'^sha256:[0-9a-f]{64}$')
    and (sandbox_reclamation_recovery_hash is null
      or sandbox_reclamation_recovery_hash~'^sha256:[0-9a-f]{64}$')
    and (sandbox_reclamation_claim_hash is null
      or sandbox_reclamation_claim_hash~'^sha256:[0-9a-f]{64}$')
    and (sandbox_reclamation_hash is null
      or sandbox_reclamation_hash~'^sha256:[0-9a-f]{64}$')),
  add constraint falcon24_acceptance_campaign_runs_trace_gate_binding_check check(
    trace_gate_receipt is null or (
      pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and trace_gate_receipt->>'campaign_id'=campaign_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_acceptance_campaign_runs_result_binding_check check(
    result_document is null or result_hash=
      app_data_agent.u2_canonical_sha256(result_document)),
  add constraint falcon24_acceptance_campaign_runs_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or sandbox_reclamation_hash=
      app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash'));

create function app_data_agent.stage_falcon24_acceptance_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','trace_closure_hash',
      'trace_gate_receipt_hash','trace_gate_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt_hash') is distinct from 'string'
    or command->>'trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_TRACE_STAGE_INVALID'; end if;
  receipt:=command->'trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','trace_hash','node_count','edge_count',
      'detail_count','sql_node_count','query_evidence_node_count',
      'analysis_evidence_node_count','chart_node_count','report_node_count',
      'verified_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-gate-receipt@1.0.0'
    or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or pg_catalog.jsonb_typeof(receipt->'trace_hash') is distinct from 'string'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or pg_catalog.jsonb_typeof(receipt->'receipt_hash') is distinct from 'string'
    or receipt->>'receipt_hash' is distinct from command->>'trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or exists(select 1 from pg_catalog.unnest(array[
        'node_count','edge_count','detail_count','sql_node_count',
        'query_evidence_node_count','analysis_evidence_node_count','chart_node_count',
        'report_node_count']::text[]) count_key
      where pg_catalog.jsonb_typeof(receipt->count_key) is distinct from 'number'
        or receipt->>count_key!~'^[1-9][0-9]*$'
        or (receipt->>count_key)::numeric not between 1 and 9007199254740991)
    or receipt->>'detail_count' is distinct from receipt->>'node_count'
    or (receipt->>'node_count')::numeric <
      (receipt->>'sql_node_count')::numeric
      +(receipt->>'query_evidence_node_count')::numeric
      +(receipt->>'analysis_evidence_node_count')::numeric
      +(receipt->>'chart_node_count')::numeric
      +(receipt->>'report_node_count')::numeric
    or pg_catalog.jsonb_typeof(receipt->'verified_at') is distinct from 'string'
    or receipt->>'verified_at'!~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    or (receipt->>'verified_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_TRACE_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  if campaign_run.trace_gate_receipt_hash is not null then
    if campaign_run.trace_closure_hash<>command->>'trace_closure_hash'
      or campaign_run.trace_gate_receipt_hash<>command->>'trace_gate_receipt_hash'
      or campaign_run.trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    trace_closure_hash=command->>'trace_closure_hash',
    trace_gate_receipt_hash=command->>'trace_gate_receipt_hash',trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id and status='CLAIMED'
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_TRACE_STAGE_INVALID';
end
$function$;
create or replace function app_data_agent.claim_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  claimed app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
  normalized_fence_token text; fence_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_ordinal','run_id','case_id','run_variant',
      'repetition','claim_fence_token','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-claim@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_ordinal') is distinct from 'number'
    or command->>'run_ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'run_ordinal')::integer not between 0 and 29
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'case_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_variant') is distinct from 'string'
    or command->>'run_variant' not in('COLD','WARM')
    or pg_catalog.jsonb_typeof(command->'repetition') is distinct from 'number'
    or command->>'repetition'!~'^[1-3]$'
    or pg_catalog.jsonb_typeof(command->'claim_fence_token') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID'; end if;
  normalized_fence_token:=(command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID'; end if;
  fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='HOLD' then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD'; end if;
  if campaign.status<>'READY'
    or campaign.next_run_ordinal<>(command->>'run_ordinal')::integer
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs run
      where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
        and run.environment=authority.environment and run.principal_id=authority.principal_id
        and run.campaign_id=campaign.campaign_id and run.status='CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  select * into claimed from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id
      and run.run_ordinal=(command->>'run_ordinal')::integer for update;
  if not found or claimed.status<>'PLANNED'
    or claimed.run_id is distinct from (command->>'run_id')::uuid
    or claimed.case_id is distinct from command->>'case_id'
    or claimed.run_variant is distinct from command->>'run_variant'
    or claimed.repetition is distinct from (command->>'repetition')::integer
  then raise exception using errcode='55000',message='FALCON24_RUN_SCHEDULE_MISMATCH'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='CLAIMED',claimed_at=now_at,claim_fence_hash=fence_hash,
    claim_fence_consumed_at=null
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=claimed.run_ordinal
      and status='PLANNED'
    returning * into strict claimed;
  update app_data_agent.falcon24_acceptance_campaigns set status='RUNNING',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id;
  return pg_catalog.to_jsonb(claimed);
exception when unique_violation then
  raise exception using errcode='55000',message='FALCON24_RUN_ALREADY_CLAIMED';
when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID';
end
$function$;

create or replace function app_data_agent.hold_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
  actual_run_status text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','failure_layer','failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-hold@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'failure_layer') is distinct from 'string'
    or command->>'failure_layer' not in('ROOT_ROUTING','SQL_DATA_PREPARATION',
      'GOVERNED_OPERATOR','ORACLE','PUBLISHER','SANDBOX_RECLAMATION')
    or pg_catalog.jsonb_typeof(command->'failure_code') is distinct from 'string'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='PASSED' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_ALREADY_PASSED'; end if;
  if campaign.status='HOLD' then
    if campaign.first_failure_run_id is distinct from (command->>'run_id')::uuid
      or campaign.first_failure_layer is distinct from command->>'failure_layer'
      or campaign.first_failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_ordinal=campaign.next_run_ordinal
      and run.run_id=(command->>'run_id')::uuid for update;
  if not found or campaign_run.status not in('PLANNED','CLAIMED')
    or (campaign.status='READY' and campaign_run.status<>'PLANNED')
    or (campaign.status='RUNNING' and campaign_run.status<>'CLAIMED')
    or campaign.status not in('READY','RUNNING')
  then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  if campaign_run.status='PLANNED' and command->>'failure_layer'<>'ROOT_ROUTING' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.status='CLAIMED' then
    if campaign_run.claim_fence_consumed_at is null then
      raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED';
    end if;
    select actual.status into actual_run_status from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=campaign_run.run_id for update;
    if not found then
      raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_REQUIRED';
    end if;
    if actual_run_status not in('SUCCEEDED','FAILED','CANCELLED') then
      raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_TERMINAL';
    end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=campaign.next_run_ordinal
      and run_id=campaign_run.run_id and status=campaign_run.status;
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  update app_data_agent.falcon24_acceptance_campaigns set status='HOLD',
    first_failure_run_id=campaign_run.run_id,
    first_failure_layer=command->>'failure_layer',first_failure_code=command->>'failure_code',
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_HOLD_INVALID';
end
$function$;

create function app_data_agent.accept_falcon24_question_run_with_effective_config(
  requested_command jsonb,requested_config jsonb,submit_fence_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
  normalized_fence_token text; expected_fence_hash text; now_at timestamptz;
  acceptance jsonb; submit_fence_receipt jsonb;
begin
  if submit_fence_command is null
    or pg_catalog.jsonb_typeof(submit_fence_command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(submit_fence_command,array[
      'schema_version','campaign_id','run_id','claim_fence_token','command_hash']::text[])
      is distinct from true
    or submit_fence_command->>'schema_version' is distinct from
      'falcon24-question-run-acceptance@1.0.0'
    or submit_fence_command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(submit_fence_command-'command_hash')
    or pg_catalog.jsonb_typeof(submit_fence_command->'campaign_id') is distinct from 'string'
    or submit_fence_command->>'campaign_id'!~
      '^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(submit_fence_command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(submit_fence_command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'claim_fence_token') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_config) is distinct from 'object'
    or requested_command->>'run_id' is distinct from submit_fence_command->>'run_id'
    or requested_config->>'run_id' is distinct from submit_fence_command->>'run_id'
  then raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID'; end if;
  normalized_fence_token:=(submit_fence_command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from submit_fence_command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID'; end if;
  expected_fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(submit_fence_command->>'run_id'),0));
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=submit_fence_command->>'campaign_id'
      and run.run_id=(submit_fence_command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.claim_fence_hash is distinct from expected_fence_hash then
    raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_MISMATCH'; end if;
  if campaign_run.claim_fence_consumed_at is not null then
    raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_ALREADY_CONSUMED'; end if;
  if exists(select 1 from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=campaign_run.run_id)
    or exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=authority.principal_id
        and binding.run_id=campaign_run.run_id)
    or exists(select 1 from app_data_agent.effective_run_config_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
        and receipt.run_id=campaign_run.run_id)
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_RUN_PREEXISTS'; end if;
  acceptance:=app_data_agent.accept_question_run_with_effective_config(
    requested_command,requested_config);
  if acceptance#>>'{resolution,operation}' is distinct from 'QUESTION_RUN'
    or acceptance#>>'{resolution,admission}' is distinct from 'READY'
    or acceptance#>>'{resolution,run_id}' is distinct from campaign_run.run_id::text
    or pg_catalog.jsonb_typeof(acceptance->'effective_config') is distinct from 'object'
  then raise exception using errcode='55000',message='FALCON24_QUESTION_ACCEPTANCE_NOT_READY'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.run_id=actual.run_id
      and binding.principal_id=actual.principal_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.run_id=actual.run_id
      and receipt.principal_id=actual.principal_id
      and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=campaign_run.run_id and actual.status='QUEUED'
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY')
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_ACCEPTANCE_NOT_ATOMIC'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set claim_fence_consumed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign_run.campaign_id and run_id=campaign_run.run_id
      and status='CLAIMED' and claim_fence_hash=expected_fence_hash
      and claim_fence_consumed_at is null
    returning * into strict campaign_run;
  submit_fence_receipt:=pg_catalog.jsonb_build_object(
    'campaign_id',campaign_run.campaign_id,
    'run_id',campaign_run.run_id,
    'claim_fence_hash',campaign_run.claim_fence_hash,
    'claim_fence_consumed_at',campaign_run.claim_fence_consumed_at);
  return pg_catalog.jsonb_build_object(
    'acceptance',acceptance,'submit_fence',submit_fence_receipt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID';
end
$function$;
create function app_data_agent.load_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-campaign-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id';
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(campaign);
end
$function$;

create function app_data_agent.resolve_falcon24_run_execution_policy(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; execution_policy jsonb;
begin
  if requested_run_id is null then
    raise exception using errcode='22023',message='FALCON24_RUN_EXECUTION_POLICY_INPUT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',campaign_run.campaign_id,
      'case_id',campaign_run.case_id,
      'run_variant',campaign_run.run_variant,
      'repetition',campaign_run.repetition,
      'policy_id',campaign.policy_id,
      'mode','FALCON24_STRICT',
      'max_run_attempts',1,
      'max_provider_attempts_per_call',1,
      'max_root_turns',1,
      'max_text2sql_candidate_attempts',1,
      'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,
      'allow_stage_recovery',false,
      'hold_on_failure',true)
    into execution_policy
    from app_data_agent.falcon24_acceptance_campaign_runs campaign_run
    join app_data_agent.falcon24_acceptance_campaigns campaign
      on campaign.app_id=campaign_run.app_id
      and campaign.tenant_id=campaign_run.tenant_id
      and campaign.environment=campaign_run.environment
      and campaign.principal_id=campaign_run.principal_id
      and campaign.campaign_id=campaign_run.campaign_id
    where campaign_run.app_id=authority.app_id
      and campaign_run.tenant_id=authority.tenant_id
      and campaign_run.environment=authority.environment
      and campaign_run.principal_id=authority.principal_id
      and campaign_run.run_id=requested_run_id;
  return execution_policy;
end
$function$;

create function app_data_agent.load_falcon24_pending_failed_run()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; pending jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  begin
    select pg_catalog.jsonb_build_object(
        'campaign_id',campaign.campaign_id,
        'run_id',campaign_run.run_id)
      into strict pending
      from app_data_agent.falcon24_acceptance_campaigns campaign
      join app_data_agent.falcon24_acceptance_campaign_runs campaign_run
        on campaign_run.app_id=campaign.app_id
        and campaign_run.tenant_id=campaign.tenant_id
        and campaign_run.environment=campaign.environment
        and campaign_run.principal_id=campaign.principal_id
        and campaign_run.campaign_id=campaign.campaign_id
        and campaign_run.run_ordinal=campaign.next_run_ordinal
      join app_data_agent.runs run
        on run.app_id=campaign_run.app_id
        and run.tenant_id=campaign_run.tenant_id
        and run.environment=campaign_run.environment
        and run.principal_id=campaign_run.principal_id
        and run.run_id=campaign_run.run_id
      where campaign.app_id=authority.app_id
        and campaign.tenant_id=authority.tenant_id
        and campaign.environment=authority.environment
        and campaign.principal_id=authority.principal_id
        and campaign.status='RUNNING'
        and campaign_run.status='CLAIMED'
        and run.status='FAILED';
  exception
    when no_data_found then return null;
    when too_many_rows then raise exception using errcode='55000',
      message='FALCON24_PENDING_FAILED_RUN_AMBIGUOUS';
  end;
  return pending;
end
$function$;

create function app_data_agent.load_falcon24_acceptance_campaign_run(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-campaign-run-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_RUN_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_RUN_LOAD_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_acceptance_trace_gate(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-trace-gate-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_TRACE_GATE_RECEIPT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return campaign_run.trace_gate_receipt;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_TRACE_GATE_RECEIPT_LOAD_INVALID';
end
$function$;
create function app_data_agent.resolve_run_delivery_attempt_limit(requested_run_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $function$
declare execution_policy jsonb;
begin
  execution_policy:=app_data_agent.resolve_falcon24_run_execution_policy(requested_run_id);
  if execution_policy is null then return 5; end if;
  if execution_policy->>'policy_id' is distinct from
      'falcon24-strict-zero-retry@1.0.0'
    or execution_policy->>'mode' is distinct from 'FALCON24_STRICT'
    or execution_policy->>'max_run_attempts' is distinct from '1'
    or execution_policy->>'hold_on_failure' is distinct from 'true'
  then raise exception using errcode='55000',message='RUN_EXECUTION_POLICY_CORRUPT'; end if;
  return 1;
end
$function$;

do $policy_aware_run_work$
declare definition text;
  function_signature constant regprocedure:=
    'app_data_agent.claim_run_work(text,integer,integer)'::pg_catalog.regprocedure;
  exhausted_predicate constant text:='message.attempt_count >= 5';
  retryable_predicate constant text:='message.attempt_count < 5';
  candidate_predicate constant text:='candidate.attempt_count >= 5';
begin
  definition:=pg_catalog.pg_get_functiondef(function_signature);
  if (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,exhausted_predicate,'')))
        /pg_catalog.length(exhausted_predicate)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,retryable_predicate,'')))
        /pg_catalog.length(retryable_predicate)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,candidate_predicate,'')))
        /pg_catalog.length(candidate_predicate)<>1
  then raise exception using errcode='55000',message='RUN_WORK_ATTEMPT_BUDGET_SOURCE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,exhausted_predicate,
    'message.attempt_count >= app_data_agent.resolve_run_delivery_attempt_limit(message.run_id)');
  definition:=pg_catalog.replace(definition,retryable_predicate,
    'message.attempt_count < app_data_agent.resolve_run_delivery_attempt_limit(message.run_id)');
  definition:=pg_catalog.replace(definition,candidate_predicate,
    'candidate.attempt_count >= app_data_agent.resolve_run_delivery_attempt_limit(candidate.run_id)');
  execute definition;
end
$policy_aware_run_work$;
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
create function app_data_agent.claim_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
  reclamation_recovery_hash text; reclamation_claim_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'reclamation_recovery_token','reclamation_claim_token','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-sandbox-reclamation-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'runtime_attestation_hash') is distinct from 'string'
    or command->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'reclamation_recovery_token') is distinct from 'string'
    or (command->>'reclamation_recovery_token')::uuid is null
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid is null
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_CLAIM_INVALID'; end if;
  reclamation_recovery_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'reclamation_recovery_token',command->>'reclamation_recovery_token'));
  reclamation_claim_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  if campaign.runtime_attestation_hash<>command->>'runtime_attestation_hash'
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_ATTESTATION_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_hash is not null then
    if campaign_run.sandbox_reclamation_recovery_hash is distinct from
      reclamation_recovery_hash
    then raise exception using errcode='55000',
      message='FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  if campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  if campaign_run.sandbox_reclamation_claim_hash is not null then
    if campaign_run.sandbox_reclamation_recovery_hash<>reclamation_recovery_hash
      or campaign_run.sandbox_reclamation_claim_expires_at>now_at
    then raise exception using errcode='55000',
      message='FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED'; end if;
    update app_data_agent.falcon24_acceptance_campaign_runs set
      sandbox_reclamation_claim_hash=reclamation_claim_hash,
      sandbox_reclamation_claimed_at=now_at,
      sandbox_reclamation_claim_expires_at=now_at+interval '15 minutes'
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment and principal_id=authority.principal_id
        and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id
        and status='CLAIMED'
        and sandbox_reclamation_recovery_hash=reclamation_recovery_hash
        and sandbox_reclamation_claim_expires_at<=now_at
        and sandbox_reclamation_claim_consumed_at is null
        and sandbox_reclamation_hash is null
      returning * into strict campaign_run;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_recovery_hash=reclamation_recovery_hash,
    sandbox_reclamation_claim_hash=reclamation_claim_hash,
    sandbox_reclamation_claimed_at=now_at,
    sandbox_reclamation_claim_expires_at=now_at+interval '15 minutes'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id
      and status='CLAIMED' and sandbox_reclamation_recovery_hash is null
      and sandbox_reclamation_claim_hash is null
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_CLAIM_INVALID';
end
$function$;

create or replace function app_data_agent.record_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','reclamation_claim_token','sandbox_reclamation_hash',
      'sandbox_reclamation_receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-sandbox-reclamation-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid is null
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  receipt:=command->'sandbox_reclamation_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-sandbox-reclamation-receipt@2.0.0'
    or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'management_observation_schema_version' is distinct from
      'opensandbox-management-reclamation-observation@1.0.0'
    or pg_catalog.jsonb_typeof(receipt->'management_operation_id') is distinct from 'string'
    or (receipt->>'management_operation_id')::uuid is null
    or receipt->>'observation_source' is distinct from 'OPENSANDBOX_MANAGEMENT_API'
    or pg_catalog.jsonb_typeof(receipt->'target_metadata_hash') is distinct from 'string'
    or receipt->>'target_metadata_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'before_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{before_observation,active_count}'!~'^(0|[1-9][0-9]*)$'
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{before_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'runtime_attestation_hash') is distinct from 'string'
    or receipt->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'killed') is distinct from 'number'
    or receipt->>'killed'!~'^(0|[1-9][0-9]*)$'
    or receipt->>'killed' is distinct from receipt#>>'{before_observation,active_count}'
    or pg_catalog.jsonb_typeof(receipt->'after_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{after_observation,active_count}' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{after_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'residual') is distinct from 'number'
    or receipt->>'residual' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt->'completed_at') is distinct from 'string'
    or receipt->>'completed_at'!~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    or pg_catalog.jsonb_typeof(receipt->'management_observation_hash') is distinct from 'string'
    or receipt->>'management_observation_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    or pg_catalog.jsonb_typeof(receipt->'receipt_hash') is distinct from 'string'
    or receipt->>'receipt_hash' is distinct from command->>'sandbox_reclamation_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  if receipt->>'runtime_attestation_hash' is distinct from campaign.runtime_attestation_hash
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_ATTESTATION_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_claim_hash is null
    or campaign_run.sandbox_reclamation_claimed_at is null
  then raise exception using errcode='55000',
    message='FALCON24_SANDBOX_RECLAMATION_CLAIM_REQUIRED'; end if;
  if campaign_run.sandbox_reclamation_claim_hash<>
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'reclamation_claim_token',command->>'reclamation_claim_token'))
  then raise exception using errcode='55000',
    message='FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_hash is not null then
    if campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or campaign_run.sandbox_reclamation_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_hash=command->>'sandbox_reclamation_hash',
    sandbox_reclamation_receipt=receipt,
    sandbox_reclamation_claim_consumed_at=pg_catalog.clock_timestamp()
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id and status='CLAIMED'
      and sandbox_reclamation_claim_hash=
        app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'reclamation_claim_token',command->>'reclamation_claim_token'))
      and sandbox_reclamation_claim_consumed_at is null
      and sandbox_reclamation_hash is null
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID';
end
$function$;

create or replace function app_data_agent.complete_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','expected_result_hash',
      'sandbox_reclamation_hash','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-complete@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'expected_result_hash') is distinct from 'string'
    or command->>'expected_result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.status='VERIFIED' then
    if campaign_run.trace_closure_hash is null
      or campaign_run.trace_gate_receipt_hash is null
      or campaign_run.trace_gate_receipt is null
      or campaign_run.result_hash<>command->>'expected_result_hash'
      or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
    then raise exception using errcode='55000',message='FALCON24_RUN_COMPLETION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if campaign_run.result_hash is null or campaign_run.result_document is null
    or campaign_run.result_hash<>command->>'expected_result_hash'
  then raise exception using errcode='55000',message='FALCON24_RESULT_STAGE_REQUIRED'; end if;
  if campaign_run.sandbox_reclamation_hash is null
    or campaign_run.sandbox_reclamation_receipt is null
    or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='VERIFIED',completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=(command->>'run_id')::uuid
      and run_ordinal=campaign.next_run_ordinal and status='CLAIMED'
    returning * into strict campaign_run;
  update app_data_agent.falcon24_acceptance_campaigns set
    next_run_ordinal=next_run_ordinal+1,
    status=case when next_run_ordinal+1=run_count then 'PASSED' else 'READY' end,
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID';
end
$function$;
alter function app_data_agent.claim_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_pending_failed_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_run_delivery_attempt_limit(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;

grant select on table app_data_agent.workspace_run_bindings,
  app_data_agent.effective_run_config_receipts to data_agent_u6_rpc_owner;
grant select on table app_data_agent.commands
  to data_agent_provider_invocation_rpc_owner;
grant execute on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  to data_agent_provider_invocation_rpc_owner;
create policy falcon24_acceptance_submit_fence_binding_select
  on app_data_agent.workspace_run_bindings for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_acceptance_submit_fence_config_select
  on app_data_agent.effective_run_config_receipts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_provider_worker_lease_commands_select
  on app_data_agent.commands for select to data_agent_provider_invocation_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));

revoke all on function app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb),
  app_data_agent.stage_falcon24_acceptance_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_campaign(jsonb),
  app_data_agent.resolve_falcon24_run_execution_policy(uuid),
  app_data_agent.load_falcon24_pending_failed_run(),
  app_data_agent.resolve_run_delivery_attempt_limit(uuid),
  app_data_agent.load_falcon24_acceptance_campaign_run(jsonb),
  app_data_agent.load_falcon24_acceptance_trace_gate(jsonb),
  app_data_agent.claim_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb) from public;

revoke all on function app_data_agent.resolve_run_delivery_attempt_limit(uuid)
  from data_agent_backend;

revoke all on function app_data_agent.assert_provider_active_worker_lease(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function app_data_agent.assert_provider_active_worker_lease(jsonb)
  to data_agent_u19_team_owner;

grant execute on function app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb),
  app_data_agent.stage_falcon24_acceptance_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_campaign(jsonb),
  app_data_agent.resolve_falcon24_run_execution_policy(uuid),
  app_data_agent.load_falcon24_pending_failed_run(),
  app_data_agent.load_falcon24_acceptance_campaign_run(jsonb),
  app_data_agent.load_falcon24_acceptance_trace_gate(jsonb),
  app_data_agent.claim_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb) to data_agent_backend;
do $postconditions$
declare claim_definition text; hold_definition text; acceptance_definition text;
  stage_definition text; record_definition text; complete_definition text;
  reclamation_claim_definition text; execution_policy_definition text;
  pending_failure_definition text; run_work_definition text; attempt_limit_definition text;
  provider_lease_definition text;
  lifecycle_constraint text; binding_constraint text;
begin
  select procedure.prosrc into strict claim_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict hold_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)'
        ::pg_catalog.regprocedure;
  select procedure.prosrc into strict stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict record_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict complete_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict reclamation_claim_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict execution_policy_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict pending_failure_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.load_falcon24_pending_failed_run()'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict run_work_definition
    from pg_catalog.pg_proc procedure where procedure.oid=
      'app_data_agent.claim_run_work(text,integer,integer)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict attempt_limit_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict provider_lease_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_constraintdef(constraint_row.oid) into strict lifecycle_constraint
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
      'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and constraint_row.conname='falcon24_acceptance_campaign_runs_check';
  select pg_catalog.pg_get_constraintdef(constraint_row.oid) into strict binding_constraint
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
      'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and constraint_row.conname=
        'falcon24_acceptance_campaign_runs_trace_gate_binding_check';

  if not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='claim_fence_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='claim_fence_consumed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='trace_gate_receipt_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='trace_gate_receipt'
        and attribute.atttypid='jsonb'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_recovery_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claimed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_expires_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_consumed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or pg_catalog.strpos(lifecycle_constraint,'claim_fence_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'claim_fence_consumed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'trace_gate_receipt_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_recovery_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claimed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_expires_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_consumed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'status <> ''VERIFIED''')=0
    or pg_catalog.strpos(binding_constraint,'u2_canonical_sha256')=0
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_COLUMNS_OR_CHECKS_DRIFT'; end if;

  if pg_catalog.strpos(claim_definition,'falcon24-acceptance-run-claim@2.0.0')=0
    or pg_catalog.strpos(claim_definition,'falcon24-acceptance-run-claim@1.0.0')>0
    or pg_catalog.strpos(claim_definition,'claim_fence_hash=fence_hash')=0
    or pg_catalog.strpos(hold_definition,'falcon24-acceptance-campaign-hold@2.0.0')=0
    or pg_catalog.strpos(hold_definition,'falcon24-acceptance-campaign-hold@1.0.0')>0
    or pg_catalog.strpos(hold_definition,'campaign_run.status not in(''PLANNED'',''CLAIMED'')')=0
    or pg_catalog.strpos(hold_definition,
      'campaign_run.status=''PLANNED'' and command->>''failure_layer''<>''ROOT_ROUTING''')=0
    or pg_catalog.strpos(hold_definition,'if campaign_run.status=''CLAIMED'' then')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_ACTUAL_RUN_NOT_TERMINAL')=0
    or pg_catalog.strpos(hold_definition,
      'actual_run_status not in(''SUCCEEDED'',''FAILED'',''CANCELLED'')')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_RUN_ACCEPTED_RECOVERY_REQUIRED')>0
    or pg_catalog.strpos(acceptance_definition,
      'falcon24-question-run-acceptance@1.0.0')=0
    or pg_catalog.strpos(acceptance_definition,
      'accept_question_run_with_effective_config')=0
    or pg_catalog.strpos(acceptance_definition,'FALCON24_SUBMIT_RUN_PREEXISTS')=0
    or pg_catalog.strpos(acceptance_definition,'workspace_run_bindings')=0
    or pg_catalog.strpos(acceptance_definition,'effective_run_config_receipts')=0
    or pg_catalog.strpos(acceptance_definition,'actual.xmin')>0
    or pg_catalog.strpos(acceptance_definition,'binding.xmin')>0
    or pg_catalog.strpos(acceptance_definition,'pg_xact_status')>0
    or pg_catalog.strpos(acceptance_definition,'claim_fence_consumed_at=now_at')=0
    or pg_catalog.strpos(acceptance_definition,
      '''claim_fence_consumed_at'',campaign_run.claim_fence_consumed_at')=0
    or pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@1.0.0')=0
    or pg_catalog.strpos(stage_definition,'FALCON24_TRACE_STAGE_REPLAY_MISMATCH')=0
    or pg_catalog.strpos(stage_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(stage_definition,'u2_canonical_sha256(receipt-''receipt_hash'')')=0
    or pg_catalog.strpos(record_definition,'FALCON24_TRACE_STAGE_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'reclamation_claim_token')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SANDBOX_RECLAMATION_CLAIM_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH')=0
    or pg_catalog.strpos(record_definition,'sandbox_reclamation_claim_consumed_at')=0
    or pg_catalog.strpos(complete_definition,'falcon24-acceptance-run-complete@2.0.0')=0
    or pg_catalog.strpos(complete_definition,'falcon24-acceptance-run-complete@1.0.0')>0
    or pg_catalog.strpos(complete_definition,'command->>''trace_closure_hash''')>0
    or pg_catalog.strpos(complete_definition,'FALCON24_TRACE_STAGE_REQUIRED')=0
    or pg_catalog.strpos(complete_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'falcon24-sandbox-reclamation-claim@1.0.0')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'platform.current_backend_authority(true)')=0
    or pg_catalog.strpos(reclamation_claim_definition,'for update')=0
    or pg_catalog.strpos(reclamation_claim_definition,'run.status=''SUCCEEDED''')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_recovery_hash<>reclamation_recovery_hash')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_recovery_hash is distinct from')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_claim_expires_at<=now_at')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_claim_hash=reclamation_claim_hash')=0
    or pg_catalog.strpos(execution_policy_definition,
      'platform.current_backend_authority(false)')=0
    or pg_catalog.strpos(execution_policy_definition,
      'campaign_run.run_id=requested_run_id')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''policy_id'',campaign.policy_id')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''max_run_attempts'',1')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''hold_on_failure'',true')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign.status=''RUNNING''')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign_run.status=''CLAIMED''')=0
    or pg_catalog.strpos(pending_failure_definition,'run.status=''FAILED''')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign.next_run_ordinal')=0
    or pg_catalog.strpos(pending_failure_definition,'FALCON24_PENDING_FAILED_RUN_AMBIGUOUS')=0
    or pg_catalog.strpos(run_work_definition,'message.attempt_count >= 5')>0
    or pg_catalog.strpos(run_work_definition,'message.attempt_count < 5')>0
    or pg_catalog.strpos(run_work_definition,'candidate.attempt_count >= 5')>0
    or pg_catalog.strpos(run_work_definition,
      'resolve_run_delivery_attempt_limit(message.run_id)')=0
    or pg_catalog.strpos(run_work_definition,
      'resolve_run_delivery_attempt_limit(candidate.run_id)')=0
    or pg_catalog.strpos(attempt_limit_definition,
      'resolve_falcon24_run_execution_policy(requested_run_id)')=0
    or pg_catalog.strpos(attempt_limit_definition,'RUN_EXECUTION_POLICY_CORRUPT')=0
    or pg_catalog.strpos(provider_lease_definition,'''execution_policy''')=0
    or pg_catalog.strpos(provider_lease_definition,
      'resolve_falcon24_run_execution_policy(requested_run_id)')=0
    or pg_catalog.strpos(provider_lease_definition,'''START_DATA_AGENT_TEAM''')=0
    or pg_catalog.strpos(provider_lease_definition,'''START_L2_RESEARCH''')=0
    or pg_catalog.strpos(provider_lease_definition,'command_payload_is_valid')=0
    or pg_catalog.strpos(provider_lease_definition,'RUN_EXECUTION_POLICY_CORRUPT')=0
    or pg_catalog.strpos(provider_lease_definition,'lock_owned_run_fence')=0
    or pg_catalog.strpos(provider_lease_definition,'assert_provider_active_worker_lease_pre_u20')>0
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_FUNCTION_DEFINITION_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='assert_provider_active_worker_lease')<>1
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_COMPATIBILITY_GATE_REMAINS'; end if;

  if exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid in(
        'app_data_agent.claim_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)'
          ::pg_catalog.regprocedure,
        'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_pending_failed_run()'::pg_catalog.regprocedure,
        'app_data_agent.resolve_run_delivery_attempt_limit(uuid)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.complete_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure)
        and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
          or not procedure.prosecdef
          or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_FUNCTION_SECURITY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid=
        'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure
        and (pg_catalog.pg_get_userbyid(procedure.proowner)<>
            'data_agent_provider_invocation_rpc_owner'
          or not procedure.prosecdef
          or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_FUNCTION_SECURITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_pending_failed_run()','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_u19_team_owner',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)',
      'EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_pending_failed_run()','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaigns','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaign_runs','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_GRANT_DRIFT'; end if;

  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.workspace_run_bindings','SELECT')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.effective_run_config_receipts','SELECT')
    or not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='workspace_run_bindings'
        and policyname='falcon24_acceptance_submit_fence_binding_select'
        and cmd='SELECT' and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(qual,'principal_id')>0)
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='effective_run_config_receipts'
        and policyname='falcon24_acceptance_submit_fence_config_select'
        and cmd='SELECT' and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(qual,'principal_id')>0)
  then raise exception using errcode='P0001',message='FALCON24_SUBMIT_FENCE_BINDING_AUTHORITY_DRIFT'; end if;

  if not pg_catalog.has_table_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.commands','SELECT')
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='commands'
        and policyname='falcon24_provider_worker_lease_commands_select'
        and cmd='SELECT' and roles='{data_agent_provider_invocation_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_run_object_matches')>0)
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_COMMAND_AUTHORITY_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run_v1(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run_v2(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='complete_falcon24_acceptance_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='claim_falcon24_acceptance_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='hold_falcon24_acceptance_campaign')<>1
    or pg_catalog.to_regprocedure(
      'app_data_agent.consume_falcon24_acceptance_submit_fence(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.authorize_falcon24_sandbox_reclamation(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='accept_falcon24_question_run_with_effective_config')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='claim_falcon24_sandbox_reclamation')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='resolve_falcon24_run_execution_policy')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='load_falcon24_pending_failed_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='resolve_run_delivery_attempt_limit')<>1
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_COMPATIBILITY_RPC_REMAINS'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010769_app_data_agent_falcon24_trace_gate_authority',
  'sha256:871d01f306554396da549f1287ab183e63118cb097e23abb001eb3656baa3cd7');
commit;
