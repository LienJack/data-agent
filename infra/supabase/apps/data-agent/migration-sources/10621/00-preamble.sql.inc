-- ============================================================
-- 10621: Published F9 — Capability, Eligibility, Profile, Safety
-- ============================================================
-- This migration adds:
--   1. attribution_capability_directory — capability directory with anti-enumeration
--   2. attribution_eligibility_decision — eligibility decisions for frozen-question attribution
--   3. attribution_profile_request — profile request lifecycle (DRAFT→SUBMITTED→DEDUPED|TRIAGED→DECLINED|LINKED→CLOSED)
--   4. attribution_safety_verdict — published attribution safety verdicts (GO/HOLD/STOP)
--   5. attribution_profile_projection — profile projections for attribution analysis
--   6. Internal functions, RLS, owner grants
--
-- Depends on: 20260725010620_app_data_agent_contribution_authority (10620)
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
    raise exception using errcode = '0A000', message = 'PUBLISHED_F9_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PUBLISHED_F9_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'PUBLISHED_F9_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'PUBLISHED_F9_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  -- Verify 10620 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority';
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLISHED_F9_BASELINE_10620_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010621_app_data_agent_published_f9'
  ) then
    raise exception using errcode = 'P0001', message = 'PUBLISHED_F9_MIGRATION_10621_ALREADY_RECORDED';
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
