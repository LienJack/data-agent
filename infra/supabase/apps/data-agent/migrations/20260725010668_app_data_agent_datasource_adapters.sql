-- u16_datasource_adapter_migration_checksum: sha256:d4a31ab2e384be8a9f65d79a6b2ef8770f6e2457f35ce94b9a9f6610058b80ec
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U16_DATASOURCE_ADAPTER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U16_DATASOURCE_ADAPTER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010667_app_data_agent_agent_product_profiles')
  then raise exception using errcode='P0001',message='U16_DATASOURCE_ADAPTER_BASELINE_10667_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
alter table app_data_agent.datasource_connections
  drop constraint datasource_connections_datasource_type_check;
alter table app_data_agent.datasource_connections
  add constraint datasource_connections_datasource_type_check check (
    datasource_type in ('postgresql','mysql','clickhouse','sqlite','duckdb')
  );
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid,true) into definition
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid=constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='app_data_agent' and relation.relname='datasource_connections'
    and constraint_row.conname='datasource_connections_datasource_type_check';
  if definition is null or pg_catalog.strpos(definition,'''duckdb''')=0
    or pg_catalog.strpos(definition,'''trino''')>0
  then raise exception using errcode='P0001',message='U16_DATASOURCE_ADAPTER_TYPE_CHECK_INVALID'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010668_app_data_agent_datasource_adapters','sha256:d4a31ab2e384be8a9f65d79a6b2ef8770f6e2457f35ce94b9a9f6610058b80ec');
commit;
