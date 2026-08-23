create table app_data_agent.model_control_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  operation_kind text not null check (operation_kind in (
    'UPSERT_MODEL','SET_MODEL_STATUS','UPSERT_PROVIDER','ARCHIVE_PROVIDER','SELECT_PROVIDER_MODELS'
  )),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, actor_principal_id, idempotency_key),
  unique (app_id, environment, operation_id)
);

create table app_data_agent.model_control_audit_log (
  app_id uuid not null,
  environment text not null,
  audit_id uuid not null default pg_catalog.gen_random_uuid(),
  operation_id uuid not null,
  actor_principal_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  reason text not null,
  details jsonb not null check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, audit_id),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.model_control_operations (app_id, environment, operation_id)
    on delete restrict
);

create function app_data_agent.reject_model_control_history_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'MODEL_CONTROL_HISTORY_IMMUTABLE';
end
$function$;

drop trigger model_config_versions_immutable on app_data_agent.model_config_versions;
create trigger model_config_versions_immutable
before update or delete on app_data_agent.model_config_versions
for each row execute function app_data_agent.reject_model_control_history_mutation();

drop trigger model_provider_connection_versions_immutable
on app_data_agent.model_provider_connection_versions;
create trigger model_provider_connection_versions_immutable
before update or delete on app_data_agent.model_provider_connection_versions
for each row execute function app_data_agent.reject_model_control_history_mutation();

create trigger model_control_operations_immutable
before update or delete on app_data_agent.model_control_operations
for each row execute function app_data_agent.reject_model_control_history_mutation();
create trigger model_control_audit_log_immutable
before update or delete on app_data_agent.model_control_audit_log
for each row execute function app_data_agent.reject_model_control_history_mutation();

alter table app_data_agent.model_control_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_control_audit_log owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reject_model_control_history_mutation()
  owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.model_control_operations,
  app_data_agent.model_control_audit_log
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.reject_model_control_history_mutation() from public;

alter table app_data_agent.model_catalog_entries
  drop constraint model_catalog_entries_status_check;
alter table app_data_agent.model_catalog_entries
  add constraint model_catalog_entries_status_check
  check (status in ('DRAFT','ACTIVE','DISABLED')) not valid;
