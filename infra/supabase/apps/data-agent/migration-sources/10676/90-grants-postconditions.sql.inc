do $functions$
declare signature text;
begin
  foreach signature in array array[
    'semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)',
    'semantic.mark_authoring_provider_dispatched(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)',
    'semantic.mark_authoring_provider_response_observed(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,text)',
    'semantic.commit_authoring_provider_terminal(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)'
  ] loop
    execute pg_catalog.format('alter function %s owner to data_agent_u6_rpc_owner',signature);
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',signature);
    execute pg_catalog.format('grant execute on function %s to data_agent_backend',signature);
  end loop;
end
$functions$;

revoke all on semantic.semantic_authoring_turn from data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_table_privilege('data_agent_backend','semantic.semantic_authoring_turn','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'semantic.commit_authoring_provider_terminal(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_HARDENING_FAILED'; end if;
end
$postconditions$;
