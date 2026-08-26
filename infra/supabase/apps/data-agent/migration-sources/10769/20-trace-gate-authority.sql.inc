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
