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
