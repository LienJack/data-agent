begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text; function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010791_app_data_agent_falcon24_semantic_closure_readback')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'semantic.semantic_active_pointer','semantic.semantic_dependency_pointer',
    'semantic.semantic_source_revision','semantic.semantic_candidate',
    'semantic.semantic_candidate_revision','semantic.semantic_review_task',
    'semantic.semantic_review_decision','semantic.semantic_publish_attempt',
    'semantic.semantic_reviewer_policy_revision',
    'semantic.semantic_reviewer_policy_pointer','semantic.semantic_reviewer_assignment'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_INVENTORY_DRIFT',
      detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'semantic.lock_packet(uuid,uuid,text,text,uuid)',
    'semantic.assert_review_packet_open(uuid,uuid,text,text,uuid)',
    'semantic.verify_principal_not_excluded(text,jsonb)',
    'semantic.u5_json_has_exact_keys(jsonb,text[])',
    'semantic.assert_u5_scope(jsonb,text,boolean)',
    'platform.backend_context_matches(uuid,uuid,text,boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.runtime_iso_timestamp(timestamptz)',
    'semantic.semantic_successor_receipt_immutable()'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_FUNCTION_DRIFT',
      detail=function_name; end if;
  end loop;

  if pg_catalog.to_regclass(
      'semantic.semantic_successor_review_preparation') is not null
    or pg_catalog.to_regclass(
      'semantic.semantic_successor_review_decision_document') is not null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_review(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'semantic.human_record_semantic_review_decision(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
