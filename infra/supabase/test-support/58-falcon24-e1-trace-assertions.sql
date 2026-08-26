\set ON_ERROR_STOP on

begin;

create function pg_temp.e1_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

do $schema_authority$
declare commit_definition text;load_definition text;
begin
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)'::regprocedure;
  select prosrc into strict load_definition from pg_catalog.pg_proc
    where oid='app_data_agent.load_falcon24_e1_ui_receipts(jsonb)'::regprocedure;
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_ui_receipts') is null
    or pg_catalog.strpos(commit_definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.strpos(commit_definition,'FALCON24_E1_UI_RECEIPT_ARTIFACT_MISMATCH')=0
    or pg_catalog.strpos(load_definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_e1_ui_receipts','INSERT')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
  then raise exception 'FALCON24_E1_UI_RECEIPT_AUTHORITY_ASSERTION_FAILED'; end if;
end
$schema_authority$;

update app_data_agent.runs set status='SUCCEEDED',updated_at=pg_catalog.clock_timestamp()
where app_id='00000000-0000-4000-8000-00000000da01'::uuid
  and tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
  and environment='test' and run_id='00000000-0000-4000-8000-00000000a101'::uuid;

insert into app_data_agent.artifacts(
  app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
  document_json,worker_fence,is_active,created_at)
select '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,'test',
  '00000000-0000-4000-8000-00000000a101'::uuid,
  ('00000000-0000-4000-8000-'||pg_catalog.lpad((8800+ordinality)::text,12,'0'))::uuid,
  artifact_type,1,'sha256:'||pg_catalog.repeat(pg_catalog.substr('12345',ordinality::integer,1),64),
  pg_catalog.jsonb_build_object('fixture',artifact_type),1,true,pg_catalog.clock_timestamp()
from pg_catalog.unnest(array['AnalysisReport','ArtifactWorkspaceDocument',
  'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact']::text[])
  with ordinality item(artifact_type,ordinality);

create function pg_temp.e1_ui_receipt(requested_kind text,requested_width integer)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare binding record;authority_json jsonb;web_build jsonb;viewport jsonb;receipt jsonb;
  references_json jsonb;chart_reference jsonb;
begin
  select current_epoch.baseline_id,current_epoch.baseline_hash,current_epoch.activation_attempt_id,
    baseline.web_build_hash into strict binding
  from app_data_agent.falcon24_current_authority_epoch current_epoch
  join app_data_agent.falcon24_authority_baselines baseline
    on baseline.app_id=current_epoch.app_id and baseline.tenant_id=current_epoch.tenant_id
      and baseline.environment=current_epoch.environment and baseline.baseline_id=current_epoch.baseline_id
  where current_epoch.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and current_epoch.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
    and current_epoch.environment='test';
  authority_json:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-binding@1.0.0','authority_epoch','E1',
    'baseline_id',binding.baseline_id,'baseline_hash',binding.baseline_hash,
    'activation_attempt_id',binding.activation_attempt_id);
  web_build:=pg_catalog.jsonb_build_object('build_id',binding.web_build_hash,
    'generation_id','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
  viewport:=pg_catalog.jsonb_build_object('width',requested_width,'height',
    case when requested_width=390 then 844 else 900 end);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'artifact_id',artifact_id,'artifact_type',artifact_type,'app_id',app_id,
    'tenant_id',tenant_id,'environment',environment,'run_id',run_id,
    'revision',revision,'content_hash',content_hash) order by artifact_type,artifact_id)
  into references_json from app_data_agent.artifacts row
  where row.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and row.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
    and row.environment='test' and row.run_id='00000000-0000-4000-8000-00000000a101'::uuid
    and row.artifact_type in('AnalysisReport','ArtifactWorkspaceDocument',
      'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact') and row.artifact_id::text like '%00880_';
  select item into strict chart_reference from pg_catalog.jsonb_array_elements(references_json) item
    where item->>'artifact_type'='ArtifactWorkspaceDocument';
  if requested_kind='QA_E2E' then
    receipt:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-qa-e2e-receipt@1.0.0',
      'run_id','00000000-0000-4000-8000-00000000a101',
      'conversation_id','00000000-0000-4000-8000-000000008899',
      'authority',authority_json,'web_build',web_build,
      'browser_harness_version','falcon24-agent-browser-trace-gate@2.0.0',
      'viewport',viewport,'entry_path','QUESTION_COMPOSER_SUBMIT_TO_RESULT',
      'question_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'terminal_status','COMPLETED','answer_visible',true,'table_visible',true,
      'chart_rendered',true,'report_visible',true,'error_banner',null,
      'dom_snapshot_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'screenshot_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'observed_at','2026-08-27T00:00:00.000Z');
  else
    receipt:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-trace-ui-receipt@1.0.0',
      'run_id','00000000-0000-4000-8000-00000000a101',
      'conversation_id','00000000-0000-4000-8000-000000008899',
      'trace_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'authority',authority_json,'web_build',web_build,
      'browser_harness_version','falcon24-agent-browser-trace-gate@2.0.0',
      'viewport',viewport,'entry_path','RESULT_TRACE_ENTRY_TO_EXACT_RUN',
      'opened_nodes',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'node_id','root','detail_hash',
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')),
      'opened_artifact_refs',references_json,'chart_ref',chart_reference,
      'chart_rendered',true,'source_table_visible',true,'returned_to_result',true,
      'error_banner',null,
      'dom_snapshot_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'screenshot_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'observed_at','2026-08-27T00:00:01.000Z');
  end if;
  return receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.e1_hash(receipt));
end
$function$;

create function pg_temp.e1_ui_command(requested_kind text,requested_width integer)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare command jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipt-commit@1.0.0',
    'run_id','00000000-0000-4000-8000-00000000a101','receipt_kind',requested_kind,
    'receipt',pg_temp.e1_ui_receipt(requested_kind,requested_width));
  return command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.e1_hash(command));
end
$function$;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

set local role data_agent_backend;
do $complete_ui_pair$
declare requested_kind text;requested_width integer;result jsonb;load_command jsonb;loaded jsonb;
begin
  foreach requested_kind in array array['QA_E2E','TRACE_UI']::text[] loop
    foreach requested_width in array array[390,1440]::integer[] loop
      result:=app_data_agent.commit_falcon24_e1_ui_receipt(
        pg_temp.e1_ui_command(requested_kind,requested_width));
      if result->>'disposition'<>'CREATED'
      then raise exception 'FALCON24_E1_UI_RECEIPT_NOT_CREATED: %',result; end if;
    end loop;
  end loop;
  result:=app_data_agent.commit_falcon24_e1_ui_receipt(pg_temp.e1_ui_command('QA_E2E',390));
  if result->>'disposition'<>'REPLAYED'
  then raise exception 'FALCON24_E1_UI_RECEIPT_REPLAY_FAILED'; end if;
  load_command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipts-load@1.0.0',
    'run_id','00000000-0000-4000-8000-00000000a101');
  load_command:=load_command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.e1_hash(load_command));
  loaded:=app_data_agent.load_falcon24_e1_ui_receipts(load_command);
  if pg_catalog.jsonb_array_length(loaded->'receipts')<>4
    or loaded#>>'{authority,authority_epoch}'<>'E1'
  then raise exception 'FALCON24_E1_UI_RECEIPT_PAIR_INCOMPLETE: %',loaded; end if;
end
$complete_ui_pair$;

do $stale_baseline_rejected$
declare command jsonb;receipt jsonb;
begin
  receipt:=pg_temp.e1_ui_receipt('QA_E2E',1440);
  receipt:=pg_catalog.jsonb_set(receipt,'{authority,baseline_hash}',
    pg_catalog.to_jsonb('sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'::text))
    -'receipt_hash';
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.e1_hash(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipt-commit@1.0.0',
    'run_id','00000000-0000-4000-8000-00000000a101','receipt_kind','QA_E2E','receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.e1_hash(command));
  begin
    perform app_data_agent.commit_falcon24_e1_ui_receipt(command);
    raise exception 'FALCON24_E1_STALE_UI_RECEIPT_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_UI_RECEIPT_AUTHORITY_MISMATCH' then raise; end if;
  end;
end
$stale_baseline_rejected$;

do $replay_mismatch_rejected$
declare command jsonb;receipt jsonb;
begin
  receipt:=pg_temp.e1_ui_receipt('QA_E2E',390)-'receipt_hash';
  receipt:=pg_catalog.jsonb_set(receipt,'{screenshot_hash}',
    pg_catalog.to_jsonb('sha256:9999999999999999999999999999999999999999999999999999999999999999'::text));
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.e1_hash(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipt-commit@1.0.0',
    'run_id','00000000-0000-4000-8000-00000000a101','receipt_kind','QA_E2E','receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.e1_hash(command));
  begin
    perform app_data_agent.commit_falcon24_e1_ui_receipt(command);
    raise exception 'FALCON24_E1_UI_RECEIPT_REPLAY_MISMATCH_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_UI_RECEIPT_REPLAY_MISMATCH' then raise; end if;
  end;
end
$replay_mismatch_rejected$;
reset role;

do $exact_authority_rows$
begin
  if (select pg_catalog.count(*) from app_data_agent.falcon24_e1_ui_receipts
      where run_id='00000000-0000-4000-8000-00000000a101'::uuid)<>4
    or exists(select 1 from app_data_agent.falcon24_e1_ui_receipts receipt
      join app_data_agent.falcon24_current_authority_epoch current_epoch
        on current_epoch.app_id=receipt.app_id and current_epoch.tenant_id=receipt.tenant_id
          and current_epoch.environment=receipt.environment
      where receipt.run_id='00000000-0000-4000-8000-00000000a101'::uuid
        and (receipt.baseline_id<>current_epoch.baseline_id
          or receipt.baseline_hash<>current_epoch.baseline_hash
          or receipt.activation_attempt_id<>current_epoch.activation_attempt_id))
  then raise exception 'FALCON24_E1_UI_RECEIPT_EXACT_AUTHORITY_ASSERTION_FAILED'; end if;
end
$exact_authority_rows$;

rollback;
