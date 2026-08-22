do $postconditions$ begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u5_self_publish_owner','semantic.authoring_canonical_json(jsonb)','EXECUTE'
  ) then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_POSTCONDITION_FAILED'; end if;
end $postconditions$;
