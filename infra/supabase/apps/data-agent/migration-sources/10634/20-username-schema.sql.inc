-- ============================================================
-- 10634: Better Auth username fields and app-global mirror
-- ============================================================

alter table data_agent_auth."user"
  add column "username" text,
  add column "displayUsername" text,
  add constraint auth_user_username_format_check check (
    "username" is null
    or (
      pg_catalog.length("username") between 3 and 30
      and "username" = pg_catalog.lower("username")
      and "username" ~ '^[a-z0-9_.]+$'
    )
  ),
  add constraint auth_user_display_username_format_check check (
    "displayUsername" is null
    or pg_catalog.length("displayUsername") between 3 and 30
  );

create unique index auth_user_username_uq
  on data_agent_auth."user" ("username")
  where "username" is not null;

alter table app_data_agent.app_users
  add column username text,
  add constraint app_users_username_format_check check (
    username is null
    or (
      pg_catalog.length(username) between 3 and 30
      and username = pg_catalog.lower(username)
      and username ~ '^[a-z0-9_.]+$'
    )
  );

create unique index app_users_scope_username_uq
  on app_data_agent.app_users (app_id, environment, username)
  where username is not null;

create function app_data_agent.bind_new_app_user_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_username text;
begin
  select auth_user."username" into resolved_username
  from data_agent_auth."user" as auth_user
  where auth_user."id" = new.auth_user_id
    and auth_user."email" = new.email;
  if not found or resolved_username is null then
    raise exception using errcode = '23514', message = 'APP_USER_USERNAME_REQUIRED';
  end if;
  if new.username is not null and new.username is distinct from resolved_username then
    raise exception using errcode = '23514', message = 'APP_USER_USERNAME_MISMATCH';
  end if;
  new.username := resolved_username;
  return new;
end
$function$;

alter function app_data_agent.bind_new_app_user_username()
  owner to data_agent_auth_runtime;

create trigger app_users_bind_username
before insert on app_data_agent.app_users
for each row execute function app_data_agent.bind_new_app_user_username();

create or replace function platform.list_admin_users(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns table (projection jsonb)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_actor_principal_id);
  return query
  select pg_catalog.jsonb_build_object(
    'schema_version','admin-user-projection@1.0.0',
    'principal_id',app_user.principal_id,
    'auth_user_id',app_user.auth_user_id,
    'username',app_user.username,
    'email',app_user.email,
    'display_name',app_user.display_name,
    'system_role',app_user.system_role,
    'status',app_user.status,
    'authz_epoch',app_user.authz_epoch,
    'active_memberships',(
      select pg_catalog.count(*)
      from app_data_agent.memberships as membership
      join app_data_agent.workspaces as workspace
        on workspace.app_id=membership.app_id
       and workspace.environment=membership.environment
       and workspace.workspace_id=membership.tenant_id
      where membership.app_id=app_user.app_id
        and membership.environment=app_user.environment
        and membership.principal_id=app_user.principal_id
        and membership.revoked_at is null
        and membership.membership_role <> 'demo'
        and workspace.lifecycle='ACTIVE'
    ),
    'created_at',app_user.created_at,
    'disabled_at',app_user.disabled_at
  )
  from app_data_agent.app_users as app_user
  where app_user.app_id=scope_record.app_id
    and app_user.environment=scope_record.environment
  order by case app_user.status when 'ACTIVE' then 0 else 1 end,
    case app_user.system_role when 'SUPER_ADMIN' then 0 else 1 end,
    app_user.display_name,app_user.principal_id;
end
$function$;

create or replace function platform.list_workspace_members(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_workspace_id uuid
)
returns table (projection jsonb)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_workspace_authority(
    requested_deployment_id,requested_workspace_id,requested_actor_principal_id,false
  );
  if not exists (
    select 1
    from app_data_agent.app_users as actor
    left join app_data_agent.memberships as actor_membership
      on actor_membership.app_id=actor.app_id
     and actor_membership.environment=actor.environment
     and actor_membership.principal_id=actor.principal_id
     and actor_membership.tenant_id=requested_workspace_id
     and actor_membership.revoked_at is null
     and actor_membership.membership_role <> 'demo'
    where actor.app_id=scope_record.app_id
      and actor.environment=scope_record.environment
      and actor.principal_id=requested_actor_principal_id
      and actor.status='ACTIVE'
      and (actor.system_role='SUPER_ADMIN' or actor_membership.workspace_role='WORKSPACE_ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ADMIN_REQUIRED';
  end if;
  return query
  select pg_catalog.jsonb_build_object(
    'schema_version','admin-workspace-member-projection@1.0.0',
    'workspace_id',membership.tenant_id,
    'principal_id',app_user.principal_id,
    'username',app_user.username,
    'email',app_user.email,
    'display_name',app_user.display_name,
    'system_role',app_user.system_role,
    'user_status',app_user.status,
    'role',membership.workspace_role,
    'source',membership.membership_source,
    'membership_version',membership.membership_version,
    'revoked_at',membership.revoked_at
  )
  from app_data_agent.memberships as membership
  join app_data_agent.app_users as app_user
    on app_user.app_id=membership.app_id
   and app_user.environment=membership.environment
   and app_user.principal_id=membership.principal_id
  where membership.app_id=scope_record.app_id
    and membership.environment=scope_record.environment
    and membership.tenant_id=requested_workspace_id
    and membership.membership_role <> 'demo'
    and membership.workspace_role is not null
  order by case when membership.revoked_at is null then 0 else 1 end,
    case membership.workspace_role when 'WORKSPACE_ADMIN' then 0 when 'ANALYST' then 1 else 2 end,
    app_user.display_name,app_user.principal_id;
end
$function$;
