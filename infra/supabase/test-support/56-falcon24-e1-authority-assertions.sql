\set ON_ERROR_STOP on

begin;

insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values('00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa34'::uuid,'test','falcon24-e1-hold',
  'Falcon24 E1 HOLD fixture');
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role)
values('00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa34'::uuid,'test',
  '00000000-0000-4000-8000-000000001033'::uuid,'owner');

insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values('00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa35'::uuid,'prod','falcon24-e1-prod-hold',
  'Falcon24 E1 production HOLD fixture');
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role)
values('00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa35'::uuid,'prod',
  '00000000-0000-4000-8000-000000001035'::uuid,'owner');

do $production_hold_rejected$
begin
  begin
    perform test_support.activate_falcon24_e1_fixture(
      '00000000-0000-4000-8000-00000000aa35'::uuid,'prod',
      '00000000-0000-4000-8000-000000001035'::uuid,
      '00000000-0000-4000-8000-00000000de02'::uuid,false,8);
    raise exception 'FALCON24_E1_PRODUCTION_HOLD_ACTIVATED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_ACTIVATION_PREFLIGHT_FAILED' then raise; end if;
  end;
end
$production_hold_rejected$;

create function pg_temp.e1_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create function pg_temp.forge_cross_epoch_artifact()
returns void language sql volatile security definer set search_path='' as $function$
  insert into app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,created_at,authority_epoch,authority_baseline_id,
    authority_baseline_hash,authority_activation_attempt_id)
  values('00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,'test',
    '00000000-0000-4000-8000-00000000a101'::uuid,
    '00000000-0000-4000-8000-00000000e156'::uuid,'Report',1,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{}'::jsonb,1,true,pg_catalog.clock_timestamp(),'E1',
    '00000000-0000-4000-8000-000000007201'::uuid,
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '00000000-0000-4000-8000-000000007301'::uuid)
$function$;

select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

set local role data_agent_backend;

do $active_binding$
declare current_binding jsonb; run_binding jsonb; command jsonb;
begin
  current_binding:=app_data_agent.load_falcon24_current_authority_epoch();
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-run-authority-load@1.0.0',
    'run_id','00000000-0000-4000-8000-00000000a101');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  run_binding:=app_data_agent.load_falcon24_run_authority_binding(command);
  if current_binding is null or current_binding->>'authority_epoch'<>'E1'
    or current_binding is distinct from run_binding
    or current_binding->>'baseline_id'<>'00000000-0000-4000-8000-000000007201'
    or current_binding->>'activation_attempt_id'<>'00000000-0000-4000-8000-000000007301'
  then raise exception 'FALCON24_E1_RUN_BINDING_ASSERTION_FAILED'; end if;
  begin
    perform pg_temp.forge_cross_epoch_artifact();
    raise exception 'FALCON24_E1_CROSS_EPOCH_ARTIFACT_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_ARTIFACT_AUTHORITY_MISMATCH' then raise; end if;
  end;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_authority_baselines','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_current_authority_epoch','UPDATE')
  then raise exception 'FALCON24_E1_DIRECT_TABLE_BYPASS'; end if;
end
$active_binding$;

reset role;
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa34',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001033',true);
set local role data_agent_backend;

do $hold_is_terminal$
declare staging_id constant uuid:='00000000-0000-4000-8000-000000007133'::uuid;
  baseline_id constant uuid:='00000000-0000-4000-8000-000000007233'::uuid;
  attempt_id constant uuid:='00000000-0000-4000-8000-000000007333'::uuid;
  retained_hash constant text:='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  component text; baseline_key text; receipt jsonb; command jsonb; baseline jsonb;
  receipt_hashes jsonb:='{}'::jsonb; attempt jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-session-begin@1.0.0',
    'staging_id',staging_id,'retained_assets_hash',retained_hash);
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  perform app_data_agent.begin_falcon24_e1_staging_session(command);
  foreach component in array array['AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SEMANTIC_RELEASE']::text[] loop
    baseline_key:=case component when 'AGENT_PROFILES' then 'agent_profiles'
      when 'DATASET' then 'dataset' when 'LLM_CONFIGURATION' then 'llm_configuration'
      when 'OPERATOR_REGISTRY' then 'operator_registry' else 'semantic_release' end;
    receipt:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-e1-staging-receipt@1.0.0','staging_id',staging_id,
      'component',component,
      'subject_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'evidence_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'production_isolation_proven',false);
    receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',pg_temp.e1_hash(receipt));
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-e1-staging-receipt-record@1.0.0','receipt',receipt);
    command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
    perform app_data_agent.record_falcon24_e1_staging_receipt(command);
    receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(
      baseline_key,receipt->>'receipt_hash');
  end loop;
  receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(
    'sandbox_runtime','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  baseline:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@1.0.0','baseline_id',baseline_id,
    'authority_epoch','E1','source_commit',pg_catalog.repeat('d',40),
    'retained_assets_hash',retained_hash,
    'web_build_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'staging_receipts',receipt_hashes,
    'acceptance_contracts',pg_catalog.jsonb_build_object(
      'oracle','sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'qualification','sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'campaign','sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'qa_e2e','sha256:4444444444444444444444444444444444444444444444444444444444444444',
      'trace_ui','sha256:5555555555555555555555555555555555555555555555555555555555555555',
      'reclamation','sha256:6666666666666666666666666666666666666666666666666666666666666666'),
    'production_isolation_proven',false,'production_gate','HOLD');
  baseline:=baseline||pg_catalog.jsonb_build_object('baseline_hash',pg_temp.e1_hash(baseline));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-baseline-stage@1.0.0','staging_id',staging_id,
    'baseline',baseline);
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  begin
    perform app_data_agent.stage_falcon24_e1_authority_baseline(command);
    raise exception 'FALCON24_E1_INCOMPLETE_BASELINE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_STAGING_INCOMPLETE' then raise; end if;
  end;

  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-receipt@1.0.0','staging_id',staging_id,
    'component','SANDBOX_RUNTIME',
    'subject_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'evidence_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'production_isolation_proven',false);
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',pg_temp.e1_hash(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-receipt-record@1.0.0','receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  perform app_data_agent.record_falcon24_e1_staging_receipt(command);
  baseline:=pg_catalog.jsonb_set(baseline,'{staging_receipts,sandbox_runtime}',
    pg_catalog.to_jsonb(receipt->>'receipt_hash'))-'baseline_hash';
  baseline:=baseline||pg_catalog.jsonb_build_object('baseline_hash',pg_temp.e1_hash(baseline));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-baseline-stage@1.0.0','staging_id',staging_id,
    'baseline',baseline);
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  perform app_data_agent.stage_falcon24_e1_authority_baseline(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-activation-attempt-begin@1.0.0',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  perform app_data_agent.begin_falcon24_e1_activation_attempt(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-activation-attempt-hold@1.0.0',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash',
    'failure_code','FALCON24_E1_TEST_HOLD');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  attempt:=app_data_agent.hold_falcon24_e1_activation_attempt(command);
  if attempt->>'status'<>'HOLD' then raise exception 'FALCON24_E1_HOLD_NOT_RECORDED'; end if;
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-authority-activate@1.0.0',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  begin
    perform app_data_agent.activate_falcon24_e1_authority(command);
    raise exception 'FALCON24_E1_HOLD_ATTEMPT_RESUMED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_ACTIVATION_ATTEMPT_TERMINAL' then raise; end if;
  end;
  if app_data_agent.load_falcon24_current_authority_epoch() is not null
  then raise exception 'FALCON24_E1_HOLD_CREATED_CURRENT_POINTER'; end if;
end
$hold_is_terminal$;

rollback;
