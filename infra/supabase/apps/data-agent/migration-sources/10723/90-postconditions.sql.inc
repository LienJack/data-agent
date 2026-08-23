do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_RECEIPT_HASH_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_INFERENCE_RECEIPT_HASH_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_MANDATORY_CLOSURE_HASH_INVALID')=0
    or pg_catalog.strpos(definition,$$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$)=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_NOT_INSTALLED'; end if;
end
$postconditions$;
