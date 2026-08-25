do $postconditions$
begin
  if not exists(
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent'
      and relation.relname='agent_team_accepted_sibling_output_attachments'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.agent_team_accepted_sibling_output_attachments','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.prepare_agent_team_handoff(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)','EXECUTE')
    or pg_catalog.position(
      'agent_team_accepted_sibling_output_attachments' in
      pg_catalog.pg_get_functiondef('app_data_agent.prepare_agent_team_handoff(jsonb)'::regprocedure)
    )=0
  then raise exception using errcode='P0001',message='AGENT_TEAM_SIBLING_ATTACHMENT_AUTHORITY_NOT_INSTALLED'; end if;
end
$postconditions$;
