create or replace function app_data_agent.stage_falcon24_acceptance_trace(command jsonb)
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
      'detail_closure','verified_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-gate-receipt@2.0.0'
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
    or pg_catalog.jsonb_typeof(receipt->'detail_closure') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<1
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<>
      (receipt->>'detail_count')::integer
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.lag(item->>'node_id') over(order by ordinality) previous_node_id
        from pg_catalog.jsonb_array_elements(receipt->'detail_closure')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'node_id','detail_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'node_id') is distinct from 'string'
        or pg_catalog.length(item->>'node_id') not between 1 and 320
        or pg_catalog.jsonb_typeof(item->'detail_hash') is distinct from 'string'
        or item->>'detail_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_node_id is not null and previous_node_id>=item->>'node_id'))
    or pg_catalog.jsonb_typeof(receipt->'verified_at') is distinct from 'string'
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
  if campaign_run.claim_fence_hash is null or campaign_run.claim_fence_consumed_at is null
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
