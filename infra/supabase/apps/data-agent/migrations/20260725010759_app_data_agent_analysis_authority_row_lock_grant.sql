-- analysis_authority_row_lock_grant_migration_checksum: sha256:ab2df53e56a46027aecd2b4b6d84c4f56f8e62b334b1af28bdc5ece0517ae887
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_AUTHORITY_ROW_LOCK_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_AUTHORITY_ROW_LOCK_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010758_app_data_agent_analysis_stage_observation_variable_repair')
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_GRANT_BASELINE_10758_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant update on table app_data_agent.analysis_result_stages,
  app_data_agent.analysis_stage_oracle_records,
  app_data_agent.analysis_stage_explanation_records to data_agent_u6_rpc_owner;
do $postconditions$
begin
  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_result_stages','UPDATE')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_stage_oracle_records','UPDATE')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_stage_explanation_records','UPDATE')
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_oracle_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_explanation_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stages') is null
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_GRANT_DRIFT'; end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and tgname='analysis_result_stages_immutable' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_stage_oracle_records'::pg_catalog.regclass and tgname='analysis_stage_oracle_records_immutable' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_stage_explanation_records'::pg_catalog.regclass and tgname='analysis_stage_explanation_records_immutable' and not tgisinternal)
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_IMMUTABILITY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010759_app_data_agent_analysis_authority_row_lock_grant',
  'sha256:ab2df53e56a46027aecd2b4b6d84c4f56f8e62b334b1af28bdc5ece0517ae887');
commit;
