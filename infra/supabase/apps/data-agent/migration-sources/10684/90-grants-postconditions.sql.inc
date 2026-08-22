alter function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  owner to data_agent_u15_knowledge_owner;
revoke all on function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text:=pg_catalog.pg_get_functiondef(
  'app_data_agent.commit_knowledge_document(jsonb,jsonb)'::regprocedure
);
begin
  if pg_catalog.strpos(definition,'attempt.principal_id::text')>0
    or pg_catalog.strpos(definition,'job.principal_id::text')=0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_knowledge_document(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'anon','app_data_agent.commit_knowledge_document(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
