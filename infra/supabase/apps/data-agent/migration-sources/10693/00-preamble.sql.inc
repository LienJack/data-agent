-- 10693 repairs the Graph Studio read guard without weakening release binding checks.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_GRAPH_STUDIO_DIGEST_REPAIR_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010692_app_data_agent_resolved_context_promotion_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_GRAPH_STUDIO_DIGEST_REPAIR_BASELINE_10692_MISSING'; end if;
  if pg_catalog.to_regprocedure('semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regclass('semantic.semantic_graph_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_source_release_graph_projection') is null
  then raise exception using errcode='P0001',message='SEMANTIC_GRAPH_STUDIO_DIGEST_REPAIR_SURFACE_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
