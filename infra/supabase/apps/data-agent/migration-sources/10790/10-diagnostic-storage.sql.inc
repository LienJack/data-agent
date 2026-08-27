create table app_data_agent.falcon24_diagnostic_attempts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,
  principal_id uuid not null,attempt_id uuid not null,run_id uuid not null,
  authority_epoch text not null check(authority_epoch='E4'),
  authority_baseline_id uuid not null,
  authority_baseline_hash text not null check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  authority_activation_attempt_id uuid not null,
  semantic_domain text not null check(semantic_domain~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  semantic_release_id uuid not null,
  semantic_release_generation bigint not null check(semantic_release_generation=2),
  semantic_release_digest text not null check(semantic_release_digest~'^sha256:[0-9a-f]{64}$'),
  datasource_id uuid not null,
  source_commit text not null check(source_commit~'^[0-9a-f]{40}$'),
  source_fingerprint text not null check(source_fingerprint~'^sha256:[0-9a-f]{64}$'),
  web_build_id text not null check(web_build_id~'^sha256:[0-9a-f]{64}$'),
  web_generation_id text not null check(web_generation_id~'^sha256:[0-9a-f]{64}$'),
  worker_build_id text not null check(worker_build_id~'^sha256:[0-9a-f]{64}$'),
  worker_generation_id text not null check(worker_generation_id~'^sha256:[0-9a-f]{64}$'),
  runtime_attestation_hash text not null check(runtime_attestation_hash~'^sha256:[0-9a-f]{64}$'),
  question_hash text not null check(question_hash~'^sha256:[0-9a-f]{64}$'),
  manifest_hash text not null check(manifest_hash~'^sha256:[0-9a-f]{64}$'),
  manifest_document jsonb not null check(pg_catalog.jsonb_typeof(manifest_document)='object'),
  status text not null check(status in('ACTIVE','PASSED','FAILED')),
  failure_class text check(failure_class in(
    'FROZEN_CLOSURE_CHANGE_REQUIRED','EXTERNAL_DEPENDENCY')),
  failure_code text check(failure_code is null or failure_code~'^[A-Z][A-Z0-9_]{2,127}$'),
  terminal_receipt_hash text check(
    terminal_receipt_hash is null or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),completed_at timestamptz,
  primary key(app_id,tenant_id,environment,attempt_id),
  unique(app_id,tenant_id,environment,run_id),
  foreign key(app_id,tenant_id,environment,authority_baseline_id,
    authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  foreign key(app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_authority_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict,
  check(manifest_hash=app_data_agent.u2_canonical_sha256(manifest_document-'manifest_hash')),
  check((status='ACTIVE' and failure_class is null and failure_code is null
      and terminal_receipt_hash is null and completed_at is null)
    or (status='PASSED' and failure_class is null and failure_code is null
      and terminal_receipt_hash is not null and completed_at is not null)
    or (status='FAILED' and failure_class is not null and failure_code is not null
      and terminal_receipt_hash is not null and completed_at is not null))
);

create unique index falcon24_diagnostic_one_active_closure
on app_data_agent.falcon24_diagnostic_attempts(
  app_id,tenant_id,environment,authority_baseline_id,semantic_release_id)
where status='ACTIVE';

create table app_data_agent.falcon24_diagnostic_receipts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  attempt_id uuid not null,run_id uuid not null,outcome text not null check(outcome in('PASS','FAIL')),
  completion_command_hash text not null
    check(completion_command_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_document jsonb not null check(pg_catalog.jsonb_typeof(receipt_document)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,attempt_id),
  unique(app_id,tenant_id,environment,run_id),
  unique(app_id,tenant_id,environment,receipt_hash),
  unique(app_id,tenant_id,environment,attempt_id,run_id,receipt_hash),
  foreign key(app_id,tenant_id,environment,attempt_id)
    references app_data_agent.falcon24_diagnostic_attempts(
      app_id,tenant_id,environment,attempt_id) on delete restrict,
  check(receipt_document->>'schema_version'='falcon24-diagnostic-receipt@1.0.0'),
  check(receipt_document->>'attempt_id'=attempt_id::text),
  check(receipt_document->>'run_id'=run_id::text),
  check(receipt_document->>'outcome'=outcome),
  check(receipt_hash=app_data_agent.u2_canonical_sha256(receipt_document-'receipt_hash'))
);

create function app_data_agent.falcon24_diagnostic_attempt_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or (pg_catalog.to_jsonb(new)-array[
        'status','failure_class','failure_code','terminal_receipt_hash','completed_at'])
      is distinct from
      (pg_catalog.to_jsonb(old)-array[
        'status','failure_class','failure_code','terminal_receipt_hash','completed_at'])
    or old.status<>'ACTIVE' or new.status not in('PASSED','FAILED')
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_diagnostic_receipt_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE';
end
$function$;

create trigger falcon24_diagnostic_attempt_state_fence
before update or delete on app_data_agent.falcon24_diagnostic_attempts
for each row execute function app_data_agent.falcon24_diagnostic_attempt_state_fence();
create trigger falcon24_diagnostic_receipt_immutable
before update or delete on app_data_agent.falcon24_diagnostic_receipts
for each row execute function app_data_agent.falcon24_diagnostic_receipt_immutable();

alter table app_data_agent.falcon24_qualifications
  add column diagnostic_attempt_id uuid,
  add column diagnostic_run_id uuid,
  add column diagnostic_receipt_hash text,
  add constraint falcon24_qualification_diagnostic_columns_check check(
    (diagnostic_attempt_id is null)=(diagnostic_run_id is null)
    and (diagnostic_attempt_id is null)=(diagnostic_receipt_hash is null)
    and (diagnostic_receipt_hash is null
      or diagnostic_receipt_hash~'^sha256:[0-9a-f]{64}$')),
  add constraint falcon24_qualification_diagnostic_receipt_fk foreign key(
    app_id,tenant_id,environment,diagnostic_attempt_id,diagnostic_run_id,
    diagnostic_receipt_hash)
    references app_data_agent.falcon24_diagnostic_receipts(
      app_id,tenant_id,environment,attempt_id,run_id,receipt_hash) on delete restrict;
