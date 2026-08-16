alter table app_data_agent.qa_conversations
  add column model_profile_id uuid,
  add column resource_version bigint not null default 1 check (resource_version >= 1);

update app_data_agent.qa_conversations as conversation
set model_profile_id = conversation.model_id::uuid
where conversation.model_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from app_data_agent.model_catalog_entries as catalog
    where catalog.app_id = conversation.app_id
      and catalog.environment = conversation.environment
      and catalog.model_profile_id = conversation.model_id::uuid
  );

alter table app_data_agent.qa_conversations
  add constraint qa_conversations_model_profile_fk
  foreign key (app_id, environment, model_profile_id)
  references app_data_agent.model_catalog_entries (app_id, environment, model_profile_id)
  on delete restrict;

alter table app_data_agent.workspace_run_bindings
  add column model_profile_id uuid,
  add column model_config_version bigint check (model_config_version is null or model_config_version >= 1),
  add column provider text check (
    provider is null or provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')
  ),
  add column model_id text check (
    model_id is null or pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256
  ),
  add column datasource_binding_hash text check (
    datasource_binding_hash is null or datasource_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint workspace_run_bindings_model_snapshot_complete check (
    pg_catalog.num_nonnulls(
      model_profile_id, model_config_version, provider, model_id, datasource_binding_hash
    ) in (0, 5)
  ),
  add constraint workspace_run_bindings_model_config_fk
  foreign key (app_id, environment, model_profile_id, model_config_version)
  references app_data_agent.model_config_versions (
    app_id, environment, model_profile_id, config_version
  ) on delete restrict;

create table app_data_agent.qa_resource_switch_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_json jsonb not null check (
    pg_catalog.jsonb_typeof(result_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(result_json)
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key)
);

revoke all on table app_data_agent.qa_resource_switch_operations from public;
