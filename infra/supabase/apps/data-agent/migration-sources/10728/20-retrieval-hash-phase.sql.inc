do $retrieval_hash_phase$
declare
  definition text;
  rewritten text;
  retrieval_hash_probe constant text := $$  failure_phase:='RETRIEVAL_HASH';
  perform app_data_agent.u2_canonical_sha256(
    requested#>'{package,retrieval_receipt}'-('receipt_hash'::text));$$;
  component_probes constant text := $$  failure_phase:='RETRIEVAL_HEADER';
  perform app_data_agent.u2_canonical_sha256(
    (requested#>'{package,retrieval_receipt}')-
      array['hits','expansions','receipt_hash']::text[]);
  failure_phase:='RETRIEVAL_ROUTE_SCORES';
  perform app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_path_query_array(
    requested#>'{package,retrieval_receipt,hits}','$[*].route_score'::jsonpath));
  failure_phase:='RETRIEVAL_RRF_SCORES';
  perform app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_path_query_array(
    requested#>'{package,retrieval_receipt,hits}','$[*].rrf_score'::jsonpath));
  failure_phase:='RETRIEVAL_HIT_DOCUMENTS';
  perform app_data_agent.u2_canonical_sha256(coalesce((
    select pg_catalog.jsonb_agg(hit.value-
      array['route_score','rrf_score']::text[] order by hit.ordinality)
    from pg_catalog.jsonb_array_elements(requested#>'{package,retrieval_receipt,hits}')
      with ordinality hit(value,ordinality)
  ),'[]'::jsonb));
  failure_phase:='RETRIEVAL_EXPANSIONS';
  perform app_data_agent.u2_canonical_sha256(
    requested#>'{package,retrieval_receipt,expansions}');
  failure_phase:='RETRIEVAL_HASH';
  perform app_data_agent.u2_canonical_sha256(
    requested#>'{package,retrieval_receipt}'-('receipt_hash'::text));$$;
  handler_anchor constant text := $$  elsif failure_phase='RETRIEVAL_HASH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID';$$;
  component_handler constant text := $$  elsif failure_phase='RETRIEVAL_HEADER' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_HEADER_HASH_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_ROUTE_SCORES' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_ROUTE_SCORE_HASH_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_RRF_SCORES' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_RRF_SCORE_HASH_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_HIT_DOCUMENTS' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_HIT_HASH_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_EXPANSIONS' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_EXPANSION_HASH_INPUT_INVALID';
  elsif failure_phase='RETRIEVAL_HASH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID';$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,retrieval_hash_probe)=0
    or pg_catalog.strpos(definition,handler_anchor)=0
    or pg_catalog.strpos(definition,'RETRIEVAL_ROUTE_SCORES')>0
  then raise exception using errcode='P0001',message='SEMANTIC_RETRIEVAL_HASH_PHASE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,retrieval_hash_probe,component_probes);
  rewritten:=pg_catalog.replace(rewritten,handler_anchor,component_handler);
  execute rewritten;
end
$retrieval_hash_phase$;
