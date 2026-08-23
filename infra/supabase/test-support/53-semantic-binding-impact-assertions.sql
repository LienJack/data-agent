\set ON_ERROR_STOP on

do $assertions$
begin
  if pg_catalog.to_regclass('app_data_agent.semantic_binding_impact_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_semantic_binding_impact(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.get_semantic_binding_impact(jsonb)') is null
  then raise exception 'semantic binding impact authority closure missing'; end if;
  if not exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname='semantic_binding_impact_receipts' and relation.relrowsecurity and relation.relforcerowsecurity)
  then raise exception 'semantic binding impact receipt must force RLS'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_binding_impact_receipts','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_binding_impact_authority(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_binding_impact(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.get_semantic_binding_impact(jsonb)','EXECUTE')
  then raise exception 'semantic binding impact DML or RPC grants unsafe'; end if;
  if app_data_agent.semantic_binding_impact_uuid_v8(
      'sha256:47f7093f71b26f7203983832d59c508917848e7402c488771da38c4127852a21'
    )<>'47f7093f-71b2-8f72-8398-3832d59c5089'::uuid
  then raise exception 'semantic binding impact UUID vector drift'; end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.commit_semantic_binding_impact(jsonb)'::pg_catalog.regprocedure
    ),'load_semantic_binding_impact_authority')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.commit_semantic_binding_impact(jsonb)'::pg_catalog.regprocedure
    ),'semantic.create_candidate_draft')=0
  then raise exception 'semantic binding impact stale recheck or candidate closure missing'; end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.get_semantic_binding_impact(jsonb)'::pg_catalog.regprocedure
    ),'event_payload')>0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.get_semantic_binding_impact(jsonb)'::pg_catalog.regprocedure
    ),'package_json')>0
  then raise exception 'semantic binding impact public projection leaks authority payload'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v1(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v2(jsonb)') is not null
  then raise exception 'semantic binding impact compatibility RPC forbidden'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010706_app_data_agent_semantic_binding_impact')
  then raise exception 'semantic binding impact ledger missing'; end if;
end
$assertions$;

select 'SEMANTIC_BINDING_IMPACT_ASSERTIONS_PASSED' as result;
