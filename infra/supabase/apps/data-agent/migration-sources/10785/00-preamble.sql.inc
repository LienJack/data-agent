begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare commit_definition text;load_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010784_app_data_agent_conversational_root_context')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.load_provider_task_artifact(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u6_uuid_v5(uuid,bytea)') is null
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_BASELINE_DRIFT'; end if;
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict load_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.load_provider_task_artifact(jsonb)'::regprocedure;
  if pg_catalog.strpos(commit_definition,'provider-task-artifact@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'limit 64')=0
    or pg_catalog.strpos(load_definition,'provider_task_document_is_valid')=0
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
