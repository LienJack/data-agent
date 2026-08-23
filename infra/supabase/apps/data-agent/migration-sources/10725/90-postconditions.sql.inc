do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'get stacked diagnostics failure_context=pg_exception_context')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PACKAGE_ID_DERIVATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
