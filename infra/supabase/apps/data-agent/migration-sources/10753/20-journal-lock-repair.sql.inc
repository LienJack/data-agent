create or replace function app_data_agent.append_analysis_context_journal(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; scope_json jsonb; event_json jsonb; previous record; replayed record;
  next_seq integer; next_hash text; created_at timestamptz; entry_json jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope'; event_json:=command_json->'event';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json))<>15
    or command_json->>'schema_version'<>'analysis-context-journal-append@1.0.0'
    or pg_catalog.jsonb_typeof(scope_json)<>'object' or pg_catalog.jsonb_typeof(event_json)<>'object'
    or command_json->>'run_id' is null or command_json->>'principal_id' is null
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (scope_json->>'app_id')||':'||(scope_json->>'tenant_id')||':'||(scope_json->>'environment')||':'||
    (command_json->>'run_id')||':'||(command_json->>'node_id')||':'||(command_json->>'attempt_id')||':'||
    (command_json->>'context_generation'),0));
  select source.* into replayed from app_data_agent.analysis_context_journal as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.append_hash=command_json->>'append_hash';
  if replayed.seq is not null then
    return pg_catalog.jsonb_build_object('ok',true,'entry',replayed.entry_json);
  end if;
  select source.* into previous from app_data_agent.analysis_context_journal as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
  order by source.seq desc limit 1;
  next_seq:=coalesce(previous.seq,0)+1;
  if (command_json->>'expected_prev_seq')::integer<>next_seq-1
    or command_json->>'expected_prev_entry_hash' is distinct from previous.entry_hash
    or (previous.seq is null and event_json->>'event_type'<>'MODEL_CELL_COMMITTED')
    or (previous.seq is not null and not app_data_agent.analysis_journal_transition_allowed(
      previous.event_json->>'event_type',event_json->>'event_type'))
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT'); end if;
  created_at:=pg_catalog.clock_timestamp();
  next_hash:=app_data_agent.u6_domain_sha256('analysis-context-journal-entry@1.0.0',
    pg_catalog.jsonb_build_object('command',command_json,'seq',next_seq,'prev_entry_hash',previous.entry_hash));
  entry_json:=command_json||pg_catalog.jsonb_build_object(
    'schema_version','analysis-context-journal-entry@1.0.0','seq',next_seq,
    'prev_entry_hash',previous.entry_hash,'entry_hash',next_hash,'created_at',created_at);
  insert into app_data_agent.analysis_context_journal(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,seq,
    principal_id,worker_fence,prev_entry_hash,entry_hash,append_hash,runtime_digest,
    policy_version,operator_registry_digest,event_json,entry_json,created_at
  ) values (
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
    (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
    (command_json->>'context_generation')::integer,next_seq,(command_json->>'principal_id')::uuid,
    (command_json->>'worker_fence')::bigint,previous.entry_hash,next_hash,command_json->>'append_hash',
    command_json->>'runtime_digest',command_json->>'policy_version',command_json->>'operator_registry_digest',
    event_json,entry_json,created_at);
  return pg_catalog.jsonb_build_object('ok',true,'entry',entry_json);
end
$function$;

alter function app_data_agent.append_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.append_analysis_context_journal(jsonb) from public;
grant execute on function app_data_agent.append_analysis_context_journal(jsonb) to data_agent_backend;
