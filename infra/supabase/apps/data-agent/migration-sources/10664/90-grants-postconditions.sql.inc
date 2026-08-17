alter function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  owner to data_agent_u12_context_owner;

revoke all on function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  to data_agent_backend;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
    'app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)','EXECUTE')
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_VERIFIER_GRANT_MISSING'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)'::regprocedure
      and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_VERIFIER_SECURITY_UNSAFE'; end if;
end
$postconditions$;
