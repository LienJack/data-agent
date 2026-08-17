\set ON_ERROR_STOP on

do $catalog$
declare definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid,true) into definition
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid=constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='app_data_agent' and relation.relname='datasource_connections'
    and constraint_row.conname='datasource_connections_datasource_type_check';
  if definition is null or pg_catalog.strpos(definition,'''duckdb''')=0
    or pg_catalog.strpos(definition,'''postgresql''')=0
    or pg_catalog.strpos(definition,'''mysql''')=0
    or pg_catalog.strpos(definition,'''sqlite''')=0
    or pg_catalog.strpos(definition,'''clickhouse''')=0
    or pg_catalog.strpos(definition,'''trino''')>0
  then raise exception 'U16 mandatory Datasource Adapter set is not exact'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010668_app_data_agent_datasource_adapters')
  then raise exception 'U16 Datasource Adapter migration ledger missing'; end if;
end
$catalog$;

select 'U16_DATASOURCE_ADAPTER_ASSERTIONS_PASSED' as result;
