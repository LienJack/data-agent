do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_qa_conversation_directory(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'app_data_agent.resolved_context_exact_keys')>0
    or pg_catalog.strpos(definition,'app_data_agent.semantic_context_exact_keys')=0
    or pg_catalog.to_regprocedure('app_data_agent.resolved_context_exact_keys(jsonb,text[])') is not null
  then raise exception using errcode='P0001',message='QA_DIRECTORY_SEMANTIC_HELPER_CUTOVER_NOT_INSTALLED'; end if;
end
$postconditions$;
