begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text;function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010790_app_data_agent_falcon24_diagnostic_authority')
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'semantic.semantic_source_release','semantic.semantic_relationship_projection',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_CLOSURE_READBACK_INVENTORY_DRIFT',detail=relation_name; end if;
  end loop;
  foreach function_name in array array[
    'platform.current_backend_authority(boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
    'app_data_agent.falcon24_authority_binding_document(app_data_agent.falcon24_current_authority_epoch)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_CLOSURE_READBACK_FUNCTION_DRIFT',detail=function_name; end if;
  end loop;
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
