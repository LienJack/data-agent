-- semantic_receipt_hash_precedence_migration_checksum: sha256:e6d7310222494036cce654b0c3eb15f2d6882f31ef2b8963cb04e0161b1e448e
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010729_app_data_agent_semantic_canonicalizer_exception_projection')
  then raise exception using errcode='P0001',message='SEMANTIC_RECEIPT_HASH_PRECEDENCE_BASELINE_10729_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010730_app_data_agent_semantic_receipt_hash_precedence',
  'sha256:e6d7310222494036cce654b0c3eb15f2d6882f31ef2b8963cb04e0161b1e448e');
commit;
