create or replace function app_data_agent.record_analysis_stage_oracle(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare command_json jsonb; journal_json jsonb; scope_json jsonb; stage_record record; existing record; journal_result jsonb;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if command_json->>'schema_version'<>'analysis-stage-oracle-record@1.0.0'
    or journal_json->'event'->>'event_type'<>'ORACLE_VERIFIED'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'oracle_receipt_hash'<>command_json->>'receipt_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'receipt_payload')<>command_json->>'receipt_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_ORACLE_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stage_record from app_data_agent.analysis_result_stages source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash';
  if stage_record.stage_id is null then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_NOT_FOUND'); end if;
  select source.* into existing from app_data_agent.analysis_stage_oracle_records source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id and source.environment=stage_record.environment
    and source.run_id=stage_record.run_id and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
    and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id;
  if existing.stage_id is not null and existing.receipt_hash<>command_json->>'receipt_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_ORACLE_IDEMPOTENCY_CONFLICT'); end if;
  begin
    if existing.stage_id is null then
      insert into app_data_agent.analysis_stage_oracle_records values(
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.attempt_id,stage_record.context_generation,stage_record.stage_id,(command_json->>'principal_id')::uuid,
        (command_json->>'worker_fence')::bigint,command_json->>'receipt_hash',command_json->'receipt_payload',default);
    end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then raise exception using errcode='P0001',message='ANALYSIS_STAGE_ORACLE_JOURNAL_REJECTED'; end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT');
  end;
  return pg_catalog.jsonb_build_object('ok',true,'journal_entry',journal_result->'entry');
end
$function$;

create or replace function app_data_agent.record_analysis_stage_explanation(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
#variable_conflict use_variable
declare command_json jsonb; journal_json jsonb; scope_json jsonb; stage_record record; existing record; journal_result jsonb;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if command_json->>'schema_version'<>'analysis-stage-explanation-record@1.0.0'
    or journal_json->'event'->>'event_type'<>'EXPLANATION_BOUND'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'explanation_hash'<>command_json->>'explanation_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'explanation')<>command_json->>'explanation_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_EXPLANATION_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stage_record from app_data_agent.analysis_result_stages source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash';
  if stage_record.stage_id is null then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_NOT_FOUND'); end if;
  select source.* into existing from app_data_agent.analysis_stage_explanation_records source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id and source.environment=stage_record.environment
    and source.run_id=stage_record.run_id and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
    and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id;
  if existing.stage_id is not null and existing.explanation_hash<>command_json->>'explanation_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_STAGE_EXPLANATION_IDEMPOTENCY_CONFLICT'); end if;
  begin
    if existing.stage_id is null then
      insert into app_data_agent.analysis_stage_explanation_records values(
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.attempt_id,stage_record.context_generation,stage_record.stage_id,(command_json->>'principal_id')::uuid,
        (command_json->>'worker_fence')::bigint,command_json->>'explanation_hash',command_json->'explanation',
        command_json->'provider_invocation_ref',default);
    end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then raise exception using errcode='P0001',message='ANALYSIS_STAGE_EXPLANATION_JOURNAL_REJECTED'; end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT');
  end;
  return pg_catalog.jsonb_build_object('ok',true,'journal_entry',journal_result->'entry');
end
$function$;

alter function app_data_agent.record_analysis_stage_oracle(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_analysis_stage_explanation(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.record_analysis_stage_oracle(jsonb) from public;
revoke all on function app_data_agent.record_analysis_stage_explanation(jsonb) from public;
grant execute on function app_data_agent.record_analysis_stage_oracle(jsonb) to data_agent_backend;
grant execute on function app_data_agent.record_analysis_stage_explanation(jsonb) to data_agent_backend;
