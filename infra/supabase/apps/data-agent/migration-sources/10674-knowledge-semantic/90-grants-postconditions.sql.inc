create policy knowledge_semantic_usage_references_semantic_writer
  on app_data_agent.knowledge_semantic_usage_references for insert to data_agent_u6_rpc_owner
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select,insert on semantic.semantic_candidate_revision_save_idempotency to data_agent_u6_rpc_owner;
grant insert on app_data_agent.knowledge_semantic_usage_references to data_agent_u6_rpc_owner;
grant select on app_data_agent.knowledge_semantic_usage_references to data_agent_u15_knowledge_owner;

alter function semantic.complete_semantic_authoring(
  uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb
) owner to data_agent_u6_rpc_owner;
alter function semantic.start_manual_semantic_authoring(jsonb) owner to data_agent_u6_rpc_owner;
alter function semantic.save_semantic_candidate_revision(jsonb) owner to data_agent_u6_rpc_owner;
alter function semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.get_knowledge_document(uuid,bigint) owner to data_agent_u15_knowledge_owner;

revoke all on semantic.semantic_candidate_revision_save_idempotency,
  app_data_agent.knowledge_semantic_usage_references
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function semantic.start_manual_semantic_authoring(jsonb),
  semantic.save_semantic_candidate_revision(jsonb),
  semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.start_manual_semantic_authoring(jsonb),
  semantic.save_semantic_candidate_revision(jsonb),
  semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
to data_agent_backend;

do $postconditions$
begin
  if not (select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation where relation.oid=
      'semantic.semantic_candidate_revision_save_idempotency'::regclass)
    or not (select relation.relrowsecurity and relation.relforcerowsecurity
      from pg_catalog.pg_class relation where relation.oid=
        'app_data_agent.knowledge_semantic_usage_references'::regclass)
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_revision_save_idempotency',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.knowledge_semantic_usage_references',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.save_semantic_candidate_revision(jsonb)','EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.start_manual_semantic_authoring(jsonb)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)','EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_EXPLICIT_REVISION_HARDENING_FAILED'; end if;
end
$postconditions$;
