create table app_data_agent.semantic_binding_impact_receipts (
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check(semantic_domain~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  impact_id uuid not null,
  datasource_id text not null check(datasource_id~'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  drift_event_id uuid not null,
  event_storage_digest text not null check(event_storage_digest~'^sha256:[0-9a-f]{64}$'),
  release_id uuid not null,
  release_generation bigint not null check(release_generation between 1 and 9007199254740991),
  release_digest text not null check(release_digest~'^sha256:[0-9a-f]{64}$'),
  authority_input_hash text not null check(authority_input_hash~'^sha256:[0-9a-f]{64}$'),
  plan_hash text not null check(plan_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid,
  candidate_revision_id uuid,
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  committed_by uuid not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,semantic_domain,impact_id),
  unique(app_id,tenant_id,environment,semantic_domain,receipt_hash),
  foreign key(app_id,tenant_id,environment,datasource_id,drift_event_id)
    references catalog.schema_drift_event(app_id,tenant_id,environment,datasource_id,drift_event_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,release_id)
    references semantic.semantic_source_release(app_id,tenant_id,environment,semantic_domain,release_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,candidate_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id),
  check((candidate_id is null)=(candidate_revision_id is null))
);

alter table app_data_agent.semantic_binding_impact_receipts enable row level security;
alter table app_data_agent.semantic_binding_impact_receipts force row level security;

create function app_data_agent.reject_semantic_binding_impact_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_BINDING_IMPACT_IMMUTABLE';
end
$function$;
create trigger semantic_binding_impact_receipts_immutable
before update or delete on app_data_agent.semantic_binding_impact_receipts
for each row execute function app_data_agent.reject_semantic_binding_impact_mutation();

create function app_data_agent.semantic_binding_impact_exact_keys(value jsonb,keys text[])
returns boolean language sql immutable strict set search_path='' as $function$
  select pg_catalog.jsonb_typeof(value)='object' and value-keys='{}'::jsonb
    and not exists(select 1 from pg_catalog.unnest(keys) required(key) where not value?required.key)
$function$;

create function app_data_agent.semantic_binding_impact_uuid_v8(requested_hash text)
returns uuid language plpgsql immutable strict set search_path='' as $function$
declare value text; variant text;
begin
  if requested_hash!~'^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_HASH_INVALID';
  end if;
  value:=pg_catalog.substr(requested_hash,8,32);
  value:=pg_catalog.substr(value,1,12)||'8'||pg_catalog.substr(value,14);
  variant:=case pg_catalog.substr(value,17,1)
    when '0' then '8' when '4' then '8' when '8' then '8' when 'c' then '8'
    when '1' then '9' when '5' then '9' when '9' then '9' when 'd' then '9'
    when '2' then 'a' when '6' then 'a' when 'a' then 'a' when 'e' then 'a' else 'b' end;
  value:=pg_catalog.substr(value,1,16)||variant||pg_catalog.substr(value,18);
  return (pg_catalog.substr(value,1,8)||'-'||pg_catalog.substr(value,9,4)||'-'||
    pg_catalog.substr(value,13,4)||'-'||pg_catalog.substr(value,17,4)||'-'||
    pg_catalog.substr(value,21,12))::uuid;
end
$function$;

create function app_data_agent.semantic_binding_impact_utc_millis(value timestamptz)
returns text language sql immutable strict parallel safe set search_path='' as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;
