-- 10678 installs a fail-closed operational authority for legacy Attribution cleanup.
-- The migration itself is non-destructive: actual DELETE is available only through the
-- postgres-only function installed below and requires an exact inventory + backup command.
begin;

do $bootstrap$
declare target text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='LEGACY_ATTRIBUTION_CLEANUP_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='LEGACY_ATTRIBUTION_CLEANUP_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(
    select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010677_app_data_agent_qa_admin_audit_failure_repair'
  ) then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_BASELINE_10677_MISSING';
  end if;
  if not exists(
    select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010620_app_data_agent_contribution_authority'
      and migration_checksum='sha256:c2403b07f7cba81cfce9d4f4ed1aa7ffef636e14eb606f47906dbadf8452bc19'
  ) or not exists(
    select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010621_app_data_agent_published_f9'
      and migration_checksum='sha256:0000000000000000000000000000000000000000000000000000000000000000'
  ) then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_MIGRATION_ATTESTATION_INVALID';
  end if;
  foreach target in array array[
    'attribution_active_pointer','attribution_capability_directory',
    'attribution_conclusion_policy','attribution_eligibility_decision',
    'attribution_nonce_ledger','attribution_owner_map_release',
    'attribution_profile_projection','attribution_profile_request',
    'attribution_relationship_promotion_receipt','attribution_safety_verdict',
    'attribution_signer_assignment','attribution_verification_key_revision'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||target) is null then
      raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_TARGET_MISSING';
    end if;
  end loop;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010678_app_data_agent_legacy_attribution_cleanup',
  '__LEGACY_ATTRIBUTION_CLEANUP_MIGRATION_CHECKSUM__');

do $role$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_legacy_attribution_cleanup_owner') then
    create role data_agent_legacy_attribution_cleanup_owner nologin noinherit bypassrls;
  end if;
  if not exists(
    select 1 from pg_catalog.pg_roles where rolname='data_agent_legacy_attribution_cleanup_owner'
      and not rolcanlogin and not rolinherit and rolbypassrls and not rolsuper
  ) then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_OWNER_INVALID';
  end if;
end
$role$;
