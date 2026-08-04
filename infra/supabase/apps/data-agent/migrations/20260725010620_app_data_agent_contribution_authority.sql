-- u20_migration_checksum: sha256:c2403b07f7cba81cfce9d4f4ed1aa7ffef636e14eb606f47906dbadf8452bc19
-- ============================================================
-- 10620: Contribution Authority Foundation — OwnerMap, Policy, Key, Nonce
-- ============================================================
-- This migration adds:
--   1. attribution_owner_map_releases — owner map lifecycle
--   2. attribution_relationship_promotion_receipts — relationship promotion
--   3. attribution_conclusion_policies — conclusion policy lifecycle
--   4. attribution_signer_assignments — signer assignment lifecycle
--   5. attribution_verification_key_revisions — verification key lifecycle
--   6. attribution_active_pointer — active pointer/status
--   7. attribution_nonce_ledger — nonce check-and-consume
--   8. Internal functions, RLS, owner grants
--
-- Depends on: 20260725010615_app_data_agent_semantic_published_bridge (10615)
-- ============================================================

begin;

do $bootstrap$
declare
  session_arm_ms bigint;
  arm_now timestamptz;
  window_expires_at timestamptz;
  effective_budget_ms bigint;
  rearm_verified_at timestamptz;
  requested_deployment_id uuid;
  observed_database_identity_hash text;
  expected_database_identity_hash text;
  executor record;
  transaction_setting bigint;
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'CONTRIBUTION_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'CONTRIBUTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'CONTRIBUTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'CONTRIBUTION_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  -- Verify 10615 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010615_app_data_agent_semantic_published_bridge';
  if not found then
    raise exception using errcode = 'P0001', message = 'CONTRIBUTION_MIGRATION_BASELINE_10615_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority'
  ) then
    raise exception using errcode = 'P0001', message = 'CONTRIBUTION_MIGRATION_10620_ALREADY_RECORDED';
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

lock table
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_attempts,
  app_data_agent.artifacts,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release
in access exclusive mode nowait;
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
-- ============================================================
-- 10620: Attribution Relationship Promotion Receipt
-- ============================================================
-- Stores relationship promotion receipts that track promotion of
-- relationships between source releases across the semantic lifecycle.
-- ============================================================

create table app_data_agent.attribution_relationship_promotion_receipt (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null default extensions.gen_random_uuid(),
  source_release_id uuid not null,
  target_release_id uuid not null,
  promotion_type text not null
    constraint attribution_promotion_type_check
    check (promotion_type in ('PROMOTE', 'DEMOTE', 'RECONCILE')),
  status text not null
    constraint attribution_promotion_status_check
    check (status in ('COMMITTED', 'VERIFIED', 'FAILED')),
  promotion_receipt jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  verified_at timestamptz,
  constraint attribution_relationship_promotion_receipt_pk
    primary key (id),
  constraint attribution_promotion_receipt_unique
    unique (app_id, tenant_id, environment, receipt_id)
);

comment on table app_data_agent.attribution_relationship_promotion_receipt is
  'Tracks promotion of relationships between source releases across the semantic lifecycle.';

create index idx_attribution_promotion_source
  on app_data_agent.attribution_relationship_promotion_receipt (app_id, tenant_id, environment, source_release_id);

-- ============================================================
-- RPC: commit_relationship_promotion_receipt
-- ============================================================
create or replace function app_data_agent.commit_relationship_promotion_receipt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_source_release_id uuid,
  p_target_release_id uuid,
  p_promotion_type text,
  p_promotion_receipt jsonb default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_result jsonb;
begin
  v_receipt_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_relationship_promotion_receipt (
    app_id, tenant_id, environment, receipt_id,
    source_release_id, target_release_id, promotion_type,
    status, promotion_receipt
  ) values (
    p_app_id, p_tenant_id, p_environment, v_receipt_id,
    p_source_release_id, p_target_release_id, p_promotion_type,
    'COMMITTED', p_promotion_receipt
  );
  v_result := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'status', 'COMMITTED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: verify_relationship_promotion
-- ============================================================
create or replace function app_data_agent.verify_relationship_promotion(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_receipt_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_relationship_promotion_receipt as target
  set status = 'VERIFIED',
      verified_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.receipt_id = p_receipt_id
    and target.status = 'COMMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_RECEIPT_NOT_FOUND_OR_NOT_COMMITTED';
  end if;

  v_result := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'status', 'VERIFIED',
    'verified_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
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
-- ============================================================
-- 10620: Attribution Active Pointer
-- ============================================================
-- Tracks the current active version for each attribution resource type.
-- Supports pointer_type enum: OWNER_MAP, POLICY, SIGNER_ASSIGNMENT, VERIFICATION_KEY.
-- ============================================================

do $active_pointer_types$
begin
  if not exists (
    select 1 from pg_catalog.pg_type as typ
    join pg_catalog.pg_namespace as ns on ns.oid = typ.typnamespace
    where ns.nspname = 'app_data_agent'
      and typ.typname = 'attribution_pointer_type'
  ) then
    create type app_data_agent.attribution_pointer_type as enum (
      'OWNER_MAP',
      'POLICY',
      'SIGNER_ASSIGNMENT',
      'VERIFICATION_KEY'
    );
  end if;
end
$active_pointer_types$;

create table app_data_agent.attribution_active_pointer (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  pointer_type app_data_agent.attribution_pointer_type not null,
  active_id uuid not null,
  status text not null default 'ACTIVE'
    constraint attribution_active_pointer_status_check
    check (status in ('ACTIVE', 'FROZEN')),
  version integer not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_active_pointer_pk
    primary key (id),
  constraint attribution_active_pointer_unique
    unique (app_id, tenant_id, environment, pointer_type)
);

comment on table app_data_agent.attribution_active_pointer is
  'Active pointer: tracks the current active version for each attribution resource type (OWNER_MAP, POLICY, SIGNER_ASSIGNMENT, VERIFICATION_KEY).';

-- ============================================================
-- RPC: get_active_pointer
-- ============================================================
create or replace function app_data_agent.get_active_pointer(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_pointer_type app_data_agent.attribution_pointer_type
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'pointer_type', p_pointer_type,
    'active_id', pointer.active_id,
    'status', pointer.status,
    'version', pointer.version,
    'updated_at', pointer.updated_at
  )
  into v_result
  from app_data_agent.attribution_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.pointer_type = p_pointer_type;

  if not found then
    return jsonb_build_object(
      'pointer_type', p_pointer_type,
      'active_id', null::uuid,
      'status', 'UNSET',
      'version', 0
    );
  end if;

  return v_result;
end;
$function$;

-- ============================================================
-- RPC: set_active_pointer
-- ============================================================
create or replace function app_data_agent.set_active_pointer(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_pointer_type app_data_agent.attribution_pointer_type,
  p_active_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
  v_version integer;
begin
  insert into app_data_agent.attribution_active_pointer as target (
    app_id, tenant_id, environment, pointer_type, active_id, version
  ) values (
    p_app_id, p_tenant_id, p_environment, p_pointer_type, p_active_id, 1
  )
  on conflict (app_id, tenant_id, environment, pointer_type)
  do update set
    active_id = p_active_id,
    version = target.version + 1,
    updated_at = pg_catalog.clock_timestamp()
  returning version into v_version;

  v_result := jsonb_build_object(
    'pointer_type', p_pointer_type,
    'active_id', p_active_id,
    'version', v_version,
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
-- ============================================================
-- 10620: Attribution Nonce Ledger
-- ============================================================
-- Stores nonce entries for atomic check-and-consume operations.
-- Nonces are used to prevent replay attacks in attribution workflows.
-- ============================================================

create table app_data_agent.attribution_nonce_ledger (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  nonce text not null,
  purpose text not null,
  consumed_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  origin text,
  constraint attribution_nonce_ledger_pk
    primary key (id),
  constraint attribution_nonce_ledger_unique_nonce
    unique (app_id, tenant_id, environment, nonce)
);

comment on table app_data_agent.attribution_nonce_ledger is
  'Nonce ledger: stores nonce entries for atomic check-and-consume operations to prevent replay attacks.';

create index idx_attribution_nonce_expires
  on app_data_agent.attribution_nonce_ledger (app_id, tenant_id, environment, expires_at);

-- ============================================================
-- RPC: check_and_consume_nonce
-- ============================================================
-- Atomically checks if a nonce has been consumed and consumes it if not.
-- Returns consumed=true if the nonce was successfully consumed (first time),
-- or consumed=false if the nonce was already consumed.
-- ============================================================
create or replace function app_data_agent.check_and_consume_nonce(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_nonce text,
  p_purpose text,
  p_expires_at timestamptz,
  p_origin text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  insert into app_data_agent.attribution_nonce_ledger (
    app_id, tenant_id, environment, nonce, purpose, expires_at, origin
  ) values (
    p_app_id, p_tenant_id, p_environment, p_nonce, p_purpose, p_expires_at, p_origin
  )
  on conflict (app_id, tenant_id, environment, nonce)
  do nothing;

  if found then
    v_result := jsonb_build_object(
      'nonce', p_nonce,
      'consumed', true,
      'consumed_at', pg_catalog.clock_timestamp()
    );
  else
    v_result := jsonb_build_object(
      'nonce', p_nonce,
      'consumed', false,
      'consumed_at', null::timestamptz
    );
  end if;

  return v_result;
end;
$function$;
-- ============================================================
-- 10620: Attribution Internal Functions
-- ============================================================
-- Internal helper functions for the contribution authority:
--   1. attribution_sha256 — domain-separated SHA256
--   2. lock_attribution_authority_fence — advisory lock
--   3. attribution_canonical_json — canonical JSON serialization
-- ============================================================

-- ============================================================
-- Function: attribution_sha256
-- Domain-separated SHA256 hash: sha256(domain || chr(0) || canonicalJson(payload))
-- ============================================================
create or replace function app_data_agent.attribution_sha256(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    pg_catalog.digest(
      p_domain::bytea || pg_catalog.chr(0)::bytea || app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Function: lock_attribution_authority_fence
-- Acquires an advisory lock for the attribution authority fence.
-- Returns true if the lock was acquired, raises exception on lock timeout.
-- ============================================================
create or replace function app_data_agent.lock_attribution_authority_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns boolean
  language plpgsql
  strict
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_lock_key bigint;
begin
  v_lock_key := (
    ('x' || pg_catalog.left(p_app_id::text, 16))::bit(64)::bigint
    # ('x' || pg_catalog.left(p_tenant_id::text, 16))::bit(64)::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  return true;
end;
$function$;

-- ============================================================
-- Function: attribution_canonical_json
-- Returns canonical (deterministic) JSON serialization.
-- Sorts keys recursively, uses no whitespace, and produces
-- a stable representation suitable for hashing.
-- ============================================================
create or replace function app_data_agent.attribution_canonical_json(
  p_value jsonb
) returns text
  language plpgsql
  strict
  immutable
  set search_path = ''
as $function$
declare
  v_result text;
begin
  select string_agg(
    case
      when jsonb_typeof(p_value) = 'object' then
        '{' || (
          select string_agg(
            pg_catalog.to_json(object_key.key)::text || ':' ||
            app_data_agent.attribution_canonical_json(object_key.value),
            ',' order by object_key.key
          )
          from jsonb_each(p_value) as object_key(key, value)
        ) || '}'
      when jsonb_typeof(p_value) = 'array' then
        '[' || (
          select string_agg(
            app_data_agent.attribution_canonical_json(array_element.value),
            ',' order by row_number
          )
          from jsonb_array_elements(p_value) with ordinality as array_element(value, row_number)
        ) || ']'
      when jsonb_typeof(p_value) = 'string' then
        pg_catalog.to_json(p_value#>>'{}')::text
      when jsonb_typeof(p_value) = 'number' then
        (p_value#>>'{}')::text
      when jsonb_typeof(p_value) = 'boolean' then
        case when p_value::boolean then 'true' else 'false' end
      when jsonb_typeof(p_value) = 'null' then
        'null'
      else
        raise exception 'ATTRIBUTION_CANONICAL_JSON_UNSUPPORTED_TYPE'
    end
  ) into v_result;
  return v_result;
end;
$function$;
-- ============================================================
-- 10620: RLS, policy, ACL, and owner assignments for attribution tables
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 7 attribution tables
-- ============================================================

alter table app_data_agent.attribution_owner_map_release owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_relationship_promotion_receipt owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_conclusion_policy owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_signer_assignment owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_verification_key_revision owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_active_pointer owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_nonce_ledger owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 7 attribution tables
-- ============================================================

alter table app_data_agent.attribution_owner_map_release enable row level security;
alter table app_data_agent.attribution_owner_map_release force row level security;

alter table app_data_agent.attribution_relationship_promotion_receipt enable row level security;
alter table app_data_agent.attribution_relationship_promotion_receipt force row level security;

alter table app_data_agent.attribution_conclusion_policy enable row level security;
alter table app_data_agent.attribution_conclusion_policy force row level security;

alter table app_data_agent.attribution_signer_assignment enable row level security;
alter table app_data_agent.attribution_signer_assignment force row level security;

alter table app_data_agent.attribution_verification_key_revision enable row level security;
alter table app_data_agent.attribution_verification_key_revision force row level security;

alter table app_data_agent.attribution_active_pointer enable row level security;
alter table app_data_agent.attribution_active_pointer force row level security;

alter table app_data_agent.attribution_nonce_ledger enable row level security;
alter table app_data_agent.attribution_nonce_ledger force row level security;

-- ============================================================
-- Part 3: RLS policies for attribution tables
-- App/Tenant/Environment isolation
-- ============================================================

create policy attribution_owner_map_release_tenant_isolation
  on app_data_agent.attribution_owner_map_release
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_relationship_promotion_receipt_tenant_isolation
  on app_data_agent.attribution_relationship_promotion_receipt
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_conclusion_policy_tenant_isolation
  on app_data_agent.attribution_conclusion_policy
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_signer_assignment_tenant_isolation
  on app_data_agent.attribution_signer_assignment
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_verification_key_revision_tenant_isolation
  on app_data_agent.attribution_verification_key_revision
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_active_pointer_tenant_isolation
  on app_data_agent.attribution_active_pointer
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_nonce_ledger_tenant_isolation
  on app_data_agent.attribution_nonce_ledger
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on owner map RPCs
grant execute on function app_data_agent.provision_owner_map_release(uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_owner_map_release(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_owner_map_release(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on relationship promotion RPCs
grant execute on function app_data_agent.commit_relationship_promotion_receipt(uuid, uuid, text, uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.verify_relationship_promotion(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on conclusion policy RPCs
grant execute on function app_data_agent.provision_conclusion_policy(uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_conclusion_policy(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_conclusion_policy(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on signer assignment RPCs
grant execute on function app_data_agent.provision_signer_assignment(uuid, uuid, text, uuid, text, integer, text[], jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_signer_assignment(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_signer_assignment(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on verification key RPCs
grant execute on function app_data_agent.stage_verification_key(uuid, uuid, text, text, text, boolean) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.compromise_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on active pointer RPCs
grant execute on function app_data_agent.get_active_pointer(uuid, uuid, text, app_data_agent.attribution_pointer_type) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.set_active_pointer(uuid, uuid, text, app_data_agent.attribution_pointer_type, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on nonce ledger RPC
grant execute on function app_data_agent.check_and_consume_nonce(uuid, uuid, text, text, text, timestamptz, text) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
do $attribution_roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_web_role') then
    create role data_agent_u6_web_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_worker_role') then
    create role data_agent_u6_worker_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
end
$attribution_roles$;

grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_web_role;
grant usage on schema app_data_agent to data_agent_u6_worker_role;
-- ============================================================
-- 10620: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010620_app_data_agent_contribution_authority',
  'sha256:c2403b07f7cba81cfce9d4f4ed1aa7ffef636e14eb606f47906dbadf8452bc19'
);

commit;
