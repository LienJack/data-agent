do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_u12_context_owner',
    'app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_u12_context_owner','app_data_agent.artifacts','SELECT')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.load_semantic_context_authority_snapshot(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u12_context_owner' and prosecdef
        and proconfig @> array['search_path=""']::text[]
        and pg_catalog.strpos(prosrc,'conversation_intent')>0)
  then raise exception using errcode='P0001',message='SEMANTIC_CONVERSATION_INTENT_SECURITY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010816_app_data_agent_semantic_conversation_intent',
  '__SEMANTIC_CONVERSATION_INTENT_MIGRATION_CHECKSUM__');
commit;
