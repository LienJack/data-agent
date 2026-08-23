-- ============================================================
-- 10621: Attribution Profile Projection
-- ============================================================
-- Stores profile projections for attribution analysis.
-- Each projection defines the lowering rule set and contribution
-- endpoints for a specific attribution profile.
-- ============================================================

create table app_data_agent.attribution_profile_projection (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  profile_id uuid not null default extensions.gen_random_uuid(),
  source_release_id uuid not null,
  profile_name text not null,
  profile_version text not null,
  lowering_rule_set jsonb not null,
  contribution_endpoints jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_profile_projection_pk
    primary key (id),
  constraint attribution_profile_projection_unique
    unique (app_id, tenant_id, environment, profile_id)
);

comment on table app_data_agent.attribution_profile_projection is
  'Attribution profile projection: projected profile used for attribution analysis.';

create index idx_attribution_profile_projection_active
  on app_data_agent.attribution_profile_projection (app_id, tenant_id, environment, is_active)
  where is_active = true;

create index idx_attribution_profile_projection_source
  on app_data_agent.attribution_profile_projection (app_id, tenant_id, environment, source_release_id);

-- ============================================================
-- RPC: create_profile_projection
-- ============================================================
create or replace function app_data_agent.create_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_source_release_id uuid,
  p_profile_name text,
  p_profile_version text,
  p_lowering_rule_set jsonb,
  p_contribution_endpoints jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_profile_id uuid;
  v_result jsonb;
begin
  v_profile_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_profile_projection (
    app_id, tenant_id, environment, profile_id, source_release_id,
    profile_name, profile_version, lowering_rule_set, contribution_endpoints
  ) values (
    p_app_id, p_tenant_id, p_environment, v_profile_id, p_source_release_id,
    p_profile_name, p_profile_version, p_lowering_rule_set, p_contribution_endpoints
  );
  v_result := jsonb_build_object(
    'profile_id', v_profile_id,
    'is_active', true,
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: update_profile_projection
-- ============================================================
create or replace function app_data_agent.update_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_profile_id uuid,
  p_lowering_rule_set jsonb default null,
  p_contribution_endpoints jsonb default null,
  p_is_active boolean default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_projection as target
  set
    lowering_rule_set = coalesce(p_lowering_rule_set, target.lowering_rule_set),
    contribution_endpoints = coalesce(p_contribution_endpoints, target.contribution_endpoints),
    is_active = coalesce(p_is_active, target.is_active),
    updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.profile_id = p_profile_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_PROJECTION_NOT_FOUND';
  end if;

  v_result := jsonb_build_object(
    'profile_id', p_profile_id,
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_active_profile_projection
-- ============================================================
create or replace function app_data_agent.get_active_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_profile_id uuid default null
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
  if p_profile_id is not null then
    select jsonb_build_object(
      'profile_id', p.profile_id,
      'source_release_id', p.source_release_id,
      'profile_name', p.profile_name,
      'profile_version', p.profile_version,
      'lowering_rule_set', p.lowering_rule_set,
      'contribution_endpoints', p.contribution_endpoints,
      'is_active', p.is_active,
      'created_at', p.created_at,
      'updated_at', p.updated_at
    )
    into v_result
    from app_data_agent.attribution_profile_projection as p
    where p.app_id = p_app_id
      and p.tenant_id = p_tenant_id
      and p.environment = p_environment
      and p.profile_id = p_profile_id;
  else
    select jsonb_build_object(
      'profile_id', p.profile_id,
      'source_release_id', p.source_release_id,
      'profile_name', p.profile_name,
      'profile_version', p.profile_version,
      'lowering_rule_set', p.lowering_rule_set,
      'contribution_endpoints', p.contribution_endpoints,
      'is_active', p.is_active,
      'created_at', p.created_at,
      'updated_at', p.updated_at
    )
    into v_result
    from app_data_agent.attribution_profile_projection as p
    where p.app_id = p_app_id
      and p.tenant_id = p_tenant_id
      and p.environment = p_environment
      and p.is_active = true
    order by p.updated_at desc
    limit 1;
  end if;

  return v_result;
end;
$function$;
