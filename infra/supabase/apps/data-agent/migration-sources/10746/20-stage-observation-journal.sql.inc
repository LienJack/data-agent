create table app_data_agent.analysis_stage_oracle_records (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, attempt_id uuid not null, context_generation integer not null,
  stage_id uuid not null, principal_id uuid not null, worker_fence bigint not null,
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_payload jsonb not null check(pg_catalog.jsonb_typeof(receipt_payload)='object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id),
  foreign key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    references app_data_agent.analysis_result_stages(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    on delete restrict
);

create table app_data_agent.analysis_stage_explanation_records (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, attempt_id uuid not null, context_generation integer not null,
  stage_id uuid not null, principal_id uuid not null, worker_fence bigint not null,
  explanation_hash text not null check(explanation_hash~'^sha256:[0-9a-f]{64}$'),
  explanation jsonb not null check(pg_catalog.jsonb_typeof(explanation)='object'),
  provider_invocation_ref jsonb not null check(pg_catalog.jsonb_typeof(provider_invocation_ref)='object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id),
  foreign key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    references app_data_agent.analysis_result_stages(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    on delete restrict
);

create trigger analysis_stage_oracle_records_immutable before update or delete
on app_data_agent.analysis_stage_oracle_records for each row execute function app_data_agent.analysis_governed_state_immutable();
create trigger analysis_stage_explanation_records_immutable before update or delete
on app_data_agent.analysis_stage_explanation_records for each row execute function app_data_agent.analysis_governed_state_immutable();

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
  next_seq:=pg_catalog.coalesce(previous.seq,0)+1;
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

create function app_data_agent.record_analysis_stage_oracle(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
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

create function app_data_agent.record_analysis_stage_explanation(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
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

create or replace function app_data_agent.read_analysis_result_stage(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
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

alter table app_data_agent.analysis_stage_oracle_records enable row level security;
alter table app_data_agent.analysis_stage_oracle_records force row level security;
alter table app_data_agent.analysis_stage_explanation_records enable row level security;
alter table app_data_agent.analysis_stage_explanation_records force row level security;
revoke all on table app_data_agent.analysis_stage_oracle_records,app_data_agent.analysis_stage_explanation_records from public;
grant select,insert on table app_data_agent.analysis_stage_oracle_records,app_data_agent.analysis_stage_explanation_records to data_agent_u6_rpc_owner;
create policy analysis_stage_oracle_records_rpc on app_data_agent.analysis_stage_oracle_records
for all to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_stage_explanation_records_rpc on app_data_agent.analysis_stage_explanation_records
for all to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

alter function app_data_agent.append_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_analysis_stage_oracle(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_analysis_stage_explanation(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_result_stage(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.record_analysis_stage_oracle(jsonb),app_data_agent.record_analysis_stage_explanation(jsonb) from public;
grant execute on function app_data_agent.record_analysis_stage_oracle(jsonb),app_data_agent.record_analysis_stage_explanation(jsonb) to data_agent_backend;
