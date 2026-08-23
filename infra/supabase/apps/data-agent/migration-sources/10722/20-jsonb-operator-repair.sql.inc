do $operator_repair$
declare
  definition text;
  rewritten text;
  retrieval_expression constant text :=
    $$requested#>'{package,retrieval_receipt}'-'receipt_hash'$$;
  inference_expression constant text :=
    $$requested#>'{package,inference_receipt}'-'receipt_hash'$$;
  typed_retrieval_expression constant text :=
    $$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$;
  typed_inference_expression constant text :=
    $$requested#>'{package,inference_receipt}'-('receipt_hash'::text)$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,retrieval_expression)=0
    or pg_catalog.strpos(definition,inference_expression)=0
    or pg_catalog.strpos(definition,typed_retrieval_expression)>0
    or pg_catalog.strpos(definition,typed_inference_expression)>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_JSONB_OPERATOR_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,retrieval_expression,typed_retrieval_expression);
  rewritten:=pg_catalog.replace(rewritten,inference_expression,typed_inference_expression);
  execute rewritten;
end
$operator_repair$;
