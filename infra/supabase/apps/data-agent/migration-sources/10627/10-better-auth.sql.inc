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
