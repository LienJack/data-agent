-- ============================================================
-- 10621: Attribution Capability Directory
-- ============================================================
-- Stores capability directory entries that list available attribution
-- capabilities with anti-enumeration protections.
-- ============================================================

create table app_data_agent.attribution_capability_directory (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  directory_id uuid not null default extensions.gen_random_uuid(),
  directory_hash text not null,
  capabilities jsonb not null,
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_capability_directory_pk
    primary key (id),
  constraint attribution_capability_directory_unique
    unique (app_id, tenant_id, environment, directory_id)
);

comment on table app_data_agent.attribution_capability_directory is
  'Attribution capability directory: lists available capabilities with anti-enumeration protections.';

create index idx_attribution_capability_dir_published
  on app_data_agent.attribution_capability_directory (app_id, tenant_id, environment, published_at desc);

-- ============================================================
-- RPC: publish_capability_directory
-- ============================================================
create or replace function app_data_agent.publish_capability_directory(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_directory_hash text,
  p_capabilities jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_directory_id uuid;
  v_result jsonb;
begin
  v_directory_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_capability_directory (
    app_id, tenant_id, environment, directory_id, directory_hash, capabilities
  ) values (
    p_app_id, p_tenant_id, p_environment, v_directory_id, p_directory_hash, p_capabilities
  );
  v_result := jsonb_build_object(
    'directory_id', v_directory_id,
    'published_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_latest_capability_directory
-- ============================================================
create or replace function app_data_agent.get_latest_capability_directory(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'directory_id', dir.directory_id,
    'directory_hash', dir.directory_hash,
    'capabilities', dir.capabilities,
    'published_at', dir.published_at
  )
  into v_result
  from app_data_agent.attribution_capability_directory as dir
  where dir.app_id = p_app_id
    and dir.tenant_id = p_tenant_id
    and dir.environment = p_environment
  order by dir.published_at desc
  limit 1;

  return v_result;
end;
$function$;
