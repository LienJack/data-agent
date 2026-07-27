\set ON_ERROR_STOP on

-- 仅供普通 PostgreSQL 容器执行迁移测试。生产迁移不得创建或替换 auth/storage 对象。
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  raw_claims text;
  subject text;
begin
  raw_claims := pg_catalog.current_setting('request.jwt.claims', true);
  if raw_claims is null or raw_claims = '' then
    return null;
  end if;

  subject := nullif((raw_claims::jsonb ->> 'sub'), '');
  if subject is null then
    return null;
  end if;
  return subject::uuid;
exception
  when others then
    return null;
end
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key,
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on table storage.objects
to anon, authenticated, service_role;
grant select on table storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  with parts as (
    select pg_catalog.string_to_array(name, '/') as value
  )
  select case
    when pg_catalog.cardinality(value) <= 1 then array[]::text[]
    else value[1:pg_catalog.cardinality(value) - 1]
  end
  from parts
$$;

create or replace function storage.filename(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select (pg_catalog.string_to_array(name, '/'))[
    pg_catalog.cardinality(pg_catalog.string_to_array(name, '/'))
  ]
$$;

create schema if not exists test_support;

create or replace function test_support.assert_true(condition boolean, message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if condition is distinct from true then
    raise exception using
      errcode = 'P0001',
      message = 'ASSERTION_FAILED: ' || message;
  end if;
end
$$;

create or replace function test_support.assert_raises(statement text, message_fragment text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  begin
    execute statement;
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, message_fragment) = 0 then
        raise exception using
          errcode = 'P0001',
          message = 'ASSERTION_WRONG_ERROR: expected ' || message_fragment || ', got ' || sqlerrm;
      end if;
      return;
  end;

  raise exception using
    errcode = 'P0001',
    message = 'ASSERTION_DID_NOT_RAISE: ' || message_fragment;
end
$$;

grant usage on schema test_support to anon, authenticated, service_role;
grant execute on all functions in schema test_support to anon, authenticated, service_role;
