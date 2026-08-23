do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$)=0
    or pg_catalog.strpos(definition,$$requested#>'{package,inference_receipt}'-('receipt_hash'::text)$$)=0
    or pg_catalog.strpos(definition,$$requested#>'{package,retrieval_receipt}'-'receipt_hash'$$)>0
    or pg_catalog.strpos(definition,$$requested#>'{package,inference_receipt}'-'receipt_hash'$$)>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_JSONB_OPERATOR_REPAIR_NOT_INSTALLED'; end if;
end
$postconditions$;
