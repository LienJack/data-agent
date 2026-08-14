-- ============================================================
-- 10629: Model catalog, price/FX candidates and immutable versions
-- ============================================================

create table app_data_agent.pricing_control_state (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  pricing_epoch bigint not null default 1 check (pricing_epoch >= 1),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment)
);

create table app_data_agent.model_catalog_entries (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  model_profile_id uuid not null,
  provider text not null check (provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')),
  model_id text not null check (pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256),
  display_name text not null check (pg_catalog.length(pg_catalog.btrim(display_name)) between 1 and 255),
  base_url text not null check (pg_catalog.length(base_url) between 8 and 2048),
  capabilities jsonb not null check (
    pg_catalog.jsonb_typeof(capabilities) = 'object'
    and capabilities ?& array['structured_output','tool_calling','streaming','reasoning','vision']
  ),
  credential_ref jsonb,
  status text not null check (status in ('DRAFT','ACTIVE','DISABLED','UNBILLABLE')),
  config_version bigint not null default 1 check (config_version >= 1),
  is_system_default boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, model_profile_id),
  unique (app_id, environment, provider, model_id),
  foreign key (app_id, environment, created_by)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  check (
    credential_ref is null
    or (
      pg_catalog.jsonb_typeof(credential_ref) = 'object'
      and credential_ref ->> 'schema_version' = 'global-model-credential-ref@1.0.0'
      and credential_ref ->> 'app_id' = app_id::text
      and credential_ref ->> 'environment' = environment
      and credential_ref ->> 'rotation_state' in ('ACTIVE','ROTATION_PENDING','REVOCATION_PENDING','REVOKED')
      and (credential_ref ->> 'credential_ref_id') ~ '^[0-9a-f-]{36}$'
      and (credential_ref ->> 'secret_ref_id') ~ '^[0-9a-f-]{36}$'
      and (credential_ref ->> 'secret_version') ~ '^[1-9][0-9]*$'
    )
  )
);

create unique index model_catalog_one_system_default
  on app_data_agent.model_catalog_entries (app_id, environment)
  where is_system_default and status = 'ACTIVE';

create table app_data_agent.model_config_versions (
  app_id uuid not null,
  environment text not null,
  model_profile_id uuid not null,
  config_version bigint not null check (config_version >= 1),
  snapshot jsonb not null check (
    pg_catalog.jsonb_typeof(snapshot) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(snapshot)
  ),
  actor_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, model_profile_id, config_version),
  foreign key (app_id, environment, model_profile_id)
    references app_data_agent.model_catalog_entries (app_id, environment, model_profile_id)
    on delete restrict
);

create table app_data_agent.pricing_sync_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  source_kind text not null check (source_kind in ('MODEL_PRICE','FX_RATE')),
  source_adapter text not null check (source_adapter ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  source_url text not null check (pg_catalog.length(source_url) between 8 and 2048),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  parser_version text not null check (parser_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  status text not null check (status in ('SUCCEEDED','FAILED')),
  fetched_at timestamptz not null,
  raw_evidence text not null check (pg_catalog.octet_length(raw_evidence) <= 65536),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, operation_id)
);

create table app_data_agent.model_price_candidates (
  app_id uuid not null,
  environment text not null,
  candidate_id uuid not null,
  provider text not null check (provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')),
  model_id text not null check (pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256),
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  source_url text not null,
  evidence_hash text not null check (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  parser_version text not null,
  fetched_at timestamptz not null,
  risk text not null check (risk in ('NORMAL','HIGH')),
  source_operation_id uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  primary key (app_id, environment, candidate_id),
  unique (app_id, environment, provider, model_id, evidence_hash),
  foreign key (app_id, environment, source_operation_id)
    references app_data_agent.pricing_sync_operations (app_id, environment, operation_id)
    on delete restrict,
  check (
    (status = 'PENDING_REVIEW' and reviewed_by is null and reviewed_at is null and review_reason is null)
    or (status <> 'PENDING_REVIEW' and reviewed_by is not null and reviewed_at is not null and review_reason is not null)
  )
);

create table app_data_agent.model_price_candidate_components (
  app_id uuid not null,
  environment text not null,
  candidate_id uuid not null,
  component_id uuid not null,
  kind text not null check (kind in ('INPUT_TOKENS','OUTPUT_TOKENS','CACHE_READ_TOKENS','CACHE_WRITE_TOKENS','TOOL_CALLS')),
  unit text not null check (unit in ('PER_MILLION_TOKENS','PER_THOUSAND_TOKENS','PER_CALL')),
  unit_price numeric(38,18) not null check (unit_price > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tier_min_inclusive numeric(38,0) check (tier_min_inclusive is null or tier_min_inclusive >= 0),
  tier_max_exclusive numeric(38,0) check (tier_max_exclusive is null or tier_max_exclusive > 0),
  primary key (app_id, environment, candidate_id, component_id),
  foreign key (app_id, environment, candidate_id)
    references app_data_agent.model_price_candidates (app_id, environment, candidate_id)
    on delete restrict,
  check (tier_max_exclusive is null or tier_min_inclusive is null or tier_max_exclusive > tier_min_inclusive)
);

create table app_data_agent.model_price_versions (
  app_id uuid not null,
  environment text not null,
  price_version_id uuid not null,
  source_candidate_id uuid not null,
  provider text not null,
  model_id text not null,
  approved_by uuid not null,
  approved_at timestamptz not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  primary key (app_id, environment, price_version_id),
  unique (app_id, environment, source_candidate_id),
  foreign key (app_id, environment, source_candidate_id)
    references app_data_agent.model_price_candidates (app_id, environment, candidate_id)
    on delete restrict,
  check (effective_to is null or effective_to > effective_from)
);

create unique index model_price_one_active_version
  on app_data_agent.model_price_versions (app_id, environment, provider, model_id)
  where effective_to is null;

create table app_data_agent.model_price_components (
  app_id uuid not null,
  environment text not null,
  price_version_id uuid not null,
  component_id uuid not null,
  kind text not null,
  unit text not null,
  unit_price numeric(38,18) not null check (unit_price > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tier_min_inclusive numeric(38,0),
  tier_max_exclusive numeric(38,0),
  primary key (app_id, environment, price_version_id, component_id),
  foreign key (app_id, environment, price_version_id)
    references app_data_agent.model_price_versions (app_id, environment, price_version_id)
    on delete restrict
);

create table app_data_agent.fx_rate_candidates (
  app_id uuid not null,
  environment text not null,
  candidate_id uuid not null,
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency char(3) not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(38,18) not null check (rate > 0),
  official_date date not null,
  source_url text not null,
  evidence_hash text not null check (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  parser_version text not null,
  fetched_at timestamptz not null,
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  source_operation_id uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  primary key (app_id, environment, candidate_id),
  unique (app_id, environment, base_currency, quote_currency, official_date, evidence_hash),
  foreign key (app_id, environment, source_operation_id)
    references app_data_agent.pricing_sync_operations (app_id, environment, operation_id)
    on delete restrict,
  check (base_currency <> quote_currency),
  check (
    (status = 'PENDING_REVIEW' and reviewed_by is null and reviewed_at is null and review_reason is null)
    or (status <> 'PENDING_REVIEW' and reviewed_by is not null and reviewed_at is not null and review_reason is not null)
  )
);

create table app_data_agent.fx_rate_versions (
  app_id uuid not null,
  environment text not null,
  fx_version_id uuid not null,
  source_candidate_id uuid not null,
  base_currency char(3) not null,
  quote_currency char(3) not null,
  rate numeric(38,18) not null check (rate > 0),
  approved_by uuid not null,
  approved_at timestamptz not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  primary key (app_id, environment, fx_version_id),
  unique (app_id, environment, source_candidate_id),
  foreign key (app_id, environment, source_candidate_id)
    references app_data_agent.fx_rate_candidates (app_id, environment, candidate_id)
    on delete restrict,
  check (effective_to is null or effective_to > effective_from)
);

create unique index fx_rate_one_active_version
  on app_data_agent.fx_rate_versions (app_id, environment, base_currency, quote_currency)
  where effective_to is null;

create table app_data_agent.pricing_control_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  operation_kind text not null check (operation_kind in ('UPSERT_MODEL','SET_MODEL_STATUS','DECIDE_PRICE','DECIDE_FX')),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, actor_principal_id, idempotency_key),
  unique (app_id, environment, operation_id)
);

create table app_data_agent.pricing_audit_log (
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
    references app_data_agent.pricing_control_operations (app_id, environment, operation_id)
    on delete restrict
);

create function app_data_agent.reject_pricing_history_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '42501', message = 'PRICING_HISTORY_IMMUTABLE';
end
$function$;

create function app_data_agent.close_pricing_version_interval()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'UPDATE'
    and pg_catalog.current_setting('data_agent.pricing_activation', true) = 'on'
    and old.effective_to is null
    and new.effective_to is not null
    and (pg_catalog.to_jsonb(old) - 'effective_to') = (pg_catalog.to_jsonb(new) - 'effective_to')
  then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'PRICING_HISTORY_IMMUTABLE';
end
$function$;

create trigger model_config_versions_immutable before update or delete on app_data_agent.model_config_versions
for each row execute function app_data_agent.reject_pricing_history_mutation();
create trigger model_price_versions_immutable before update or delete on app_data_agent.model_price_versions
for each row execute function app_data_agent.close_pricing_version_interval();
create trigger model_price_components_immutable before update or delete on app_data_agent.model_price_components
for each row execute function app_data_agent.reject_pricing_history_mutation();
create trigger fx_rate_versions_immutable before update or delete on app_data_agent.fx_rate_versions
for each row execute function app_data_agent.close_pricing_version_interval();
create trigger pricing_audit_log_immutable before update or delete on app_data_agent.pricing_audit_log
for each row execute function app_data_agent.reject_pricing_history_mutation();
