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
        and migration_version='20260725010782_app_data_agent_falcon24_analysis_publication')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_E4_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection','semantic.semantic_active_pointer',
    'semantic.semantic_runtime_activation','semantic.semantic_publish_attempt',
    'semantic.semantic_candidate','semantic.semantic_review_task',
    'semantic.semantic_graph_projection','semantic.semantic_graph_node_projection',
    'semantic.semantic_graph_edge_projection',
    'semantic.semantic_source_release_graph_projection',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_current_authority_epoch'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_E4_INVENTORY_DRIFT',detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'platform.current_backend_authority(boolean)',
    'platform.backend_context_matches(uuid,uuid,text,boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
    'app_data_agent.runtime_iso_timestamp(timestamptz)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_E4_FUNCTION_DRIFT',detail=function_name; end if;
  end loop;

  if pg_catalog.to_regclass('semantic.semantic_successor_release_stage') is not null
    or pg_catalog.to_regclass('semantic.semantic_successor_projection_stage') is not null
    or pg_catalog.to_regclass('semantic.semantic_successor_stage_receipt') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_E4_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

create temporary table semantic_successor_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text; relation_id regclass; observed_count bigint; observed_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection','semantic.semantic_graph_projection',
    'semantic.semantic_graph_node_projection','semantic.semantic_graph_edge_projection',
    'semantic.semantic_source_release_graph_projection',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_gate_attempt_history','app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_acceptance_campaigns'
  ]::text[] loop
    relation_id:=pg_catalog.to_regclass(relation_name);
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'
      ||'''[]''::jsonb)) from %s source',relation_id)
      into strict observed_count,observed_digest;
    insert into semantic_successor_history_snapshot values(
      relation_name,observed_count,observed_digest);
  end loop;
end
$snapshot$;
