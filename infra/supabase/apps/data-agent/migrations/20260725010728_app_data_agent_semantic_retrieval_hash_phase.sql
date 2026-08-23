-- semantic_retrieval_hash_phase_migration_checksum: sha256:8d542736b6abff184ea02166e8767dc9d4f056866942bd5dcfd5fb60683325bb
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_RETRIEVAL_HASH_PHASE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_RETRIEVAL_HASH_PHASE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010727_app_data_agent_semantic_context_validation_phase_projection')
  then raise exception using errcode='P0001',message='SEMANTIC_RETRIEVAL_HASH_PHASE_BASELINE_10727_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010728_app_data_agent_semantic_retrieval_hash_phase',
  'sha256:8d542736b6abff184ea02166e8767dc9d4f056866942bd5dcfd5fb60683325bb');
commit;
