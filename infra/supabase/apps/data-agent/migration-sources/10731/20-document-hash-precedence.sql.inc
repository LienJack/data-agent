do $document_hash_precedence$
declare
  definition text;
  rewritten text;
  package_unparenthesized constant text := $$requested->'package'-'package_hash'$$;
  package_parenthesized constant text := $$(requested->'package')-('package_hash'::text)$$;
  receipt_unparenthesized constant text := $$requested->'receipt'-'receipt_hash'$$;
  receipt_parenthesized constant text := $$(requested->'receipt')-('receipt_hash'::text)$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,package_unparenthesized,''
    )))/pg_catalog.length(package_unparenthesized)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,receipt_unparenthesized,''
    )))/pg_catalog.length(receipt_unparenthesized)<>1
    or pg_catalog.strpos(definition,package_parenthesized)>0
    or pg_catalog.strpos(definition,receipt_parenthesized)>0
  then raise exception using errcode='P0001',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,package_unparenthesized,package_parenthesized
  );
  rewritten:=pg_catalog.replace(
    rewritten,receipt_unparenthesized,receipt_parenthesized
  );
  execute rewritten;
end
$document_hash_precedence$;
