-- model_price_fx_control_migration_checksum: sha256:4be4799b20dc19d4e6e2d563529b4160f64bf5e3b191904345e69dec63c0a096
-- ============================================================
-- 10629: App-global model, price and FX control plane
-- ============================================================
-- Depends on: 20260725010628_app_data_agent_workspace_data_isolation
-- Clean-install only. No model Map or environment credential backfill.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'PRICING_CONTROL_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PRICING_CONTROL_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010628_app_data_agent_workspace_data_isolation';
  if not found then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BASELINE_10628_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010629_app_data_agent_model_price_fx_control'
  ) then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_MIGRATION_10629_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.app_users') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BASELINE_AUTHORITY_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
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
-- ============================================================
-- 10629: Super-admin authority and atomic control-plane commands
-- ============================================================

create function platform.resolve_super_admin_scope(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (app_id uuid, environment text)
language plpgsql volatile security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  perform platform.acquire_lifecycle_shared_lock(deployment.app_id, deployment.environment)
  from platform.deployment_mappings as deployment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active;

  return query
  select deployment.app_id, deployment.environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and app_user.system_role = 'SUPER_ADMIN';
  if not found then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;
end
$function$;

create function platform.list_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select catalog.* from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id and catalog.environment = scope_record.environment
  order by catalog.provider, catalog.model_id;
end
$function$;

create function platform.list_active_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  return query
  select catalog.*
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  join app_data_agent.model_catalog_entries as catalog
    on catalog.app_id = deployment.app_id and catalog.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and catalog.status = 'ACTIVE'
  order by catalog.is_system_default desc, catalog.provider, catalog.model_id;
end
$function$;

create function platform.list_model_price_candidates(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (candidate jsonb)
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select pg_catalog.jsonb_build_object(
    'candidate', pg_catalog.to_jsonb(price_candidate),
    'components', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component) order by component.kind, component.component_id)
      from app_data_agent.model_price_candidate_components as component
      where component.app_id = price_candidate.app_id
        and component.environment = price_candidate.environment
        and component.candidate_id = price_candidate.candidate_id
    ), '[]'::jsonb)
  )
  from app_data_agent.model_price_candidates as price_candidate
  where price_candidate.app_id = scope_record.app_id
    and price_candidate.environment = scope_record.environment
  order by price_candidate.fetched_at desc, price_candidate.candidate_id;
end
$function$;

create function platform.list_fx_rate_candidates(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.fx_rate_candidates
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select candidate.* from app_data_agent.fx_rate_candidates as candidate
  where candidate.app_id = scope_record.app_id and candidate.environment = scope_record.environment
  order by candidate.fetched_at desc, candidate.candidate_id;
end
$function$;

create function app_data_agent.model_price_chain_is_complete(
  requested_app_id uuid,
  requested_environment text,
  requested_provider text,
  requested_model_id text,
  requested_credential_ref jsonb
)
returns boolean language sql stable set search_path = '' as $function$
  select
    requested_credential_ref is not null
    and pg_catalog.jsonb_typeof(requested_credential_ref) = 'object'
    and requested_credential_ref ->> 'rotation_state' = 'ACTIVE'
    and exists (
      select 1
      from app_data_agent.model_price_versions as version
      where version.app_id = requested_app_id
        and version.environment = requested_environment
        and version.provider = requested_provider
        and version.model_id = requested_model_id
        and version.effective_from <= pg_catalog.clock_timestamp()
        and (version.effective_to is null or version.effective_to > pg_catalog.clock_timestamp())
        and exists (
          select 1 from app_data_agent.model_price_components as component
          where component.app_id = version.app_id
            and component.environment = version.environment
            and component.price_version_id = version.price_version_id
        )
        and not exists (
          select 1 from app_data_agent.model_price_components as component
          where component.app_id = version.app_id
            and component.environment = version.environment
            and component.price_version_id = version.price_version_id
            and component.currency <> 'CNY'
            and not exists (
              select 1 from app_data_agent.fx_rate_versions as fx
              where fx.app_id = version.app_id
                and fx.environment = version.environment
                and fx.base_currency = component.currency
                and fx.quote_currency = 'CNY'
                and fx.effective_from <= pg_catalog.clock_timestamp()
                and (fx.effective_to is null or fx.effective_to > pg_catalog.clock_timestamp())
            )
        )
    );
$function$;

create function app_data_agent.apply_model_catalog_command(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  existing_catalog app_data_agent.model_catalog_entries%rowtype;
  result_payload jsonb;
  snapshot_payload jsonb;
  input_hash text := platform.canonical_sha256(command);
  requested_version bigint;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if command ->> 'schema_version' not in ('model-catalog-upsert@1.0.0','model-catalog-status@1.0.0') then
    raise exception using errcode = '22023', message = 'MODEL_CATALOG_COMMAND_INVALID';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_control_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = command ->> 'idempotency_key';
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  select * into existing_catalog
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id
    and catalog.environment = scope_record.environment
    and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid
  for update;

  if command ->> 'schema_version' = 'model-catalog-upsert@1.0.0' then
    requested_version := (command ->> 'expected_config_version')::bigint;
    if (not found and requested_version <> 0)
      or (found and existing_catalog.config_version <> requested_version)
    then
      raise exception using errcode = '40001', message = 'MODEL_CONFIG_VERSION_CONFLICT';
    end if;
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, command ->> 'provider', command ->> 'model_id',
      nullif(command -> 'credential_ref', 'null'::jsonb)
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;
    if (command ->> 'is_system_default')::boolean then
      update app_data_agent.model_catalog_entries set is_system_default = false,
        updated_at = pg_catalog.clock_timestamp()
      where app_id = scope_record.app_id and environment = scope_record.environment
        and is_system_default;
    end if;
    insert into app_data_agent.model_catalog_entries (
      app_id, environment, model_profile_id, provider, model_id, display_name, base_url,
      capabilities, credential_ref, status, config_version, is_system_default, created_by
    ) values (
      scope_record.app_id, scope_record.environment, (command ->> 'model_profile_id')::uuid,
      command ->> 'provider', command ->> 'model_id', command ->> 'display_name',
      command ->> 'base_url', command -> 'capabilities',
      nullif(command -> 'credential_ref', 'null'::jsonb),
      command ->> 'status', requested_version + 1, (command ->> 'is_system_default')::boolean,
      requested_principal_id
    ) on conflict (app_id, environment, model_profile_id) do update set
      provider = excluded.provider, model_id = excluded.model_id,
      display_name = excluded.display_name, base_url = excluded.base_url,
      capabilities = excluded.capabilities, credential_ref = excluded.credential_ref,
      status = excluded.status, config_version = excluded.config_version,
      is_system_default = excluded.is_system_default, updated_at = pg_catalog.clock_timestamp();
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'MODEL_PROFILE_NOT_FOUND';
    end if;
    requested_version := (command ->> 'expected_config_version')::bigint;
    if existing_catalog.config_version <> requested_version then
      raise exception using errcode = '40001', message = 'MODEL_CONFIG_VERSION_CONFLICT';
    end if;
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, existing_catalog.provider,
      existing_catalog.model_id, existing_catalog.credential_ref
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;
    update app_data_agent.model_catalog_entries set
      status = command ->> 'status',
      is_system_default = case when command ->> 'status' = 'ACTIVE' then is_system_default else false end,
      config_version = config_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where app_id = scope_record.app_id and environment = scope_record.environment
      and model_profile_id = existing_catalog.model_profile_id;
  end if;

  select pg_catalog.to_jsonb(catalog) into result_payload
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id and catalog.environment = scope_record.environment
    and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid;
  snapshot_payload := result_payload - 'credential_ref';
  if result_payload -> 'credential_ref' is not null
    and result_payload -> 'credential_ref' <> 'null'::jsonb
  then
    snapshot_payload := snapshot_payload || pg_catalog.jsonb_build_object(
      'secret_refs', pg_catalog.jsonb_build_array(
        'secretref:' || (result_payload #>> '{credential_ref,secret_ref_id}')
      ),
      'reference_version', (result_payload #>> '{credential_ref,secret_version}')::bigint,
      'rotation_state', result_payload #>> '{credential_ref,rotation_state}'
    );
  end if;
  insert into app_data_agent.model_config_versions (
    app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'model_profile_id')::uuid,
    (result_payload ->> 'config_version')::bigint, snapshot_payload, requested_principal_id
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'idempotency_key',
    case when command ->> 'schema_version' = 'model-catalog-upsert@1.0.0'
      then 'UPSERT_MODEL' else 'SET_MODEL_STATUS' end,
    input_hash, result_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'schema_version', 'MODEL_PROFILE',
    command ->> 'model_profile_id', 'model catalog command', result_payload
  );
  return result_payload;
end
$function$;

create function app_data_agent.submit_pricing_sync(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  submission jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_sync_operations%rowtype;
  candidate jsonb;
  component jsonb;
  actual_candidate_id uuid;
  actual_candidate_ids jsonb := '[]'::jsonb;
  operation_result jsonb;
  input_hash text := platform.canonical_sha256(submission);
  source_kind text;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  source_kind := case submission ->> 'schema_version'
    when 'model-price-sync-submit@1.0.0' then 'MODEL_PRICE'
    when 'fx-rate-sync-submit@1.0.0' then 'FX_RATE'
    else null end;
  if source_kind is null
    or pg_catalog.octet_length(submission ->> 'raw_evidence') > 65536
    or pg_catalog.jsonb_typeof(submission -> 'candidates') <> 'array'
  then
    raise exception using errcode = '22023', message = 'PRICING_SYNC_INVALID';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_sync_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.operation_id = (submission ->> 'operation_id')::uuid;
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_SYNC_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  insert into app_data_agent.pricing_sync_operations (
    app_id, environment, operation_id, actor_principal_id, source_kind, source_adapter,
    source_url, input_hash, evidence_hash, parser_version, status, fetched_at,
    raw_evidence, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (submission ->> 'operation_id')::uuid,
    requested_principal_id, source_kind, submission ->> 'source_adapter',
    submission ->> 'source_url', input_hash, submission ->> 'evidence_hash',
    submission ->> 'parser_version', 'SUCCEEDED', (submission ->> 'fetched_at')::timestamptz,
    submission ->> 'raw_evidence', '{}'::jsonb
  );

  for candidate in select value from pg_catalog.jsonb_array_elements(submission -> 'candidates') loop
    if source_kind = 'MODEL_PRICE' then
      insert into app_data_agent.model_price_candidates (
        app_id, environment, candidate_id, provider, model_id, source_url, evidence_hash,
        parser_version, fetched_at, risk, source_operation_id
      ) values (
        scope_record.app_id, scope_record.environment, (candidate ->> 'candidate_id')::uuid,
        candidate ->> 'provider', candidate ->> 'model_id', submission ->> 'source_url',
        submission ->> 'evidence_hash', submission ->> 'parser_version',
        (submission ->> 'fetched_at')::timestamptz, candidate ->> 'risk',
        (submission ->> 'operation_id')::uuid
      ) on conflict (app_id, environment, provider, model_id, evidence_hash) do nothing;
      select price_candidate.candidate_id into strict actual_candidate_id
      from app_data_agent.model_price_candidates as price_candidate
      where price_candidate.app_id = scope_record.app_id
        and price_candidate.environment = scope_record.environment
        and price_candidate.provider = candidate ->> 'provider'
        and price_candidate.model_id = candidate ->> 'model_id'
        and price_candidate.evidence_hash = submission ->> 'evidence_hash';
      for component in select value from pg_catalog.jsonb_array_elements(candidate -> 'components') loop
        insert into app_data_agent.model_price_candidate_components (
          app_id, environment, candidate_id, component_id, kind, unit, unit_price,
          currency, tier_min_inclusive, tier_max_exclusive
        ) values (
          scope_record.app_id, scope_record.environment, actual_candidate_id,
          (component ->> 'component_id')::uuid, component ->> 'kind', component ->> 'unit',
          (component ->> 'unit_price')::numeric, component ->> 'currency',
          nullif(component ->> 'tier_min_inclusive', '')::numeric,
          nullif(component ->> 'tier_max_exclusive', '')::numeric
        ) on conflict do nothing;
      end loop;
    else
      insert into app_data_agent.fx_rate_candidates (
        app_id, environment, candidate_id, base_currency, quote_currency, rate,
        official_date, source_url, evidence_hash, parser_version, fetched_at, source_operation_id
      ) values (
        scope_record.app_id, scope_record.environment, (candidate ->> 'candidate_id')::uuid,
        candidate ->> 'base_currency', candidate ->> 'quote_currency',
        (candidate ->> 'rate')::numeric, (candidate ->> 'official_date')::date,
        submission ->> 'source_url', submission ->> 'evidence_hash',
        submission ->> 'parser_version', (submission ->> 'fetched_at')::timestamptz,
        (submission ->> 'operation_id')::uuid
      ) on conflict (app_id, environment, base_currency, quote_currency, official_date, evidence_hash)
        do nothing;
      select fx_candidate.candidate_id into strict actual_candidate_id
      from app_data_agent.fx_rate_candidates as fx_candidate
      where fx_candidate.app_id = scope_record.app_id
        and fx_candidate.environment = scope_record.environment
        and fx_candidate.base_currency = candidate ->> 'base_currency'
        and fx_candidate.quote_currency = candidate ->> 'quote_currency'
        and fx_candidate.official_date = (candidate ->> 'official_date')::date
        and fx_candidate.evidence_hash = submission ->> 'evidence_hash';
    end if;
    actual_candidate_ids := actual_candidate_ids || pg_catalog.jsonb_build_array(actual_candidate_id);
  end loop;
  operation_result := pg_catalog.jsonb_build_object(
    'operation_id', submission ->> 'operation_id',
    'source_kind', source_kind,
    'candidate_ids', actual_candidate_ids,
    'status', 'SUCCEEDED'
  );
  update app_data_agent.pricing_sync_operations set result_payload = operation_result
  where app_id = scope_record.app_id and environment = scope_record.environment
    and operation_id = (submission ->> 'operation_id')::uuid;
  return operation_result;
end
$function$;

create function app_data_agent.record_pricing_sync_failure(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  failure jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_sync_operations%rowtype;
  result_payload jsonb;
  input_hash text := platform.canonical_sha256(failure);
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if pg_catalog.octet_length(failure ->> 'raw_evidence') > 65536 then
    raise exception using errcode = '22023', message = 'PRICING_SYNC_EVIDENCE_TOO_LARGE';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_sync_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.operation_id = (failure ->> 'operation_id')::uuid;
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_SYNC_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', failure ->> 'operation_id', 'status', 'FAILED',
    'error_code', failure ->> 'error_code'
  );
  insert into app_data_agent.pricing_sync_operations (
    app_id, environment, operation_id, actor_principal_id, source_kind, source_adapter,
    source_url, input_hash, evidence_hash, parser_version, status, fetched_at,
    raw_evidence, result_payload, error_code
  ) values (
    scope_record.app_id, scope_record.environment, (failure ->> 'operation_id')::uuid,
    requested_principal_id, failure ->> 'source_kind', failure ->> 'source_adapter',
    failure ->> 'source_url', input_hash, null,
    failure ->> 'parser_version', 'FAILED', (failure ->> 'fetched_at')::timestamptz,
    coalesce(failure ->> 'raw_evidence', ''), result_payload, failure ->> 'error_code'
  );
  return result_payload;
end
$function$;

create function app_data_agent.decide_pricing_candidate(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  candidate_kind text,
  decision jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  price_candidate app_data_agent.model_price_candidates%rowtype;
  fx_candidate app_data_agent.fx_rate_candidates%rowtype;
  result_payload jsonb;
  input_hash text := platform.canonical_sha256(pg_catalog.jsonb_build_object(
    'candidate_kind', candidate_kind, 'decision', decision
  ));
  new_version_id uuid := pg_catalog.gen_random_uuid();
  requested_effective_from timestamptz;
  previous_effective_from timestamptz;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if candidate_kind not in ('MODEL_PRICE','FX_RATE')
    or decision ->> 'schema_version' <> 'pricing-candidate-decision@1.0.0'
    or decision ->> 'decision' not in ('APPROVE','REJECT')
  then
    raise exception using errcode = '22023', message = 'PRICING_DECISION_INVALID';
  end if;
  if decision ->> 'decision' = 'APPROVE' and decision ->> 'effective_from' is null then
    raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_FROM_REQUIRED';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_control_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = decision ->> 'idempotency_key';
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  insert into app_data_agent.pricing_control_state (app_id, environment)
  values (scope_record.app_id, scope_record.environment) on conflict do nothing;
  perform 1 from app_data_agent.pricing_control_state as state
  where state.app_id = scope_record.app_id and state.environment = scope_record.environment
  for update;

  if candidate_kind = 'MODEL_PRICE' then
    select * into strict price_candidate
    from app_data_agent.model_price_candidates as candidate
    where candidate.app_id = scope_record.app_id
      and candidate.environment = scope_record.environment
      and candidate.candidate_id = (decision ->> 'candidate_id')::uuid
    for update;
    if price_candidate.status <> 'PENDING_REVIEW' then
      raise exception using errcode = '55000', message = 'PRICING_CANDIDATE_ALREADY_DECIDED';
    end if;
    if decision ->> 'decision' = 'APPROVE' then
      requested_effective_from := (decision ->> 'effective_from')::timestamptz;
      select version.effective_from into previous_effective_from
      from app_data_agent.model_price_versions as version
      where version.app_id = scope_record.app_id and version.environment = scope_record.environment
        and version.provider = price_candidate.provider and version.model_id = price_candidate.model_id
        and version.effective_to is null for update;
      if found and previous_effective_from >= requested_effective_from then
        raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_INTERVAL_INVALID';
      end if;
      perform pg_catalog.set_config('data_agent.pricing_activation', 'on', true);
      update app_data_agent.model_price_versions set effective_to = requested_effective_from
      where app_id = scope_record.app_id and environment = scope_record.environment
        and provider = price_candidate.provider and model_id = price_candidate.model_id
        and effective_to is null;
      insert into app_data_agent.model_price_versions (
        app_id, environment, price_version_id, source_candidate_id, provider, model_id,
        approved_by, approved_at, effective_from
      ) values (
        scope_record.app_id, scope_record.environment, new_version_id,
        price_candidate.candidate_id, price_candidate.provider, price_candidate.model_id,
        requested_principal_id, pg_catalog.clock_timestamp(), requested_effective_from
      );
      insert into app_data_agent.model_price_components (
        app_id, environment, price_version_id, component_id, kind, unit, unit_price,
        currency, tier_min_inclusive, tier_max_exclusive
      ) select component.app_id, component.environment, new_version_id, component.component_id,
        component.kind, component.unit, component.unit_price, component.currency,
        component.tier_min_inclusive, component.tier_max_exclusive
      from app_data_agent.model_price_candidate_components as component
      where component.app_id = price_candidate.app_id
        and component.environment = price_candidate.environment
        and component.candidate_id = price_candidate.candidate_id;
    end if;
    update app_data_agent.model_price_candidates set
      status = case when decision ->> 'decision' = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
      reviewed_by = requested_principal_id, reviewed_at = pg_catalog.clock_timestamp(),
      review_reason = decision ->> 'reason'
    where app_id = price_candidate.app_id and environment = price_candidate.environment
      and candidate_id = price_candidate.candidate_id;
  else
    select * into strict fx_candidate
    from app_data_agent.fx_rate_candidates as candidate
    where candidate.app_id = scope_record.app_id
      and candidate.environment = scope_record.environment
      and candidate.candidate_id = (decision ->> 'candidate_id')::uuid
    for update;
    if fx_candidate.status <> 'PENDING_REVIEW' then
      raise exception using errcode = '55000', message = 'PRICING_CANDIDATE_ALREADY_DECIDED';
    end if;
    if decision ->> 'decision' = 'APPROVE' then
      requested_effective_from := (decision ->> 'effective_from')::timestamptz;
      select version.effective_from into previous_effective_from
      from app_data_agent.fx_rate_versions as version
      where version.app_id = scope_record.app_id and version.environment = scope_record.environment
        and version.base_currency = fx_candidate.base_currency
        and version.quote_currency = fx_candidate.quote_currency
        and version.effective_to is null for update;
      if found and previous_effective_from >= requested_effective_from then
        raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_INTERVAL_INVALID';
      end if;
      perform pg_catalog.set_config('data_agent.pricing_activation', 'on', true);
      update app_data_agent.fx_rate_versions set effective_to = requested_effective_from
      where app_id = scope_record.app_id and environment = scope_record.environment
        and base_currency = fx_candidate.base_currency
        and quote_currency = fx_candidate.quote_currency and effective_to is null;
      insert into app_data_agent.fx_rate_versions (
        app_id, environment, fx_version_id, source_candidate_id, base_currency,
        quote_currency, rate, approved_by, approved_at, effective_from
      ) values (
        scope_record.app_id, scope_record.environment, new_version_id,
        fx_candidate.candidate_id, fx_candidate.base_currency, fx_candidate.quote_currency,
        fx_candidate.rate, requested_principal_id, pg_catalog.clock_timestamp(), requested_effective_from
      );
    end if;
    update app_data_agent.fx_rate_candidates set
      status = case when decision ->> 'decision' = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
      reviewed_by = requested_principal_id, reviewed_at = pg_catalog.clock_timestamp(),
      review_reason = decision ->> 'reason'
    where app_id = fx_candidate.app_id and environment = fx_candidate.environment
      and candidate_id = fx_candidate.candidate_id;
  end if;

  if decision ->> 'decision' = 'APPROVE' then
    update app_data_agent.pricing_control_state set
      pricing_epoch = pricing_epoch + 1, updated_at = pg_catalog.clock_timestamp()
    where app_id = scope_record.app_id and environment = scope_record.environment;
  end if;
  result_payload := pg_catalog.jsonb_build_object(
    'candidate_kind', candidate_kind, 'candidate_id', decision ->> 'candidate_id',
    'decision', decision ->> 'decision',
    'version_id', case when decision ->> 'decision' = 'APPROVE' then new_version_id end
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (decision ->> 'operation_id')::uuid,
    requested_principal_id, decision ->> 'idempotency_key',
    case when candidate_kind = 'MODEL_PRICE' then 'DECIDE_PRICE' else 'DECIDE_FX' end,
    input_hash, result_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (decision ->> 'operation_id')::uuid,
    requested_principal_id, decision ->> 'decision', candidate_kind,
    decision ->> 'candidate_id', decision ->> 'reason', result_payload
  );
  return result_payload;
end
$function$;
-- ============================================================
-- 10629: Private ownership, RLS, exact grants and postconditions
-- ============================================================

alter table app_data_agent.pricing_control_state owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_catalog_entries owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_config_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_sync_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_candidates owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_candidate_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.fx_rate_candidates owner to data_agent_identity_rpc_owner;
alter table app_data_agent.fx_rate_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_control_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_audit_log owner to data_agent_identity_rpc_owner;

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'pricing_control_state','model_catalog_entries','model_config_versions',
    'pricing_sync_operations','model_price_candidates','model_price_candidate_components',
    'model_price_versions','model_price_components','fx_rate_candidates','fx_rate_versions',
    'pricing_control_operations','pricing_audit_log'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security', relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security', relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_identity_rpc_owner using (true) with check (true)',
      relation_name || '_pricing_rpc_policy', relation_name
    );
  end loop;
end
$rls$;

grant select on table platform.deployment_mappings, platform.app_environment_lifecycle
  to data_agent_identity_rpc_owner;
grant select on table app_data_agent.app_users to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_identity_rpc_owner;
grant select, insert, update, delete on table
  app_data_agent.pricing_control_state,
  app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log
to data_agent_identity_rpc_owner;

alter function app_data_agent.reject_pricing_history_mutation() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.close_pricing_version_interval() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_super_admin_scope(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_model_catalog(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_active_model_catalog(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_model_price_candidates(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_fx_rate_candidates(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.pricing_control_state,
  app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function platform.resolve_super_admin_scope(uuid,uuid) from public;
revoke all on function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb)
  from public;
revoke all on function platform.list_model_catalog(uuid,uuid) from public;
revoke all on function platform.list_active_model_catalog(uuid,uuid) from public;
revoke all on function platform.list_model_price_candidates(uuid,uuid) from public;
revoke all on function platform.list_fx_rate_candidates(uuid,uuid) from public;
revoke all on function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) from public;

grant execute on function platform.list_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_active_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_model_price_candidates(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_fx_rate_candidates(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'pricing_control_state','model_catalog_entries','model_config_versions',
    'pricing_sync_operations','model_price_candidates','model_price_candidate_components',
    'model_price_versions','model_price_components','fx_rate_candidates','fx_rate_versions',
    'pricing_control_operations','pricing_audit_log'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('app_data_agent.%I', relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.resolve_super_admin_scope(uuid,uuid)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_AUTHORITY_HELPER_EXPOSED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10629: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010629_app_data_agent_model_price_fx_control',
  'sha256:4be4799b20dc19d4e6e2d563529b4160f64bf5e3b191904345e69dec63c0a096'
);

commit;
