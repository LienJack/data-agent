do $postconditions$
declare commit_definition text;load_definition text;validator_definition text;
begin
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict load_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.load_provider_task_artifact(jsonb)'::regprocedure;
  select procedure.prosrc into strict validator_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.conversation_context_summary_document_is_valid(jsonb,uuid,uuid,text)'::regprocedure;
  if pg_catalog.strpos(commit_definition,'effective_run_config_receipts')=0
    or pg_catalog.strpos(commit_definition,'limit 64')=0
    or pg_catalog.strpos(commit_definition,'visible_start')=0
    or pg_catalog.strpos(commit_definition,'PROVIDER_TASK_VISIBLE_REFS_MISMATCH')=0
    or pg_catalog.strpos(commit_definition,'ConversationContextSummary')=0
    or pg_catalog.strpos(load_definition,'context_summary')=0
    or pg_catalog.strpos(validator_definition,'covered_through_message_id')=0
    or not pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.u6_uuid_v5(uuid,bytea)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.conversation_context_summary_document_is_valid(jsonb,uuid,uuid,text)',
      'EXECUTE')
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010785_app_data_agent_conversation_context_summary',
  '__CONVERSATION_CONTEXT_SUMMARY_MIGRATION_CHECKSUM__');
