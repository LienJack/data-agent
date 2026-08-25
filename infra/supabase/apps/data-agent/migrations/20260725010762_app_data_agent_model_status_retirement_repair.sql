-- model_status_retirement_repair_migration_checksum: sha256:dcffd4ffc69803006a5ba90937568d07ffbb2e554f9fd8470dbdace3170d6279
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='MODEL_STATUS_RETIREMENT_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='MODEL_STATUS_RETIREMENT_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010761_app_data_agent_governed_analysis_profile')
  then raise exception using errcode='P0001',message='MODEL_STATUS_RETIREMENT_REPAIR_BASELINE_10761_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
update app_data_agent.model_catalog_entries
set status='ACTIVE',updated_at=pg_catalog.clock_timestamp()
where status='UNBILLABLE';

alter table app_data_agent.model_catalog_entries
  validate constraint model_catalog_entries_status_check;
do $postconditions$
begin
  if exists(select 1 from app_data_agent.model_catalog_entries
    where status not in ('DRAFT','ACTIVE','DISABLED'))
  then raise exception using errcode='P0001',message='MODEL_STATUS_RETIREMENT_REPAIR_INCOMPLETE'; end if;

  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='app_data_agent.model_catalog_entries'::pg_catalog.regclass
      and conname='model_catalog_entries_status_check' and convalidated)
  then raise exception using errcode='P0001',message='MODEL_STATUS_RETIREMENT_CONSTRAINT_NOT_VALIDATED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010762_app_data_agent_model_status_retirement_repair',
  'sha256:dcffd4ffc69803006a5ba90937568d07ffbb2e554f9fd8470dbdace3170d6279');
commit;
