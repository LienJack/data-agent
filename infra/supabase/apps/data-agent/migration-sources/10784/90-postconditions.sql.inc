do $postconditions$
declare acceptance_definition text;commit_definition text;load_definition text;
begin
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict load_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.load_provider_task_artifact(jsonb)'::regprocedure;
  if pg_catalog.strpos(acceptance_definition,'limit 63')=0
    or pg_catalog.strpos(acceptance_definition,'visible_message_refs')=0
    or pg_catalog.strpos(commit_definition,'provider-task-artifact@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'limit 64')=0
    or pg_catalog.strpos(commit_definition,'context_selection_hash')=0
    or pg_catalog.strpos(load_definition,'provider_task_document_is_valid')=0
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)','EXECUTE')
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010784_app_data_agent_conversational_root_context',
  '__CONVERSATIONAL_ROOT_CONTEXT_MIGRATION_CHECKSUM__');
