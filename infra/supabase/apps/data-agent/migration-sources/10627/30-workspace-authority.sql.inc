-- ============================================================
-- 10627: Session principal and transaction-revalidated workspace authority
-- ============================================================

create function platform.resolve_session_principal(
  requested_deployment_id uuid,
  requested_auth_user_id uuid
)
returns table (
  app_id uuid,
  environment text,
  principal_id uuid,
  auth_user_id uuid,
  system_role text,
  authz_epoch bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;

  return query
  select
    deployment.app_id,
    deployment.environment,
    app_user.principal_id,
    app_user.auth_user_id,
    app_user.system_role,
    app_user.authz_epoch
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state <> 'DELETED'
    and app_user.auth_user_id = requested_auth_user_id
    and app_user.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_SESSION_INVALID';
  end if;
end
$function$;

create function platform.list_principal_workspaces(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (
  app_id uuid,
  environment text,
  workspace_id uuid,
  slug text,
  display_name text,
  lifecycle text,
  lifecycle_version bigint,
  created_at timestamptz,
  archived_at timestamptz,
  principal_id uuid,
  system_role text,
  workspace_role text,
  membership_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;

  return query
  select
    deployment.app_id,
    deployment.environment,
    workspace.workspace_id,
    workspace.slug,
    workspace.display_name,
    workspace.lifecycle,
    workspace.lifecycle_version,
    workspace.created_at,
    workspace.archived_at,
    app_user.principal_id,
    app_user.system_role,
    case
      when app_user.system_role = 'SUPER_ADMIN' then 'WORKSPACE_ADMIN'
      else membership.workspace_role
    end,
    membership.membership_version
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as app_lifecycle
    on app_lifecycle.app_id = deployment.app_id
   and app_lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  join app_data_agent.memberships as membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
   and membership.principal_id = app_user.principal_id
   and membership.revoked_at is null
   and membership.membership_role <> 'demo'
  join app_data_agent.workspaces as workspace
    on workspace.app_id = membership.app_id
   and workspace.environment = membership.environment
   and workspace.workspace_id = membership.tenant_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and app_lifecycle.lifecycle_state <> 'DELETED'
    and app_user.status = 'ACTIVE'
    and workspace.lifecycle = 'ACTIVE'
  order by workspace.display_name, workspace.workspace_id;
end
$function$;

create function platform.resolve_workspace_authority(
  requested_deployment_id uuid,
  requested_workspace_id uuid,
  requested_principal_id uuid,
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  deployment_id uuid,
  principal_id uuid,
  capability_role text,
  workspace_role text,
  system_role text,
  membership_version bigint,
  user_authz_epoch bigint,
  workspace_lifecycle_version bigint,
  app_epoch bigint,
  app_lifecycle_state text,
  workspace_lifecycle text,
  can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lock_app_id uuid;
  lock_environment text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using errcode = '22023', message = 'DA_AUTHORITY_MODE_INVALID';
  end if;

  if require_write then
    select deployment.app_id, deployment.environment
    into lock_app_id, lock_environment
    from platform.deployment_mappings as deployment
    where deployment.deployment_id = requested_deployment_id and deployment.is_active;
    if found then
      perform platform.acquire_lifecycle_shared_lock(lock_app_id, lock_environment);
    end if;
  end if;

  return query
  select
    deployment.app_id,
    workspace.workspace_id,
    deployment.environment,
    deployment.deployment_id,
    app_user.principal_id,
    case
      when app_user.system_role = 'SUPER_ADMIN' then 'owner'
      else membership.membership_role
    end,
    case
      when app_user.system_role = 'SUPER_ADMIN' then 'WORKSPACE_ADMIN'
      else membership.workspace_role
    end,
    app_user.system_role,
    membership.membership_version,
    app_user.authz_epoch,
    workspace.lifecycle_version,
    app_lifecycle.authority_epoch,
    app_lifecycle.lifecycle_state,
    workspace.lifecycle,
    (
      app_lifecycle.lifecycle_state = 'ACTIVE'
      and workspace.lifecycle = 'ACTIVE'
      and case
        when app_user.system_role = 'SUPER_ADMIN' then true
        else membership.membership_role in ('owner', 'analyst')
      end
    )
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as app_lifecycle
    on app_lifecycle.app_id = deployment.app_id
   and app_lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
  join app_data_agent.workspaces as workspace
    on workspace.app_id = deployment.app_id
   and workspace.environment = deployment.environment
  join app_data_agent.memberships as membership
    on membership.app_id = workspace.app_id
   and membership.tenant_id = workspace.workspace_id
   and membership.environment = workspace.environment
   and membership.principal_id = app_user.principal_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and workspace.workspace_id = requested_workspace_id
    and app_user.principal_id = requested_principal_id
    and app_user.status = 'ACTIVE'
    and membership.revoked_at is null
    and membership.membership_role <> 'demo'
    and app_lifecycle.lifecycle_state <> 'DELETED'
    and workspace.lifecycle = 'ACTIVE'
    and (
      not require_write
      or (
        app_lifecycle.lifecycle_state = 'ACTIVE'
        and (
          app_user.system_role = 'SUPER_ADMIN'
          or membership.membership_role in ('owner', 'analyst')
        )
      )
    )
  for share of app_user, workspace, membership;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
end
$function$;

create function platform.revalidate_workspace_authority(
  requested_app_id uuid,
  requested_workspace_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_capability_role text,
  requested_workspace_role text,
  requested_system_role text,
  requested_membership_version bigint,
  requested_user_authz_epoch bigint,
  requested_workspace_lifecycle_version bigint,
  requested_app_epoch bigint,
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  deployment_id uuid,
  principal_id uuid,
  capability_role text,
  workspace_role text,
  system_role text,
  membership_version bigint,
  user_authz_epoch bigint,
  workspace_lifecycle_version bigint,
  app_epoch bigint,
  app_lifecycle_state text,
  workspace_lifecycle text,
  can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  return query
  select resolved.*
  from platform.resolve_workspace_authority(
    requested_deployment_id,
    requested_workspace_id,
    requested_principal_id,
    require_write
  ) as resolved
  where resolved.app_id = requested_app_id
    and resolved.environment = requested_environment
    and resolved.capability_role = requested_capability_role
    and resolved.workspace_role = requested_workspace_role
    and resolved.system_role = requested_system_role
    and resolved.membership_version = requested_membership_version
    and resolved.user_authz_epoch = requested_user_authz_epoch
    and resolved.workspace_lifecycle_version = requested_workspace_lifecycle_version
    and resolved.app_epoch = requested_app_epoch;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
end
$function$;

create or replace function platform.provision_membership(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid,
  requested_role text
)
returns app_data_agent.memberships
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_app_id uuid;
  resolved_environment text;
  provisioned_membership app_data_agent.memberships%rowtype;
  resolved_workspace_role text;
begin
  if requested_role is null or requested_role not in ('owner', 'analyst', 'viewer', 'demo') then
    raise exception using errcode = '22023', message = 'DA_MEMBERSHIP_ROLE_INVALID';
  end if;
  resolved_workspace_role := case requested_role
    when 'owner' then 'WORKSPACE_ADMIN'
    when 'analyst' then 'ANALYST'
    when 'viewer' then 'VIEWER'
    else null
  end;

  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active and lifecycle.lifecycle_state <> 'DELETED';
  if not found then
    raise exception using errcode = 'P0002', message = 'DA_DEPLOYMENT_NOT_FOUND';
  end if;
  if resolved_app_id <> '00000000-0000-4000-8000-00000000da01'::uuid then
    raise exception using errcode = '42501', message = 'DA_APP_SCHEMA_MISMATCH';
  end if;

  insert into app_data_agent.workspaces (
    app_id, workspace_id, environment, slug, display_name
  ) values (
    resolved_app_id,
    requested_tenant_id,
    resolved_environment,
    'legacy-' || pg_catalog.replace(requested_tenant_id::text, '-', ''),
    'Development workspace ' || requested_tenant_id::text
  ) on conflict (app_id, workspace_id, environment) do nothing;

  insert into app_data_agent.memberships (
    app_id, tenant_id, environment, principal_id, membership_role,
    workspace_role, membership_source, system_override
  ) values (
    resolved_app_id, requested_tenant_id, resolved_environment, requested_principal_id,
    requested_role, resolved_workspace_role, 'LEGACY', false
  )
  on conflict (app_id, tenant_id, environment, principal_id)
  do update set
    membership_role = excluded.membership_role,
    workspace_role = excluded.workspace_role,
    membership_source = excluded.membership_source,
    system_override = false,
    membership_version = app_data_agent.memberships.membership_version + 1,
    revoked_at = null,
    updated_at = pg_catalog.clock_timestamp()
  returning * into provisioned_membership;

  return provisioned_membership;
end
$function$;
