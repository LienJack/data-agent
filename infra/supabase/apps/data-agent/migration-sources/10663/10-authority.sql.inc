create table app_data_agent.resolved_context_receipts (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  consumer text not null check (consumer in ('PREVIEW','RUN')),
  run_id uuid,
  package_id uuid not null,
  package_key_hash text not null check (package_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  package_hash text not null check (
    package_hash ~ '^sha256:[0-9a-f]{64}$'
    and package_hash=app_data_agent.u2_canonical_sha256(package_json-'package_hash')
  ),
  authority_snapshot_hash text not null check (authority_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('READY','PARTIAL','NEEDS_CLARIFICATION','REJECTED','STALE')),
  route text not null check (route in ('METRIC','ONTOLOGY_TEXT2SQL','KNOWLEDGE','GRAPH','NONE')),
  package_json jsonb not null check (
    pg_catalog.jsonb_typeof(package_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(package_json)
  ),
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  receipt_hash text not null check (
    receipt_hash ~ '^sha256:[0-9a-f]{64}$'
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_json-'receipt_hash')
  ),
  resolved_at timestamptz not null,
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,request_id,consumer),
  unique (app_id,tenant_id,environment,receipt_id,receipt_hash),
  check ((consumer='PREVIEW' and run_id is null) or (consumer='RUN' and run_id is not null)),
  check (request_id::text=receipt_json->>'request_id' and request_hash=receipt_json->>'request_hash'),
  check (package_id::text=package_json->>'package_id' and package_key_hash=package_json->>'package_key_hash'),
  foreign key (app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key (app_id,tenant_id,environment,committed_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_resolved_context_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='RESOLVED_CONTEXT_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger resolved_context_receipts_immutable
before update or delete on app_data_agent.resolved_context_receipts
for each row execute function app_data_agent.reject_resolved_context_mutation();

alter table app_data_agent.resolved_context_receipts enable row level security;
alter table app_data_agent.resolved_context_receipts force row level security;
create policy resolved_context_receipts_owner on app_data_agent.resolved_context_receipts
  for all to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
