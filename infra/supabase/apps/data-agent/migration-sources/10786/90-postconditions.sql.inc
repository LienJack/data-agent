do $postconditions$
declare commit_definition text;
begin
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  if pg_catalog.strpos(commit_definition,
      $$requested_lease#>'{payload,visible_message_refs}' is null then 1$$)=0
    or pg_catalog.strpos(commit_definition,
      $$requested_lease#>'{payload,visible_message_refs}' is not null$$)=0
    or pg_catalog.strpos(commit_definition,
      'left join app_data_agent.effective_run_config_receipts receipt')=0
    or pg_catalog.strpos(commit_definition,'conversation.resource_version=')=0
    or pg_catalog.strpos(commit_definition,'receipt.config_id is not null')=0
    or pg_catalog.strpos(commit_definition,'ConversationContextSummary')=0
    or not pg_catalog.has_schema_privilege(
      'data_agent_provider_invocation_rpc_owner','extensions','USAGE')
    or pg_catalog.has_schema_privilege('data_agent_backend','extensions','USAGE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010786_app_data_agent_conversation_context_summary_compatibility',
  '__CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_MIGRATION_CHECKSUM__');
