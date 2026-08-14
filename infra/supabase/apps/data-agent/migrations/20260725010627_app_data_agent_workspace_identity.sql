-- workspace_identity_migration_checksum: sha256:cf08be336326e3f00cc2bd1806cf3081cd05908ec5ec05ddb32e3e328f51fc02
-- ============================================================
-- 10627: Workspace identity, RBAC and closed-account bootstrap
-- ============================================================
-- Depends on: 20260725010626_app_data_agent_semantic_candidate_compile
-- Better Auth owns credentials and sessions. PostgreSQL owns app users,
-- workspaces, memberships, versions, authority and immutable audit evidence.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'WORKSPACE_IDENTITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'WORKSPACE_IDENTITY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'WORKSPACE_IDENTITY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010626_app_data_agent_semantic_candidate_compile';
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_BASELINE_10626_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010627_app_data_agent_workspace_identity'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_MIGRATION_10627_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.memberships') is null
    or pg_catalog.to_regprocedure('platform.resolve_backend_authority(uuid,uuid,uuid,boolean)') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_BASELINE_AUTHORITY_MISSING';
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
-- 10627: Reviewed Better Auth 1.6.23 PostgreSQL schema
-- ============================================================

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_auth_runtime') then
    create role data_agent_auth_runtime nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_identity_rpc_owner') then
    create role data_agent_identity_rpc_owner nologin noinherit;
  end if;
end
$roles$;

create schema data_agent_auth;
revoke all on schema data_agent_auth from public, anon, authenticated, service_role, data_agent_backend;

create table data_agent_auth."user" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default pg_catalog.clock_timestamp() not null,
  "updatedAt" timestamptz default pg_catalog.clock_timestamp() not null,
  "role" text,
  "banned" boolean,
  "banReason" text,
  "banExpires" timestamptz
);

create table data_agent_auth."session" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default pg_catalog.clock_timestamp() not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid not null references data_agent_auth."user" ("id") on delete cascade,
  "impersonatedBy" text,
  check ("impersonatedBy" is null)
);

create table data_agent_auth."account" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" uuid not null references data_agent_auth."user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default pg_catalog.clock_timestamp() not null,
  "updatedAt" timestamptz not null
);

create table data_agent_auth."verification" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default pg_catalog.clock_timestamp() not null,
  "updatedAt" timestamptz default pg_catalog.clock_timestamp() not null
);

create index "session_userId_idx" on data_agent_auth."session" ("userId");
create index "account_userId_idx" on data_agent_auth."account" ("userId");
create index "verification_identifier_idx" on data_agent_auth."verification" ("identifier");

alter table data_agent_auth."user" owner to data_agent_auth_runtime;
alter table data_agent_auth."session" owner to data_agent_auth_runtime;
alter table data_agent_auth."account" owner to data_agent_auth_runtime;
alter table data_agent_auth."verification" owner to data_agent_auth_runtime;
-- ============================================================
-- 10627: App-global users, workspace map, membership versions and receipts
-- ============================================================

create table app_data_agent.app_users (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  auth_user_id uuid not null references data_agent_auth."user" ("id") on delete restrict,
  email text not null check (pg_catalog.length(email) between 3 and 320),
  display_name text not null check (pg_catalog.length(pg_catalog.btrim(display_name)) between 1 and 128),
  system_role text not null check (system_role in ('SUPER_ADMIN', 'USER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  authz_epoch bigint not null default 1 check (authz_epoch >= 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  disabled_at timestamptz,
  primary key (app_id, environment, principal_id),
  unique (app_id, environment, auth_user_id),
  unique (app_id, environment, email),
  check ((status = 'ACTIVE' and disabled_at is null) or (status = 'DISABLED' and disabled_at is not null))
);

create table app_data_agent.workspaces (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  workspace_id uuid not null,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  display_name text not null check (pg_catalog.length(pg_catalog.btrim(display_name)) between 1 and 128),
  lifecycle text not null default 'ACTIVE' check (lifecycle in ('ACTIVE', 'ARCHIVED')),
  lifecycle_version bigint not null default 1 check (lifecycle_version >= 1),
  created_by_principal_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  archived_at timestamptz,
  primary key (app_id, workspace_id, environment),
  unique (app_id, environment, slug),
  check (
    (lifecycle = 'ACTIVE' and archived_at is null)
    or (lifecycle = 'ARCHIVED' and archived_at is not null)
  )
);

alter table app_data_agent.memberships
  add column workspace_role text,
  add column membership_source text not null default 'LEGACY',
  add column system_override boolean not null default false;

update app_data_agent.memberships
set workspace_role = case membership_role
  when 'owner' then 'WORKSPACE_ADMIN'
  when 'analyst' then 'ANALYST'
  when 'viewer' then 'VIEWER'
  else null
end;

alter table app_data_agent.memberships
  add constraint memberships_workspace_role_check
    check (workspace_role is null or workspace_role in ('WORKSPACE_ADMIN', 'ANALYST', 'VIEWER')),
  add constraint memberships_source_check
    check (membership_source in ('EXPLICIT', 'SYSTEM_ROLE', 'LEGACY')),
  add constraint memberships_role_mapping_check
    check (
      (membership_role = 'demo' and workspace_role is null and not system_override)
      or (membership_role = 'owner' and workspace_role = 'WORKSPACE_ADMIN')
      or (membership_role = 'analyst' and workspace_role = 'ANALYST' and not system_override)
      or (membership_role = 'viewer' and workspace_role = 'VIEWER' and not system_override)
    ),
  add constraint memberships_workspace_fk
    foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment)
    on delete restrict;

create index memberships_workspace_active_idx
  on app_data_agent.memberships (app_id, environment, principal_id, revoked_at, tenant_id);

create table app_data_agent.identity_operations (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (
    pg_catalog.length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  command_kind text not null check (command_kind in (
    'CREATE_USER', 'DISABLE_USER', 'ENABLE_USER', 'RESET_USER_PASSWORD',
    'CREATE_WORKSPACE', 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE',
    'UPSERT_WORKSPACE_MEMBER', 'REVOKE_WORKSPACE_MEMBER'
  )),
  input_payload jsonb not null check (pg_catalog.jsonb_typeof(input_payload) = 'object'),
  input_hash text not null check (
    input_hash ~ '^sha256:[0-9a-f]{64}$'
    and input_hash = platform.canonical_sha256(input_payload)
  ),
  target_principal_id uuid,
  workspace_id uuid,
  status text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'RETRY_REQUIRED')),
  result_payload jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  result_version bigint not null default 1 check (result_version >= 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  primary key (app_id, environment, actor_principal_id, idempotency_key),
  unique (app_id, environment, operation_id),
  check (
    (status in ('PENDING', 'RETRY_REQUIRED') and completed_at is null)
    or (status in ('SUCCEEDED', 'FAILED') and completed_at is not null)
  )
);

create table app_data_agent.identity_operation_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null default pg_catalog.gen_random_uuid(),
  operation_id uuid not null,
  actor_principal_id uuid not null,
  attempt_no integer not null check (attempt_no >= 1),
  status text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'RETRY_REQUIRED')),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  details jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, receipt_id),
  unique (app_id, environment, operation_id, attempt_no),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.identity_operations (app_id, environment, operation_id)
    on delete restrict
);

create table app_data_agent.identity_audit_log (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  audit_id uuid not null default pg_catalog.gen_random_uuid(),
  operation_id uuid not null,
  actor_principal_id uuid not null,
  target_principal_id uuid,
  workspace_id uuid,
  command_kind text not null,
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  details jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, audit_id),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.identity_operations (app_id, environment, operation_id)
    on delete restrict
);

create function app_data_agent.reject_identity_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'IDENTITY_EVIDENCE_IMMUTABLE';
end
$function$;

create trigger identity_operation_receipts_immutable
before update or delete on app_data_agent.identity_operation_receipts
for each row execute function app_data_agent.reject_identity_evidence_mutation();

create trigger identity_audit_log_immutable
before update or delete on app_data_agent.identity_audit_log
for each row execute function app_data_agent.reject_identity_evidence_mutation();
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
-- ============================================================
-- 10627: Principal-scoped idempotent identity/workspace commands
-- ============================================================

create function app_data_agent.identity_command_payload_is_valid(requested_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  command_kind text;
begin
  if pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or not (requested_payload ?& array['schema_version', 'operation_id', 'idempotency_key', 'kind'])
    or requested_payload ->> 'schema_version' <> 'identity-command@1.0.0'
    or requested_payload ->> 'operation_id'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.length(requested_payload ->> 'idempotency_key') not between 8 and 128
    or requested_payload ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  then
    return false;
  end if;
  if requested_payload ? 'expected_version' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'expected_version') <> 'number'
    or requested_payload ->> 'expected_version' !~ '^[1-9][0-9]*$'
  ) then
    return false;
  end if;

  command_kind := requested_payload ->> 'kind';
  case command_kind
    when 'CREATE_USER' then
      return requested_payload ?& array['email', 'display_name', 'system_role']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'email', 'display_name', 'system_role'
      ] = '{}'::jsonb
        and pg_catalog.length(requested_payload ->> 'email') between 3 and 320
        and pg_catalog.length(pg_catalog.btrim(requested_payload ->> 'display_name')) between 1 and 128
        and requested_payload ->> 'system_role' in ('SUPER_ADMIN', 'USER');
    when 'DISABLE_USER', 'ENABLE_USER', 'RESET_USER_PASSWORD' then
      return requested_payload ?& array['principal_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'principal_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    when 'CREATE_WORKSPACE' then
      return requested_payload ?& array['workspace_id', 'slug', 'display_name']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'slug', 'display_name'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'slug' ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'
        and pg_catalog.length(pg_catalog.btrim(requested_payload ->> 'display_name')) between 1 and 128;
    when 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE' then
      return requested_payload ?& array['workspace_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    when 'UPSERT_WORKSPACE_MEMBER' then
      return requested_payload ?& array['workspace_id', 'principal_id', 'role']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'principal_id', 'role'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'role' in ('WORKSPACE_ADMIN', 'ANALYST', 'VIEWER');
    when 'REVOKE_WORKSPACE_MEMBER' then
      return requested_payload ?& array['workspace_id', 'principal_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'principal_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    else
      return false;
  end case;
end
$function$;

create function app_data_agent.apply_identity_command(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_auth_user_id uuid,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
<<apply_identity_command>>
declare
  resolved_app_id uuid;
  resolved_environment text;
  actor app_data_agent.app_users%rowtype;
  target app_data_agent.app_users%rowtype;
  workspace app_data_agent.workspaces%rowtype;
  existing_operation app_data_agent.identity_operations%rowtype;
  command_kind text;
  operation_id uuid;
  idempotency_key text;
  input_hash text;
  expected_version bigint;
  target_principal_id uuid;
  workspace_id uuid;
  target_role text;
  legacy_role text;
  operation_status text := 'SUCCEEDED';
  reason_code text := 'IDENTITY_OPERATION_SUCCEEDED';
  now_at timestamptz := pg_catalog.clock_timestamp();
  result_payload jsonb;
  actor_is_workspace_admin boolean := false;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.identity_command_payload_is_valid(requested_command) then
    raise exception using errcode = '22023', message = 'IDENTITY_COMMAND_INVALID';
  end if;

  command_kind := requested_command ->> 'kind';
  operation_id := (requested_command ->> 'operation_id')::uuid;
  idempotency_key := requested_command ->> 'idempotency_key';
  input_hash := platform.canonical_sha256(requested_command);
  expected_version := nullif(requested_command ->> 'expected_version', '')::bigint;
  target_principal_id := nullif(requested_command ->> 'principal_id', '')::uuid;
  workspace_id := nullif(requested_command ->> 'workspace_id', '')::uuid;

  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and lifecycle.lifecycle_state = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  select app_user.* into actor
  from app_data_agent.app_users as app_user
  where app_user.app_id = resolved_app_id
    and app_user.environment = resolved_environment
    and app_user.principal_id = requested_actor_principal_id
    and app_user.status = 'ACTIVE'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'APP_USER_DISABLED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        resolved_app_id, resolved_environment, requested_actor_principal_id, idempotency_key
      )::text,
      0
    )
  );
  select operation.* into existing_operation
  from app_data_agent.identity_operations as operation
  where operation.app_id = resolved_app_id
    and operation.environment = resolved_environment
    and operation.actor_principal_id = requested_actor_principal_id
    and operation.idempotency_key = apply_identity_command.idempotency_key
  for update;
  if found then
    if existing_operation.operation_id <> operation_id
      or existing_operation.input_hash <> input_hash
      or existing_operation.input_payload <> requested_command
    then
      raise exception using errcode = '23505', message = 'IDENTITY_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  insert into app_data_agent.identity_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    command_kind, input_payload, input_hash, target_principal_id, workspace_id, status
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id,
    idempotency_key, command_kind, requested_command, input_hash,
    target_principal_id, workspace_id, 'PENDING'
  );

  if command_kind in (
    'CREATE_USER', 'DISABLE_USER', 'ENABLE_USER', 'RESET_USER_PASSWORD',
    'CREATE_WORKSPACE', 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE'
  ) and actor.system_role <> 'SUPER_ADMIN' then
    raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
  end if;

  case command_kind
    when 'CREATE_USER' then
      if requested_auth_user_id is null or not exists (
        select 1 from data_agent_auth."user" as auth_user
        where auth_user."id" = requested_auth_user_id
          and auth_user."email" = requested_command ->> 'email'
      ) then
        raise exception using errcode = 'P0001', message = 'IDENTITY_OPERATION_RETRY_REQUIRED';
      end if;
      target_principal_id := operation_id;
      insert into app_data_agent.app_users (
        app_id, environment, principal_id, auth_user_id, email, display_name, system_role
      ) values (
        resolved_app_id, resolved_environment, target_principal_id, requested_auth_user_id,
        requested_command ->> 'email', requested_command ->> 'display_name',
        requested_command ->> 'system_role'
      );
      if requested_command ->> 'system_role' = 'SUPER_ADMIN' then
        insert into app_data_agent.memberships (
          app_id, tenant_id, environment, principal_id, membership_role,
          workspace_role, membership_source, system_override
        )
        select
          workspace_row.app_id, workspace_row.workspace_id, workspace_row.environment,
          target_principal_id, 'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
        from app_data_agent.workspaces as workspace_row
        where workspace_row.app_id = resolved_app_id
          and workspace_row.environment = resolved_environment
          and workspace_row.lifecycle = 'ACTIVE';
      end if;

    when 'DISABLE_USER' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      if target.system_role = 'SUPER_ADMIN' and target.status = 'ACTIVE' and (
        select pg_catalog.count(*) from app_data_agent.app_users as app_user
        where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
          and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE'
      ) <= 1 then
        raise exception using errcode = '42501', message = 'LAST_SUPER_ADMIN_REQUIRED';
      end if;
      update app_data_agent.app_users as target_user
      set status = 'DISABLED', disabled_at = now_at, authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;
      operation_status := 'RETRY_REQUIRED';
      reason_code := 'IDENTITY_OPERATION_RETRY_REQUIRED';

    when 'ENABLE_USER' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.app_users as target_user
      set status = 'ACTIVE', disabled_at = null, authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;

    when 'RESET_USER_PASSWORD' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.app_users as target_user
      set authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;
      operation_status := 'RETRY_REQUIRED';
      reason_code := 'IDENTITY_OPERATION_RETRY_REQUIRED';

    when 'CREATE_WORKSPACE' then
      insert into app_data_agent.workspaces (
        app_id, environment, workspace_id, slug, display_name, created_by_principal_id
      ) values (
        resolved_app_id, resolved_environment, workspace_id,
        requested_command ->> 'slug', requested_command ->> 'display_name',
        requested_actor_principal_id
      );
      insert into app_data_agent.memberships (
        app_id, tenant_id, environment, principal_id, membership_role,
        workspace_role, membership_source, system_override
      )
      select
        app_user.app_id, workspace_id, app_user.environment, app_user.principal_id,
        'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE';

    when 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE' then
      select workspace_row.* into workspace
      from app_data_agent.workspaces as workspace_row
      where workspace_row.app_id = resolved_app_id
        and workspace_row.environment = resolved_environment
        and workspace_row.workspace_id = apply_identity_command.workspace_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and workspace.lifecycle_version <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.workspaces as target_workspace
      set lifecycle = case command_kind when 'ARCHIVE_WORKSPACE' then 'ARCHIVED' else 'ACTIVE' end,
          archived_at = case command_kind when 'ARCHIVE_WORKSPACE' then now_at else null end,
          lifecycle_version = lifecycle_version + 1,
          updated_at = now_at
      where target_workspace.app_id = resolved_app_id
        and target_workspace.environment = resolved_environment
        and target_workspace.workspace_id = workspace.workspace_id;

    when 'UPSERT_WORKSPACE_MEMBER', 'REVOKE_WORKSPACE_MEMBER' then
      select workspace_row.* into workspace
      from app_data_agent.workspaces as workspace_row
      where workspace_row.app_id = resolved_app_id
        and workspace_row.environment = resolved_environment
        and workspace_row.workspace_id = apply_identity_command.workspace_id
        and workspace_row.lifecycle = 'ACTIVE'
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      select exists (
        select 1 from app_data_agent.memberships as membership
        where membership.app_id = resolved_app_id and membership.environment = resolved_environment
          and membership.tenant_id = apply_identity_command.workspace_id
          and membership.principal_id = requested_actor_principal_id
          and membership.membership_role = 'owner' and membership.revoked_at is null
      ) into actor_is_workspace_admin;
      if actor.system_role <> 'SUPER_ADMIN' and not actor_is_workspace_admin then
        raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
      end if;
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if actor.system_role <> 'SUPER_ADMIN' and target.system_role = 'SUPER_ADMIN' then
        raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
      end if;
      if command_kind = 'UPSERT_WORKSPACE_MEMBER' then
        target_role := requested_command ->> 'role';
        if target.system_role = 'SUPER_ADMIN' and target_role <> 'WORKSPACE_ADMIN' then
          raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
        end if;
        legacy_role := case target_role
          when 'WORKSPACE_ADMIN' then 'owner'
          when 'ANALYST' then 'analyst'
          else 'viewer'
        end;
        insert into app_data_agent.memberships (
          app_id, tenant_id, environment, principal_id, membership_role,
          workspace_role, membership_source, system_override
        ) values (
          resolved_app_id, workspace_id, resolved_environment, target_principal_id,
          legacy_role, target_role,
          case when target.system_role = 'SUPER_ADMIN' then 'SYSTEM_ROLE' else 'EXPLICIT' end,
          target.system_role = 'SUPER_ADMIN'
        )
        on conflict (app_id, tenant_id, environment, principal_id)
        do update set
          membership_role = excluded.membership_role,
          workspace_role = excluded.workspace_role,
          membership_source = excluded.membership_source,
          system_override = excluded.system_override,
          membership_version = app_data_agent.memberships.membership_version + 1,
          revoked_at = null,
          updated_at = now_at;
      else
        if target.system_role = 'SUPER_ADMIN' then
          raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
        end if;
        update app_data_agent.memberships as target_membership
        set revoked_at = now_at,
            membership_version = membership_version + 1,
            updated_at = now_at
        where target_membership.app_id = resolved_app_id
          and target_membership.environment = resolved_environment
          and target_membership.tenant_id = apply_identity_command.workspace_id
          and target_membership.principal_id = apply_identity_command.target_principal_id
          and target_membership.revoked_at is null;
        if not found then
          raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
        end if;
      end if;
  end case;

  result_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'identity-operation-receipt@1.0.0',
    'operation_id', operation_id,
    'actor_principal_id', requested_actor_principal_id,
    'target_principal_id', target_principal_id,
    'workspace_id', workspace_id,
    'command_kind', command_kind,
    'status', operation_status,
    'input_hash', input_hash,
    'result_version', '1',
    'reason_code', reason_code,
    'created_at', now_at,
    'completed_at', case
      when operation_status = 'SUCCEEDED' then pg_catalog.to_jsonb(now_at)
      else 'null'::jsonb
    end
  );
  update app_data_agent.identity_operations as identity_operation
  set target_principal_id = apply_identity_command.target_principal_id,
      workspace_id = apply_identity_command.workspace_id,
      status = apply_identity_command.operation_status,
      result_payload = apply_identity_command.result_payload,
      completed_at = case
        when apply_identity_command.operation_status = 'SUCCEEDED' then now_at
        else null
      end
  where identity_operation.app_id = resolved_app_id
    and identity_operation.environment = resolved_environment
    and identity_operation.operation_id = apply_identity_command.operation_id;
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id, 1,
    operation_status, reason_code,
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    workspace_id, command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id,
    target_principal_id, workspace_id, command_kind, reason_code,
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  return result_payload;
end
$function$;

create function app_data_agent.complete_identity_side_effect(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_operation_id uuid,
  succeeded boolean,
  requested_reason_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  resolved_app_id uuid;
  resolved_environment text;
  operation app_data_agent.identity_operations%rowtype;
  next_attempt integer;
  final_status text;
  final_result jsonb;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE')
    or succeeded is null
    or requested_reason_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
  then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join app_data_agent.app_users as actor
    on actor.app_id = deployment.app_id and actor.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active
    and actor.principal_id = requested_actor_principal_id
    and actor.system_role = 'SUPER_ADMIN' and actor.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
  end if;
  select operation_row.* into operation
  from app_data_agent.identity_operations as operation_row
  where operation_row.app_id = resolved_app_id
    and operation_row.environment = resolved_environment
    and operation_row.operation_id = requested_operation_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
  final_status := case when succeeded then 'SUCCEEDED' else 'RETRY_REQUIRED' end;
  if operation.status = 'SUCCEEDED' then
    if not succeeded then
      raise exception using errcode = '23505', message = 'IDENTITY_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;
  select coalesce(pg_catalog.max(receipt.attempt_no), 0) + 1 into next_attempt
  from app_data_agent.identity_operation_receipts as receipt
  where receipt.app_id = resolved_app_id and receipt.environment = resolved_environment
    and receipt.operation_id = requested_operation_id;
  final_result := operation.result_payload || pg_catalog.jsonb_build_object(
    'status', final_status,
    'reason_code', requested_reason_code,
    'completed_at', case when succeeded then pg_catalog.to_jsonb(now_at) else 'null'::jsonb end
  );
  update app_data_agent.identity_operations
  set status = final_status,
      result_payload = final_result,
      result_version = result_version + 1,
      completed_at = case when succeeded then now_at else null end
  where app_id = resolved_app_id and environment = resolved_environment
    and operation_id = requested_operation_id;
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_actor_principal_id, next_attempt, final_status, requested_reason_code,
    pg_catalog.jsonb_build_object('side_effect_completed', succeeded)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    workspace_id, command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_actor_principal_id, operation.target_principal_id, operation.workspace_id,
    operation.command_kind, requested_reason_code,
    pg_catalog.jsonb_build_object('side_effect_completed', succeeded)
  );
  return final_result;
end
$function$;

create function app_data_agent.bootstrap_super_admin(
  requested_deployment_id uuid,
  requested_auth_user_id uuid,
  requested_principal_id uuid,
  requested_email text,
  requested_display_name text,
  requested_operation_id uuid,
  requested_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  resolved_app_id uuid;
  resolved_environment text;
  now_at timestamptz := pg_catalog.clock_timestamp();
  input_payload jsonb;
  input_hash text;
  result_payload jsonb;
begin
  if session_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_superadmin_bootstrap', true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_BOOTSTRAP_DISABLED';
  end if;
  if requested_auth_user_id is null or requested_principal_id is null
    or requested_operation_id is null
    or pg_catalog.length(requested_email) not between 3 and 320
    or pg_catalog.length(pg_catalog.btrim(requested_display_name)) not between 1 and 128
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'IDENTITY_COMMAND_INVALID';
  end if;
  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and lifecycle.lifecycle_state = 'ACTIVE';
  if not found or not exists (
    select 1 from data_agent_auth."user" as auth_user
    where auth_user."id" = requested_auth_user_id and auth_user."email" = requested_email
  ) then
    raise exception using errcode = 'P0001', message = 'IDENTITY_OPERATION_RETRY_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array('superadmin-bootstrap', resolved_app_id, resolved_environment)::text,
      0
    )
  );
  if exists (
    select 1 from app_data_agent.app_users as app_user
    where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
      and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_ALREADY_BOOTSTRAPPED';
  end if;
  input_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'superadmin-bootstrap@1.0.0',
    'operation_id', requested_operation_id,
    'idempotency_key', requested_idempotency_key,
    'principal_id', requested_principal_id,
    'auth_user_id', requested_auth_user_id,
    'email', requested_email,
    'display_name', requested_display_name
  );
  input_hash := platform.canonical_sha256(input_payload);
  insert into app_data_agent.app_users (
    app_id, environment, principal_id, auth_user_id, email, display_name, system_role
  ) values (
    resolved_app_id, resolved_environment, requested_principal_id, requested_auth_user_id,
    requested_email, requested_display_name, 'SUPER_ADMIN'
  );
  insert into app_data_agent.memberships (
    app_id, tenant_id, environment, principal_id, membership_role,
    workspace_role, membership_source, system_override
  )
  select workspace.app_id, workspace.workspace_id, workspace.environment,
    requested_principal_id, 'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
  from app_data_agent.workspaces as workspace
  where workspace.app_id = resolved_app_id and workspace.environment = resolved_environment
    and workspace.lifecycle = 'ACTIVE';
  result_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'identity-operation-receipt@1.0.0',
    'operation_id', requested_operation_id,
    'actor_principal_id', requested_principal_id,
    'target_principal_id', requested_principal_id,
    'workspace_id', null,
    'command_kind', 'CREATE_USER',
    'status', 'SUCCEEDED',
    'input_hash', input_hash,
    'result_version', '1',
    'reason_code', 'IDENTITY_OPERATION_SUCCEEDED',
    'created_at', now_at,
    'completed_at', now_at
  );
  insert into app_data_agent.identity_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    command_kind, input_payload, input_hash, target_principal_id, status,
    result_payload, completed_at
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, requested_idempotency_key, 'CREATE_USER', input_payload,
    input_hash, requested_principal_id, 'SUCCEEDED', result_payload, now_at
  );
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, 1, 'SUCCEEDED', 'IDENTITY_OPERATION_SUCCEEDED',
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, requested_principal_id, 'CREATE_USER',
    'IDENTITY_OPERATION_SUCCEEDED',
    pg_catalog.jsonb_build_object('bootstrap', true, 'input_hash', input_hash)
  );
  return result_payload;
end
$function$;
-- ============================================================
-- 10627: Private ownership, exact grants, RLS and postconditions
-- ============================================================

revoke all on all tables in schema data_agent_auth
from public, anon, authenticated, service_role, data_agent_backend, data_agent_identity_rpc_owner;
grant usage on schema data_agent_auth to data_agent_auth_runtime, data_agent_identity_rpc_owner;
grant select, insert, update, delete on table
  data_agent_auth."user",
  data_agent_auth."session",
  data_agent_auth."account",
  data_agent_auth."verification"
to data_agent_auth_runtime;
grant select on table data_agent_auth."user" to data_agent_identity_rpc_owner;

alter table app_data_agent.app_users owner to data_agent_identity_rpc_owner;
alter table app_data_agent.workspaces owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_operation_receipts owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_audit_log owner to data_agent_identity_rpc_owner;

alter table app_data_agent.app_users enable row level security;
alter table app_data_agent.app_users force row level security;
alter table app_data_agent.workspaces enable row level security;
alter table app_data_agent.workspaces force row level security;
alter table app_data_agent.identity_operations enable row level security;
alter table app_data_agent.identity_operations force row level security;
alter table app_data_agent.identity_operation_receipts enable row level security;
alter table app_data_agent.identity_operation_receipts force row level security;
alter table app_data_agent.identity_audit_log enable row level security;
alter table app_data_agent.identity_audit_log force row level security;

create policy app_users_identity_rpc_policy
  on app_data_agent.app_users for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy workspaces_identity_rpc_policy
  on app_data_agent.workspaces for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_operations_rpc_policy
  on app_data_agent.identity_operations for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_operation_receipts_rpc_policy
  on app_data_agent.identity_operation_receipts for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_audit_log_rpc_policy
  on app_data_agent.identity_audit_log for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy memberships_identity_rpc_policy
  on app_data_agent.memberships for all to data_agent_identity_rpc_owner
  using (true) with check (true);

grant usage on schema platform, app_data_agent to data_agent_identity_rpc_owner;
grant select on table
  platform.deployment_mappings,
  platform.app_environment_lifecycle
to data_agent_identity_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb) to data_agent_identity_rpc_owner;
grant execute on function platform.acquire_lifecycle_shared_lock(uuid,text)
  to data_agent_identity_rpc_owner;
grant select, insert, update on table app_data_agent.memberships
  to data_agent_identity_rpc_owner;

alter function app_data_agent.reject_identity_evidence_mutation()
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.identity_command_payload_is_valid(jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_session_principal(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_principal_workspaces(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)
  owner to data_agent_identity_rpc_owner;
alter function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) owner to data_agent_identity_rpc_owner;

revoke all on function app_data_agent.identity_command_payload_is_valid(jsonb) from public;
revoke all on function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text) from public;
revoke all on function app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text) from public;
revoke all on function platform.resolve_session_principal(uuid,uuid) from public;
revoke all on function platform.list_principal_workspaces(uuid,uuid) from public;
revoke all on function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean) from public;
revoke all on function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) from public;

grant execute on function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text)
  to data_agent_backend;
grant execute on function platform.resolve_session_principal(uuid,uuid)
  to data_agent_backend;
grant execute on function platform.list_principal_workspaces(uuid,uuid)
  to data_agent_backend;
grant execute on function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)
  to data_agent_backend;
grant execute on function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) to data_agent_backend;

revoke all on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.identity_operations,
  app_data_agent.identity_operation_receipts,
  app_data_agent.identity_audit_log
from public, anon, authenticated, service_role, data_agent_backend, data_agent_auth_runtime;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'app_users', 'workspaces', 'identity_operations',
    'identity_operation_receipts', 'identity_audit_log'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('app_data_agent.%I', relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_schema_privilege('data_agent_backend', 'data_agent_auth', 'USAGE')
    or pg_catalog.has_table_privilege('data_agent_backend', 'data_agent_auth.session', 'SELECT')
    or pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_PRIVATE_SURFACE_EXPOSED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'data_agent_auth'
      and class.relname = 'session'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%impersonatedBy%IS NULL%'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_IMPERSONATION_NOT_DISABLED';
  end if;
  foreach function_name in array array[
    'resolve_session_principal', 'list_principal_workspaces',
    'resolve_workspace_authority', 'revalidate_workspace_authority',
    'apply_identity_command', 'complete_identity_side_effect', 'bootstrap_super_admin'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname in ('platform', 'app_data_agent')
      and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_identity_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
-- ============================================================
-- 10627: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010627_app_data_agent_workspace_identity',
  'sha256:cf08be336326e3f00cc2bd1806cf3081cd05908ec5ec05ddb32e3e328f51fc02'
);

commit;
