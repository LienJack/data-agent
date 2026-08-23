-- analysis_python_source_replay_migration_checksum: sha256:0ac45d89ca4d230206cac6500db94dbb7051ef15f6f9e2a133dd206e17fce28c
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_PYTHON_SOURCE_REPLAY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_PYTHON_SOURCE_REPLAY_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010709_app_data_agent_analysis_python_source_authority')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_REPLAY_BASELINE_10709_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function app_data_agent.load_analysis_python_source(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  program_ref jsonb;
  target_run record;
  target_attempt record;
  target_outbox record;
  source_record app_data_agent.analysis_python_sources%rowtype;
  db_now timestamptz;
begin
  command_json:=envelope_json->'command';
  scope_json:=command_json->'scope';
  program_ref:=command_json->'analysis_program_ref';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      envelope_json,array['protocol_version','authority_capability_id','command'])
    or not app_data_agent.provider_json_object_has_exact_keys(command_json,array[
      'schema_version','scope','run_id','principal_id','attempt_id','worker_fence',
      'analysis_program_ref','node_id','generation_attempt'])
    or command_json->>'schema_version'<>'analysis-python-source-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      scope_json,array['app_id','tenant_id','environment'])
    or not app_data_agent.provider_json_object_has_exact_keys(program_ref,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'])
    or program_ref->>'artifact_type'<>'AnalysisProgram'
    or (program_ref->>'revision')::integer<>1
    or program_ref->>'app_id'<>scope_json->>'app_id'
    or program_ref->>'tenant_id'<>scope_json->>'tenant_id'
    or program_ref->>'environment'<>scope_json->>'environment'
    or program_ref->>'run_id'<>command_json->>'run_id'
    or (command_json->>'generation_attempt')::integer not in (0,1)
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID'); end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','PLANNING',null,null,true);
  select source.* into target_run from app_data_agent.runs source
  where source.app_id=(scope_json->>'app_id')::uuid
    and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment'
    and source.run_id=(command_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
  for update of source nowait;
  select source.* into target_attempt from app_data_agent.run_attempts source
  where source.app_id=target_run.app_id and source.tenant_id=target_run.tenant_id
    and source.environment=target_run.environment and source.run_id=target_run.run_id
    and source.attempt_id=(command_json->>'attempt_id')::uuid;
  select source.* into target_outbox from app_data_agent.outbox source
  where source.app_id=target_attempt.app_id and source.tenant_id=target_attempt.tenant_id
    and source.environment=target_attempt.environment
    and source.outbox_id=target_attempt.outbox_id and source.run_id=target_attempt.run_id
  for update of source nowait;
  select source.* into target_attempt from app_data_agent.run_attempts source
  where source.app_id=target_attempt.app_id and source.tenant_id=target_attempt.tenant_id
    and source.environment=target_attempt.environment
    and source.attempt_id=target_attempt.attempt_id
  for update of source nowait;
  db_now:=pg_catalog.clock_timestamp();
  if target_run.run_id is null or target_attempt.attempt_id is null or target_outbox.outbox_id is null
    or target_attempt.status<>'ACTIVE'
    or target_attempt.worker_fence<>(command_json->>'worker_fence')::bigint
    or target_attempt.lease_expires_at<=db_now
    or target_outbox.active_attempt_id<>target_attempt.attempt_id
    or target_outbox.run_fence<>target_attempt.worker_fence
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','RESEARCH_AUTHORITY_FENCE_MISMATCH'); end if;

  select source.* into source_record from app_data_agent.analysis_python_sources source
  where source.app_id=target_run.app_id and source.tenant_id=target_run.tenant_id
    and source.environment=target_run.environment and source.run_id=target_run.run_id
    and source.principal_id=target_run.principal_id
    and source.analysis_program_id=(program_ref->>'artifact_id')::uuid
    and source.analysis_program_revision=(program_ref->>'revision')::integer
    and source.analysis_program_hash=program_ref->>'content_hash'
    and source.node_id=command_json->>'node_id'
    and source.generation_attempt=(command_json->>'generation_attempt')::integer
  order by source.committed_at,source.artifact_id limit 1;
  if not found then return pg_catalog.jsonb_build_object('ok',true,'source',null); end if;
  return pg_catalog.jsonb_build_object('ok',true,'source',pg_catalog.jsonb_build_object(
    'receipt',source_record.receipt_json,
    'ciphertext_base64',pg_catalog.replace(pg_catalog.replace(
      pg_catalog.encode(source_record.ciphertext_bytes,'base64'),pg_catalog.chr(10),''),
      pg_catalog.chr(13),'')));
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID');
end
$function$;
alter function app_data_agent.load_analysis_python_source(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.load_analysis_python_source(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_analysis_python_source(jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text;
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_analysis_python_source(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.analysis_python_sources','SELECT,INSERT,UPDATE,DELETE')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_REPLAY_GRANT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.load_analysis_python_source(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'analysis-python-source-load@1.0.0')=0
    or pg_catalog.strpos(definition,'AnalysisProgram')=0
    or pg_catalog.strpos(definition,'RESEARCH_AUTHORITY_FENCE_MISMATCH')=0
    or pg_catalog.strpos(definition,'ciphertext_base64')=0
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_REPLAY_CONTRACT_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010710_app_data_agent_analysis_python_source_replay',
  'sha256:0ac45d89ca4d230206cac6500db94dbb7051ef15f6f9e2a133dd206e17fce28c');
commit;
