do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$failure_phase:='RETRIEVAL_HEADER'$$)=0
    or pg_catalog.strpos(definition,$$failure_phase:='RETRIEVAL_ROUTE_SCORES'$$)=0
    or pg_catalog.strpos(definition,$$failure_phase:='RETRIEVAL_RRF_SCORES'$$)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_HIT_HASH_INPUT_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_EXPANSION_HASH_INPUT_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_RETRIEVAL_HASH_PHASE_NOT_INSTALLED'; end if;
end
$postconditions$;
