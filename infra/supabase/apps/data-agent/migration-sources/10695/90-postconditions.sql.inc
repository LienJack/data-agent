do $postconditions$
begin
  if not pg_catalog.has_schema_privilege('data_agent_u5_self_publish_owner','semantic','USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_u5_self_publish_owner','semantic.authoring_sha256(jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
