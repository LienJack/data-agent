do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'pg_catalog.pg_input_is_valid')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PACKAGE_ID_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RESOLVED_AT_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_VALIDATION_NOT_INSTALLED'; end if;
end
$postconditions$;
