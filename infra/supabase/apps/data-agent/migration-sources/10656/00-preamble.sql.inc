-- ============================================================
-- 10656: Greenfield Semantic Bootstrap Release Authority
-- Depends on 10655 Ontology Package Authority and 10610 governance baseline.
-- Forward-only empty Authority; no import, backfill, dual-read or benchmark data.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_BOOTSTRAP_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_BOOTSTRAP_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010655_app_data_agent_ontology_package_authority'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BOOTSTRAP_BASELINE_10655_MISSING';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.ontology_package_candidates') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BOOTSTRAP_AUTHORITY_DEPENDENCY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_data_owner') then
    create role data_agent_u5_data_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_verifier_owner') then
    create role data_agent_u5_verifier_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_publisher_owner') then
    create role data_agent_u5_publisher_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_human_governance_owner') then
    create role data_agent_u5_human_governance_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
