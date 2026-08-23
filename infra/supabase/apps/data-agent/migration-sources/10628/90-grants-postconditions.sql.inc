-- ============================================================
-- 10628: RLS, exact grants and migration postconditions
-- ============================================================

alter table app_data_agent.datasource_connections enable row level security;
alter table app_data_agent.datasource_connections force row level security;
alter table app_data_agent.qa_conversations enable row level security;
alter table app_data_agent.qa_conversations force row level security;
alter table app_data_agent.qa_messages enable row level security;
alter table app_data_agent.qa_messages force row level security;
alter table app_data_agent.workspace_run_bindings enable row level security;
alter table app_data_agent.workspace_run_bindings force row level security;

create policy datasource_connections_backend_select
  on app_data_agent.datasource_connections for select to data_agent_backend
  using (platform.backend_context_matches(app_id, tenant_id, environment, false));
create policy datasource_connections_backend_insert
  on app_data_agent.datasource_connections for insert to data_agent_backend
  with check (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  );
create policy datasource_connections_backend_update
  on app_data_agent.datasource_connections for update to data_agent_backend
  using (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  )
  with check (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  );

create policy qa_conversations_backend_select
  on app_data_agent.qa_conversations for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, false
    )
  );
create policy qa_conversations_backend_insert
  on app_data_agent.qa_conversations for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );
create policy qa_conversations_backend_update
  on app_data_agent.qa_conversations for update to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  )
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );
create policy qa_conversations_backend_delete
  on app_data_agent.qa_conversations for delete to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );

create policy qa_messages_backend_select
  on app_data_agent.qa_messages for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, false
    )
  );
create policy qa_messages_backend_insert
  on app_data_agent.qa_messages for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );

create policy workspace_run_bindings_backend_select
  on app_data_agent.workspace_run_bindings for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, principal_id, false
    )
  );
create policy workspace_run_bindings_backend_insert
  on app_data_agent.workspace_run_bindings for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, principal_id, true
    )
  );

revoke all on table
  app_data_agent.datasource_connections,
  app_data_agent.qa_conversations,
  app_data_agent.qa_messages,
  app_data_agent.workspace_run_bindings
from public, anon, authenticated, service_role;

grant select, insert, update on table app_data_agent.datasource_connections to data_agent_backend;
grant select, insert, update, delete on table app_data_agent.qa_conversations to data_agent_backend;
grant select, insert on table app_data_agent.qa_messages to data_agent_backend;
grant select, insert on table app_data_agent.workspace_run_bindings to data_agent_backend;

do $postconditions$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'datasource_connections', 'qa_conversations', 'qa_messages', 'workspace_run_bindings'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'app_data_agent'
        and class.relname = relation_name
        and class.relrowsecurity
        and class.relforcerowsecurity
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_RLS_POSTCONDITION_FAILED';
    end if;
    if pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('app_data_agent.%I', relation_name), 'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_TABLE_EXPOSED';
    end if;
  end loop;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.workspace_run_bindings', 'UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.qa_messages', 'UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_IMMUTABLE_GRANT_FAILED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname = 'semantic_domain_registry_datasource_connection_fk'
      and constraint_record.contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname = 'semantic_relationship_projection_domain_datasource_fk'
      and constraint_record.contype = 'f'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_SEMANTIC_FK_MISSING';
  end if;
  if (
    select pg_catalog.count(*) <> 3
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname in (
      'physical_schema_snapshot_datasource_connection_fk',
      'schema_scan_run_datasource_connection_fk',
      'schema_drift_event_datasource_connection_fk'
    ) and constraint_record.contype = 'f'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_CATALOG_FK_MISSING';
  end if;
end
$postconditions$;
