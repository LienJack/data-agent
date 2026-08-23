-- legacy_attribution_scope_repair_migration_checksum: sha256:bdd263ebd13ba0025558f931b8419e51e1d4692f2eb51432c7b468ce75af7171
-- 10679 forward-repairs the 10678 executor so one deployment can never clean another
-- environment in the same PostgreSQL database. Historical 10678 bytes/ledger stay immutable.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(
    select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010678_app_data_agent_legacy_attribution_cleanup'
      and migration_checksum='sha256:6ad81cf69acc1af798706b089df747fb040d96ecc5d03b30e8eae2db2f0ce462'
  ) then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_BASELINE_INVALID';
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010679_app_data_agent_legacy_attribution_scope_repair',
  'sha256:bdd263ebd13ba0025558f931b8419e51e1d4692f2eb51432c7b468ce75af7171');
do $scope_repair$
declare
  inventory_definition text;
  execute_definition text;
  inventory_unscoped constant text :=
    'execute pg_catalog.format(''select pg_catalog.count(*) from app_data_agent.%I'',target)' ||
    pg_catalog.chr(10) || '      into target_count;';
  inventory_scoped constant text :=
    'execute pg_catalog.format(''select pg_catalog.count(*) from app_data_agent.%I ' ||
    'where app_id=$1 and environment=$2'',target)' || pg_catalog.chr(10) ||
    '      into target_count using scope.app_id,scope.environment;';
  delete_unscoped constant text :=
    'execute pg_catalog.format(''delete from app_data_agent.%I'',target);';
  delete_scoped constant text :=
    'execute pg_catalog.format(''delete from app_data_agent.%I ' ||
    'where app_id=$1 and environment=$2'',target)' || pg_catalog.chr(10) ||
    '      using (command->>''app_id'')::uuid,command->>''environment'';';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.legacy_attribution_cleanup_inventory(uuid)'::regprocedure)
    into strict inventory_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure)
    into strict execute_definition;
  if (pg_catalog.length(inventory_definition)-pg_catalog.length(
      pg_catalog.replace(inventory_definition,inventory_unscoped,'')))
        <>pg_catalog.length(inventory_unscoped)
    or (pg_catalog.length(execute_definition)-pg_catalog.length(
      pg_catalog.replace(execute_definition,delete_unscoped,'')))
        <>pg_catalog.length(delete_unscoped)
  then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_SOURCE_DRIFT';
  end if;
  execute pg_catalog.replace(inventory_definition,inventory_unscoped,inventory_scoped);
  execute pg_catalog.replace(execute_definition,delete_unscoped,delete_scoped);
end
$scope_repair$;
do $postconditions$
declare
  inventory_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.legacy_attribution_cleanup_inventory(uuid)'::regprocedure);
  execute_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure);
begin
  if inventory_definition not like
      '%where app_id=$1 and environment=$2%into target_count using scope.app_id,scope.environment;%'
    or execute_definition not like
      '%delete from app_data_agent.%I where app_id=$1 and environment=$2%'
    or execute_definition not like
      '%using (command->>''app_id'')::uuid,command->>''environment'';%'
    or inventory_definition like
      '%select pg_catalog.count(*) from app_data_agent.%I'',target)%'
    or execute_definition like '%delete from app_data_agent.%I'',target);%'
    or (select owner_role.rolname from pg_catalog.pg_proc function_row
      join pg_catalog.pg_roles owner_role on owner_role.oid=function_row.proowner
      where function_row.oid=
        'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure)
      <>'data_agent_legacy_attribution_cleanup_owner'
  then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

commit;
