-- ============================================================
-- 10622: Semantic Candidate Draft Authority
-- ============================================================
-- Depends on: 20260725010621_app_data_agent_published_f9
-- Adds an idempotency ledger and a narrow, database-owned draft RPC.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  compatibility_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_DRAFT_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_DRAFT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_DRAFT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'SEMANTIC_DRAFT_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010621_app_data_agent_published_f9';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_BASELINE_10621_MISSING';
  end if;
  select ledger.migration_checksum
  into compatibility_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010609_app_data_agent_semantic_publish_grant_compatibility';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_COMPATIBILITY_10609_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010622_app_data_agent_semantic_candidate_draft'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_MIGRATION_10622_ALREADY_RECORDED';
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
  semantic.semantic_authority_fence,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_revision,
  semantic.semantic_candidate,
  semantic.semantic_candidate_revision,
  semantic.semantic_validation_receipt,
  semantic.semantic_review_task
in access exclusive mode nowait;
