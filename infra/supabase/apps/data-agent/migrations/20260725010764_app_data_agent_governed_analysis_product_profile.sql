-- governed_analysis_product_profile_migration_checksum: sha256:6583db7644b153d0b83052521035413e6480bcbf56814ec52954de14b0f2bad5
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
alter table app_data_agent.agent_product_profile_revisions
  drop constraint agent_product_profile_revisions_profile_id_check;
alter table app_data_agent.agent_product_profile_revisions
  add constraint agent_product_profile_revisions_profile_id_check check(profile_id in (
    'governed-analysis-agent','governed-text2sql-agent',
    'report-writing-agent','semantic-management-agent'
  ));
do $postconditions$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'governed-analysis-agent')=0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PRODUCT_PROFILE_CONSTRAINT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010764_app_data_agent_governed_analysis_product_profile',
  'sha256:6583db7644b153d0b83052521035413e6480bcbf56814ec52954de14b0f2bad5');
commit;
