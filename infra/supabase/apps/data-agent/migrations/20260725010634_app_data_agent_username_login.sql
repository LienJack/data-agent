-- username_login_migration_checksum: sha256:042b626219badbeee6bd7ac282d9082062a7bc29847bba0ccb8afe1bccf3dc62
-- ============================================================
-- 10634: Unique username login and local superadmin credential sync
-- Depends on: 20260725010633_app_data_agent_operations_admin
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'USERNAME_LOGIN_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'USERNAME_LOGIN_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010633_app_data_agent_operations_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_BASELINE_10633_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010634_app_data_agent_username_login'
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_MIGRATION_10634_ALREADY_RECORDED';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
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
-- ============================================================
-- 10634: PostgreSQL-executor-only local credential rotation
-- ============================================================

create function app_data_agent.sync_local_super_admin_credentials(
  requested_deployment_id uuid,
  requested_email text,
  requested_username text,
  requested_password_hash text,
  requested_workspace_slug text,
  requested_operation_id uuid,
  requested_idempotency_key text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
declare
  scope_record record;
  target record;
  target_count bigint;
  old_username text;
  now_at timestamptz := pg_catalog.clock_timestamp();
  input_payload jsonb;
  input_hash text;
  result_payload jsonb;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_local_superadmin_sync',true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_EXECUTOR_UNSAFE';
  end if;
  if requested_deployment_id is null or requested_operation_id is null
    or pg_catalog.length(requested_email) not between 3 and 320
    or requested_email <> pg_catalog.lower(requested_email)
    or pg_catalog.length(requested_username) not between 3 and 30
    or requested_username <> pg_catalog.lower(requested_username)
    or requested_username !~ '^[a-z0-9_.]+$'
    or pg_catalog.length(requested_password_hash) < 20
    or pg_catalog.length(requested_workspace_slug) not between 2 and 63
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID';
  end if;
  select deployment.app_id,deployment.environment into scope_record
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id=deployment.app_id and lifecycle.environment=deployment.environment
  where deployment.deployment_id=requested_deployment_id
    and deployment.is_active and deployment.revoked_at is null
    and deployment.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and deployment.environment='local'
    and lifecycle.lifecycle_state='ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_DEPLOYMENT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array('local-superadmin-sync',scope_record.app_id,scope_record.environment)::text,0
  ));
  select pg_catalog.count(*) into target_count
  from app_data_agent.app_users as app_user
  where app_user.app_id=scope_record.app_id
    and app_user.environment=scope_record.environment
    and app_user.system_role='SUPER_ADMIN' and app_user.status='ACTIVE';
  if target_count <> 1 then
    raise exception using errcode = '21000', message = 'DEV_SUPERADMIN_SYNC_AMBIGUOUS';
  end if;
  select app_user.principal_id,app_user.auth_user_id,app_user.username,
    workspace.workspace_id
  into strict target
  from app_data_agent.app_users as app_user
  join data_agent_auth."user" as auth_user
    on auth_user."id"=app_user.auth_user_id and auth_user."email"=app_user.email
  join app_data_agent.workspaces as workspace
    on workspace.app_id=app_user.app_id and workspace.environment=app_user.environment
   and workspace.slug=requested_workspace_slug and workspace.lifecycle='ACTIVE'
  join app_data_agent.memberships as membership
    on membership.app_id=workspace.app_id and membership.environment=workspace.environment
   and membership.tenant_id=workspace.workspace_id and membership.principal_id=app_user.principal_id
   and membership.revoked_at is null and membership.system_override
   and membership.workspace_role='WORKSPACE_ADMIN'
  where app_user.app_id=scope_record.app_id
    and app_user.environment=scope_record.environment
    and app_user.system_role='SUPER_ADMIN' and app_user.status='ACTIVE';
  if requested_email is distinct from (
    select app_user.email from app_data_agent.app_users as app_user
    where app_user.app_id=scope_record.app_id and app_user.environment=scope_record.environment
      and app_user.principal_id=target.principal_id
  ) then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_EMAIL_MISMATCH';
  end if;
  if exists (
    select 1 from data_agent_auth."user" as auth_user
    where auth_user."username"=requested_username and auth_user."id"<>target.auth_user_id
  ) then
    raise exception using errcode = '23505', message = 'DEV_SUPERADMIN_SYNC_USERNAME_CONFLICT';
  end if;
  old_username := target.username;
  update data_agent_auth."user" set
    "username"=requested_username,
    "displayUsername"=requested_username,
    "updatedAt"=now_at
  where "id"=target.auth_user_id;
  update app_data_agent.app_users set
    username=requested_username,
    authz_epoch=authz_epoch+1,
    updated_at=now_at
  where app_id=scope_record.app_id and environment=scope_record.environment
    and principal_id=target.principal_id;
  update data_agent_auth."account" set "password"=requested_password_hash,"updatedAt"=now_at
  where "userId"=target.auth_user_id and "providerId"='credential';
  if not found then
    raise exception using errcode = 'P0002', message = 'DEV_SUPERADMIN_SYNC_CREDENTIAL_MISSING';
  end if;
  delete from data_agent_auth."session" where "userId"=target.auth_user_id;
  input_payload := pg_catalog.jsonb_build_object(
    'schema_version','local-superadmin-sync@1.0.0',
    'operation_id',requested_operation_id,
    'idempotency_key',requested_idempotency_key,
    'email',requested_email,
    'username_before',old_username,
    'username_after',requested_username,
    'workspace_slug',requested_workspace_slug,
    'credential_rotated',true
  );
  input_hash := platform.canonical_sha256(input_payload);
  result_payload := pg_catalog.jsonb_build_object(
    'schema_version','identity-operation-receipt@1.0.0',
    'operation_id',requested_operation_id,
    'actor_principal_id',target.principal_id,
    'target_principal_id',target.principal_id,
    'workspace_id',target.workspace_id,
    'command_kind','RESET_USER_PASSWORD',
    'status','SUCCEEDED',
    'input_hash',input_hash,
    'result_version','1',
    'reason_code','DEV_SUPERADMIN_SYNC_UPDATED',
    'created_at',now_at,
    'completed_at',now_at
  );
  insert into app_data_agent.identity_operations (
    app_id,environment,operation_id,actor_principal_id,idempotency_key,command_kind,
    input_payload,input_hash,target_principal_id,workspace_id,status,result_payload,completed_at
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,
    requested_idempotency_key,'RESET_USER_PASSWORD',input_payload,input_hash,target.principal_id,
    target.workspace_id,'SUCCEEDED',result_payload,now_at
  );
  insert into app_data_agent.identity_operation_receipts (
    app_id,environment,operation_id,actor_principal_id,attempt_no,status,reason_code,details
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,1,
    'SUCCEEDED','DEV_SUPERADMIN_SYNC_UPDATED',
    pg_catalog.jsonb_build_object('username_before',old_username,'username_after',requested_username)
  );
  insert into app_data_agent.identity_audit_log (
    app_id,environment,operation_id,actor_principal_id,target_principal_id,workspace_id,
    command_kind,reason_code,details
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,
    target.principal_id,target.workspace_id,'RESET_USER_PASSWORD','DEV_SUPERADMIN_SYNC_UPDATED',
    pg_catalog.jsonb_build_object('username_before',old_username,'username_after',requested_username,
      'sessions_revoked',true,'credential_rotated',true)
  );
  return pg_catalog.jsonb_build_object(
    'action','UPDATED','principal_id',target.principal_id,'workspace_id',target.workspace_id,
    'username',requested_username,'receipt',result_payload
  );
end
$function$;
-- ============================================================
-- 10634: Hardening and executable postconditions
-- ============================================================

alter function platform.list_admin_users(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_workspace_members(uuid,uuid,uuid) owner to data_agent_identity_rpc_owner;
revoke all on function app_data_agent.bind_new_app_user_username() from public;
revoke all on function app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_SYNC_FUNCTION_MISSING';
  end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_SYNC_FUNCTION_EXPOSED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='data_agent_auth' and relation.relname='user'
      and attribute.attname='username' and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='app_users'
      and attribute.attname='username' and not attribute.attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_COLUMN_MISSING';
  end if;
end
$postconditions$;
-- ============================================================
-- 10634: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010634_app_data_agent_username_login',
  'sha256:042b626219badbeee6bd7ac282d9082062a7bc29847bba0ccb8afe1bccf3dc62'
);

commit;
