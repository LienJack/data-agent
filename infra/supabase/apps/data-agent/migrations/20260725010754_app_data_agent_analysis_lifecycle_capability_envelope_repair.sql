-- analysis_lifecycle_capability_envelope_repair_migration_checksum: sha256:a4a7b0ef355416367cc60de54d29bfd316808a1458142bdb055520b8a4af41bf
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010753_app_data_agent_analysis_context_journal_lock_repair')
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_BASELINE_10753_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.assert_analysis_lifecycle_fence(
  envelope_json jsonb,
  command_json jsonb
)
returns void language plpgsql volatile security definer set search_path=''
as $function$
declare scope_json jsonb; target record; capability_envelope jsonb;
begin
  scope_json:=command_json->'scope';
  capability_envelope:=pg_catalog.jsonb_build_object(
    'protocol_version',envelope_json->>'protocol_version',
    'authority_capability_id',envelope_json->>'authority_capability_id',
    'command',command_json
  );
  perform app_data_agent.lock_u6_authority_capability(
    capability_envelope,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,true
  );
  select attempts.attempt_id into target
  from app_data_agent.runs as runs
  join app_data_agent.run_attempts as attempts
    on attempts.app_id=runs.app_id and attempts.tenant_id=runs.tenant_id
    and attempts.environment=runs.environment and attempts.run_id=runs.run_id
  join app_data_agent.outbox as outbox
    on outbox.app_id=attempts.app_id and outbox.tenant_id=attempts.tenant_id
    and outbox.environment=attempts.environment and outbox.outbox_id=attempts.outbox_id
  where runs.app_id=(scope_json->>'app_id')::uuid
    and runs.tenant_id=(scope_json->>'tenant_id')::uuid
    and runs.environment=scope_json->>'environment'
    and runs.run_id=(command_json->>'run_id')::uuid
    and runs.principal_id=(command_json->>'principal_id')::uuid
    and attempts.attempt_id=(command_json->>'attempt_id')::uuid
    and attempts.status='ACTIVE'
    and attempts.worker_fence=(command_json->>'worker_fence')::bigint
    and attempts.lease_expires_at>pg_catalog.clock_timestamp()
    and outbox.active_attempt_id=attempts.attempt_id
    and outbox.run_fence=attempts.worker_fence
  for update of runs,attempts,outbox nowait;
  if target.attempt_id is null then
    raise exception using errcode='42501',message='DA_U6_CAPABILITY_REQUIRED';
  end if;
end
$function$;

alter function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb) from public;
do $postconditions$
declare definition text; compact_definition text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  compact_definition:=pg_catalog.regexp_replace(definition,'[[:space:]]','','g');
  if pg_catalog.strpos(definition,'capability_envelope:=pg_catalog.jsonb_build_object')=0
    or pg_catalog.strpos(compact_definition,
      'lock_u6_authority_capability(capability_envelope,')=0
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_DEFINITION_STALE'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_OWNER_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010754_app_data_agent_analysis_lifecycle_capability_envelope_repair',
  'sha256:a4a7b0ef355416367cc60de54d29bfd316808a1458142bdb055520b8a4af41bf');
commit;
