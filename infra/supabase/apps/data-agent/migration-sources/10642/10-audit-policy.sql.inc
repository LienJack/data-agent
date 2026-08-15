-- The RPC owner may append only the two authoring-run audit actions emitted by
-- the fenced queue and completion functions. Direct backend table writes stay denied.
create policy audit_log_semantic_authoring_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(
      pg_catalog.current_setting('data_agent.principal_id', true),
      ''
    )::uuid
    and action in (
      'SEMANTIC_AUTHORING_WORKER_CLAIMED',
      'SEMANTIC_AUTHORING_READY_FOR_REVIEW'
    )
    and resource_type = 'semantic_authoring_run'
  );
