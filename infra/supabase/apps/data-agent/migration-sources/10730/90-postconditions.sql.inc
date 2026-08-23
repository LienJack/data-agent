do $postconditions$
declare
  definition text;
  material jsonb := pg_catalog.jsonb_build_object(
    'receipt_hash','sha256:ignored',
    'schema_version','semantic-retrieval-receipt@1.0.0',
    'rrf_k',60
  );
  expected_hash text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$)>0
    or pg_catalog.strpos(definition,$$requested#>'{package,inference_receipt}'-('receipt_hash'::text)$$)>0
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,$$(requested#>'{package,retrieval_receipt}')-('receipt_hash'::text)$$,''
    )))/pg_catalog.length($$(requested#>'{package,retrieval_receipt}')-('receipt_hash'::text)$$)<>3
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,$$(requested#>'{package,inference_receipt}')-('receipt_hash'::text)$$,''
    )))/pg_catalog.length($$(requested#>'{package,inference_receipt}')-('receipt_hash'::text)$$)<>3
  then raise exception using errcode='P0001',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_NOT_INSTALLED'; end if;
  expected_hash:=app_data_agent.u2_canonical_sha256(material-'receipt_hash');
  if app_data_agent.u2_canonical_sha256(
      (pg_catalog.jsonb_build_object('retrieval_receipt',material)#>'{retrieval_receipt}')-
        ('receipt_hash'::text)
    )<>expected_hash
  then raise exception using errcode='P0001',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_REGRESSION'; end if;
end
$postconditions$;
