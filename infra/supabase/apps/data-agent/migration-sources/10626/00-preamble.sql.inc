-- ============================================================
-- 10626: Agent-maintained semantic candidate generation
-- ============================================================
-- Depends on: 20260725010625_app_data_agent_semantic_relationship_index
-- PostgreSQL freezes compile identity and linkage. Model output remains an
-- unpublished proposal and must enter the existing candidate review path.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_CANDIDATE_COMPILE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_CANDIDATE_COMPILE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_CANDIDATE_COMPILE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010625_app_data_agent_semantic_relationship_index';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_BASELINE_10625_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010626_app_data_agent_semantic_candidate_compile'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_MIGRATION_10626_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regclass('catalog.schema_scan_run') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_AUTHORITY_SURFACE_MISSING';
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
