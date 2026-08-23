alter function app_data_agent.commit_knowledge_document(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.list_knowledge_documents(uuid,integer) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.get_knowledge_document(uuid,bigint) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.create_knowledge_evidence_selection(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.get_knowledge_evidence_selection(uuid) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.create_knowledge_correction_annotation(jsonb) owner to data_agent_u15_knowledge_owner;

revoke all on app_data_agent.knowledge_document_revisions,
  app_data_agent.knowledge_document_blocks,app_data_agent.knowledge_correction_annotations,
  app_data_agent.knowledge_evidence_selections,app_data_agent.knowledge_evidence_selection_blocks
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.commit_knowledge_document(jsonb,jsonb),
  app_data_agent.list_knowledge_documents(uuid,integer),
  app_data_agent.get_knowledge_document(uuid,bigint),
  app_data_agent.create_knowledge_evidence_selection(jsonb),
  app_data_agent.get_knowledge_evidence_selection(uuid),
  app_data_agent.create_knowledge_correction_annotation(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.commit_knowledge_document(jsonb,jsonb),
  app_data_agent.list_knowledge_documents(uuid,integer),
  app_data_agent.get_knowledge_document(uuid,bigint),
  app_data_agent.create_knowledge_evidence_selection(jsonb),
  app_data_agent.get_knowledge_evidence_selection(uuid),
  app_data_agent.create_knowledge_correction_annotation(jsonb)
to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_document_revisions','knowledge_document_blocks','knowledge_correction_annotations',
    'knowledge_evidence_selections','knowledge_evidence_selection_blocks'
  ] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner'))
    then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.knowledge_document_revisions','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_knowledge_document(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.create_knowledge_correction_annotation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.get_knowledge_document(uuid,bigint)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
