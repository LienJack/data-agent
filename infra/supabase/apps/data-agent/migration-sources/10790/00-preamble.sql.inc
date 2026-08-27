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
          '20260725010789_app_data_agent_semantic_context_canonical_aliases')
  then raise exception using errcode='P0001',
    message='FALCON24_DIAGNOSTIC_AUTHORITY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_ui_receipts',
    'app_data_agent.runs','app_data_agent.artifacts',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'semantic.semantic_successor_release_stage',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_DIAGNOSTIC_AUTHORITY_INVENTORY_DRIFT',detail=relation_name; end if;
  end loop;
  foreach function_name in array array[
    'platform.current_backend_authority(boolean)',
    'platform.backend_context_matches(uuid,uuid,text,boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
    'app_data_agent.runtime_iso_timestamp(timestamptz)',
    'app_data_agent.begin_falcon24_qualification(jsonb)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_DIAGNOSTIC_AUTHORITY_FUNCTION_DRIFT',detail=function_name; end if;
  end loop;
  if pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_attempts') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_receipts') is not null
    or pg_catalog.to_regprocedure('app_data_agent.begin_falcon24_diagnostic(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.complete_falcon24_diagnostic(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_DIAGNOSTIC_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
