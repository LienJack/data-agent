do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_KEY_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_SCALAR_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_DOCUMENT_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CANONICALIZER_EXCEPTION_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
