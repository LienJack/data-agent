-- ============================================================
-- 10640: Semantic Graph Studio read and authoring entrypoints
-- ============================================================
-- Depends on: 20260725010639_app_data_agent_semantic_authoring

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_GRAPH_STUDIO_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_STUDIO_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010639_app_data_agent_semantic_authoring';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_BASELINE_10639_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010640_app_data_agent_semantic_graph_studio'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_MIGRATION_10640_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_graph_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_authoring_run') is null
    or pg_catalog.to_regprocedure('semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_AUTHORITY_SURFACE_MISSING';
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
