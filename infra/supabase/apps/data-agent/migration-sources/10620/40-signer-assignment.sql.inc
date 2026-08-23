-- ============================================================
-- 10620: Attribution Signer Assignment
-- ============================================================
-- Stores signer assignments with lifecycle:
--   PROVISIONED → ACTIVE → SUPERSEDED | RETIRED
-- Signer assignment defines the signer roles, quorum, proof-verifier roles,
-- and delegation configuration for a given policy.
-- ============================================================

create table app_data_agent.attribution_signer_assignment (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  assignment_id uuid not null default extensions.gen_random_uuid(),
  policy_id uuid not null,
  signer_role text not null,
  required_signers integer not null
    constraint attribution_signer_required_check
    check (required_signers >= 1),
  proof_verifier_roles text[] not null default '{}',
  delegation_config jsonb,
  status text not null
    constraint attribution_signer_assignment_status_check
    check (status in ('PROVISIONED', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  superseded_at timestamptz,
  constraint attribution_signer_assignment_pk
    primary key (id),
  constraint attribution_signer_assignment_unique
    unique (app_id, tenant_id, environment, assignment_id)
);

comment on table app_data_agent.attribution_signer_assignment is
  'Signer assignment: defines signer roles, quorum, proof-verifier roles, and delegation configuration for a given policy.';

create index idx_attribution_signer_assignment_active
  on app_data_agent.attribution_signer_assignment (app_id, tenant_id, environment, status)
  where status = 'ACTIVE';

-- ============================================================
-- RPC: provision_signer_assignment
-- ============================================================
create or replace function app_data_agent.provision_signer_assignment(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_policy_id uuid,
  p_signer_role text,
  p_required_signers integer,
  p_proof_verifier_roles text[] default '{}',
  p_delegation_config jsonb default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_assignment_id uuid;
  v_result jsonb;
begin
  v_assignment_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_signer_assignment (
    app_id, tenant_id, environment, assignment_id,
    policy_id, signer_role, required_signers,
    proof_verifier_roles, delegation_config, status
  ) values (
    p_app_id, p_tenant_id, p_environment, v_assignment_id,
    p_policy_id, p_signer_role, p_required_signers,
    p_proof_verifier_roles, p_delegation_config, 'PROVISIONED'
  );
  v_result := jsonb_build_object(
    'assignment_id', v_assignment_id,
    'status', 'PROVISIONED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: activate_signer_assignment
-- ============================================================
create or replace function app_data_agent.activate_signer_assignment(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_assignment_id uuid
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
  update app_data_agent.attribution_signer_assignment as current
  set status = 'SUPERSEDED',
      superseded_at = pg_catalog.clock_timestamp()
  where current.app_id = p_app_id
    and current.tenant_id = p_tenant_id
    and current.environment = p_environment
    and current.status = 'ACTIVE';

  -- Activate new assignment
  update app_data_agent.attribution_signer_assignment as target
  set status = 'ACTIVE'
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.assignment_id = p_assignment_id
    and target.status = 'PROVISIONED';

  if not found then
    raise exception using errcode = 'P0002', message = 'SIGNER_ASSIGNMENT_NOT_FOUND_OR_NOT_PROVISIONED';
  end if;

  v_result := jsonb_build_object(
    'assignment_id', p_assignment_id,
    'status', 'ACTIVE',
    'activated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: retire_signer_assignment
-- ============================================================
create or replace function app_data_agent.retire_signer_assignment(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_assignment_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_signer_assignment as target
  set status = 'RETIRED',
      superseded_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.assignment_id = p_assignment_id
    and target.status = 'ACTIVE';

  if not found then
    raise exception using errcode = 'P0002', message = 'SIGNER_ASSIGNMENT_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'assignment_id', p_assignment_id,
    'status', 'RETIRED',
    'retired_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
