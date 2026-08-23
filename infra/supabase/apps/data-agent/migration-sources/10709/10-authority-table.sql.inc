create table app_data_agent.analysis_python_sources (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  revision integer not null check (revision=1),
  plaintext_hash text not null check (plaintext_hash ~ '^sha256:[0-9a-f]{64}$'),
  analysis_program_id uuid not null,
  analysis_program_revision integer not null check (analysis_program_revision=1),
  analysis_program_hash text not null check (analysis_program_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text not null check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  generation_attempt integer not null check (generation_attempt in (0,1)),
  source_kind text not null check (source_kind in ('STANDARD_PROGRAM','DEEPSEEK_GENERATED')),
  provider_invocation_id uuid,
  provider_invocation_hash text check (
    provider_invocation_hash is null or provider_invocation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ciphertext_hash text not null check (ciphertext_hash ~ '^sha256:[0-9a-f]{64}$'),
  key_id text not null check (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  iv_base64 text not null check (pg_catalog.length(iv_base64) between 16 and 64),
  auth_tag_base64 text not null check (pg_catalog.length(auth_tag_base64) between 16 and 64),
  ciphertext_bytes bytea not null check (pg_catalog.octet_length(ciphertext_bytes) between 1 and 131072),
  principal_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null check (worker_fence>=1),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,run_id,artifact_id,revision),
  unique (app_id,tenant_id,environment,run_id,principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,run_id,artifact_id,revision,plaintext_hash),
  foreign key (app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,run_id,
    analysis_program_id,analysis_program_revision,analysis_program_hash
  ) references app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  check (
    (source_kind='STANDARD_PROGRAM' and generation_attempt=0
      and provider_invocation_id is null and provider_invocation_hash is null)
    or
    (source_kind='DEEPSEEK_GENERATED'
      and provider_invocation_id is not null and provider_invocation_hash is not null)
  )
);

create function app_data_agent.reject_analysis_python_source_mutation()
returns trigger language plpgsql volatile set search_path='' as $function$
begin
  raise exception using errcode='55000',message='ANALYSIS_PYTHON_SOURCE_IMMUTABLE';
end
$function$;

create trigger analysis_python_sources_immutable
before update or delete on app_data_agent.analysis_python_sources
for each row execute function app_data_agent.reject_analysis_python_source_mutation();

alter table app_data_agent.analysis_python_sources enable row level security;
alter table app_data_agent.analysis_python_sources force row level security;

create policy analysis_python_sources_rpc_select on app_data_agent.analysis_python_sources
for select to data_agent_u6_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_python_sources_rpc_insert on app_data_agent.analysis_python_sources
for insert to data_agent_u6_rpc_owner
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
