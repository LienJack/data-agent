-- falcon24_e1_trace_migration_checksum: sha256:19aba47caeecfbc784238186b891858ae25174b7a79af324e89dce998f59f22a
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.falcon24_e1_ui_receipts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  receipt_kind text not null check(receipt_kind in('QA_E2E','TRACE_UI')),
  viewport_width integer not null check(viewport_width in(390,1440)),
  viewport_height integer not null check(viewport_height between 640 and 2400),
  authority_epoch text not null check(authority_epoch='E1'),baseline_id uuid not null,
  baseline_hash text not null check(baseline_hash~'^sha256:[0-9a-f]{64}$'),
  activation_attempt_id uuid not null,web_build_hash text not null,
  dom_snapshot_hash text not null,screenshot_hash text not null,receipt_hash text not null,
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'),
  observed_at timestamptz not null,committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,receipt_kind,viewport_width),
  unique(app_id,tenant_id,environment,run_id,receipt_hash),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  foreign key(app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash) on delete restrict,
  check(web_build_hash~'^sha256:[0-9a-f]{64}$'
    and dom_snapshot_hash~'^sha256:[0-9a-f]{64}$'
    and screenshot_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_json->>'run_id'=run_id::text
    and receipt_json->>'receipt_hash'=receipt_hash
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_json-'receipt_hash')
    and receipt_json#>>'{authority,authority_epoch}'=authority_epoch
    and receipt_json#>>'{authority,baseline_id}'=baseline_id::text
    and receipt_json#>>'{authority,baseline_hash}'=baseline_hash
    and receipt_json#>>'{authority,activation_attempt_id}'=activation_attempt_id::text
    and receipt_json#>>'{web_build,build_id}'=web_build_hash
    and (receipt_json#>>'{viewport,width}')::integer=viewport_width
    and (receipt_json#>>'{viewport,height}')::integer=viewport_height
    and receipt_json->>'dom_snapshot_hash'=dom_snapshot_hash
    and receipt_json->>'screenshot_hash'=screenshot_hash));

create trigger falcon24_e1_ui_receipts_immutable before update or delete
on app_data_agent.falcon24_e1_ui_receipts for each row
execute function app_data_agent.analysis_governed_state_immutable();
create function app_data_agent.commit_falcon24_e1_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; authority_run record; receipt jsonb;existing record;
  requested_kind text;requested_run_id uuid;requested_width integer;requested_height integer;
  required_type text;reference jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','receipt_kind','receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-ui-receipt-commit@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'receipt_kind' not in('QA_E2E','TRACE_UI')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_E1_UI_RECEIPT_COMMAND_INVALID'; end if;
  requested_kind:=command->>'receipt_kind';requested_run_id:=(command->>'run_id')::uuid;
  receipt:=command->'receipt';
  if receipt->>'run_id' is distinct from requested_run_id::text
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(receipt->'authority') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'authority',array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
      is distinct from true
    or receipt#>>'{authority,schema_version}' is distinct from 'falcon24-authority-binding@1.0.0'
    or receipt#>>'{authority,authority_epoch}' is distinct from 'E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt#>'{authority,baseline_id}')
      is distinct from true
    or receipt#>>'{authority,baseline_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      receipt#>'{authority,activation_attempt_id}') is distinct from true
    or pg_catalog.jsonb_typeof(receipt->'web_build') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      receipt#>>'{web_build,build_id}',receipt#>>'{web_build,generation_id}',
      receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(receipt->'viewport') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'viewport',array[
      'width','height']::text[]) is distinct from true
    or receipt#>>'{viewport,width}'!~'^[0-9]+$'
    or receipt#>>'{viewport,height}'!~'^[0-9]+$'
    or (receipt#>>'{viewport,width}')::integer not in(390,1440)
    or (receipt#>>'{viewport,height}')::integer not between 640 and 2400
    or receipt->>'browser_harness_version' is distinct from
      'falcon24-agent-browser-trace-gate@2.0.0'
    or receipt->'error_banner' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(receipt->'observed_at') is distinct from 'string'
    or (receipt->>'observed_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_E1_UI_RECEIPT_INVALID'; end if;
  requested_width:=(receipt#>>'{viewport,width}')::integer;
  requested_height:=(receipt#>>'{viewport,height}')::integer;
  if requested_kind='QA_E2E' then
    if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
        'schema_version','run_id','conversation_id','authority','web_build',
        'browser_harness_version','viewport','entry_path','question_hash','terminal_status',
        'answer_visible','table_visible','chart_rendered','report_visible','error_banner',
        'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
        is distinct from true
      or receipt->>'schema_version' is distinct from 'falcon24-qa-e2e-receipt@1.0.0'
      or receipt->>'entry_path' is distinct from 'QUESTION_COMPOSER_SUBMIT_TO_RESULT'
      or receipt->>'question_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->>'terminal_status' is distinct from 'COMPLETED'
      or receipt->'answer_visible' is distinct from 'true'::jsonb
      or receipt->'table_visible' is distinct from 'true'::jsonb
      or receipt->'chart_rendered' is distinct from 'true'::jsonb
      or receipt->'report_visible' is distinct from 'true'::jsonb
    then raise exception using errcode='22023',message='FALCON24_E1_QA_E2E_RECEIPT_INVALID'; end if;
  else
    if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
        'schema_version','run_id','conversation_id','trace_hash','authority','web_build',
        'browser_harness_version','viewport','entry_path','opened_nodes','opened_artifact_refs',
        'chart_ref','chart_rendered','source_table_visible','returned_to_result','error_banner',
        'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
        is distinct from true
      or receipt->>'schema_version' is distinct from 'falcon24-trace-ui-receipt@1.0.0'
      or receipt->>'entry_path' is distinct from 'RESULT_TRACE_ENTRY_TO_EXACT_RUN'
      or receipt->>'trace_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->'chart_rendered' is distinct from 'true'::jsonb
      or receipt->'source_table_visible' is distinct from 'true'::jsonb
      or receipt->'returned_to_result' is distinct from 'true'::jsonb
      or pg_catalog.jsonb_typeof(receipt->'opened_nodes') is distinct from 'array'
      or pg_catalog.jsonb_array_length(receipt->'opened_nodes')<1
      or pg_catalog.jsonb_typeof(receipt->'opened_artifact_refs') is distinct from 'array'
      or pg_catalog.jsonb_array_length(receipt->'opened_artifact_refs')<>5
      or pg_catalog.jsonb_typeof(receipt->'chart_ref') is distinct from 'object'
      or receipt->'chart_ref'->>'artifact_type' is distinct from 'ArtifactWorkspaceDocument'
      or not receipt->'opened_artifact_refs' @> pg_catalog.jsonb_build_array(receipt->'chart_ref')
      or exists(with elements as (
          select item,ordinality,
            pg_catalog.concat_ws(chr(31),item->>'artifact_type',item->>'artifact_id',
              item->>'revision',item->>'content_hash') identity,
            pg_catalog.lag(pg_catalog.concat_ws(chr(31),item->>'artifact_type',item->>'artifact_id',
              item->>'revision',item->>'content_hash')) over(order by ordinality) previous_identity
          from pg_catalog.jsonb_array_elements(receipt->'opened_artifact_refs')
            with ordinality element(item,ordinality))
        select 1 from elements where
          app_data_agent.provider_json_object_has_exact_keys(item,array[
            'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
            'revision','content_hash']::text[]) is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'artifact_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'app_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'tenant_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'run_id') is distinct from true
          or item->>'run_id' is distinct from requested_run_id::text
          or item->>'revision'!~'^[1-9][0-9]*$'
          or item->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
          or (previous_identity is not null and previous_identity>=identity))
    then raise exception using errcode='22023',message='FALCON24_E1_TRACE_UI_RECEIPT_INVALID'; end if;
    foreach required_type in array array['AnalysisReport','ArtifactWorkspaceDocument',
        'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact']::text[] loop
      if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          receipt->'opened_artifact_refs') item where item->>'artifact_type'=required_type)<>1
      then raise exception using errcode='22023',message='FALCON24_E1_TRACE_UI_RECEIPT_INVALID'; end if;
    end loop;
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  select run.authority_epoch,run.authority_baseline_id,run.authority_baseline_hash,
    run.authority_activation_attempt_id,current_epoch.baseline_id as current_baseline_id,
    current_epoch.baseline_hash as current_baseline_hash,
    current_epoch.activation_attempt_id as current_activation_attempt_id,baseline.web_build_hash
  into authority_run from app_data_agent.runs run
  join app_data_agent.falcon24_current_authority_epoch current_epoch
    on current_epoch.app_id=run.app_id and current_epoch.tenant_id=run.tenant_id
      and current_epoch.environment=run.environment
  join app_data_agent.falcon24_authority_baselines baseline
    on baseline.app_id=current_epoch.app_id and baseline.tenant_id=current_epoch.tenant_id
      and baseline.environment=current_epoch.environment and baseline.baseline_id=current_epoch.baseline_id
      and baseline.baseline_hash=current_epoch.baseline_hash
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=requested_run_id
    and run.principal_id=authority.principal_id and run.status='SUCCEEDED' for share of run;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_UI_RECEIPT_RUN_NOT_READY'; end if;
  if authority_run.authority_epoch<>'E1'
    or authority_run.authority_baseline_id<>authority_run.current_baseline_id
    or authority_run.authority_baseline_hash<>authority_run.current_baseline_hash
    or authority_run.authority_activation_attempt_id<>authority_run.current_activation_attempt_id
    or receipt#>>'{authority,baseline_id}'<>authority_run.current_baseline_id::text
    or receipt#>>'{authority,baseline_hash}'<>authority_run.current_baseline_hash
    or receipt#>>'{authority,activation_attempt_id}'<>authority_run.current_activation_attempt_id::text
    or receipt#>>'{web_build,build_id}'<>authority_run.web_build_hash
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_AUTHORITY_MISMATCH'; end if;
  if requested_kind='TRACE_UI' then
    for reference in select item from pg_catalog.jsonb_array_elements(
        receipt->'opened_artifact_refs') artifact(item) loop
      if not exists(select 1 from app_data_agent.artifacts row
        where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
          and row.environment=authority.environment and row.run_id=requested_run_id
          and row.artifact_id=(reference->>'artifact_id')::uuid
          and row.artifact_type=reference->>'artifact_type'
          and row.revision=(reference->>'revision')::integer
          and row.content_hash=reference->>'content_hash' and row.is_active
          and row.authority_epoch='E1'
          and row.authority_baseline_id=authority_run.current_baseline_id
          and row.authority_baseline_hash=authority_run.current_baseline_hash
          and row.authority_activation_attempt_id=authority_run.current_activation_attempt_id)
      then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_ARTIFACT_MISMATCH'; end if;
    end loop;
  end if;
  select * into existing from app_data_agent.falcon24_e1_ui_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.run_id=requested_run_id
      and row.receipt_kind=requested_kind and row.viewport_width=requested_width;
  if found then
    if existing.receipt_hash<>receipt->>'receipt_hash' or existing.receipt_json<>receipt
    then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('disposition','REPLAYED','receipt',existing.receipt_json);
  end if;
  insert into app_data_agent.falcon24_e1_ui_receipts(
    app_id,tenant_id,environment,run_id,receipt_kind,viewport_width,viewport_height,
    authority_epoch,baseline_id,baseline_hash,activation_attempt_id,web_build_hash,
    dom_snapshot_hash,screenshot_hash,receipt_hash,receipt_json,observed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,requested_run_id,
    requested_kind,requested_width,requested_height,'E1',authority_run.current_baseline_id,
    authority_run.current_baseline_hash,authority_run.current_activation_attempt_id,
    authority_run.web_build_hash,receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash',
    receipt->>'receipt_hash',receipt,(receipt->>'observed_at')::timestamptz);
  return pg_catalog.jsonb_build_object('disposition','CREATED','receipt',receipt);
end
$function$;

create function app_data_agent.load_falcon24_e1_ui_receipts(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;requested_run_id uuid;authority_run record;receipts jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-ui-receipts-load@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_E1_UI_RECEIPT_LOAD_INVALID'; end if;
  requested_run_id:=(command->>'run_id')::uuid;
  select * into strict authority from platform.current_backend_authority(false);
  select run.authority_epoch,run.authority_baseline_id,run.authority_baseline_hash,
    run.authority_activation_attempt_id,current_epoch.baseline_id as current_baseline_id,
    current_epoch.baseline_hash as current_baseline_hash,
    current_epoch.activation_attempt_id as current_activation_attempt_id
  into authority_run from app_data_agent.runs run
  join app_data_agent.falcon24_current_authority_epoch current_epoch
    on current_epoch.app_id=run.app_id and current_epoch.tenant_id=run.tenant_id
      and current_epoch.environment=run.environment
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=requested_run_id
    and run.principal_id=authority.principal_id;
  if not found or authority_run.authority_epoch<>'E1'
    or authority_run.authority_baseline_id<>authority_run.current_baseline_id
    or authority_run.authority_baseline_hash<>authority_run.current_baseline_hash
    or authority_run.authority_activation_attempt_id<>authority_run.current_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_AUTHORITY_MISMATCH'; end if;
  select coalesce(pg_catalog.jsonb_agg(row.receipt_json order by
    row.receipt_kind,row.viewport_width),'[]'::jsonb) into receipts
  from app_data_agent.falcon24_e1_ui_receipts row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.run_id=requested_run_id
    and row.baseline_id=authority_run.current_baseline_id
    and row.baseline_hash=authority_run.current_baseline_hash
    and row.activation_attempt_id=authority_run.current_activation_attempt_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipt-set@1.0.0','run_id',requested_run_id,
    'authority',pg_catalog.jsonb_build_object(
      'schema_version','falcon24-authority-binding@1.0.0','authority_epoch','E1',
      'baseline_id',authority_run.current_baseline_id,
      'baseline_hash',authority_run.current_baseline_hash,
      'activation_attempt_id',authority_run.current_activation_attempt_id),
    'receipts',receipts);
end
$function$;
alter table app_data_agent.falcon24_e1_ui_receipts owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_e1_ui_receipts(jsonb) owner to data_agent_u6_rpc_owner;

alter table app_data_agent.falcon24_e1_ui_receipts enable row level security;
alter table app_data_agent.falcon24_e1_ui_receipts force row level security;
revoke all on table app_data_agent.falcon24_e1_ui_receipts from public;
grant select,insert on table app_data_agent.falcon24_e1_ui_receipts to data_agent_u6_rpc_owner;
create policy falcon24_e1_ui_receipts_rpc on app_data_agent.falcon24_e1_ui_receipts
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy falcon24_e1_ui_receipts_rpc_insert on app_data_agent.falcon24_e1_ui_receipts
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

revoke all on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb),
  app_data_agent.load_falcon24_e1_ui_receipts(jsonb) from public;
grant execute on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb),
  app_data_agent.load_falcon24_e1_ui_receipts(jsonb) to data_agent_backend;
do $postconditions$
declare commit_definition text;load_definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_ui_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_falcon24_e1_ui_receipts(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_SCHEMA_DRIFT'; end if;
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)'::regprocedure;
  select prosrc into strict load_definition from pg_catalog.pg_proc
    where oid='app_data_agent.load_falcon24_e1_ui_receipts(jsonb)'::regprocedure;
  if pg_catalog.strpos(commit_definition,'QUESTION_COMPOSER_SUBMIT_TO_RESULT')=0
    or pg_catalog.strpos(commit_definition,'RESULT_TRACE_ENTRY_TO_EXACT_RUN')=0
    or pg_catalog.strpos(commit_definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.strpos(commit_definition,'opened_artifact_refs')=0
    or pg_catalog.strpos(load_definition,'falcon24_current_authority_epoch')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_DEFINITION_STALE'; end if;
  if exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_e1_ui_receipts'::regclass
        and (not relation.relrowsecurity or not relation.relforcerowsecurity))
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_SECURITY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010777_app_data_agent_falcon24_e1_trace',
  'sha256:19aba47caeecfbc784238186b891858ae25174b7a79af324e89dce998f59f22a');
commit;
