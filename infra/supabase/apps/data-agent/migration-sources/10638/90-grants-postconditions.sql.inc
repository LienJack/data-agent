-- ============================================================
-- 10638: RLS, ownership, exact grants and hardening postconditions
-- ============================================================

alter table semantic.semantic_graph_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_graph_node_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_graph_edge_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_release_graph_projection owner to data_agent_u6_data_owner;

alter table semantic.semantic_graph_projection enable row level security;
alter table semantic.semantic_graph_projection force row level security;
alter table semantic.semantic_graph_node_projection enable row level security;
alter table semantic.semantic_graph_node_projection force row level security;
alter table semantic.semantic_graph_edge_projection enable row level security;
alter table semantic.semantic_graph_edge_projection force row level security;
alter table semantic.semantic_source_release_graph_projection enable row level security;
alter table semantic.semantic_source_release_graph_projection force row level security;

create policy semantic_graph_projection_rpc_scope_policy
  on semantic.semantic_graph_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_graph_node_projection_rpc_scope_policy
  on semantic.semantic_graph_node_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_graph_edge_projection_rpc_scope_policy
  on semantic.semantic_graph_edge_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_source_release_graph_projection_rpc_scope_policy
  on semantic.semantic_source_release_graph_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant select, insert on table semantic.semantic_graph_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_graph_node_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_graph_edge_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_source_release_graph_projection to data_agent_u6_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb) to data_agent_u6_rpc_owner;

alter function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) from public;
revoke all on function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid) from public;
revoke all on function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid) from public;
grant execute on function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) to data_agent_backend;
grant execute on function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid) to data_agent_backend;
grant execute on function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid) to data_agent_backend;

revoke all on table semantic.semantic_graph_projection from data_agent_backend;
revoke all on table semantic.semantic_graph_node_projection from data_agent_backend;
revoke all on table semantic.semantic_graph_edge_projection from data_agent_backend;
revoke all on table semantic.semantic_source_release_graph_projection from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_graph_projection', 'semantic_graph_node_projection',
    'semantic_graph_edge_projection', 'semantic_source_release_graph_projection'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
      or pg_catalog.has_table_privilege(
        'data_agent_backend', pg_catalog.format('semantic.%I', relation_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_TABLE_HARDENING_FAILED';
    end if;
  end loop;
  foreach function_name in array array[
    'commit_semantic_graph_projection', 'get_semantic_graph_projection',
    'bind_semantic_graph_release'
  ] loop
    select procedure.prosecdef, procedure.proconfig, procedure.provolatile, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
      or (function_name = 'get_semantic_graph_projection' and function_record.provolatile <> 's')
      or (function_name <> 'get_semantic_graph_projection' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
