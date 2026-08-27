-- root_default_policy_compatibility_migration_checksum: sha256:670f7fd2ba57f07009d83de0435476c76e04a408e3abf5e0abb60e9edb43078d
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare definition text;
  predecessor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,
      'case_id',null,
$fragment$;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010787_app_data_agent_semantic_query_context_runtime_profile')
    or pg_catalog.to_regprocedure(
      'app_data_agent.assert_provider_active_worker_lease(jsonb)') is null
  then raise exception using errcode='P0001',
    message='ROOT_DEFAULT_POLICY_COMPATIBILITY_BASELINE_DRIFT'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,predecessor_fragment,'')))
      /pg_catalog.length(predecessor_fragment)<>1
  then raise exception using errcode='P0001',
    message='ROOT_DEFAULT_POLICY_COMPATIBILITY_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
do $patch_default_policy$
declare definition text;
  predecessor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,
      'case_id',null,
$fragment$;
  successor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind',null,
      'campaign_id',null,
      'case_id',null,
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,predecessor_fragment,'')))
      /pg_catalog.length(predecessor_fragment)<>1
  then raise exception using errcode='P0001',
    message='ROOT_DEFAULT_POLICY_COMPATIBILITY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,predecessor_fragment,successor_fragment);
end
$patch_default_policy$;
do $postconditions$
declare definition text;
  predecessor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,
      'case_id',null,
$fragment$;
  successor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind',null,
      'campaign_id',null,
      'case_id',null,
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,predecessor_fragment)>0
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,successor_fragment,'')))
      /pg_catalog.length(successor_fragment)<>1
    or pg_catalog.strpos(definition,$$'max_root_turns',4$$)=0
    or pg_catalog.strpos(definition,'RUN_EXECUTION_POLICY_CORRUPT')=0
  then raise exception using errcode='P0001',
    message='ROOT_DEFAULT_POLICY_COMPATIBILITY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010788_app_data_agent_root_default_policy_compatibility',
  'sha256:670f7fd2ba57f07009d83de0435476c76e04a408e3abf5e0abb60e9edb43078d');
commit;
