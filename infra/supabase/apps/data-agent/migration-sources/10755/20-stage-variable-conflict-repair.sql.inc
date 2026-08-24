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
        content_bytes:=pg_catalog.decode(contents_json->>(artifact_record.ordinality-1),'base64');
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

create or replace function app_data_agent.read_analysis_result_stage(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare command_json jsonb; scope_json jsonb; stored record; artifacts jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope';
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stored from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash';
  if stored.stage_id is null then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_NOT_FOUND'); end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'artifact_name',source.artifact_name,'artifact_kind',source.artifact_kind,'media_type',source.media_type,
    'content_sha256',source.content_sha256,'bytes',source.byte_count,
    'content_base64',pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(source.content_bytes,'base64'),pg_catalog.chr(10),''),pg_catalog.chr(13),'')
  ) order by source.artifact_name) into artifacts
  from app_data_agent.analysis_result_stage_artifacts as source
  where source.app_id=stored.app_id and source.tenant_id=stored.tenant_id and source.environment=stored.environment
    and source.run_id=stored.run_id and source.node_id=stored.node_id and source.attempt_id=stored.attempt_id
    and source.context_generation=stored.context_generation and source.stage_id=stored.stage_id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'stage_command',stored.command_json,'artifacts',artifacts);
exception when invalid_text_representation then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_READ_CONTRACT_INVALID');
end
$function$;

create or replace function app_data_agent.commit_analysis_authority(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare
  command_json jsonb; journal_json jsonb; scope_json jsonb; stage_record record; existing record;
  binding_record record; staged_artifact record; receipt_ref jsonb; journal_result jsonb; references_json jsonb;
  receipt_json jsonb; input_hash text; created_count bigint;
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
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash'
    and source.closure_hash=command_json->>'closure_hash' and source.expires_at>pg_catalog.clock_timestamp()
  for share of source;
  if stage_record.stage_id is null
    or pg_catalog.jsonb_array_length(command_json->'output_bindings')<>pg_catalog.jsonb_array_length(stage_record.artifacts_json)
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_STAGE_INVALID'); end if;
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

alter function app_data_agent.stage_analysis_result(jsonb,jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_result_stage(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_analysis_authority(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.stage_analysis_result(jsonb,jsonb) from public;
revoke all on function app_data_agent.read_analysis_result_stage(jsonb) from public;
revoke all on function app_data_agent.commit_analysis_authority(jsonb) from public;
grant execute on function app_data_agent.stage_analysis_result(jsonb,jsonb) to data_agent_backend;
grant execute on function app_data_agent.read_analysis_result_stage(jsonb) to data_agent_backend;
grant execute on function app_data_agent.commit_analysis_authority(jsonb) to data_agent_backend;
