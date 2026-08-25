-- governed_analysis_product_profile_migration_checksum: sha256:2b3fd5e69142fcd49f93e54f26b6b088a9e1e7c9b83d4f3e6b0f4a3c2106d79f
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='GOVERNED_ANALYSIS_PRODUCT_PROFILE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='GOVERNED_ANALYSIS_PRODUCT_PROFILE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010763_app_data_agent_semantic_helper_consumer_repair')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PRODUCT_PROFILE_BASELINE_10763_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $profile_constraint$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_generic_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'profile_id')=0
    or pg_catalog.strpos(profile_constraint,'a-z0-9')=0
  then raise exception using errcode='P0001',
    message='GENERIC_PRODUCT_PROFILE_CONSTRAINT_REQUIRED'; end if;
end
$profile_constraint$;
do $postconditions$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_generic_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'profile_id')=0
    or pg_catalog.strpos(profile_constraint,'a-z0-9')=0
  then raise exception using errcode='P0001',message='GENERIC_PRODUCT_PROFILE_CONSTRAINT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010764_app_data_agent_governed_analysis_product_profile',
  'sha256:2b3fd5e69142fcd49f93e54f26b6b088a9e1e7c9b83d4f3e6b0f4a3c2106d79f');
commit;
