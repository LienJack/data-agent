-- ============================================================
-- 10615: Published-only Bridge — Runtime Activation & V2 Grounding Materializer
-- ============================================================
-- This migration adds:
--   1. activate_runtime() — SHADOW→PUBLISHED_ONLY and LEGACY→SHADOW transitions
--   2. application_rollback() — PUBLISHED_ONLY→SHADOW rollback
--   3. contract_legacy() — legacy contract closure
--   4. commit_published_grounding_bundle_v2() — V2 materializer binding to semantic_runtime_projection_binding
--   5. Extended outbox event types for activation/rollback/contract events
--
-- Depends on: 20260725010610_app_data_agent_semantic_control_plane (10610)
-- ============================================================

begin;

-- ============================================================
-- Executor safety: must run as postgres with proper maintenance window
-- ============================================================
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
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  -- Verify 10610 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_BASELINE_10610_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010615_app_data_agent_semantic_published_bridge'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_10615_ALREADY_RECORDED';
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
  semantic.semantic_runtime_activation,
  semantic.semantic_active_pointer,
  semantic.semantic_authority_fence,
  semantic.semantic_source_release,
  semantic.semantic_runtime_projection_binding,
  semantic.semantic_legacy_closure_authorization,
  semantic.semantic_legacy_equivalence_receipt,
  semantic.semantic_legacy_equivalence_attempt,
  semantic.semantic_legacy_compatible_mirror,
  semantic.semantic_outbox
in access exclusive mode nowait;
