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
          '20260725010793_app_data_agent_falcon24_successor_review_policy_provisioning'
        and migration_checksum=
          'sha256:f6370a0956fb3e4a96abdc539543324db4bd6d0c558134f55b650048177c2c25')
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_DEPENDENCY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_diagnostic_attempts',
    'app_data_agent.runs','app_data_agent.effective_run_config_receipts',
    'app_data_agent.artifacts','app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_gate_attempt_history',
    'app_data_agent.falcon24_ui_receipts',
    'app_data_agent.workspace_run_defaults',
    'semantic.semantic_domain_registry','semantic.semantic_active_pointer',
    'semantic.semantic_runtime_activation','semantic.semantic_source_release',
    'semantic.semantic_publish_attempt','semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_bootstrap_validation_receipts',
    'semantic.initial_semantic_release_sets',
    'semantic.semantic_bootstrap_policy_revisions',
    'semantic.semantic_bootstrap_policy_pointer',
    'semantic.semantic_catalog_fence','semantic.semantic_dependency_pointer',
    'semantic.semantic_successor_release_stage'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_INVENTORY_DRIFT',
      detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'app_data_agent.u2_canonical_sha256(jsonb)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_FUNCTION_DRIFT',
      detail=function_name; end if;
  end loop;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
