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
  check ((status = 'PENDING' and completed_at is null) or (status <> 'PENDING' and completed_at is not null))
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
