do $receipt_hash_precedence$
declare
  definition text;
  rewritten text;
  retrieval_unparenthesized constant text := $$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$;
  retrieval_parenthesized constant text := $$(requested#>'{package,retrieval_receipt}')-('receipt_hash'::text)$$;
  inference_unparenthesized constant text := $$requested#>'{package,inference_receipt}'-('receipt_hash'::text)$$;
  inference_parenthesized constant text := $$(requested#>'{package,inference_receipt}')-('receipt_hash'::text)$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,retrieval_unparenthesized,''
    )))/pg_catalog.length(retrieval_unparenthesized)<>3
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,inference_unparenthesized,''
    )))/pg_catalog.length(inference_unparenthesized)<>3
    or pg_catalog.strpos(definition,retrieval_parenthesized)>0
    or pg_catalog.strpos(definition,inference_parenthesized)>0
  then raise exception using errcode='P0001',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,retrieval_unparenthesized,retrieval_parenthesized
  );
  rewritten:=pg_catalog.replace(
    rewritten,inference_unparenthesized,inference_parenthesized
  );
  execute rewritten;
end
$receipt_hash_precedence$;
