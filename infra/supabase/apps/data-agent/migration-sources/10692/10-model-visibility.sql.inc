grant select on app_data_agent.model_catalog_entries to data_agent_u12_context_owner;
create policy model_catalog_resolved_context_select on app_data_agent.model_catalog_entries
  for select to data_agent_u12_context_owner
  using (app_id=(nullif(pg_catalog.current_setting('data_agent.app_id',true),''))::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),''));
