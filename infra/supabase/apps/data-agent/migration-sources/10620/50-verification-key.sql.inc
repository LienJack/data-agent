-- ============================================================
-- 10620: Attribution Verification Key Revision
-- ============================================================
-- Stores verification key revisions with lifecycle:
--   STAGED → ACTIVE → COMPROMISED | RETIRED
-- Verification keys are used for signing and verifying attribution evidence.
-- ============================================================

create table app_data_agent.attribution_verification_key_revision (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  key_id uuid not null default extensions.gen_random_uuid(),
  key_algorithm text not null,
  public_key text not null,
  trust_root boolean not null default false,
  status text not null
    constraint attribution_verification_key_status_check
    check (status in ('STAGED', 'ACTIVE', 'COMPROMISED', 'RETIRED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  superseded_at timestamptz,
  constraint attribution_verification_key_pk
    primary key (id),
  constraint attribution_verification_key_unique
    unique (app_id, tenant_id, environment, key_id)
);

comment on table app_data_agent.attribution_verification_key_revision is
  'Verification key revision: lifecycle tracking for signing and verification keys used in attribution evidence.';

create index idx_attribution_verification_key_active
  on app_data_agent.attribution_verification_key_revision (app_id, tenant_id, environment, status)
  where status = 'ACTIVE';

create index idx_attribution_verification_key_trust_root
  on app_data_agent.attribution_verification_key_revision (app_id, tenant_id, environment, trust_root)
  where trust_root = true and status = 'ACTIVE';

-- ============================================================
-- RPC: stage_verification_key
-- ============================================================
create or replace function app_data_agent.stage_verification_key(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_key_algorithm text,
  p_public_key text,
  p_trust_root boolean default false
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_key_id uuid;
  v_result jsonb;
begin
  v_key_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_verification_key_revision (
    app_id, tenant_id, environment, key_id,
    key_algorithm, public_key, trust_root, status
  ) values (
    p_app_id, p_tenant_id, p_environment, v_key_id,
    p_key_algorithm, p_public_key, p_trust_root, 'STAGED'
  );
  v_result := jsonb_build_object(
    'key_id', v_key_id,
    'status', 'STAGED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: activate_verification_key
-- ============================================================
create or replace function app_data_agent.activate_verification_key(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_key_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_verification_key_revision as target
  set status = 'ACTIVE'
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.key_id = p_key_id
    and target.status = 'STAGED';

  if not found then
    raise exception using errcode = 'P0002', message = 'VERIFICATION_KEY_NOT_FOUND_OR_NOT_STAGED';
  end if;

  v_result := jsonb_build_object(
    'key_id', p_key_id,
    'status', 'ACTIVE',
    'activated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: compromise_verification_key
-- ============================================================
create or replace function app_data_agent.compromise_verification_key(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_key_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_verification_key_revision as target
  set status = 'COMPROMISED',
      superseded_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.key_id = p_key_id
    and target.status = 'ACTIVE';

  if not found then
    raise exception using errcode = 'P0002', message = 'VERIFICATION_KEY_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'key_id', p_key_id,
    'status', 'COMPROMISED',
    'compromised_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: retire_verification_key
-- ============================================================
create or replace function app_data_agent.retire_verification_key(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_key_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_verification_key_revision as target
  set status = 'RETIRED',
      superseded_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.key_id = p_key_id
    and target.status in ('STAGED', 'ACTIVE', 'COMPROMISED');

  if not found then
    raise exception using errcode = 'P0002', message = 'VERIFICATION_KEY_NOT_FOUND';
  end if;

  v_result := jsonb_build_object(
    'key_id', p_key_id,
    'status', 'RETIRED',
    'retired_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
