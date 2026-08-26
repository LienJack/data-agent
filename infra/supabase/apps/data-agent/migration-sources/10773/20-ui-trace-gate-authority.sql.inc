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
