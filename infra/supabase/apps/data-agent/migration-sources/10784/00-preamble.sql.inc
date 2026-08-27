begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare task_definition text;acceptance_definition text;provider_lease_definition text;
  falcon_policy_definition text;qualification_completion_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010782_app_data_agent_falcon24_analysis_publication')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.load_provider_task_artifact(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.assert_provider_active_worker_lease(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)') is null
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_BASELINE_DRIFT'; end if;
  select procedure.prosrc into strict task_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict provider_lease_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure;
  select procedure.prosrc into strict falcon_policy_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::regprocedure;
  select procedure.prosrc into strict qualification_completion_definition
    from pg_catalog.pg_proc procedure where procedure.oid=
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::regprocedure;
  if pg_catalog.strpos(task_definition,'provider-task-artifact@1.0.0')=0
    or pg_catalog.strpos(acceptance_definition,
      $$'visible_message_refs',pg_catalog.jsonb_build_array(requested_command->>'event_id')$$)=0
    or pg_catalog.strpos(provider_lease_definition,$$'max_root_turns',2$$)=0
    or pg_catalog.strpos(falcon_policy_definition,$$'max_root_turns',1$$)=0
    or pg_catalog.strpos(qualification_completion_definition,
      $$execution_policy->>'max_root_turns' is distinct from '1'$$)=0
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
