-- semantic_context_validation_phase_migration_checksum: sha256:33cd621353d8e3c57bb91455f633b9dcc04bb5776b352b0205a4651a8d434c0d
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CONTEXT_VALIDATION_PHASE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CONTEXT_VALIDATION_PHASE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010726_app_data_agent_semantic_context_failure_phase_projection')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_VALIDATION_PHASE_BASELINE_10726_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $validation_phase_projection$
declare
  definition text;
  rewritten text;
  request_assertion constant text :=
    $$  perform app_data_agent.assert_semantic_context_request(requested->'request');$$;
  phased_request_assertion constant text := $$  failure_phase:='REQUEST_ASSERTION';
  perform app_data_agent.assert_semantic_context_request(requested->'request');
  failure_phase:='RETRIEVAL_HASH';
  perform app_data_agent.u2_canonical_sha256(
    requested#>'{package,retrieval_receipt}'-('receipt_hash'::text));
  failure_phase:='INFERENCE_HASH';
  perform app_data_agent.u2_canonical_sha256(
    requested#>'{package,inference_receipt}'-('receipt_hash'::text));
  failure_phase:='MANDATORY_CLOSURE_HASH';
  perform app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'object_ids',requested#>'{package,mandatory_closure,object_ids}',
    'relationship_ids',requested#>'{package,mandatory_closure,relationship_ids}'));
  failure_phase:='PACKAGE_VALIDATION';$$;
  mandatory_check constant text := $$  if exists(
    select 1 from pg_catalog.jsonb_array_elements(requested#>'{package,mandatory_closure,object_ids}') object_id(value)$$;
  phased_mandatory_check constant text := $$  failure_phase:='MANDATORY_CLOSURE';
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(requested#>'{package,mandatory_closure,object_ids}') object_id(value)$$;
  handler_tail constant text := $$  elsif failure_phase='PERSISTENCE' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_INVALID';
  else$$;
  phased_handler_tail constant text := $$  elsif failure_phase='PERSISTENCE' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_INVALID';
  elsif failure_phase='REQUEST_ASSERTION' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_REQUEST_ASSERTION_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_HASH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID';
  elsif failure_phase='INFERENCE_HASH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_INFERENCE_HASH_INPUT_INVALID';
  elsif failure_phase='MANDATORY_CLOSURE_HASH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_MANDATORY_CLOSURE_HASH_INPUT_INVALID';
  elsif failure_phase='PACKAGE_VALIDATION' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_VALIDATION_INPUT_INVALID';
  elsif failure_phase='MANDATORY_CLOSURE' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_MANDATORY_CLOSURE_INPUT_INVALID';
  else$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,request_assertion)=0
    or pg_catalog.strpos(definition,mandatory_check)=0
    or pg_catalog.strpos(definition,handler_tail)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_VALIDATION_PHASE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,request_assertion,phased_request_assertion);
  rewritten:=pg_catalog.replace(rewritten,mandatory_check,phased_mandatory_check);
  rewritten:=pg_catalog.replace(rewritten,handler_tail,phased_handler_tail);
  execute rewritten;
end
$validation_phase_projection$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$failure_phase:='RETRIEVAL_HASH'$$)=0
    or pg_catalog.strpos(definition,$$failure_phase:='INFERENCE_HASH'$$)=0
    or pg_catalog.strpos(definition,$$failure_phase:='MANDATORY_CLOSURE_HASH'$$)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_MANDATORY_CLOSURE_INPUT_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_VALIDATION_PHASE_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010727_app_data_agent_semantic_context_validation_phase_projection',
  'sha256:33cd621353d8e3c57bb91455f633b9dcc04bb5776b352b0205a4651a8d434c0d');
commit;
