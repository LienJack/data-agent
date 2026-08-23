do $postconditions$
begin
  if pg_catalog.to_regprocedure(
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)'
    ) is null
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)',
      'EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PENDING_ATTEMPT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
