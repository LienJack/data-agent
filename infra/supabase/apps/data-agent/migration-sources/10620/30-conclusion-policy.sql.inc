-- ============================================================
-- 10620: Attribution Conclusion Policy
-- ============================================================
-- Stores conclusion policy releases with lifecycle:
--   PROVISIONED → ACTIVE → SUPERSEDED | RETIRED
-- Conclusion policy defines the rules for issuing conclusion signatures.
-- ============================================================

create table app_data_agent.attribution_conclusion_policy (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null default extensions.gen_random_uuid(),
  policy jsonb not null,
  status text not null
    constraint attribution_conclusion_policy_status_check
    check (status in ('PROVISIONED', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  superseded_at timestamptz,
  constraint attribution_conclusion_policy_pk
    primary key (id),
  constraint attribution_conclusion_policy_unique_policy
    unique (app_id, tenant_id, environment, policy_id)
);

comment on table app_data_agent.attribution_conclusion_policy is
  'Conclusion policy: rules for issuing conclusion signatures, including algorithm policy, signer requirements, and verification constraints.';

create index idx_attribution_conclusion_policy_active
  on app_data_agent.attribution_conclusion_policy (app_id, tenant_id, environment, status)
  where status = 'ACTIVE';

-- ============================================================
-- RPC: provision_conclusion_policy
-- ============================================================
create or replace function app_data_agent.provision_conclusion_policy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_policy jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_policy_id uuid;
  v_result jsonb;
begin
  v_policy_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_conclusion_policy (
    app_id, tenant_id, environment, policy_id, policy, status
  ) values (
    p_app_id, p_tenant_id, p_environment, v_policy_id, p_policy, 'PROVISIONED'
  );
  v_result := jsonb_build_object(
    'policy_id', v_policy_id,
    'status', 'PROVISIONED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: activate_conclusion_policy
-- ============================================================
create or replace function app_data_agent.activate_conclusion_policy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_policy_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_conclusion_policy as current
  set status = 'SUPERSEDED',
      superseded_at = pg_catalog.clock_timestamp()
  where current.app_id = p_app_id
    and current.tenant_id = p_tenant_id
    and current.environment = p_environment
    and current.status = 'ACTIVE';

  update app_data_agent.attribution_conclusion_policy as target
  set status = 'ACTIVE'
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.policy_id = p_policy_id
    and target.status = 'PROVISIONED';

  if not found then
    raise exception using errcode = 'P0002', message = 'CONCLUSION_POLICY_NOT_FOUND_OR_NOT_PROVISIONED';
  end if;

  v_result := jsonb_build_object(
    'policy_id', p_policy_id,
    'status', 'ACTIVE',
    'activated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: retire_conclusion_policy
-- ============================================================
create or replace function app_data_agent.retire_conclusion_policy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_policy_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_conclusion_policy as target
  set status = 'RETIRED',
      superseded_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.policy_id = p_policy_id
    and target.status = 'ACTIVE';

  if not found then
    raise exception using errcode = 'P0002', message = 'CONCLUSION_POLICY_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'policy_id', p_policy_id,
    'status', 'RETIRED',
    'retired_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
