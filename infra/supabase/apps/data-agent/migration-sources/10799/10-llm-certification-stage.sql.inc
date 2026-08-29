create table app_data_agent.falcon24_llm_execution_certification_stage(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  target_authority_epoch text not null check(
    app_data_agent.falcon24_authority_epoch_is_canonical(target_authority_epoch)
    and pg_catalog.substr(target_authority_epoch,2)::numeric>=7),
  staging_id uuid not null,stage_id uuid not null,idempotency_key text not null
    check(pg_catalog.length(idempotency_key) between 1 and 256),
  staging_command_hash text not null check(staging_command_hash~'^sha256:[0-9a-f]{64}$'),
  model_profile_id uuid not null,model_config_version bigint not null
    check(model_config_version between 1 and 9007199254740991),
  model_resource_hash text not null check(model_resource_hash~'^sha256:[0-9a-f]{64}$'),
  provider text not null check(provider='deepseek'),
  model_id text not null check(model_id='deepseek-v4-flash'),
  certification_run_id uuid not null,certification_artifact_id uuid not null,
  certification_revision integer not null check(certification_revision=1),
  certification_content_hash text not null
    check(certification_content_hash~'^sha256:[0-9a-f]{64}$'),
  execution_profile_hash text not null check(execution_profile_hash~'^sha256:[0-9a-f]{64}$'),
  deployment_id uuid not null,deployment_hash text not null
    check(deployment_hash~'^sha256:[0-9a-f]{64}$'),
  recovery_capabilities jsonb not null check(
    recovery_capabilities='["AT_LEAST_ONCE_ONLY"]'::jsonb),
  worker_build_id text not null check(worker_build_id~'^sha256:[0-9a-f]{64}$'),
  worker_generation_id text not null check(worker_generation_id~'^sha256:[0-9a-f]{64}$'),
  proof_hash text not null check(proof_hash~'^sha256:[0-9a-f]{64}$'),
  proof_document jsonb not null check(pg_catalog.jsonb_typeof(proof_document)='object'),
  status text not null check(status in('STAGED','PROMOTED','REJECTED')),
  activation_attempt_id uuid,
  rejection_reason_code text check(
    rejection_reason_code is null or rejection_reason_code~'^[A-Z][A-Z0-9_]{2,127}$'),
  rejection_command_hash text check(
    rejection_command_hash is null or rejection_command_hash~'^sha256:[0-9a-f]{64}$'),
  promoted_at timestamptz,created_at timestamptz not null
    default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,stage_id),
  unique(app_id,tenant_id,environment,idempotency_key),
  unique(app_id,tenant_id,environment,proof_hash),
  unique(app_id,tenant_id,environment,certification_run_id,certification_artifact_id,
    certification_content_hash),
  foreign key(app_id,tenant_id,environment,certification_run_id,
    certification_artifact_id,certification_revision,certification_content_hash)
    references app_data_agent.artifacts(
      app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash) on delete restrict,
  check(proof_document->>'proof_hash'=proof_hash),
  check((status='STAGED' and activation_attempt_id is null and promoted_at is null
      and rejection_reason_code is null and rejection_command_hash is null)
    or (status='PROMOTED' and activation_attempt_id is not null and promoted_at is not null
      and rejection_reason_code is null and rejection_command_hash is null)
    or (status='REJECTED' and activation_attempt_id is null and promoted_at is not null
      and rejection_reason_code is not null and rejection_command_hash is not null))
);

create unique index falcon24_llm_execution_one_live_stage
on app_data_agent.falcon24_llm_execution_certification_stage(
  app_id,tenant_id,environment,target_authority_epoch) where status='STAGED';

create function app_data_agent.falcon24_llm_execution_stage_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or (pg_catalog.to_jsonb(new)-array['status','activation_attempt_id','rejection_reason_code',
      'rejection_command_hash','promoted_at'])
      is distinct from
      (pg_catalog.to_jsonb(old)-array['status','activation_attempt_id','rejection_reason_code',
        'rejection_command_hash','promoted_at'])
    or old.status<>'STAGED' or new.status not in('PROMOTED','REJECTED')
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_IMMUTABLE'; end if;
  return new;
end
$function$;

create trigger falcon24_llm_execution_stage_state_fence
before update or delete on app_data_agent.falcon24_llm_execution_certification_stage
for each row execute function app_data_agent.falcon24_llm_execution_stage_state_fence();

alter table app_data_agent.falcon24_llm_execution_certification_stage enable row level security;
alter table app_data_agent.falcon24_llm_execution_certification_stage force row level security;
