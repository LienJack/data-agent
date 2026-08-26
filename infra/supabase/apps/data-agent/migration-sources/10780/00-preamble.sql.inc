begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
        and conname='agent_profile_revisions_profile_revision_check'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision >= 1%'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision <= 2%')
  then raise exception using errcode='P0001',
    message='FALCON24_E1_RUNTIME_PROFILE_BASELINE_DRIFT'; end if;
end
$preflight$;
