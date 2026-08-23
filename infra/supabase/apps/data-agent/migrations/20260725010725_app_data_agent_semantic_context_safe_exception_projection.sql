-- semantic_context_safe_exception_migration_checksum: sha256:93251700d3806600823823ecc2fb4f8123252ec0be90339e528de746776bb2ef
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010724_app_data_agent_semantic_context_persistence_input_validation')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_BASELINE_10724_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $safe_exception_projection$
declare
  definition text;
  rewritten text;
  declaration_anchor constant text := $$  committed_at timestamptz;$$;
  projected_declaration constant text := $$  committed_at timestamptz;
  failure_context text;$$;
  generic_handler constant text := $$exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID';$$;
  projected_handler constant text := $$exception when invalid_text_representation or numeric_value_out_of_range then
  get stacked diagnostics failure_context=pg_exception_context;
  if pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_ID_DERIVATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'load_semantic_context_authority_snapshot')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_AUTHORITY_REFRESH_INVALID';
  elsif pg_catalog.strpos(failure_context,'select receipt.* into existing')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_IDEMPOTENCY_LOOKUP_INVALID';
  elsif pg_catalog.strpos(failure_context,'insert into app_data_agent.semantic_context_receipts')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID';
  elsif sqlstate='22003' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_NUMERIC_RANGE_INVALID';
  else
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID';
  end if;$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,declaration_anchor)=0
    or pg_catalog.strpos(definition,generic_handler)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,declaration_anchor,projected_declaration);
  rewritten:=pg_catalog.replace(rewritten,generic_handler,projected_handler);
  execute rewritten;
end
$safe_exception_projection$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'get stacked diagnostics failure_context=pg_exception_context')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PACKAGE_ID_DERIVATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010725_app_data_agent_semantic_context_safe_exception_projection',
  'sha256:93251700d3806600823823ecc2fb4f8123252ec0be90339e528de746776bb2ef');
commit;
