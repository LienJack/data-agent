-- A one-to-one result receipt for the existing activation RPC, never a second current pointer.
create table app_data_agent.falcon24_retained_recovery_activation_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  activation_attempt_id uuid not null,predecessor_attempt_id uuid not null,
  command_hash text not null check(command_hash~'^sha256:[0-9a-f]{64}$'),
  command_document jsonb not null,result_hash text not null
    check(result_hash~'^sha256:[0-9a-f]{64}$'),result_document jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,activation_attempt_id),
  foreign key(app_id,tenant_id,environment,activation_attempt_id)
    references app_data_agent.falcon24_authority_activation_attempts(
      app_id,tenant_id,environment,attempt_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,principal_id,predecessor_attempt_id)
    references app_data_agent.falcon24_four_layer_gate_attempts(
      app_id,tenant_id,environment,principal_id,attempt_id) on delete restrict,
  check(pg_catalog.jsonb_typeof(command_document) is not distinct from 'object'
    and command_document->>'schema_version' is not distinct from 'falcon24-activation-request@8.0.0'
    and command_document->>'command_hash' is not distinct from command_hash
    and app_data_agent.u2_canonical_sha256(command_document-'command_hash') is not distinct from command_hash
    and command_document->>'attempt_id' is not distinct from activation_attempt_id::text
    and command_document#>>'{predecessor_four_layer_failure_receipt,attempt_id}' is not distinct from predecessor_attempt_id::text),
  check(pg_catalog.jsonb_typeof(result_document) is not distinct from 'object'
    and result_document->>'schema_version' is not distinct from 'falcon24-retained-activation-result@8.0.0'
    and result_document->>'activation_command_hash' is not distinct from command_hash
    and result_document#>>'{authority,activation_attempt_id}' is not distinct from activation_attempt_id::text
    and app_data_agent.u2_canonical_sha256(result_document) is not distinct from result_hash)
);

create function app_data_agent.reject_falcon24_retained_recovery_receipt_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_RETAINED_RECOVERY_RECEIPT_IMMUTABLE';
end
$function$;
create trigger falcon24_retained_recovery_receipt_immutable
before update or delete on app_data_agent.falcon24_retained_recovery_activation_receipts
for each row execute function app_data_agent.reject_falcon24_retained_recovery_receipt_mutation();
alter table app_data_agent.falcon24_retained_recovery_activation_receipts enable row level security;
alter table app_data_agent.falcon24_retained_recovery_activation_receipts force row level security;
