alter table app_data_agent.datasource_connections
  drop constraint datasource_connections_datasource_type_check;
alter table app_data_agent.datasource_connections
  add constraint datasource_connections_datasource_type_check check (
    datasource_type in ('postgresql','mysql','clickhouse','sqlite','duckdb')
  );
