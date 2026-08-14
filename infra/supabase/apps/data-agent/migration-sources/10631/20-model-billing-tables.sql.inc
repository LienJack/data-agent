-- ============================================================
-- 10631: Deployment mode, bill projection and immutable facts
-- ============================================================

create table app_data_agent.billing_runtime_state (
  app_id uuid not null,
  environment text not null,
  deployment_id uuid not null,
  mode text not null default 'SHADOW' check (mode in ('SHADOW','ENFORCED')),
  epoch bigint not null default 1 check (epoch >= 1),
  approved_by uuid,
  approved_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, deployment_id),
  foreign key (deployment_id)
    references platform.deployment_mappings (deployment_id) on delete restrict,
  foreign key (app_id, environment, approved_by)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  check ((approved_by is null) = (approved_at is null))
);

insert into app_data_agent.billing_runtime_state (app_id, environment, deployment_id)
select mapping.app_id, mapping.environment, mapping.deployment_id
from platform.deployment_mappings as mapping
where mapping.is_active;

create table app_data_agent.model_bills (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  bill_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  run_id uuid not null,
  conversation_id uuid,
  datasource_id uuid,
  model_profile_id uuid not null,
  model_config_version bigint not null check (model_config_version >= 1),
  provider text not null check (provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')),
  model_id text not null check (pg_catalog.length(model_id) between 1 and 256),
  funding_type text not null check (funding_type in ('USER_CREDITS','SYSTEM_FUNDED')),
  billing_mode text not null check (billing_mode in ('SHADOW','ENFORCED')),
  state text not null default 'RESERVED'
    check (state in ('RESERVED','SETTLED','RELEASED','REVIEW_REQUIRED')),
  hold_id uuid,
  price_version_id uuid not null,
  fx_version_id uuid,
  official_currency char(3) not null check (official_currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(38,18) not null check (fx_rate > 0),
  request_budget jsonb not null check (
    pg_catalog.jsonb_typeof(request_budget) = 'object'
    and request_budget ?& array[
      'input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','tool_calls'
    ]
  ),
  reserved_microcredits bigint not null default 0 check (reserved_microcredits >= 0),
  actual_usage jsonb check (actual_usage is null or pg_catalog.jsonb_typeof(actual_usage) = 'object'),
  official_cost numeric(38,18) not null default 0 check (official_cost >= 0),
  cny_cost numeric(38,18) not null default 0 check (cny_cost >= 0),
  charged_microcredits bigint not null default 0 check (charged_microcredits >= 0),
  rounding_delta_microcredits bigint not null default 0,
  formula_version text not null default 'model-billing-formula@1.0.0'
    check (formula_version = 'model-billing-formula@1.0.0'),
  review_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  settled_at timestamptz,
  primary key (app_id, environment, bill_id),
  unique (app_id, environment, invocation_id),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id, principal_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    ) on delete restrict,
  foreign key (app_id, environment, model_profile_id, model_config_version)
    references app_data_agent.model_config_versions (
      app_id, environment, model_profile_id, config_version
    ) on delete restrict,
  foreign key (app_id, environment, price_version_id)
    references app_data_agent.model_price_versions (app_id, environment, price_version_id)
    on delete restrict,
  foreign key (app_id, environment, fx_version_id)
    references app_data_agent.fx_rate_versions (app_id, environment, fx_version_id)
    on delete restrict,
  foreign key (app_id, environment, hold_id)
    references app_data_agent.credit_holds (app_id, environment, hold_id)
    on delete restrict deferrable initially deferred,
  check (
    (state = 'RESERVED' and settled_at is null and actual_usage is null and review_reason is null)
    or (state = 'SETTLED' and settled_at is not null and actual_usage is not null and review_reason is null)
    or (state = 'RELEASED' and settled_at is not null and actual_usage is null and review_reason is null)
    or (state = 'REVIEW_REQUIRED' and settled_at is null and review_reason is not null)
  ),
  check (
    (funding_type = 'USER_CREDITS' and billing_mode = 'ENFORCED' and hold_id is not null)
    or (funding_type = 'SYSTEM_FUNDED' and hold_id is null)
    or (billing_mode = 'SHADOW' and hold_id is null)
  )
);

create index model_bills_principal_timeline
  on app_data_agent.model_bills (app_id, environment, principal_id, created_at desc, bill_id desc);
create index model_bills_workspace_cost
  on app_data_agent.model_bills (
    app_id, tenant_id, environment, run_id, conversation_id, funding_type, state
  );
create index model_bills_review_queue
  on app_data_agent.model_bills (app_id, environment, created_at)
  where state = 'REVIEW_REQUIRED';

create table app_data_agent.model_bill_price_components (
  app_id uuid not null,
  environment text not null,
  bill_id uuid not null,
  component_id uuid not null,
  kind text not null check (
    kind in ('INPUT_TOKENS','OUTPUT_TOKENS','CACHE_READ_TOKENS','CACHE_WRITE_TOKENS','TOOL_CALLS')
  ),
  unit text not null check (unit in ('PER_MILLION_TOKENS','PER_THOUSAND_TOKENS','PER_CALL')),
  unit_price numeric(38,18) not null check (unit_price > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tier_min_inclusive numeric(38,0),
  tier_max_exclusive numeric(38,0),
  primary key (app_id, environment, bill_id, component_id),
  foreign key (app_id, environment, bill_id)
    references app_data_agent.model_bills (app_id, environment, bill_id) on delete restrict
);

create table app_data_agent.model_bill_events (
  app_id uuid not null,
  environment text not null,
  bill_id uuid not null,
  event_sequence bigint not null check (event_sequence >= 1),
  event_kind text not null check (
    event_kind in ('AUTHORIZED','SETTLED','RELEASED','REVIEW_REQUIRED','REVIEW_SETTLED','REVIEW_RELEASED')
  ),
  actor_principal_id uuid not null,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 500),
  details jsonb not null check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, bill_id, event_sequence),
  foreign key (app_id, environment, bill_id)
    references app_data_agent.model_bills (app_id, environment, bill_id) on delete restrict
);

create table app_data_agent.model_billing_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  operation_kind text not null check (operation_kind in ('AUTHORIZE','FINALIZE','REVIEW','SET_MODE')),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_payload jsonb not null check (pg_catalog.jsonb_typeof(input_payload) = 'object'),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, operation_id),
  unique (app_id, environment, actor_principal_id, idempotency_key)
);

create table app_data_agent.billing_reconciliation_findings (
  app_id uuid not null,
  environment text not null,
  reconciliation_id uuid not null,
  finding_sequence bigint not null check (finding_sequence >= 1),
  finding_kind text not null check (
    finding_kind in ('MISSING_BILL','HOLD_LEDGER_MISMATCH','PRICE_SNAPSHOT_MISSING','REVIEW_OPEN')
  ),
  severity text not null check (severity in ('WARNING','ERROR')),
  invocation_id uuid,
  bill_id uuid,
  details jsonb not null check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, reconciliation_id, finding_sequence)
);

create function app_data_agent.guard_model_billing_projection_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  if pg_catalog.current_setting('data_agent.model_billing_projection_write', true) <> 'on' then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_PROJECTION_WRITE_REQUIRED';
  end if;
  return new;
end
$function$;

create trigger billing_runtime_state_projection_guard
before update or delete on app_data_agent.billing_runtime_state
for each row execute function app_data_agent.guard_model_billing_projection_mutation();
create trigger model_bills_projection_guard
before update or delete on app_data_agent.model_bills
for each row execute function app_data_agent.guard_model_billing_projection_mutation();

create trigger model_bill_price_components_immutable
before update or delete on app_data_agent.model_bill_price_components
for each row execute function app_data_agent.reject_billing_fact_mutation();
create trigger model_bill_events_immutable
before update or delete on app_data_agent.model_bill_events
for each row execute function app_data_agent.reject_billing_fact_mutation();
create trigger model_billing_operations_immutable
before update or delete on app_data_agent.model_billing_operations
for each row execute function app_data_agent.reject_billing_fact_mutation();
create trigger billing_reconciliation_findings_immutable
before update or delete on app_data_agent.billing_reconciliation_findings
for each row execute function app_data_agent.reject_billing_fact_mutation();
