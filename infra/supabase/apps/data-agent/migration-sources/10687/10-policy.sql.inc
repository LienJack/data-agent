grant select on app_data_agent.knowledge_evidence_selections to data_agent_u6_rpc_owner;

create policy knowledge_evidence_selections_semantic_revision_select
  on app_data_agent.knowledge_evidence_selections
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and intended_semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
