do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','app_data_agent.knowledge_evidence_selections','SELECT'
  ) or not exists(select 1 from pg_catalog.pg_policy policy
    where policy.polrelid='app_data_agent.knowledge_evidence_selections'::pg_catalog.regclass
      and policy.polname='knowledge_evidence_selections_semantic_revision_select')
    or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.knowledge_evidence_selections','SELECT'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_EVIDENCE_READ_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
