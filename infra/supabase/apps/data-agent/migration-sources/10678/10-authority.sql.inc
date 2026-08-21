create table app_data_agent.legacy_attribution_cleanup_receipts(
  operation_id uuid primary key,
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  database_name text not null check(database_name~'^[A-Za-z_][A-Za-z0-9_$]{0,62}$'),
  system_identifier text not null check(system_identifier~'^[0-9]{10,24}$'),
  inventory_digest text not null check(inventory_digest~'^sha256:[0-9a-f]{64}$'),
  backup_sha256 text not null check(backup_sha256~'^sha256:[0-9a-f]{64}$'),
  terminal text not null check(terminal in('COMPLETED','NOOP')),
  reason_code text not null check(reason_code in(
    'LEGACY_ATTRIBUTION_AUTHORITY_ROWS_DELETED','LEGACY_ATTRIBUTION_NO_ROWS_FOUND')),
  total_deleted bigint not null check(total_deleted>=0),
  request_document jsonb not null,
  request_hash text not null check(request_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_document jsonb not null,
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  executed_at timestamptz not null,
  check(request_hash=platform.canonical_sha256(request_document)),
  check(receipt_hash=platform.canonical_sha256(receipt_document-'receipt_hash'::text)),
  check(receipt_document->>'receipt_hash'=receipt_hash)
);

create function app_data_agent.reject_legacy_attribution_cleanup_receipt_mutation()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='LEGACY_ATTRIBUTION_CLEANUP_RECEIPT_IMMUTABLE';
end
$function$;

create trigger legacy_attribution_cleanup_receipts_immutable
before update or delete on app_data_agent.legacy_attribution_cleanup_receipts
for each row execute function app_data_agent.reject_legacy_attribution_cleanup_receipt_mutation();

create function app_data_agent.legacy_attribution_cleanup_target_tables()
returns text[] language sql immutable set search_path='' as $function$
  select array[
    'attribution_active_pointer','attribution_capability_directory',
    'attribution_conclusion_policy','attribution_eligibility_decision',
    'attribution_nonce_ledger','attribution_owner_map_release',
    'attribution_profile_projection','attribution_profile_request',
    'attribution_relationship_promotion_receipt','attribution_safety_verdict',
    'attribution_signer_assignment','attribution_verification_key_revision'
  ]::text[]
$function$;
