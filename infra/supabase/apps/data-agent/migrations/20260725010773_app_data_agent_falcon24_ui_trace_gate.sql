-- falcon24_ui_trace_gate_migration_checksum: sha256:2c42a86ef733b9ae6ef84b1e4d6068b2a199bd3ce5d1c8e9cabe81f245f6de20
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_UI_TRACE_GATE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_UI_TRACE_GATE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010772_app_data_agent_falcon24_submit_outcome_coalesce_repair')
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_BASELINE_10772_MISSING'; end if;
  if pg_catalog.to_regclass('app_data_agent.falcon24_acceptance_campaign_runs') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_BASELINE_AUTHORITY_MISSING'; end if;
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
    where run.trace_gate_receipt is not null
      and run.trace_gate_receipt->>'schema_version' is distinct from
        'falcon24-resolution-trace-gate-receipt@2.0.0')
  then raise exception using errcode='P0001',message='FALCON24_LEGACY_TRACE_RECEIPT_PRESENT'; end if;
  if exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.status='VERIFIED' or run.sandbox_reclamation_claim_hash is not null
      or run.sandbox_reclamation_hash is not null)
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_HISTORY_UNVERIFIABLE'; end if;
end
$history_preflight$;

alter table app_data_agent.falcon24_acceptance_campaign_runs
  add column ui_trace_gate_receipt_hash text,
  add column ui_trace_gate_receipt jsonb,
  drop constraint falcon24_acceptance_campaign_runs_trace_gate_binding_check,
  add constraint falcon24_acceptance_campaign_runs_trace_gate_binding_check check(
    trace_gate_receipt is null or (
      pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and trace_gate_receipt->>'schema_version'=
        'falcon24-resolution-trace-gate-receipt@2.0.0'
      and trace_gate_receipt->>'campaign_id'=campaign_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_acceptance_campaign_runs_ui_trace_gate_check check(
    ((ui_trace_gate_receipt_hash is null)=(ui_trace_gate_receipt is null))
    and (ui_trace_gate_receipt_hash is null
      or ui_trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (ui_trace_gate_receipt is null or (
      trace_closure_hash is not null and trace_gate_receipt_hash is not null
      and trace_gate_receipt is not null
      and pg_catalog.jsonb_typeof(ui_trace_gate_receipt)='object'
      and ui_trace_gate_receipt->>'schema_version'=
        'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
      and ui_trace_gate_receipt->>'campaign_id'=campaign_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash')))
    and (sandbox_reclamation_claim_hash is null or ui_trace_gate_receipt is not null)
    and (sandbox_reclamation_hash is null or ui_trace_gate_receipt is not null)
    and (status<>'VERIFIED' or ui_trace_gate_receipt is not null));

create function app_data_agent.falcon24_ui_trace_gate_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if old.ui_trace_gate_receipt_hash is not null and (
    new.ui_trace_gate_receipt_hash is distinct from old.ui_trace_gate_receipt_hash
    or new.ui_trace_gate_receipt is distinct from old.ui_trace_gate_receipt)
  then raise exception using errcode='55000',message='FALCON24_UI_TRACE_STAGE_REPLAY_MISMATCH'; end if;
  if (new.sandbox_reclamation_claim_hash is not null
      or new.sandbox_reclamation_hash is not null or new.status='VERIFIED')
    and (new.ui_trace_gate_receipt_hash is null or new.ui_trace_gate_receipt is null
      or new.trace_closure_hash is null
      or new.ui_trace_gate_receipt->>'trace_hash' is distinct from new.trace_closure_hash)
  then raise exception using errcode='55000',message='FALCON24_UI_TRACE_STAGE_REQUIRED'; end if;
  return new;
end
$function$;

create trigger falcon24_acceptance_campaign_runs_ui_trace_gate_fence
before update on app_data_agent.falcon24_acceptance_campaign_runs
for each row execute function app_data_agent.falcon24_ui_trace_gate_fence();

create function app_data_agent.stage_falcon24_acceptance_ui_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','trace_closure_hash',
      'ui_trace_gate_receipt_hash','ui_trace_gate_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-ui-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt_hash') is distinct from 'string'
    or command->>'ui_trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_UI_TRACE_STAGE_INVALID'; end if;
  receipt:=command->'ui_trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','workspace_id','conversation_id','trace_hash',
      'web_build','browser_harness_version','opened_nodes','opened_artifact_refs','chart_ref',
      'chart_renderer_version','chart_rendered','source_table_visible','error_banner',
      'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
    or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or receipt->>'receipt_hash' is distinct from command->>'ui_trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(receipt->'workspace_id') is distinct from 'string'
    or (receipt->>'workspace_id')::uuid::text is distinct from receipt->>'workspace_id'
    or pg_catalog.jsonb_typeof(receipt->'conversation_id') is distinct from 'string'
    or (receipt->>'conversation_id')::uuid::text is distinct from receipt->>'conversation_id'
    or pg_catalog.jsonb_typeof(receipt->'web_build') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      receipt->'web_build'->>'build_id',receipt->'web_build'->>'generation_id',
      receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or receipt->>'browser_harness_version' is distinct from
      'falcon24-agent-browser-trace-gate@1.0.0'
    or receipt->>'chart_renderer_version' is distinct from 'governed-vchart@1.0.0'
    or receipt->'chart_rendered' is distinct from 'true'::jsonb
    or receipt->'source_table_visible' is distinct from 'true'::jsonb
    or receipt->'error_banner' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(receipt->'opened_nodes') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_nodes')<1
    or pg_catalog.jsonb_typeof(receipt->'opened_artifact_refs') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_artifact_refs')<>5
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash') identity,
          pg_catalog.lag(pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash'))
            over(order by ordinality) previous_identity
        from pg_catalog.jsonb_array_elements(receipt->'opened_artifact_refs')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
          'revision','content_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'artifact_id') is distinct from 'string'
        or (item->>'artifact_id')::uuid::text is distinct from item->>'artifact_id'
        or pg_catalog.jsonb_typeof(item->'app_id') is distinct from 'string'
        or (item->>'app_id')::uuid::text is distinct from item->>'app_id'
        or pg_catalog.jsonb_typeof(item->'tenant_id') is distinct from 'string'
        or (item->>'tenant_id')::uuid::text is distinct from item->>'tenant_id'
        or item->>'tenant_id' is distinct from receipt->>'workspace_id'
        or pg_catalog.jsonb_typeof(item->'environment') is distinct from 'string'
        or pg_catalog.length(item->>'environment') not between 1 and 64
        or pg_catalog.jsonb_typeof(item->'run_id') is distinct from 'string'
        or (item->>'run_id')::uuid::text is distinct from item->>'run_id'
        or item->>'run_id' is distinct from receipt->>'run_id'
        or item->>'artifact_type' not in('SqlArtifact','QueryEvidence',
          'DerivedAnalysisEvidence','ArtifactWorkspaceDocument','AnalysisReport')
        or pg_catalog.jsonb_typeof(item->'revision') is distinct from 'number'
        or item->>'revision'!~'^[1-9][0-9]*$'
        or (item->>'revision')::numeric not between 1 and 9007199254740991
        or pg_catalog.jsonb_typeof(item->'content_hash') is distinct from 'string'
        or item->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_identity is not null and previous_identity>=identity))
    or exists(select 1 from pg_catalog.unnest(array[
        'SqlArtifact','QueryEvidence','DerivedAnalysisEvidence',
        'ArtifactWorkspaceDocument','AnalysisReport']::text[]) required_type
      where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          receipt->'opened_artifact_refs') item
        where item->>'artifact_type'=required_type)<>1)
    or pg_catalog.jsonb_typeof(receipt->'chart_ref') is distinct from 'object'
    or receipt->'chart_ref'->>'artifact_type' is distinct from 'ArtifactWorkspaceDocument'
    or not receipt->'opened_artifact_refs' @> pg_catalog.jsonb_build_array(receipt->'chart_ref')
    or pg_catalog.jsonb_typeof(receipt->'observed_at') is distinct from 'string'
    or (receipt->>'observed_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_UI_TRACE_STAGE_INVALID'; end if;
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
  if campaign.status<>'RUNNING' or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.trace_closure_hash is null or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
    or campaign_run.trace_closure_hash<>command->>'trace_closure_hash'
    or receipt->>'workspace_id'<>campaign_run.tenant_id::text
    or receipt->'opened_nodes' is distinct from campaign_run.trace_gate_receipt->'detail_closure'
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if campaign_run.ui_trace_gate_receipt_hash is not null then
    if campaign_run.ui_trace_gate_receipt_hash<>command->>'ui_trace_gate_receipt_hash'
      or campaign_run.ui_trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_UI_TRACE_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    ui_trace_gate_receipt_hash=command->>'ui_trace_gate_receipt_hash',
    ui_trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id and status='CLAIMED'
      and ui_trace_gate_receipt_hash is null and ui_trace_gate_receipt is null
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_UI_TRACE_STAGE_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_acceptance_ui_trace_gate(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-ui-trace-gate-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_UI_TRACE_GATE_RECEIPT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return campaign_run.ui_trace_gate_receipt;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_UI_TRACE_GATE_RECEIPT_LOAD_INVALID';
end
$function$;
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
alter function app_data_agent.falcon24_ui_trace_gate_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_trace(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.falcon24_ui_trace_gate_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;
revoke all on function app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

grant execute on function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  to data_agent_backend;
do $postconditions$
declare stage_definition text; ui_stage_definition text; fence_definition text;
begin
  if not exists(select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid='app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and attribute.attname='ui_trace_gate_receipt_hash' and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid='app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='ui_trace_gate_receipt' and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and constraint_row.conname='falcon24_acceptance_campaign_runs_ui_trace_gate_check')
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and trigger_row.tgname='falcon24_acceptance_campaign_runs_ui_trace_gate_fence'
        and not trigger_row.tgisinternal)
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_SCHEMA_DRIFT'; end if;

  select procedure.prosrc into strict stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict ui_stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict fence_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_ui_trace_gate_fence()'::pg_catalog.regprocedure;
  if pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@2.0.0')=0
    or pg_catalog.strpos(stage_definition,'detail_closure')=0
    or pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@1.0.0')>0
    or pg_catalog.strpos(ui_stage_definition,
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0')=0
    or pg_catalog.strpos(ui_stage_definition,
      'falcon24-agent-browser-trace-gate@1.0.0')=0
    or pg_catalog.strpos(ui_stage_definition,
      'opened_nodes')=0
    or pg_catalog.strpos(ui_stage_definition,
      'opened_artifact_refs')=0
    or pg_catalog.strpos(ui_stage_definition,
      'campaign_run.trace_gate_receipt->''detail_closure''')=0
    or pg_catalog.strpos(fence_definition,'FALCON24_UI_TRACE_STAGE_REQUIRED')=0
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_FUNCTION_DRIFT'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='stage_falcon24_acceptance_ui_trace')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='load_falcon24_acceptance_ui_trace_gate')<>1
    or exists(select 1 from pg_catalog.pg_proc procedure where procedure.oid in(
        'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.falcon24_ui_trace_gate_fence()'::pg_catalog.regprocedure)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_SECURITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)','EXECUTE')
    or exists(select 1 from pg_catalog.unnest(array[
        'public','anon','authenticated','service_role','data_agent_job_authority']::text[]) role_name
      where pg_catalog.has_function_privilege(role_name,
          'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)','EXECUTE')
        or pg_catalog.has_function_privilege(role_name,
          'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)','EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010773_app_data_agent_falcon24_ui_trace_gate',
  'sha256:2c42a86ef733b9ae6ef84b1e4d6068b2a199bd3ce5d1c8e9cabe81f245f6de20');
commit;
