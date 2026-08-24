-- analysis_lifecycle_closure_restore_migration_checksum: sha256:9f818f64ef89c5c68be28e96385e4a685ce8a729d92bf881ff87beadee362bf3
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010756_app_data_agent_analysis_result_stage_ordinality_repair')
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_BASELINE_10756_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.read_analysis_result_stage(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare command_json jsonb; scope_json jsonb; stored record; oracle_record record; explanation_record record; artifacts jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope';
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stored from app_data_agent.analysis_result_stages source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash';
  if stored.stage_id is null then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_NOT_FOUND'); end if;
  select source.* into oracle_record from app_data_agent.analysis_stage_oracle_records source
  where source.app_id=stored.app_id and source.tenant_id=stored.tenant_id and source.environment=stored.environment
    and source.run_id=stored.run_id and source.node_id=stored.node_id and source.attempt_id=stored.attempt_id
    and source.context_generation=stored.context_generation and source.stage_id=stored.stage_id;
  select source.* into explanation_record from app_data_agent.analysis_stage_explanation_records source
  where source.app_id=stored.app_id and source.tenant_id=stored.tenant_id and source.environment=stored.environment
    and source.run_id=stored.run_id and source.node_id=stored.node_id and source.attempt_id=stored.attempt_id
    and source.context_generation=stored.context_generation and source.stage_id=stored.stage_id;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'artifact_name',source.artifact_name,'artifact_kind',source.artifact_kind,'media_type',source.media_type,
    'content_sha256',source.content_sha256,'bytes',source.byte_count,
    'content_base64',pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(source.content_bytes,'base64'),pg_catalog.chr(10),''),pg_catalog.chr(13),''))
    order by source.artifact_name) into artifacts
  from app_data_agent.analysis_result_stage_artifacts source
  where source.app_id=stored.app_id and source.tenant_id=stored.tenant_id and source.environment=stored.environment
    and source.run_id=stored.run_id and source.node_id=stored.node_id and source.attempt_id=stored.attempt_id
    and source.context_generation=stored.context_generation and source.stage_id=stored.stage_id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'stage_command',stored.command_json,'artifacts',artifacts,
    'oracle_record',case when oracle_record.stage_id is null then null else pg_catalog.jsonb_build_object(
      'receipt_payload',oracle_record.receipt_payload,'receipt_hash',oracle_record.receipt_hash) end,
    'explanation_record',case when explanation_record.stage_id is null then null else pg_catalog.jsonb_build_object(
      'explanation',explanation_record.explanation,'explanation_hash',explanation_record.explanation_hash,
      'provider_invocation_ref',explanation_record.provider_invocation_ref) end);
exception when invalid_text_representation then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_READ_CONTRACT_INVALID');
end
$function$;


alter function app_data_agent.read_analysis_result_stage(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.read_analysis_result_stage(jsonb) from public;
grant execute on function app_data_agent.read_analysis_result_stage(jsonb) to data_agent_backend;

create or replace function app_data_agent.commit_analysis_authority(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare
  command_json jsonb; journal_json jsonb; scope_json jsonb; stage_record record; oracle_record record;
  explanation_record record; existing record; binding_record record; staged_artifact record;
  receipt_ref jsonb; journal_result jsonb; references_json jsonb; receipt_json jsonb;
  input_hash text; created_count bigint; stage_artifact_count integer; binding_name_count integer;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or command_json->>'schema_version'<>'analysis-authority-commit@1.0.0'
    or journal_json->'event'->>'event_type'<>'AUTHORITY_COMMITTED'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'authority_commit_hash'<>command_json->>'authority_commit_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'oracle_receipt_payload')<>command_json->>'oracle_receipt_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'explanation')<>command_json->>'explanation_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'sandbox_receipt_payload')<>command_json->>'sandbox_receipt_hash'
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','analysis-authority-commit@1.0.0','value',command_json-'authority_commit_hash'))<>command_json->>'authority_commit_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_COMMIT_CONTRACT_INVALID'); end if;

  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stage_record from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
    and source.worker_fence=(command_json->>'worker_fence')::bigint
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash'
    and source.closure_hash=command_json->>'closure_hash' and source.expires_at>pg_catalog.clock_timestamp()
  for share of source;
  if stage_record.stage_id is null
    or stage_record.command_json->'operator_finalization'->>'operator_receipt_closure_hash'
      is distinct from command_json->>'operator_receipt_closure_hash'
    or command_json->'sandbox_receipt_payload'->>'operator_receipt_closure_hash'
      is distinct from command_json->>'operator_receipt_closure_hash'
    or command_json->'sandbox_receipt_payload'->>'result_contract_hash'
      is distinct from stage_record.command_json->>'contract_hash'
    or command_json->'sandbox_receipt_payload'->>'publish_manifest_hash'
      is distinct from stage_record.command_json->>'manifest_hash'
    or command_json->'sandbox_receipt_payload'->>'published_closure_hash'
      is distinct from stage_record.closure_hash
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_STAGE_INVALID'); end if;

  select source.* into oracle_record from app_data_agent.analysis_stage_oracle_records as source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
    and source.environment=stage_record.environment and source.run_id=stage_record.run_id
    and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
    and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id
  for share of source;
  if oracle_record.stage_id is null
    or oracle_record.principal_id<>(command_json->>'principal_id')::uuid
    or oracle_record.worker_fence<>(command_json->>'worker_fence')::bigint
    or oracle_record.receipt_hash is distinct from command_json->>'oracle_receipt_hash'
    or oracle_record.receipt_payload is distinct from command_json->'oracle_receipt_payload'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_ORACLE_RECORD_INVALID'); end if;

  select source.* into explanation_record from app_data_agent.analysis_stage_explanation_records as source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
    and source.environment=stage_record.environment and source.run_id=stage_record.run_id
    and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
    and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id
  for share of source;
  if explanation_record.stage_id is null
    or explanation_record.principal_id<>(command_json->>'principal_id')::uuid
    or explanation_record.worker_fence<>(command_json->>'worker_fence')::bigint
    or explanation_record.explanation_hash is distinct from command_json->>'explanation_hash'
    or explanation_record.explanation is distinct from command_json->'explanation'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_EXPLANATION_RECORD_INVALID'); end if;

  stage_artifact_count:=pg_catalog.jsonb_array_length(stage_record.artifacts_json);
  select pg_catalog.count(distinct value->'stage_artifact'->>'artifact_name')::integer
  into binding_name_count from pg_catalog.jsonb_array_elements(command_json->'output_bindings');
  if pg_catalog.jsonb_array_length(command_json->'output_bindings')<>stage_artifact_count
    or binding_name_count<>stage_artifact_count
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_OUTPUT_CLOSURE_INVALID'); end if;

  select source.* into existing from app_data_agent.analysis_authority_commits as source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
    and source.environment=stage_record.environment and source.run_id=stage_record.run_id
    and source.principal_id=(command_json->>'principal_id')::uuid and source.idempotency_key=command_json->>'idempotency_key';
  if existing.stage_id is not null and existing.authority_commit_hash<>command_json->>'authority_commit_hash' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_IDEMPOTENCY_CONFLICT');
  end if;

  begin
    if existing.stage_id is null then
      for binding_record in select value from pg_catalog.jsonb_array_elements(command_json->'output_bindings') loop
        select source.* into staged_artifact from app_data_agent.analysis_result_stage_artifacts as source
        where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
          and source.environment=stage_record.environment and source.run_id=stage_record.run_id
          and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
          and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id
          and source.artifact_name=binding_record.value->'stage_artifact'->>'artifact_name';
        if staged_artifact.artifact_name is null
          or staged_artifact.artifact_kind<>binding_record.value->'stage_artifact'->>'artifact_kind'
          or staged_artifact.media_type<>binding_record.value->'stage_artifact'->>'media_type'
          or staged_artifact.byte_count<>(binding_record.value->'stage_artifact'->>'bytes')::integer
          or staged_artifact.content_sha256<>binding_record.value->'stage_artifact'->>'content_sha256'
          or staged_artifact.content_sha256<>binding_record.value->'reference'->>'content_hash'
        then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_OUTPUT_BINDING_INVALID'; end if;
        input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',pg_catalog.jsonb_build_object(
          'command',binding_record.value,'content_hash',staged_artifact.content_sha256));
        insert into app_data_agent.analysis_system_artifacts(
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,principal_id,
          idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes
        ) values (
          stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
          (binding_record.value->'reference'->>'artifact_id')::uuid,'SandboxResult',1,staged_artifact.content_sha256,
          (command_json->>'principal_id')::uuid,(command_json->>'idempotency_key')||':'||staged_artifact.artifact_name,
          stage_record.attempt_id,stage_record.worker_fence,input_hash,
          pg_catalog.jsonb_build_object('stage_id',stage_record.stage_id,'artifact',binding_record.value->'stage_artifact'),
          staged_artifact.content_bytes
        );
      end loop;
      receipt_ref:=command_json->'sandbox_receipt_ref';
      input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',pg_catalog.jsonb_build_object(
        'command',command_json->'sandbox_receipt_payload','content_hash',command_json->>'sandbox_receipt_hash'));
      insert into app_data_agent.analysis_system_artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,principal_id,
        idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        (receipt_ref->>'artifact_id')::uuid,'SandboxExecutionReceipt',1,command_json->>'sandbox_receipt_hash',
        (command_json->>'principal_id')::uuid,(command_json->>'idempotency_key')||':receipt',
        stage_record.attempt_id,stage_record.worker_fence,input_hash,command_json->'sandbox_receipt_payload',null
      );
      references_json:=(select pg_catalog.jsonb_agg(value->'reference') from pg_catalog.jsonb_array_elements(command_json->'output_bindings'))
        ||pg_catalog.jsonb_build_array(receipt_ref);
      receipt_json:=pg_catalog.jsonb_build_object(
        'schema_version','analysis-authority-commit-receipt@1.0.0','created',true,
        'authority_commit_hash',command_json->>'authority_commit_hash','stage_id',command_json->>'stage_id',
        'stage_hash',command_json->>'stage_hash','references',references_json,'public_event_id',command_json->>'public_event_id');
      insert into app_data_agent.analysis_authority_commits(
        app_id,tenant_id,environment,run_id,node_id,stage_id,principal_id,attempt_id,worker_fence,
        idempotency_key,authority_commit_hash,command_json,receipt_json
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.stage_id,(command_json->>'principal_id')::uuid,stage_record.attempt_id,stage_record.worker_fence,
        command_json->>'idempotency_key',command_json->>'authority_commit_hash',command_json,receipt_json);
      insert into app_data_agent.analysis_authority_current(
        app_id,tenant_id,environment,run_id,node_id,stage_id,stage_hash,authority_commit_hash,public_event_id,committed_at
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.stage_id,stage_record.stage_hash,command_json->>'authority_commit_hash',
        (command_json->>'public_event_id')::uuid,pg_catalog.clock_timestamp());
      insert into app_data_agent.analysis_authority_outbox(
        app_id,tenant_id,environment,run_id,public_event_id,node_id,stage_id,authority_commit_hash,payload_json
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        (command_json->>'public_event_id')::uuid,stage_record.node_id,stage_record.stage_id,
        command_json->>'authority_commit_hash',pg_catalog.jsonb_build_object(
          'event_name','analysis_authority_committed','stage_id',stage_record.stage_id,
          'references',references_json,'explanation',command_json->'explanation'));
      created_count:=1;
    else receipt_json:=existing.receipt_json; created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code',sqlerrm);
  end;
  if created_count=0 then receipt_json:=pg_catalog.jsonb_set(receipt_json,'{created}','false'::jsonb); end if;
  return pg_catalog.jsonb_build_object('ok',true,'receipt',receipt_json,'journal_entry',journal_result->'entry');
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_COMMIT_CONTRACT_INVALID');
end
$function$;

alter function app_data_agent.commit_analysis_authority(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_analysis_authority(jsonb) from public;
grant execute on function app_data_agent.commit_analysis_authority(jsonb) to data_agent_backend;
do $postconditions$
declare read_definition text; commit_definition text;
begin
  select prosrc into strict read_definition from pg_catalog.pg_proc
    where oid='app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure;
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(read_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(read_definition,'analysis_stage_oracle_records')=0
    or pg_catalog.strpos(read_definition,'analysis_stage_explanation_records')=0
    or pg_catalog.strpos(read_definition,'''oracle_record''')=0
    or pg_catalog.strpos(read_definition,'''explanation_record''')=0
    or pg_catalog.strpos(commit_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(commit_definition,'operator_receipt_closure_hash')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_ORACLE_RECORD_INVALID')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_EXPLANATION_RECORD_INVALID')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_OUTPUT_CLOSURE_INVALID')=0
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_DEFINITION_STALE'; end if;
  if exists(
      select 1 from pg_catalog.pg_proc
      where oid in (
        'app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure
      ) and pg_catalog.pg_get_userbyid(proowner)<>'data_agent_u6_rpc_owner'
    )
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.read_analysis_result_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_analysis_authority(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010757_app_data_agent_analysis_lifecycle_closure_restore',
  'sha256:9f818f64ef89c5c68be28e96385e4a685ce8a729d92bf881ff87beadee362bf3');
commit;
