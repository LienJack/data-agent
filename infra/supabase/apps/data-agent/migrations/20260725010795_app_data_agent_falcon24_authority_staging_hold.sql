-- falcon24_authority_staging_hold_migration_checksum: sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare column_count integer;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010794_app_data_agent_falcon24_semantic_dependency_provisioning'
        and migration_checksum=
          'sha256:052c07b894b5ce6468e2b368122f67d1a9d983fcb99d1e57c16fe92901f85219')
  then raise exception using errcode='P0001',
    message='FALCON24_STAGING_HOLD_BASELINE_DRIFT'; end if;

  if pg_catalog.to_regclass('app_data_agent.falcon24_authority_staging_sessions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_current_authority_epoch') is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])')
      is null
    or pg_catalog.to_regprocedure('app_data_agent.contains_potential_plaintext_secret(jsonb,text)')
      is null
  then raise exception using errcode='P0001',
    message='FALCON24_STAGING_HOLD_INVENTORY_DRIFT'; end if;

  select pg_catalog.count(*) into column_count
    from information_schema.columns
    where table_schema='app_data_agent'
      and table_name='falcon24_authority_staging_sessions'
      and column_name in('app_id','tenant_id','environment','staging_id','authority_epoch',
        'retained_assets_hash','status','failure_code','created_by','created_at','updated_at');
  if column_count<>11 then raise exception using errcode='P0001',
    message='FALCON24_STAGING_HOLD_SESSION_SCHEMA_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10795_staging_snapshot on commit drop as
select pg_catalog.count(*)::bigint as row_count,
  app_data_agent.u2_canonical_sha256(
    coalesce(
      pg_catalog.jsonb_agg(to_jsonb(session) order by
        session.app_id,session.tenant_id,session.environment,
        session.authority_epoch,session.staging_id),
      '[]'::jsonb)) as row_digest
from app_data_agent.falcon24_authority_staging_sessions as session;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create function app_data_agent.hold_falcon24_authority_staging_session(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  authority record;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  requested_epoch text;
  requested_staging_id uuid;
  now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','expected_retained_assets_hash',
      'failure_code','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-hold-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or command->>'expected_retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_AUTHORITY_STAGING_HOLD_INVALID'; end if;

  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-staging:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch as row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;

  select * into session from app_data_agent.falcon24_authority_staging_sessions as row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.retained_assets_hash is distinct from command->>'expected_retained_assets_hash'
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_HOLD_MISMATCH'; end if;
  if exists(select 1 from app_data_agent.falcon24_authority_baselines as baseline
    where baseline.app_id=authority.app_id and baseline.tenant_id=authority.tenant_id
      and baseline.environment=authority.environment and baseline.staging_id=requested_staging_id
      and baseline.authority_epoch=requested_epoch)
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS'; end if;
  if session.status='HOLD' then
    if session.failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT'; end if;
  elsif session.status<>'STAGED' then
    raise exception using errcode='55000',
      message='FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL';
  else
    now_at:=pg_catalog.clock_timestamp();
    update app_data_agent.falcon24_authority_staging_sessions set
      status='HOLD',failure_code=command->>'failure_code',updated_at=now_at
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment and staging_id=requested_staging_id
        and authority_epoch=requested_epoch and status='STAGED'
      returning * into strict session;
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-hold@2.0.0',
    'authority_epoch',session.authority_epoch,
    'staging_id',session.staging_id,
    'retained_assets_hash',session.retained_assets_hash,
    'status',session.status,
    'failure_code',session.failure_code);
end
$function$;
alter function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  from public;
grant execute on function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  to data_agent_backend;
do $postconditions$
declare
  before_snapshot record;
  after_count bigint;
  after_digest text;
  rpc record;
begin
  select * into strict before_snapshot from falcon24_10795_staging_snapshot;
  select pg_catalog.count(*)::bigint,
    app_data_agent.u2_canonical_sha256(
      coalesce(
        pg_catalog.jsonb_agg(to_jsonb(session) order by
          session.app_id,session.tenant_id,session.environment,
          session.authority_epoch,session.staging_id),
        '[]'::jsonb))
    into strict after_count,after_digest
    from app_data_agent.falcon24_authority_staging_sessions as session;
  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid=
      'app_data_agent.hold_falcon24_authority_staging_session(jsonb)'::regprocedure;

  if before_snapshot.row_count is distinct from after_count
    or before_snapshot.row_digest is distinct from after_digest
    or rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.has_function_privilege(
      'public','app_data_agent.hold_falcon24_authority_staging_session(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.hold_falcon24_authority_staging_session(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_STAGING_HOLD_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010795_app_data_agent_falcon24_authority_staging_hold',
  'sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d');

commit;
