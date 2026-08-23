-- ============================================================
-- 10638: Semantic Graph v2 authoritative projections
-- ============================================================
-- Depends on: 20260725010637_app_data_agent_adb_ecommerce_workspace
-- Complete Graph source revisions remain Authority. Normalized Node/Edge rows
-- are immutable, release-bound read projections and may be rebuilt.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_GRAPH_PROJECTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010637_app_data_agent_adb_ecommerce_workspace';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_BASELINE_10637_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010638_app_data_agent_semantic_graph_v2'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_10638_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_AUTHORITY_SURFACE_MISSING';
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
