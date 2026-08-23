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
