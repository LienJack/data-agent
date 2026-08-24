-- analysis_result_stage_ordinality_repair_migration_checksum: sha256:961d0247fdafb83cc536ab7afd428783ecade1aec8a4e13ec1603ea37101fc34
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010755_app_data_agent_analysis_lifecycle_variable_conflict_repair')
  then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_BASELINE_10755_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.stage_analysis_result(envelope_json jsonb,contents_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare
  command_json jsonb; journal_json jsonb; scope_json jsonb; existing record; journal_result jsonb;
  artifact_record record; content_bytes bytea; observed_hash text; created_count bigint; stage_result jsonb;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or command_json->>'schema_version'<>'analysis-result-stage-command@1.0.0'
    or pg_catalog.jsonb_typeof(contents_json)<>'array'
    or pg_catalog.jsonb_array_length(contents_json)<>pg_catalog.jsonb_array_length(command_json->'artifacts')
    or journal_json->'event'->>'event_type'<>'PUBLISH_STAGE_CREATED'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'stage_hash'<>command_json->>'stage_hash'
    or journal_json->'event'->>'closure_hash'<>command_json->>'closure_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into existing from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid and source.idempotency_key=command_json->>'idempotency_key';
  if existing.stage_id is not null and existing.stage_hash<>command_json->>'stage_hash' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_IDEMPOTENCY_CONFLICT');
  end if;
  begin
    if existing.stage_id is null then
      insert into app_data_agent.analysis_result_stages(
        app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,principal_id,worker_fence,
        idempotency_key,publish_id,contract_hash,manifest_hash,closure_hash,stage_hash,governed_results_json,
        artifacts_json,command_json,expires_at
      ) values (
        (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
        (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
        (command_json->>'context_generation')::integer,(command_json->>'stage_id')::uuid,
        (command_json->>'principal_id')::uuid,(command_json->>'worker_fence')::bigint,command_json->>'idempotency_key',
        command_json->>'publish_id',command_json->>'contract_hash',command_json->>'manifest_hash',
        command_json->>'closure_hash',command_json->>'stage_hash',command_json->'governed_operator_results',
        command_json->'artifacts',command_json,(command_json->>'expires_at')::timestamptz
      );
      for artifact_record in
        select value,ordinality from pg_catalog.jsonb_array_elements(command_json->'artifacts') with ordinality
      loop
        content_bytes:=pg_catalog.decode(contents_json->>((artifact_record.ordinality-1)::integer),'base64');
        observed_hash:='sha256:'||pg_catalog.encode(extensions.digest(content_bytes,'sha256'),'hex');
        if observed_hash<>artifact_record.value->>'content_sha256'
          or pg_catalog.octet_length(content_bytes)<>(artifact_record.value->>'bytes')::integer
        then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_CONTENT_HASH_MISMATCH'; end if;
        insert into app_data_agent.analysis_result_stage_artifacts(
          app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
          artifact_name,artifact_kind,media_type,content_sha256,byte_count,content_bytes
        ) values (
          (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
          (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
          (command_json->>'context_generation')::integer,(command_json->>'stage_id')::uuid,
          artifact_record.value->>'artifact_name',artifact_record.value->>'artifact_kind',
          artifact_record.value->>'media_type',observed_hash,pg_catalog.octet_length(content_bytes),content_bytes
        );
      end loop;
      created_count:=1;
    else created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code',sqlerrm);
  end;
  stage_result:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-result-stage@1.0.0','stage_id',command_json->>'stage_id',
    'stage_hash',command_json->>'stage_hash','closure_hash',command_json->>'closure_hash',
    'status','STAGED','created',created_count=1,'expires_at',command_json->>'expires_at');
  return pg_catalog.jsonb_build_object('ok',true,'stage',stage_result,'journal_entry',journal_result->'entry');
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CONTRACT_INVALID');
end
$function$;

alter function app_data_agent.stage_analysis_result(jsonb,jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.stage_analysis_result(jsonb,jsonb) from public;
grant execute on function app_data_agent.stage_analysis_result(jsonb,jsonb) to data_agent_backend;
do $postconditions$
declare definition text;
begin
  select prosrc into strict definition from pg_catalog.pg_proc
    where oid='app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(definition,'contents_json->>((artifact_record.ordinality-1)::integer)')=0
  then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_DEFINITION_STALE'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.stage_analysis_result(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010756_app_data_agent_analysis_result_stage_ordinality_repair',
  'sha256:961d0247fdafb83cc536ab7afd428783ecade1aec8a4e13ec1603ea37101fc34');
commit;
