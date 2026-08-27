begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010788_app_data_agent_root_default_policy_compatibility')
    or pg_catalog.to_regprocedure(
      'app_data_agent.semantic_context_metric_projection(uuid,uuid,text,text,uuid)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)') is null
  then raise exception using errcode='P0001',
    message='SEMANTIC_CONTEXT_CANONICAL_ALIASES_BASELINE_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
