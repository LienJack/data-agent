-- semantic_document_hash_precedence_migration_checksum: sha256:a9886b9b05cd0c54f8660cb8432f47eb61cdd1fb71bd04037286675d50ac5491
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010730_app_data_agent_semantic_receipt_hash_precedence')
  then raise exception using errcode='P0001',message='SEMANTIC_DOCUMENT_HASH_PRECEDENCE_BASELINE_10730_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010731_app_data_agent_semantic_document_hash_precedence',
  'sha256:a9886b9b05cd0c54f8660cb8432f47eb61cdd1fb71bd04037286675d50ac5491');
commit;
