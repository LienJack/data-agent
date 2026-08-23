do $directory_helper_cutover$
declare definition text; rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_qa_conversation_directory(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,'app_data_agent.resolved_context_exact_keys',''
    )))/pg_catalog.length('app_data_agent.resolved_context_exact_keys')<>1
    or pg_catalog.strpos(definition,'app_data_agent.semantic_context_exact_keys')>0
  then raise exception using errcode='P0001',message='QA_DIRECTORY_SEMANTIC_HELPER_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,
    'app_data_agent.resolved_context_exact_keys',
    'app_data_agent.semantic_context_exact_keys'
  );
  execute rewritten;
end
$directory_helper_cutover$;
