-- Phase 7: administration and operational health are RPC-only and role-revalidated.

begin;

insert into data_agent_auth."user" (
  "id", "name", "email", "emailVerified", "username", "displayUsername"
) values
  (
    '00000000-0000-4000-8000-00000000b401',
    'Operations Super Admin',
    'operations-admin@example.test',
    true,
    'operations.admin',
    'operations.admin'
  ),
  (
    '00000000-0000-4000-8000-00000000b402',
    'Operations User',
    'operations-user@example.test',
    true,
    'operations.user',
    'operations.user'
  ),
  (
    '00000000-0000-4000-8000-00000000d701',
    'Workspace Admin',
    'workspace-admin@example.test',
    true,
    'workspace.admin',
    'workspace.admin'
  ),
  (
    '00000000-0000-4000-8000-00000000d702',
    'Workspace Viewer',
    'workspace-viewer@example.test',
    true,
    'workspace.viewer',
    'workspace.viewer'
  )
on conflict ("id") do nothing;

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id,
  email, display_name, system_role
) values
  (
    '00000000-0000-4000-8000-00000000da01',
    'test',
    '00000000-0000-4000-8000-00000000b411',
    '00000000-0000-4000-8000-00000000b401',
    'operations-admin@example.test',
    'Operations Super Admin',
    'SUPER_ADMIN'
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    'test',
    '00000000-0000-4000-8000-00000000b412',
    '00000000-0000-4000-8000-00000000b402',
    'operations-user@example.test',
    'Operations User',
    'USER'
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    'test',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-00000000d701',
    'workspace-admin@example.test',
    'Workspace Admin',
    'USER'
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    'test',
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-00000000d702',
    'workspace-viewer@example.test',
    'Workspace Viewer',
    'USER'
  )
on conflict (app_id, environment, principal_id) do nothing;

update app_data_agent.memberships
set workspace_role = case membership_role
      when 'owner' then 'WORKSPACE_ADMIN'
      when 'analyst' then 'ANALYST'
      when 'viewer' then 'VIEWER'
      else null
    end,
    membership_source = 'LEGACY'
where app_id = '00000000-0000-4000-8000-00000000da01'::uuid
  and environment = 'test'
  and principal_id in (
    '00000000-0000-4000-8000-000000001001'::uuid,
    '00000000-0000-4000-8000-000000001002'::uuid
  );

grant usage on schema test_support to data_agent_backend;
grant execute on all functions in schema test_support to data_agent_backend;

set local role data_agent_backend;

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from platform.list_admin_users(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411'
    ) as admin_user
    where admin_user.projection ->> 'principal_id' =
      '00000000-0000-4000-8000-00000000b411'
      and admin_user.projection ->> 'system_role' = 'SUPER_ADMIN'
      and (admin_user.projection ->> 'authz_epoch')::bigint >= 1
  ),
  'super admin user projection must expose safe identity metadata'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from platform.list_admin_workspaces(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411'
    ) as workspace
    where workspace.projection ->> 'workspace_id' =
      '00000000-0000-4000-8000-00000000aa11'
      and (workspace.projection ->> 'active_members')::bigint >= 1
  ),
  'super admin workspace projection must include member counts'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) >= 2
    from platform.list_workspace_members(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-000000001001',
      '00000000-0000-4000-8000-00000000aa11'
    )
  ),
  'workspace administrator must read members in the administered workspace'
);

do $assert_viewer_denied$
begin
  begin
    perform 1 from platform.list_workspace_members(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-000000001002',
      '00000000-0000-4000-8000-00000000aa11'
    );
    raise exception 'WORKSPACE_VIEWER_MEMBER_LIST_WAS_NOT_REJECTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'WORKSPACE_ADMIN_REQUIRED' then raise; end if;
  end;
end
$assert_viewer_denied$;

select test_support.assert_true(
  (
    select receipt ->> 'status' = 'RETRY_REQUIRED'
      and receipt ->> 'completed_at' is null
    from app_data_agent.apply_identity_command(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411',
      null,
      pg_catalog.jsonb_build_object(
        'schema_version', 'identity-command@1.0.0',
        'operation_id', '00000000-0000-4000-8000-00000000d799',
        'idempotency_key', 'phase-seven-side-effect-retry',
        'kind', 'DISABLE_USER',
        'principal_id', '00000000-0000-4000-8000-000000001002',
        'reason', 'phase seven retry proof'
      )
    ) as receipt
  ),
  'disable must enter retry-required before the auth side effect'
);

select test_support.assert_true(
  (
    select receipt ->> 'status' = 'RETRY_REQUIRED'
      and receipt ->> 'reason_code' = 'IDENTITY_AUTH_SIDE_EFFECT_FAILED'
      and receipt ->> 'completed_at' is null
    from app_data_agent.complete_identity_side_effect(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411',
      '00000000-0000-4000-8000-00000000d799',
      false,
      'IDENTITY_AUTH_SIDE_EFFECT_FAILED'
    ) as receipt
  ),
  'failed auth side effect must remain retryable and incomplete'
);

select test_support.assert_true(
  (
    select receipt ->> 'status' = 'SUCCEEDED'
      and receipt ->> 'reason_code' = 'IDENTITY_AUTH_SIDE_EFFECT_SUCCEEDED'
      and receipt ->> 'completed_at' is not null
    from app_data_agent.complete_identity_side_effect(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411',
      '00000000-0000-4000-8000-00000000d799',
      true,
      'IDENTITY_AUTH_SIDE_EFFECT_SUCCEEDED'
    ) as receipt
  ),
  'retryable auth side effect must be completable by a later successful attempt'
);

select test_support.assert_true(
  (
    select health ->> 'schema_version' = 'operations-health@1.0.0'
      and not health ? 'billing_mode'
      and pg_catalog.jsonb_array_length(health -> 'gates') = 1
      and (
        select pg_catalog.array_agg(gate ->> 'key' order by ordinal)
        from pg_catalog.jsonb_array_elements(health -> 'gates')
          with ordinality as gates(gate, ordinal)
      ) = array['IDENTITY_SIDE_EFFECTS']
    from platform.read_operations_health(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411'
    ) as health
  ),
  'operations health must expose only the identity side-effect gate'
);

select test_support.assert_raises(
  $assert$
    select platform.read_operations_health(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b412'
    )
  $assert$,
  'SUPER_ADMIN_REQUIRED'
);

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.app_users', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.workspaces', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_bills', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.credit_accounts', 'SELECT'
  ),
  'administration reads must not expose raw identity or commercial archive tables'
);

rollback;
