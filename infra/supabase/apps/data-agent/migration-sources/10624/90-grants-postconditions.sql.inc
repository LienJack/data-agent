-- ============================================================
-- 10624: RLS, exact grants and static postconditions
-- ============================================================

create policy semantic_domain_registry_explorer_scope_policy
  on semantic.semantic_domain_registry
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = any(
      pg_catalog.string_to_array(
        nullif(pg_catalog.current_setting('app.semantic_allowed_domains', true), ''),
        ','
      )
    )
  );

create policy semantic_active_pointer_explorer_scope_policy
  on semantic.semantic_active_pointer
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = any(
      pg_catalog.string_to_array(
        nullif(pg_catalog.current_setting('app.semantic_allowed_domains', true), ''),
        ','
      )
    )
  );

create policy semantic_source_release_explorer_scope_policy
  on semantic.semantic_source_release
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_executable_projection_explorer_scope_policy
  on semantic.semantic_executable_projection
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_projection_explorer_scope_policy
  on semantic.semantic_relationship_projection
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_runtime_restriction_projection_explorer_scope_policy
  on semantic.semantic_runtime_restriction_projection
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant usage on schema semantic to data_agent_u6_rpc_owner;
grant usage on schema platform to data_agent_u6_rpc_owner;
grant execute on function platform.backend_context_matches(uuid, uuid, text, boolean)
  to data_agent_u6_rpc_owner;

grant select on table semantic.semantic_domain_registry to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_active_pointer to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_source_release to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_executable_projection to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_relationship_projection to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_runtime_restriction_projection to data_agent_u6_rpc_owner;

alter function semantic.assert_explorer_scope(uuid, uuid, text, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.build_explorer_source(uuid, uuid, text, uuid, text, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.build_explorer_release_identity(uuid, uuid, text, text, uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.list_explorer_domains(uuid, uuid, text, uuid, text[])
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_active_explorer_source(uuid, uuid, text, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_release_explorer_source(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.list_explorer_releases(uuid, uuid, text, uuid, text, integer, bigint)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_candidate_explorer_comparison(uuid, uuid, text, uuid, text, uuid, uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.assert_explorer_scope(uuid, uuid, text, uuid, text) from public;
revoke all on function semantic.build_explorer_source(uuid, uuid, text, uuid, text, uuid, text) from public;
revoke all on function semantic.build_explorer_release_identity(uuid, uuid, text, text, uuid) from public;
revoke all on function semantic.list_explorer_domains(uuid, uuid, text, uuid, text[]) from public;
revoke all on function semantic.get_active_explorer_source(uuid, uuid, text, uuid, text) from public;
revoke all on function semantic.get_release_explorer_source(uuid, uuid, text, uuid, text, uuid) from public;
revoke all on function semantic.list_explorer_releases(uuid, uuid, text, uuid, text, integer, bigint) from public;
revoke all on function semantic.get_candidate_explorer_comparison(uuid, uuid, text, uuid, text, uuid, uuid)
  from public;

grant execute on function semantic.assert_explorer_scope(uuid, uuid, text, uuid, text)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.build_explorer_source(uuid, uuid, text, uuid, text, uuid, text)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.build_explorer_release_identity(uuid, uuid, text, text, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.list_explorer_domains(uuid, uuid, text, uuid, text[])
  to data_agent_u6_rpc_owner;
grant execute on function semantic.get_active_explorer_source(uuid, uuid, text, uuid, text)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.get_release_explorer_source(uuid, uuid, text, uuid, text, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.list_explorer_releases(uuid, uuid, text, uuid, text, integer, bigint)
  to data_agent_u6_rpc_owner;
grant execute on function semantic.get_candidate_explorer_comparison(uuid, uuid, text, uuid, text, uuid, uuid)
  to data_agent_u6_rpc_owner;

grant usage on schema semantic to data_agent_backend;
grant execute on function semantic.list_explorer_domains(uuid, uuid, text, uuid, text[])
  to data_agent_backend;
grant execute on function semantic.get_active_explorer_source(uuid, uuid, text, uuid, text)
  to data_agent_backend;
grant execute on function semantic.get_release_explorer_source(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;
grant execute on function semantic.list_explorer_releases(uuid, uuid, text, uuid, text, integer, bigint)
  to data_agent_backend;
grant execute on function semantic.get_candidate_explorer_comparison(uuid, uuid, text, uuid, text, uuid, uuid)
  to data_agent_backend;

revoke all on table semantic.semantic_active_pointer from data_agent_backend;
revoke all on table semantic.semantic_source_release from data_agent_backend;
revoke all on table semantic.semantic_executable_projection from data_agent_backend;
revoke all on table semantic.semantic_relationship_projection from data_agent_backend;
revoke all on table semantic.semantic_runtime_restriction_projection from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_active_pointer',
    'semantic_source_release',
    'semantic_executable_projection',
    'semantic_relationship_projection',
    'semantic_runtime_restriction_projection'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('semantic.%I', relation_name),
      'SELECT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('semantic.%I', relation_name),
      'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('semantic.%I', relation_name),
      'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('semantic.%I', relation_name),
      'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_BACKEND_TABLE_ACL_FAILED';
    end if;
    if not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('semantic.%I', relation_name),
      'SELECT'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RPC_OWNER_TABLE_ACL_FAILED';
    end if;
  end loop;

  foreach function_name in array array[
    'assert_explorer_scope',
    'build_explorer_source',
    'build_explorer_release_identity',
    'list_explorer_domains',
    'get_active_explorer_source',
    'get_release_explorer_source',
    'list_explorer_releases',
    'get_candidate_explorer_comparison'
  ] loop
    select
      procedure.prosecdef,
      procedure.proconfig,
      procedure.provolatile,
      owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner
      on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.provolatile <> 's'
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
        'search_path=',
        'search_path=""'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_schema_privilege('data_agent_backend', 'semantic', 'USAGE')
    or pg_catalog.has_schema_privilege('authenticated', 'semantic', 'USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_active_explorer_source(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.get_active_explorer_source(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.list_explorer_domains(uuid,uuid,text,uuid,text[])',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.list_explorer_domains(uuid,uuid,text,uuid,text[])',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.build_explorer_source(uuid,uuid,text,uuid,text,uuid,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_domain_registry_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_allowed_domains%'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_active_pointer_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_allowed_domains%'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_source_release_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_executable_projection_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_relationship_projection_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_runtime_restriction_projection_explorer_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RLS_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
