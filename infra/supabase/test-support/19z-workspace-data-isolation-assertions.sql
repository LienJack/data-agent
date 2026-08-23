-- Phase 2: datasource, Q&A and immutable run attribution are workspace scoped.

begin;
insert into data_agent_auth."user" (
  "id", "name", "email", "emailVerified", "username", "displayUsername"
) values (
  '00000000-0000-4000-8000-000000001001',
  'Workspace isolation owner',
  'workspace-isolation-owner@example.invalid',
  true,
  'workspace_isolation_owner',
  'workspace_isolation_owner'
) on conflict ("id") do nothing;

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id, email, display_name,
  system_role, status, authz_epoch
) values (
  '00000000-0000-4000-8000-00000000da01',
  'test',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001001',
  'workspace-isolation-owner@example.invalid',
  'Workspace isolation owner',
  'USER',
  'ACTIVE',
  1
) on conflict (app_id, environment, principal_id) do nothing;

insert into app_data_agent.model_catalog_entries (
  app_id, environment, model_profile_id, provider, model_id, display_name,
  base_url, capabilities, credential_ref, status, config_version,
  is_system_default, created_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  'test',
  '00000000-0000-4000-8000-00000000d212',
  'openai',
  'workspace-isolation-model',
  'Workspace isolation model',
  'https://example.invalid',
  '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":false,"vision":false}'::jsonb,
  null,
  'ACTIVE',
  1,
  false,
  '00000000-0000-4000-8000-000000001001'
);
set local role data_agent_backend;
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa11', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001001', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);

insert into app_data_agent.datasource_connections (
  app_id, tenant_id, environment, datasource_id, name, datasource_type,
  file_path, created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000d211',
  'workspace-one-sqlite',
  'sqlite',
  '/tmp/workspace-one.db',
  '00000000-0000-4000-8000-000000001001'
);

insert into app_data_agent.qa_conversations (
  app_id, tenant_id, environment, conversation_id, owner_principal_id,
  title, datasource_id, model_id, model_profile_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000c211',
  '00000000-0000-4000-8000-000000001001',
  'workspace one private conversation',
  '00000000-0000-4000-8000-00000000d211',
  'workspace-isolation-model',
  '00000000-0000-4000-8000-00000000d212'
);

insert into app_data_agent.qa_messages (
  app_id, tenant_id, environment, conversation_id, message_id,
  owner_principal_id, role, content, message_type
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000c211',
  '00000000-0000-4000-8000-00000000c212',
  '00000000-0000-4000-8000-000000001001',
  'user',
  'workspace one private question',
  'text'
);

do $assert_workspace_one$
begin
  if (select pg_catalog.count(*) <> 1 from app_data_agent.datasource_connections)
    or (select pg_catalog.count(*) <> 1 from app_data_agent.qa_conversations)
  then
    raise exception 'WORKSPACE_ONE_VISIBILITY_ASSERTION_FAILED';
  end if;
end
$assert_workspace_one$;

select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa22', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001003', true);

do $assert_workspace_two_empty$
begin
  if (
    select pg_catalog.count(*) <> 0
    from app_data_agent.datasource_connections
    where datasource_id = '00000000-0000-4000-8000-00000000d211'::uuid
  )
    or (select pg_catalog.count(*) <> 0 from app_data_agent.qa_conversations)
  then
    raise exception 'WORKSPACE_TWO_CROSS_SCOPE_VISIBILITY_ASSERTION_FAILED';
  end if;
end
$assert_workspace_two_empty$;

insert into app_data_agent.datasource_connections (
  app_id, tenant_id, environment, datasource_id, name, datasource_type,
  file_path, created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa22',
  'test',
  '00000000-0000-4000-8000-00000000d222',
  'workspace-two-sqlite',
  'sqlite',
  '/tmp/workspace-two.db',
  '00000000-0000-4000-8000-000000001003'
);

do $assert_workspace_two$
begin
  if (select pg_catalog.count(*) <> 2 from app_data_agent.datasource_connections) then
    raise exception 'WORKSPACE_TWO_VISIBILITY_ASSERTION_FAILED';
  end if;
end
$assert_workspace_two$;
rollback;

begin;
set local role data_agent_backend;
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa11', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001006', true);
select pg_catalog.set_config('data_agent.role', 'analyst', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);

do $assert_analyst_cannot_manage_datasource$
begin
  begin
    insert into app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id, name, datasource_type,
      file_path, created_by_principal_id
    ) values (
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11',
      'test',
      '00000000-0000-4000-8000-00000000d299',
      'analyst-forbidden-source',
      'sqlite',
      '/tmp/forbidden.db',
      '00000000-0000-4000-8000-000000001006'
    );
    raise exception 'ANALYST_DATASOURCE_MUTATION_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert_analyst_cannot_manage_datasource$;
rollback;
