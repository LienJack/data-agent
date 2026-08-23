-- semantic_context_jsonb_operator_repair_migration_checksum: sha256:61068749d838988449d6840ec5d7bb4ea23827027ddbf94b7936b3bf1a2739db
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CONTEXT_JSONB_OPERATOR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CONTEXT_JSONB_OPERATOR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010721_app_data_agent_research_authority_provisioning_scope')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_JSONB_OPERATOR_BASELINE_10721_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010722_app_data_agent_semantic_context_jsonb_operator_repair',
  'sha256:61068749d838988449d6840ec5d7bb4ea23827027ddbf94b7936b3bf1a2739db');
commit;
