alter function app_data_agent.create_knowledge_evidence_selection(jsonb)
  owner to data_agent_u15_knowledge_owner;
revoke all on function app_data_agent.create_knowledge_evidence_selection(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.create_knowledge_evidence_selection(jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text:=pg_catalog.pg_get_functiondef(
  'app_data_agent.create_knowledge_evidence_selection(jsonb)'::regprocedure
);
begin
  if pg_catalog.strpos(definition,'selected_base.status=''READY''')=0
    or pg_catalog.strpos(definition,'retained_source.value=selected_document.revision_json->''source_file_ref''')=0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'anon','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
