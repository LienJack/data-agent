begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority')
    or pg_catalog.to_regclass(
      'app_data_agent.falcon24_four_layer_gate_attempts') is not null
    or pg_catalog.to_regclass(
      'app_data_agent.falcon24_four_layer_gate_turns') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.begin_falcon24_four_layer_gate(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_current_authority_epoch') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10803_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;
  before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_diagnostic_attempts',
    'app_data_agent.falcon24_diagnostic_receipts',
    'app_data_agent.falcon24_epoch_closure_failure_receipts',
    'app_data_agent.falcon24_finalization_failure_receipts',
    'app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_qualification_slots',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.run_attempts',
    'app_data_agent.artifacts','app_data_agent.falcon24_llm_execution_certification_stage',
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection','semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_graph_projection','semantic.semantic_source_release_graph_projection',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10803_history_snapshot
    values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
