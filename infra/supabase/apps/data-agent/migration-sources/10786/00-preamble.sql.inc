begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare commit_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010785_app_data_agent_conversation_context_summary')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)') is null
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_BASELINE_DRIFT'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure)
    into strict commit_definition;
  if pg_catalog.strpos(commit_definition,
      $$select case when bounds.total_count<=16 then 1$$)=0
    or pg_catalog.strpos(commit_definition,
      $$if selected_message_refs<>requested_lease#>'{payload,visible_message_refs}' then$$)=0
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
