alter function app_data_agent.commit_semantic_context_package(jsonb)
  owner to data_agent_u12_context_owner;

revoke all on app_data_agent.semantic_context_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.load_semantic_context_authority_snapshot(jsonb),
  app_data_agent.commit_semantic_context_package(jsonb),
  app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_semantic_context_authority_snapshot(jsonb),
  app_data_agent.commit_semantic_context_package(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)
  to data_agent_backend;

do $postconditions$
declare definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname='semantic_context_receipts'
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or pg_catalog.to_regclass('app_data_agent.resolved_context_receipts') is not null
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_AUTHORITY_CUTOVER_INCOMPLETE'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.load_resolved_context_authority_snapshot(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_resolved_context_package(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)') is not null
    or exists(select 1 from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent' and procedure.proname like '%resolved_context%')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMPATIBILITY_OBJECT_PRESENT'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_context_receipts',
      'SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_semantic_context_authority_snapshot(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_semantic_context_package(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_GRANT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'semantic-context-package@1.0.0')=0
    or pg_catalog.strpos(definition,'semantic-retrieval-receipt@1.0.0')=0
    or pg_catalog.strpos(definition,'semantic-inference-receipt@1.0.0')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_MANDATORY_CLOSURE_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_CONTRACT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'AnalysisProgram')=0 or pg_catalog.strpos(definition,'AnalysisPlan')>0
  then raise exception using errcode='P0001',message='ANALYSIS_PROGRAM_CUTOVER_INCOMPLETE'; end if;
  if exists(select 1 from pg_catalog.pg_policy policy
    where pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) like '%AnalysisPlan%'
      or pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid) like '%AnalysisPlan%')
  then raise exception using errcode='P0001',message='ANALYSIS_PLAN_POLICY_PRESENT'; end if;
  perform app_data_agent.assert_semantic_context_integrity();
end
$postconditions$;
