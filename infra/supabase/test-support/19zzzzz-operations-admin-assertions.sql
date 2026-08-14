-- Phase 7: administration and operational health are RPC-only and role-revalidated.

begin;

insert into data_agent_auth."user" ("id", "name", "email", "emailVerified") values
  (
    '00000000-0000-4000-8000-00000000d701',
    'Workspace Admin',
    'workspace-admin@example.test',
    true
  ),
  (
    '00000000-0000-4000-8000-00000000d702',
    'Workspace Viewer',
    'workspace-viewer@example.test',
    true
  )
on conflict ("id") do nothing;

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id,
  email, display_name, system_role
) values
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
    select health ->> 'schema_version' = 'operations-health@1.0.0'
      and health ->> 'billing_mode' in ('SHADOW', 'ENFORCED')
      and pg_catalog.jsonb_array_length(health -> 'gates') = 6
      and (
        select pg_catalog.array_agg(gate ->> 'key' order by ordinal)
        from pg_catalog.jsonb_array_elements(health -> 'gates')
          with ordinality as gates(gate, ordinal)
      ) = array[
        'IDENTITY_SIDE_EFFECTS',
        'PRICING_SYNC',
        'PRICING_REVIEW',
        'BILLING_REVIEW',
        'BALANCE_INTEGRITY',
        'SHADOW_RECONCILIATION'
      ]
    from platform.read_operations_health(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411'
    ) as health
  ),
  'operations health must preserve the six ordered production gates'
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
  'administration reads must not expose raw identity or billing tables'
);

rollback;
