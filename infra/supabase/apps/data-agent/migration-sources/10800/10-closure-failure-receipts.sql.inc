create table app_data_agent.falcon24_epoch_closure_failure_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  receipt_id uuid not null,idempotency_key text not null
    check(pg_catalog.length(idempotency_key) between 1 and 256),
  authority_epoch text not null check(
    app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and pg_catalog.substr(authority_epoch,2)::numeric>=7),
  baseline_id uuid not null,baseline_hash text not null
    check(baseline_hash~'^sha256:[0-9a-f]{64}$'),
  activation_attempt_id uuid not null,stage_id uuid not null,
  stage_proof_hash text not null check(stage_proof_hash~'^sha256:[0-9a-f]{64}$'),
  failure_class text not null check(failure_class='FROZEN_CLOSURE_CHANGE_REQUIRED'),
  failure_code text not null check(failure_code='PROVIDER_PROFILE_BINDING_NOT_SELECTED'),
  expected_readiness text not null check(expected_readiness='AVAILABLE'),
  observed_readiness text not null check(observed_readiness='STALE'),
  observed_selectable boolean not null check(not observed_selectable),
  evidence_hash text not null check(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  command_hash text not null check(command_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_document jsonb not null check(pg_catalog.jsonb_typeof(receipt_document)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,receipt_id),
  unique(app_id,tenant_id,environment,idempotency_key),
  unique(app_id,tenant_id,environment,authority_epoch,baseline_id,activation_attempt_id,failure_code),
  foreign key(app_id,tenant_id,environment,stage_id)
    references app_data_agent.falcon24_llm_execution_certification_stage(
      app_id,tenant_id,environment,stage_id) on delete restrict,
  check(receipt_document->>'receipt_hash'=receipt_hash),
  check(receipt_document->>'evidence_hash'=evidence_hash),
  check(receipt_document->>'receipt_id'=receipt_id::text)
);

create function app_data_agent.reject_falcon24_epoch_closure_failure_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',
    message='DA_FALCON24_EPOCH_CLOSURE_FAILURE_IMMUTABLE';
end
$function$;

create trigger falcon24_epoch_closure_failure_immutable
before update or delete on app_data_agent.falcon24_epoch_closure_failure_receipts
for each row execute function app_data_agent.reject_falcon24_epoch_closure_failure_mutation();

alter table app_data_agent.falcon24_epoch_closure_failure_receipts enable row level security;
alter table app_data_agent.falcon24_epoch_closure_failure_receipts force row level security;
