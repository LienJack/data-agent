-- ============================================================
-- 10623: PostgreSQL Schema Discovery Authority
-- ============================================================
-- Depends on: 20260725010622_app_data_agent_semantic_candidate_draft
-- Adds immutable physical catalog snapshots, append-only scan runs,
-- immutable drift events and narrow server-only RPCs.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SCHEMA_DISCOVERY_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SCHEMA_DISCOVERY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SCHEMA_DISCOVERY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010622_app_data_agent_semantic_candidate_draft';
  if not found then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_BASELINE_10622_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010623_app_data_agent_schema_discovery'
  ) then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_MIGRATION_10623_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regnamespace('catalog') is not null then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_CATALOG_SCHEMA_ALREADY_EXISTS';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

create schema catalog authorization data_agent_u6_data_owner;
