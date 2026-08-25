update app_data_agent.model_catalog_entries
set status='ACTIVE',updated_at=pg_catalog.clock_timestamp()
where status='UNBILLABLE';

alter table app_data_agent.model_catalog_entries
  validate constraint model_catalog_entries_status_check;
