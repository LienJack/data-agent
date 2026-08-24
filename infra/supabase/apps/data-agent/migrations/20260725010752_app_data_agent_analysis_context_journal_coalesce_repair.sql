-- analysis_context_journal_coalesce_repair_migration_checksum: sha256:5ab54221f1ba3eaf0fa96e12348bc1b47a178c6780fefde7014867e9d0e45491
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010751_app_data_agent_analysis_stage_cleanup_hash_grant')
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_BASELINE_10751_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
  order by source.seq desc limit 1 for update;
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

create or replace function app_data_agent.read_analysis_context_journal(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; scope_json jsonb; entries jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,false
  );
  select coalesce(pg_catalog.jsonb_agg(source.entry_json order by source.seq),'[]'::jsonb)
  into entries from app_data_agent.analysis_context_journal as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer;
  return pg_catalog.jsonb_build_object('ok',true,'entries',entries);
end
$function$;

alter function app_data_agent.append_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.append_analysis_context_journal(jsonb),
  app_data_agent.read_analysis_context_journal(jsonb) from public;
grant execute on function app_data_agent.append_analysis_context_journal(jsonb),
  app_data_agent.read_analysis_context_journal(jsonb) to data_agent_backend;
do $postconditions$
declare append_definition text; read_definition text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.append_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
    into strict append_definition;
  select pg_catalog.pg_get_functiondef('app_data_agent.read_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
    into strict read_definition;
  if pg_catalog.strpos(append_definition,'pg_catalog.coalesce')<>0
    or pg_catalog.strpos(read_definition,'pg_catalog.coalesce')<>0
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_DEFINITION_STALE'; end if;
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.append_analysis_context_journal(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.read_analysis_context_journal(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_EXECUTE_GRANT_MISSING'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.append_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
    or (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.read_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_OWNER_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010752_app_data_agent_analysis_context_journal_coalesce_repair',
  'sha256:5ab54221f1ba3eaf0fa96e12348bc1b47a178c6780fefde7014867e9d0e45491');
commit;
