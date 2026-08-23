do $postconditions$
declare
  definition text;
  material jsonb := pg_catalog.jsonb_build_object(
    'package_hash','sha256:ignored',
    'schema_version','semantic-context-package@1.0.0'
  );
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$requested->'package'-'package_hash'$$)>0
    or pg_catalog.strpos(definition,$$requested->'receipt'-'receipt_hash'$$)>0
    or pg_catalog.strpos(definition,$$(requested->'package')-('package_hash'::text)$$)=0
    or pg_catalog.strpos(definition,$$(requested->'receipt')-('receipt_hash'::text)$$)=0
  then raise exception using errcode='P0001',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_NOT_INSTALLED'; end if;
  if app_data_agent.u2_canonical_sha256(
      (pg_catalog.jsonb_build_object('package',material)->'package')-
        ('package_hash'::text)
    )<>app_data_agent.u2_canonical_sha256(material-'package_hash')
  then raise exception using errcode='P0001',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_REGRESSION'; end if;
end
$postconditions$;
