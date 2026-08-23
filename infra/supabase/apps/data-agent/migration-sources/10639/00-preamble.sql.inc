-- ============================================================
-- 10639: Agent semantic authoring runtime authority
-- ============================================================
-- Depends on: 20260725010638_app_data_agent_semantic_graph_v2
-- Provider output is only a proposal. PostgreSQL owns fenced authoring runs,
-- append-only turn/tool/patch/event evidence and review materialization.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010638_app_data_agent_semantic_graph_v2';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_BASELINE_10638_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010639_app_data_agent_semantic_authoring'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_MIGRATION_10639_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUTHORITY_SURFACE_MISSING';
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
