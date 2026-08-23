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
