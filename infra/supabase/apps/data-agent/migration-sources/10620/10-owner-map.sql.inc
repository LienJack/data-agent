-- ============================================================
-- 10620: Attribution Owner Map Release
-- ============================================================
-- Stores owner map releases with lifecycle:
--   PROVISIONED → ACTIVE → SUPERSEDED | RETIRED
-- Owner map defines canonical path → owner capability → required signer roles/quorum/proof-verifier roles/delegation
-- ============================================================

create table app_data_agent.attribution_owner_map_release (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  release_id uuid not null default extensions.gen_random_uuid(),
  owner_map jsonb not null,
  status text not null
    constraint attribution_owner_map_status_check
    check (status in ('PROVISIONED', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  superseded_at timestamptz,
  constraint attribution_owner_map_release_pk
    primary key (id),
  constraint attribution_owner_map_release_unique_release
    unique (app_id, tenant_id, environment, release_id)
);

comment on table app_data_agent.attribution_owner_map_release is
  'Owner map release: maps canonical path → owner capability → required signer roles/quorum/proof-verifier roles/delegation.';

create index idx_attribution_owner_map_active
  on app_data_agent.attribution_owner_map_release (app_id, tenant_id, environment, status)
  where status = 'ACTIVE';

-- ============================================================
-- RPC: provision_owner_map_release
-- ============================================================
create or replace function app_data_agent.provision_owner_map_release(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_owner_map jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_release_id uuid;
  v_result jsonb;
begin
  v_release_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_owner_map_release (
    app_id, tenant_id, environment, release_id, owner_map, status
  ) values (
    p_app_id, p_tenant_id, p_environment, v_release_id, p_owner_map, 'PROVISIONED'
  );
  v_result := jsonb_build_object(
    'release_id', v_release_id,
    'status', 'PROVISIONED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: activate_owner_map_release
-- ============================================================
create or replace function app_data_agent.activate_owner_map_release(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_release_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  -- Supersede current active
  update app_data_agent.attribution_owner_map_release as current
  set status = 'SUPERSEDED',
      superseded_at = pg_catalog.clock_timestamp()
  where current.app_id = p_app_id
    and current.tenant_id = p_tenant_id
    and current.environment = p_environment
    and current.status = 'ACTIVE';

  -- Activate new release
  update app_data_agent.attribution_owner_map_release as target
  set status = 'ACTIVE'
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.release_id = p_release_id
    and target.status = 'PROVISIONED';

  if not found then
    raise exception using errcode = 'P0002', message = 'OWNER_MAP_RELEASE_NOT_FOUND_OR_NOT_PROVISIONED';
  end if;

  v_result := jsonb_build_object(
    'release_id', p_release_id,
    'status', 'ACTIVE',
    'activated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: retire_owner_map_release
-- ============================================================
create or replace function app_data_agent.retire_owner_map_release(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_release_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_owner_map_release as target
  set status = 'RETIRED',
      superseded_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.release_id = p_release_id
    and target.status = 'ACTIVE';

  if not found then
    raise exception using errcode = 'P0002', message = 'OWNER_MAP_RELEASE_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'release_id', p_release_id,
    'status', 'RETIRED',
    'retired_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
