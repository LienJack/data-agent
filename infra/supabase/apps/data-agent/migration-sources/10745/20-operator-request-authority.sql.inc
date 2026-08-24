do $guard$
begin
  if exists(select 1 from app_data_agent.analysis_operator_results) then
    raise exception using errcode='P0001',message='ANALYSIS_OPERATOR_REQUEST_BACKFILL_UNAVAILABLE';
  end if;
end
$guard$;

alter table app_data_agent.analysis_operator_results
  add column request_content bytea not null;

revoke all on function app_data_agent.commit_governed_operator_result(jsonb,bytea) from public,data_agent_backend;
drop function app_data_agent.commit_governed_operator_result(jsonb,bytea);
drop function app_data_agent.read_governed_operator_result(jsonb);

create function app_data_agent.commit_governed_operator_result(
  envelope_json jsonb,
  request_content_bytes bytea,
  result_content_bytes bytea
)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; journal_json jsonb; result_json jsonb; scope_json jsonb;
  existing record; observed_request_hash text; observed_result_hash text;
  journal_result jsonb; created_count bigint;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command';
  result_json:=command_json->'result'; scope_json:=result_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json)<>'object' or pg_catalog.jsonb_typeof(journal_json)<>'object'
    or command_json->>'schema_version'<>'governed-operator-result-commit@1.0.0'
    or pg_catalog.octet_length(request_content_bytes) not between 1 and 16777216
    or pg_catalog.octet_length(result_content_bytes) not between 1 and 16777216
    or journal_json->'event'->>'event_type'<>'OPERATOR_RESULT_COMMITTED'
    or journal_json->'event'->'governed_result' is distinct from result_json
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_CONTRACT_INVALID'); end if;

  observed_request_hash:='sha256:'||pg_catalog.encode(extensions.digest(request_content_bytes,'sha256'),'hex');
  observed_result_hash:='sha256:'||pg_catalog.encode(extensions.digest(result_content_bytes,'sha256'),'hex');
  if observed_request_hash<>result_json->>'request_sha256'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_REQUEST_CONTENT_HASH_MISMATCH'); end if;
  if observed_result_hash<>result_json->>'result_sha256'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_CONTENT_HASH_MISMATCH'); end if;

  perform app_data_agent.assert_analysis_lifecycle_fence(
    envelope_json,
    pg_catalog.jsonb_build_object(
      'scope',scope_json,'run_id',result_json->>'run_id','principal_id',command_json->>'principal_id',
      'attempt_id',result_json->>'attempt_id','worker_fence',result_json->>'worker_fence'
    )
  );
  select source.* into existing from app_data_agent.analysis_operator_results as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(result_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
    and source.idempotency_key=command_json->>'idempotency_key';
  if existing.call_id is not null and existing.commit_hash<>command_json->>'commit_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_IDEMPOTENCY_CONFLICT'); end if;

  begin
    if existing.call_id is null then
      insert into app_data_agent.analysis_operator_results(
        app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,call_id,operator_id,
        principal_id,worker_fence,idempotency_key,request_sha256,result_sha256,result_bytes,
        result_ref_json,receipt_ref_json,receipt_payload_json,request_content,result_content,commit_hash
      ) values (
        (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
        (result_json->>'run_id')::uuid,result_json->>'node_id',(result_json->>'attempt_id')::uuid,
        (result_json->>'context_generation')::integer,result_json->>'call_id',result_json->>'operator_id',
        (command_json->>'principal_id')::uuid,(result_json->>'worker_fence')::bigint,
        command_json->>'idempotency_key',result_json->>'request_sha256',result_json->>'result_sha256',
        (result_json->>'result_bytes')::integer,result_json->'result_artifact_ref',result_json->'receipt_ref',
        command_json->'result_receipt_payload',request_content_bytes,result_content_bytes,command_json->>'commit_hash'
      );
      get diagnostics created_count=row_count;
    else created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(
      pg_catalog.jsonb_build_object(
        'protocol_version','u6-db-command@1.0.0',
        'authority_capability_id',envelope_json->>'authority_capability_id',
        'command',journal_json
      )
    );
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='GOVERNED_OPERATOR_RESULT_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT');
  end;
  return pg_catalog.jsonb_build_object(
    'ok',true,'created',created_count=1,'result',result_json,'journal_entry',journal_result->'entry'
  );
end
$function$;

create function app_data_agent.read_governed_operator_result(envelope_json jsonb)
returns table(result jsonb,result_content bytea,request_content bytea,receipt_payload jsonb)
language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; result_json jsonb; scope_json jsonb; stored record;
begin
  command_json:=envelope_json->'command'; result_json:=command_json->'result'; scope_json:=result_json->'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,false
  );
  select source.* into stored from app_data_agent.analysis_operator_results as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(result_json->>'run_id')::uuid
    and source.node_id=result_json->>'node_id' and source.attempt_id=(result_json->>'attempt_id')::uuid
    and source.context_generation=(result_json->>'context_generation')::integer
    and source.call_id=result_json->>'call_id' and source.operator_id=result_json->>'operator_id'
    and source.request_sha256=result_json->>'request_sha256'
    and source.result_sha256=result_json->>'result_sha256';
  if stored.call_id is null then
    return query select pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_NOT_FOUND'),null::bytea,null::bytea,null::jsonb;
  else
    return query select pg_catalog.jsonb_build_object('ok',true),stored.result_content,stored.request_content,stored.receipt_payload_json;
  end if;
end
$function$;

alter function app_data_agent.commit_governed_operator_result(jsonb,bytea,bytea) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_governed_operator_result(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_governed_operator_result(jsonb,bytea,bytea),
  app_data_agent.read_governed_operator_result(jsonb) from public;
grant execute on function app_data_agent.commit_governed_operator_result(jsonb,bytea,bytea),
  app_data_agent.read_governed_operator_result(jsonb) to data_agent_backend;
