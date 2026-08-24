create table app_data_agent.analysis_result_stage_cleanup_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  cleanup_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check(pg_catalog.length(idempotency_key) between 8 and 256),
  requested_limit integer not null check(requested_limit between 1 and 100),
  cutoff_at timestamptz not null,
  deleted_count integer not null check(deleted_count between 0 and 100),
  deleted_stages_json jsonb not null check(pg_catalog.jsonb_typeof(deleted_stages_json)='array'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,cleanup_id),
  unique(app_id,tenant_id,environment,idempotency_key),
  check(deleted_count=pg_catalog.jsonb_array_length(deleted_stages_json))
);

create index analysis_result_stages_expiry_cleanup
on app_data_agent.analysis_result_stages(app_id,tenant_id,environment,expires_at,stage_id);

create function app_data_agent.analysis_stage_state_immutable()
returns trigger language plpgsql volatile set search_path=''
as $function$
begin
  if current_user='data_agent_u6_cleanup_owner' and tg_op='DELETE' then return old; end if;
  raise exception using errcode='55000',message='ANALYSIS_GOVERNED_STATE_IMMUTABLE';
end
$function$;

drop trigger analysis_result_stages_immutable on app_data_agent.analysis_result_stages;
create trigger analysis_result_stages_immutable before update or delete
on app_data_agent.analysis_result_stages for each row execute function app_data_agent.analysis_stage_state_immutable();
drop trigger analysis_result_stage_artifacts_immutable on app_data_agent.analysis_result_stage_artifacts;
create trigger analysis_result_stage_artifacts_immutable before update or delete
on app_data_agent.analysis_result_stage_artifacts for each row execute function app_data_agent.analysis_stage_state_immutable();
drop trigger analysis_stage_oracle_records_immutable on app_data_agent.analysis_stage_oracle_records;
create trigger analysis_stage_oracle_records_immutable before update or delete
on app_data_agent.analysis_stage_oracle_records for each row execute function app_data_agent.analysis_stage_state_immutable();
drop trigger analysis_stage_explanation_records_immutable on app_data_agent.analysis_stage_explanation_records;
create trigger analysis_stage_explanation_records_immutable before update or delete
on app_data_agent.analysis_stage_explanation_records for each row execute function app_data_agent.analysis_stage_state_immutable();
create trigger analysis_result_stage_cleanup_receipts_immutable before update or delete
on app_data_agent.analysis_result_stage_cleanup_receipts for each row execute function app_data_agent.analysis_governed_state_immutable();

create function app_data_agent.cleanup_expired_analysis_result_stages(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  existing record;
  stage_record record;
  requested_limit integer;
  cutoff_at timestamptz;
  deleted_count integer:=0;
  deleted_stages jsonb:='[]'::jsonb;
  receipt_material jsonb;
  receipt_hash text;
  receipt_json jsonb;
begin
  command_json:=envelope_json->'command';
  scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(envelope_json))<>3
    or pg_catalog.jsonb_typeof(command_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json))<>6
    or command_json->>'schema_version'<>'analysis-result-stage-cleanup@1.0.0'
    or pg_catalog.jsonb_typeof(scope_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(scope_json))<>3
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CLEANUP_CONTRACT_INVALID'); end if;

  begin
    perform (command_json->>'cleanup_id')::uuid;
    perform (command_json->>'principal_id')::uuid;
    requested_limit:=(command_json->>'requested_limit')::integer;
    if requested_limit not between 1 and 100
      or pg_catalog.length(command_json->>'idempotency_key') not between 8 and 256
    then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CLEANUP_CONTRACT_INVALID'); end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CLEANUP_CONTRACT_INVALID');
  end;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,true
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (scope_json->>'app_id')||':'||(scope_json->>'tenant_id')||':'||(scope_json->>'environment')||':analysis-stage-cleanup',0
  ));

  select source.* into existing
  from app_data_agent.analysis_result_stage_cleanup_receipts as source
  where source.app_id=(scope_json->>'app_id')::uuid
    and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment'
    and (source.cleanup_id=(command_json->>'cleanup_id')::uuid
      or source.idempotency_key=command_json->>'idempotency_key')
  order by source.committed_at limit 1;
  if existing.cleanup_id is not null then
    if existing.cleanup_id<>(command_json->>'cleanup_id')::uuid
      or existing.principal_id<>(command_json->>'principal_id')::uuid
      or existing.idempotency_key<>command_json->>'idempotency_key'
      or existing.requested_limit<>requested_limit
    then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CLEANUP_IDEMPOTENCY_CONFLICT'); end if;
    return pg_catalog.jsonb_build_object('ok',true,'receipt',existing.receipt_json);
  end if;

  cutoff_at:=pg_catalog.clock_timestamp();
  for stage_record in
    select source.* from app_data_agent.analysis_result_stages as source
    where source.app_id=(scope_json->>'app_id')::uuid
      and source.tenant_id=(scope_json->>'tenant_id')::uuid
      and source.environment=scope_json->>'environment'
      and source.expires_at<=cutoff_at
      and not exists(
        select 1 from app_data_agent.analysis_authority_commits as committed
        where committed.app_id=source.app_id and committed.tenant_id=source.tenant_id
          and committed.environment=source.environment and committed.run_id=source.run_id
          and committed.node_id=source.node_id and committed.stage_id=source.stage_id
      )
    order by source.expires_at,source.stage_id
    limit requested_limit
    for update of source skip locked
  loop
    delete from app_data_agent.analysis_stage_explanation_records as child
    where child.app_id=stage_record.app_id and child.tenant_id=stage_record.tenant_id
      and child.environment=stage_record.environment and child.run_id=stage_record.run_id
      and child.node_id=stage_record.node_id and child.attempt_id=stage_record.attempt_id
      and child.context_generation=stage_record.context_generation and child.stage_id=stage_record.stage_id;
    delete from app_data_agent.analysis_stage_oracle_records as child
    where child.app_id=stage_record.app_id and child.tenant_id=stage_record.tenant_id
      and child.environment=stage_record.environment and child.run_id=stage_record.run_id
      and child.node_id=stage_record.node_id and child.attempt_id=stage_record.attempt_id
      and child.context_generation=stage_record.context_generation and child.stage_id=stage_record.stage_id;
    delete from app_data_agent.analysis_result_stage_artifacts as child
    where child.app_id=stage_record.app_id and child.tenant_id=stage_record.tenant_id
      and child.environment=stage_record.environment and child.run_id=stage_record.run_id
      and child.node_id=stage_record.node_id and child.attempt_id=stage_record.attempt_id
      and child.context_generation=stage_record.context_generation and child.stage_id=stage_record.stage_id;
    delete from app_data_agent.analysis_result_stages as child
    where child.app_id=stage_record.app_id and child.tenant_id=stage_record.tenant_id
      and child.environment=stage_record.environment and child.run_id=stage_record.run_id
      and child.node_id=stage_record.node_id and child.attempt_id=stage_record.attempt_id
      and child.context_generation=stage_record.context_generation and child.stage_id=stage_record.stage_id;
    deleted_count:=deleted_count+1;
    deleted_stages:=deleted_stages||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'run_id',stage_record.run_id,'node_id',stage_record.node_id,'attempt_id',stage_record.attempt_id,
      'context_generation',stage_record.context_generation,'stage_id',stage_record.stage_id,
      'stage_hash',stage_record.stage_hash,'expires_at',stage_record.expires_at
    ));
  end loop;

  receipt_material:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-result-stage-cleanup-receipt@1.0.0',
    'scope',scope_json,'principal_id',command_json->>'principal_id','cleanup_id',command_json->>'cleanup_id',
    'idempotency_key',command_json->>'idempotency_key','requested_limit',requested_limit,
    'cutoff_at',cutoff_at,'deleted_count',deleted_count,'deleted_stages',deleted_stages
  );
  receipt_hash:=app_data_agent.u6_domain_sha256('analysis-result-stage-cleanup-receipt@1.0.0',receipt_material);
  receipt_json:=receipt_material||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
  insert into app_data_agent.analysis_result_stage_cleanup_receipts(
    app_id,tenant_id,environment,cleanup_id,principal_id,idempotency_key,requested_limit,
    cutoff_at,deleted_count,deleted_stages_json,receipt_hash,receipt_json
  ) values (
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
    (command_json->>'cleanup_id')::uuid,(command_json->>'principal_id')::uuid,
    command_json->>'idempotency_key',requested_limit,cutoff_at,deleted_count,deleted_stages,receipt_hash,receipt_json
  );
  return pg_catalog.jsonb_build_object('ok',true,'receipt',receipt_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CLEANUP_CONTRACT_INVALID');
end
$function$;

alter table app_data_agent.analysis_result_stage_cleanup_receipts enable row level security;
alter table app_data_agent.analysis_result_stage_cleanup_receipts force row level security;
alter table app_data_agent.analysis_result_stage_cleanup_receipts owner to data_agent_u6_cleanup_owner;
alter function app_data_agent.analysis_stage_state_immutable() owner to data_agent_u6_cleanup_owner;
alter function app_data_agent.cleanup_expired_analysis_result_stages(jsonb) owner to data_agent_u6_cleanup_owner;

grant usage on schema app_data_agent,platform to data_agent_u6_cleanup_owner;
grant select,delete on table app_data_agent.analysis_result_stages,
  app_data_agent.analysis_result_stage_artifacts,
  app_data_agent.analysis_stage_oracle_records,
  app_data_agent.analysis_stage_explanation_records to data_agent_u6_cleanup_owner;
grant select,insert on table app_data_agent.analysis_result_stage_cleanup_receipts to data_agent_u6_cleanup_owner;

create policy analysis_result_stages_cleanup on app_data_agent.analysis_result_stages
for all to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(false);
create policy analysis_result_stage_artifacts_cleanup on app_data_agent.analysis_result_stage_artifacts
for all to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(false);
create policy analysis_stage_oracle_records_cleanup on app_data_agent.analysis_stage_oracle_records
for all to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(false);
create policy analysis_stage_explanation_records_cleanup on app_data_agent.analysis_stage_explanation_records
for all to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(false);
create policy analysis_result_stage_cleanup_receipts_owner on app_data_agent.analysis_result_stage_cleanup_receipts
for all to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

revoke all on table app_data_agent.analysis_result_stage_cleanup_receipts from public,data_agent_backend;
revoke all on function app_data_agent.cleanup_expired_analysis_result_stages(jsonb) from public;
grant execute on function app_data_agent.lock_u6_authority_capability(jsonb,text,text,text,text,boolean)
to data_agent_u6_cleanup_owner;
grant execute on function app_data_agent.cleanup_expired_analysis_result_stages(jsonb) to data_agent_backend;
