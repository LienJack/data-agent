-- 10679 forward-repairs the 10678 executor so one deployment can never clean another
-- environment in the same PostgreSQL database. Historical 10678 bytes/ledger stay immutable.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(
    select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010678_app_data_agent_legacy_attribution_cleanup'
      and migration_checksum='sha256:6ad81cf69acc1af798706b089df747fb040d96ecc5d03b30e8eae2db2f0ce462'
  ) then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_BASELINE_INVALID';
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010679_app_data_agent_legacy_attribution_scope_repair',
  '__LEGACY_ATTRIBUTION_SCOPE_REPAIR_MIGRATION_CHECKSUM__');
