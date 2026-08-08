-- ============================================================
-- 10619: Attribution bootstrap compatibility
-- ============================================================
-- The registered 10620 migration creates attribution_sha256 before the
-- canonical JSON helper it references and resolves pgcrypto.digest from the
-- wrong schema. Clean installs receive an inert canonical helper plus a
-- private, tagged digest parser shim. A narrowly matched event trigger also
-- defers validation only for the three invalid historical function bodies.
-- 10622 installs valid bodies and removes both temporary compatibility aids.
-- Existing databases that already recorded 10620 do not create the shim.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ATTRIBUTION_COMPATIBILITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ATTRIBUTION_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'ATTRIBUTION_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;

  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010615_app_data_agent_semantic_published_bridge';
  if not found then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_BASELINE_10615_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010619_app_data_agent_attribution_canonical_compatibility'
  ) then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_10619_ALREADY_RECORDED';
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
