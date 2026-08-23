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
