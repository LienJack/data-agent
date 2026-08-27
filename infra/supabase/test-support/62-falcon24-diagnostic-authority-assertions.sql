\set ON_ERROR_STOP on

begin;

do $catalog_security$
begin
  if not exists(select 1 from pg_catalog.pg_class row
      where row.oid='app_data_agent.falcon24_diagnostic_attempts'::pg_catalog.regclass
        and row.relrowsecurity and row.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class row
      where row.oid='app_data_agent.falcon24_diagnostic_receipts'::pg_catalog.regclass
        and row.relrowsecurity and row.relforcerowsecurity)
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_diagnostic_attempts','INSERT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_diagnostic_receipts','SELECT')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.begin_falcon24_diagnostic(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb)','EXECUTE')
  then raise exception 'FALCON24_DIAGNOSTIC_SECURITY_ASSERTION_FAILED'; end if;
end
$catalog_security$;

create function pg_temp.falcon24_diagnostic_begin_command(requested_attempt uuid,requested_run uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare current_epoch record;baseline record;stage record;manifest jsonb;command jsonb;
  question_value constant text:='最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。';
begin
  select * into strict current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and row.tenant_id='00000000-0000-4000-8000-00000000aa83'::uuid
      and row.environment='test' and row.authority_epoch='E4';
  select * into strict baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=current_epoch.app_id and row.tenant_id=current_epoch.tenant_id
      and row.environment=current_epoch.environment and row.baseline_id=current_epoch.baseline_id
      and row.baseline_hash=current_epoch.baseline_hash and row.status='ACTIVE';
  select * into strict stage from semantic.semantic_successor_release_stage row
    where row.app_id=current_epoch.app_id and row.tenant_id=current_epoch.tenant_id
      and row.environment=current_epoch.environment and row.semantic_domain='falcon24_successor'
      and row.status='PROMOTED' and row.target_generation=2;
  manifest:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-attempt@1.0.0','attempt_id',requested_attempt,
    'run_id',requested_run,'authority',pg_catalog.jsonb_build_object(
      'schema_version','falcon24-authority-binding@2.0.0','authority_epoch','E4',
      'baseline_id',current_epoch.baseline_id,'baseline_hash',current_epoch.baseline_hash,
      'activation_attempt_id',current_epoch.activation_attempt_id),
    'semantic_release',pg_catalog.jsonb_build_object(
      'release_id',stage.candidate_release_id,'generation',2,
      'release_digest',stage.candidate_release_digest,'datasource_id',stage.datasource_id),
    'source_commit',baseline.source_commit,
    'source_fingerprint','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'web_build',pg_catalog.jsonb_build_object(
      'build_id',baseline.web_build_hash,
      'generation_id','sha256:2222222222222222222222222222222222222222222222222222222222222222'),
    'worker_build',pg_catalog.jsonb_build_object(
      'build_id','sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'generation_id','sha256:4444444444444444444444444444444444444444444444444444444444444444'),
    'runtime_attestation_hash',
      'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    'question',question_value,
    'question_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(question_value)));
  manifest:=manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(manifest));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-begin@1.0.0','manifest',manifest);
  return command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
end
$function$;

create function pg_temp.falcon24_diagnostic_load_command(requested_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare command jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-load@1.0.0','attempt_id',requested_attempt);
  return command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
end
$function$;

select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa83',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001083',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
select pg_catalog.set_config('app.semantic_domain','falcon24_successor',true);

set local role data_agent_backend;
do $backend_surface$
declare first_attempt jsonb;loaded jsonb;
begin
  begin
    insert into app_data_agent.falcon24_diagnostic_attempts default values;
    raise exception 'FALCON24_DIAGNOSTIC_DIRECT_DML_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  first_attempt:=app_data_agent.begin_falcon24_diagnostic(
    pg_temp.falcon24_diagnostic_begin_command(
      '00000000-0000-4000-8000-000000009001'::uuid,
      '00000000-0000-4000-8000-000000009101'::uuid));
  if first_attempt->>'status'<>'ACTIVE' then
    raise exception 'FALCON24_DIAGNOSTIC_BEGIN_ASSERTION_FAILED'; end if;
  begin
    perform app_data_agent.begin_falcon24_diagnostic(
      pg_temp.falcon24_diagnostic_begin_command(
        '00000000-0000-4000-8000-000000009002'::uuid,
        '00000000-0000-4000-8000-000000009102'::uuid));
    raise exception 'FALCON24_DIAGNOSTIC_SECOND_ACTIVE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_DIAGNOSTIC_ACTIVE_ATTEMPT_EXISTS' then raise; end if;
  end;
  loaded:=app_data_agent.load_falcon24_diagnostic(
    pg_temp.falcon24_diagnostic_load_command(
      '00000000-0000-4000-8000-000000009001'::uuid));
  if loaded->>'manifest_hash'<>first_attempt->>'manifest_hash'
  then raise exception 'FALCON24_DIAGNOSTIC_LOAD_ASSERTION_FAILED'; end if;
end
$backend_surface$;
reset role;

do $append_only$
declare attempt app_data_agent.falcon24_diagnostic_attempts%rowtype;receipt jsonb;
  receipt_hash_value text;
begin
  select * into strict attempt from app_data_agent.falcon24_diagnostic_attempts row
    where row.attempt_id='00000000-0000-4000-8000-000000009001';
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-receipt@1.0.0','attempt_id',attempt.attempt_id,
    'run_id',attempt.run_id,'attempt_manifest_hash',attempt.manifest_hash,
    'authority',attempt.manifest_document->'authority',
    'semantic_release',attempt.manifest_document->'semantic_release','outcome','FAIL',
    'pass_evidence',null,'failure_class','EXTERNAL_DEPENDENCY',
    'failure_code','TEST_EXTERNAL_DEPENDENCY','completed_at','2026-08-28T12:00:00.000Z');
  receipt_hash_value:=app_data_agent.u2_canonical_sha256(receipt);
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash_value);
  insert into app_data_agent.falcon24_diagnostic_receipts(
    app_id,tenant_id,environment,attempt_id,run_id,outcome,completion_command_hash,
    receipt_hash,receipt_document)
  values(attempt.app_id,attempt.tenant_id,attempt.environment,attempt.attempt_id,attempt.run_id,
    'FAIL','sha256:6666666666666666666666666666666666666666666666666666666666666666',
    receipt_hash_value,receipt);
  begin
    update app_data_agent.falcon24_diagnostic_receipts set outcome=outcome
      where attempt_id=attempt.attempt_id;
    raise exception 'FALCON24_DIAGNOSTIC_RECEIPT_UPDATE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from app_data_agent.falcon24_diagnostic_attempts
      where attempt_id=attempt.attempt_id;
    raise exception 'FALCON24_DIAGNOSTIC_ATTEMPT_DELETE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE' then raise; end if;
  end;
end
$append_only$;

rollback;

\echo FALCON24_DIAGNOSTIC_AUTHORITY_ASSERTIONS_READY
