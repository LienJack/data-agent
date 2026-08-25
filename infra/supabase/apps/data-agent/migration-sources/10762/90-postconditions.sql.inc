do $postconditions$
begin
  if exists(select 1 from app_data_agent.model_catalog_entries
    where status not in ('DRAFT','ACTIVE','DISABLED'))
  then raise exception using errcode='P0001',message='MODEL_STATUS_RETIREMENT_REPAIR_INCOMPLETE'; end if;

  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='app_data_agent.model_catalog_entries'::pg_catalog.regclass
      and conname='model_catalog_entries_status_check' and convalidated)
  then raise exception using errcode='P0001',message='MODEL_STATUS_RETIREMENT_CONSTRAINT_NOT_VALIDATED'; end if;
end
$postconditions$;
