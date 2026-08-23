-- model_billing_settlement_migration_checksum: sha256:949216916bff7943361ae214fc60112b6ec9d07c326ff8048afd0c08435aaa7c
-- ============================================================
-- 10631: Model billing authorization, settlement and attribution
-- Depends on: 20260725010630_app_data_agent_credit_ledger
-- Clean-install only. No historical invocation backfill is supported.
-- ============================================================

begin;

do $bootstrap$
declare baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'MODEL_BILLING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010630_app_data_agent_credit_ledger';
  if not found then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_BASELINE_10630_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010631_app_data_agent_model_billing_settlement'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_MIGRATION_10631_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.research_invocation_outcome_usage') is null
    or pg_catalog.to_regclass('app_data_agent.model_price_versions') is null
    or pg_catalog.to_regclass('app_data_agent.credit_holds') is null
  then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_BASELINE_AUTHORITY_MISSING';
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
-- ============================================================
-- 10631: Snapshot calculation, payloads and read authority
-- ============================================================

create function app_data_agent.model_bill_payload(bill app_data_agent.model_bills)
returns jsonb language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version', 'model-billing-bill@1.0.0',
    'bill_id', bill.bill_id,
    'app_id', bill.app_id,
    'environment', bill.environment,
    'principal_id', bill.principal_id,
    'workspace_id', bill.tenant_id,
    'invocation_id', bill.invocation_id,
    'reservation_id', bill.reservation_id,
    'run_id', bill.run_id,
    'conversation_id', bill.conversation_id,
    'datasource_id', bill.datasource_id,
    'model_profile_id', bill.model_profile_id,
    'model_config_version', bill.model_config_version,
    'provider', bill.provider,
    'model_id', bill.model_id,
    'funding_type', bill.funding_type,
    'billing_mode', bill.billing_mode,
    'state', bill.state,
    'hold_id', bill.hold_id,
    'price_version_id', bill.price_version_id,
    'fx_version_id', bill.fx_version_id,
    'official_currency', bill.official_currency,
    'fx_rate', bill.fx_rate::text,
    'request_budget', bill.request_budget,
    'reserved_microcredits', bill.reserved_microcredits::text,
    'usage', bill.actual_usage,
    'official_cost', bill.official_cost::text,
    'cny_cost', bill.cny_cost::text,
    'charged_microcredits', bill.charged_microcredits::text,
    'rounding_delta_microcredits', bill.rounding_delta_microcredits::text,
    'formula_version', bill.formula_version,
    'review_reason', bill.review_reason,
    'created_at', bill.created_at,
    'settled_at', bill.settled_at
  );
$function$;

create function app_data_agent.calculate_model_bill_cost(
  requested_app_id uuid,
  requested_environment text,
  requested_bill_id uuid,
  requested_usage jsonb,
  requested_rounding text
)
returns table (
  official_cost numeric,
  cny_cost numeric,
  microcredits bigint,
  rounding_delta_microcredits bigint
)
language plpgsql stable set search_path = '' as $function$
declare
  bill app_data_agent.model_bills%rowtype;
  dimension text;
  usage_key text;
  requested_quantity numeric;
  covered_quantity numeric;
  official_value numeric := 0;
  cny_value numeric;
  charged_value numeric;
  rounded_from_cny numeric;
begin
  if requested_rounding not in ('CEIL','HALF_UP')
    or pg_catalog.jsonb_typeof(requested_usage) <> 'object'
    or not requested_usage ?& array[
      'input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','tool_calls'
    ]
  then
    raise exception using errcode = '22023', message = 'MODEL_BILLING_USAGE_INVALID';
  end if;
  select * into strict bill from app_data_agent.model_bills as current_bill
  where current_bill.app_id = requested_app_id
    and current_bill.environment = requested_environment
    and current_bill.bill_id = requested_bill_id;

  foreach dimension in array array[
    'INPUT_TOKENS','OUTPUT_TOKENS','CACHE_READ_TOKENS','CACHE_WRITE_TOKENS','TOOL_CALLS'
  ] loop
    usage_key := case dimension
      when 'INPUT_TOKENS' then 'input_tokens'
      when 'OUTPUT_TOKENS' then 'output_tokens'
      when 'CACHE_READ_TOKENS' then 'cache_read_tokens'
      when 'CACHE_WRITE_TOKENS' then 'cache_write_tokens'
      else 'tool_calls'
    end;
    if requested_usage ->> usage_key !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '22023', message = 'MODEL_BILLING_USAGE_INVALID';
    end if;
    requested_quantity := (requested_usage ->> usage_key)::numeric;
    select coalesce(pg_catalog.sum(
      greatest(
        least(
          requested_quantity,
          coalesce(component.tier_max_exclusive, requested_quantity)
        ) - coalesce(component.tier_min_inclusive, 0),
        0
      )
    ), 0) into covered_quantity
    from app_data_agent.model_bill_price_components as component
    where component.app_id = bill.app_id and component.environment = bill.environment
      and component.bill_id = bill.bill_id and component.kind = dimension;
    if requested_quantity > 0 and covered_quantity <> requested_quantity then
      raise exception using errcode = '22023', message = 'MODEL_BILLING_DIMENSION_UNPRICED';
    end if;
  end loop;

  select coalesce(pg_catalog.sum(
    component.unit_price
    * greatest(
        least(
          (requested_usage ->> case component.kind
            when 'INPUT_TOKENS' then 'input_tokens'
            when 'OUTPUT_TOKENS' then 'output_tokens'
            when 'CACHE_READ_TOKENS' then 'cache_read_tokens'
            when 'CACHE_WRITE_TOKENS' then 'cache_write_tokens'
            else 'tool_calls'
          end)::numeric,
          coalesce(
            component.tier_max_exclusive,
            (requested_usage ->> case component.kind
              when 'INPUT_TOKENS' then 'input_tokens'
              when 'OUTPUT_TOKENS' then 'output_tokens'
              when 'CACHE_READ_TOKENS' then 'cache_read_tokens'
              when 'CACHE_WRITE_TOKENS' then 'cache_write_tokens'
              else 'tool_calls'
            end)::numeric
          )
        ) - coalesce(component.tier_min_inclusive, 0),
        0
      )
    / case component.unit
        when 'PER_MILLION_TOKENS' then 1000000::numeric
        when 'PER_THOUSAND_TOKENS' then 1000::numeric
        else 1::numeric
      end
  ), 0) into official_value
  from app_data_agent.model_bill_price_components as component
  where component.app_id = bill.app_id and component.environment = bill.environment
    and component.bill_id = bill.bill_id;

  cny_value := official_value * bill.fx_rate;
  charged_value := case requested_rounding
    when 'CEIL' then pg_catalog.ceil(cny_value * 100000000::numeric)
    else pg_catalog.floor(cny_value * 100000000::numeric + 0.5)
  end;
  if charged_value > 9223372036854775807::numeric then
    raise exception using errcode = '22003', message = 'MICROCREDIT_AMOUNT_OVERFLOW';
  end if;
  rounded_from_cny := pg_catalog.floor(
    pg_catalog.round(cny_value, 18) * 100000000::numeric + 0.5
  );
  return query select
    pg_catalog.round(official_value, 18),
    pg_catalog.round(cny_value, 18),
    charged_value::bigint,
    (charged_value - rounded_from_cny)::bigint;
end
$function$;

create function platform.get_billing_runtime_state(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record; runtime app_data_agent.billing_runtime_state%rowtype;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  select * into strict runtime from app_data_agent.billing_runtime_state as state
  where state.app_id = scope_record.app_id and state.environment = scope_record.environment
    and state.deployment_id = requested_deployment_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','billing-runtime-state@1.0.0',
    'app_id',runtime.app_id,'environment',runtime.environment,'deployment_id',runtime.deployment_id,
    'mode',runtime.mode,'epoch',runtime.epoch,'approved_by',runtime.approved_by,
    'approved_at',runtime.approved_at,'updated_at',runtime.updated_at
  );
end
$function$;

create function platform.list_own_model_bills(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_principal_id);
  return query select app_data_agent.model_bill_payload(bill)
  from app_data_agent.model_bills as bill
  where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
    and bill.principal_id = requested_principal_id
  order by bill.created_at desc, bill.bill_id desc;
end
$function$;

create function platform.list_model_bills(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_state text default null
)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query select app_data_agent.model_bill_payload(bill)
  from app_data_agent.model_bills as bill
  where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
    and (requested_state is null or bill.state = requested_state)
  order by bill.created_at desc, bill.bill_id desc;
end
$function$;

create function platform.list_model_billing_costs(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (
  workspace_id uuid,
  run_id uuid,
  conversation_id uuid,
  funding_type text,
  bill_count bigint,
  settled_count bigint,
  review_count bigint,
  cny_cost numeric,
  charged_microcredits bigint
)
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query select bill.tenant_id, bill.run_id, bill.conversation_id, bill.funding_type,
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (where bill.state = 'SETTLED')::bigint,
    pg_catalog.count(*) filter (where bill.state = 'REVIEW_REQUIRED')::bigint,
    coalesce(pg_catalog.sum(bill.cny_cost),0),
    coalesce(pg_catalog.sum(bill.charged_microcredits),0)::bigint
  from app_data_agent.model_bills as bill
  where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
  group by bill.tenant_id, bill.run_id, bill.conversation_id, bill.funding_type
  order by pg_catalog.sum(bill.cny_cost) desc, bill.tenant_id, bill.run_id;
end
$function$;
-- ============================================================
-- 10631: Narrow read bridge from Research authority to billing
-- ============================================================

create function app_data_agent.resolve_model_billing_reservation_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_reservation_id uuid,
  requested_run_id uuid,
  requested_principal_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  reservation_record record;
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  select reservation.reservation_id,reservation.run_id,reservation.principal_id
  into strict reservation_record
  from app_data_agent.research_resource_reservations as reservation
  where reservation.app_id = requested_app_id
    and reservation.tenant_id = requested_tenant_id
    and reservation.environment = requested_environment
    and reservation.reservation_id = requested_reservation_id
    and reservation.run_id = requested_run_id
    and reservation.principal_id = requested_principal_id
    and reservation.resource_kind = 'MODEL'
    and reservation.state = 'RESERVED'
    and reservation.invocation_id is null
  for share;
  return pg_catalog.jsonb_build_object(
    'reservation_id',reservation_record.reservation_id,
    'run_id',reservation_record.run_id,
    'principal_id',reservation_record.principal_id
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'MODEL_BILLING_RESERVATION_AUTHORITY_MISSING';
end
$function$;

create function app_data_agent.require_model_billing_run_binding(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_run_id uuid,
  requested_principal_id uuid,
  requested_datasource_id uuid,
  requested_conversation_id uuid
)
returns boolean language plpgsql volatile security definer set search_path = '' as $function$
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
    or requested_principal_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RUN_BINDING_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from app_data_agent.workspace_run_bindings as binding
    where binding.app_id = requested_app_id
      and binding.tenant_id = requested_tenant_id
      and binding.environment = requested_environment
      and binding.run_id = requested_run_id
      and binding.principal_id = requested_principal_id
      and binding.datasource_id = requested_datasource_id
      and binding.conversation_id is not distinct from requested_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RUN_BINDING_INVALID';
  end if;
  return true;
end
$function$;

create function app_data_agent.resolve_model_billing_terminal_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_invocation_id uuid,
  requested_reservation_id uuid,
  requested_run_id uuid,
  requested_principal_id uuid,
  requested_usage_record_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  invocation_state text := null;
  usage_outcome text := null;
  usage_actual jsonb := null;
  invocation_found boolean := false;
  usage_found boolean := false;
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  select invocation.state
  into invocation_state
  from app_data_agent.research_invocation_commits as invocation
  where invocation.app_id = requested_app_id
    and invocation.tenant_id = requested_tenant_id
    and invocation.environment = requested_environment
    and invocation.invocation_id = requested_invocation_id
    and invocation.reservation_id = requested_reservation_id
    and invocation.run_id = requested_run_id
    and invocation.principal_id = requested_principal_id
    and invocation.resource_kind = 'MODEL'
  for share;
  invocation_found := found;

  if requested_usage_record_id is not null then
    select usage.outcome,usage.actual_json
    into usage_outcome,usage_actual
    from app_data_agent.research_invocation_outcome_usage as usage
    where usage.app_id = requested_app_id
      and usage.tenant_id = requested_tenant_id
      and usage.environment = requested_environment
      and usage.record_id = requested_usage_record_id
      and usage.run_id = requested_run_id
      and usage.principal_id = requested_principal_id
      and usage.invocation_id = requested_invocation_id
      and usage.reservation_id = requested_reservation_id
      and usage.resource_kind = 'MODEL';
    usage_found := found;
  end if;

  return pg_catalog.jsonb_build_object(
    'invocation_found',invocation_found,
    'invocation_state',invocation_state,
    'usage_found',usage_found,
    'usage_outcome',usage_outcome,
    'actual',usage_actual
  );
end
$function$;

create function app_data_agent.list_model_billing_terminal_invocations(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text
)
returns table (invocation_id uuid)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  return query
  select invocation.invocation_id
  from app_data_agent.research_invocation_commits as invocation
  where invocation.app_id = requested_app_id
    and invocation.tenant_id = requested_tenant_id
    and invocation.environment = requested_environment
    and invocation.resource_kind = 'MODEL'
    and invocation.state in ('COMPLETED','FAILED');
end
$function$;
-- ============================================================
-- 10631: Provider preflight authorization and atomic hold
-- ============================================================

create function app_data_agent.authorize_model_billing(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  runtime app_data_agent.billing_runtime_state%rowtype;
  reservation_payload jsonb;
  model_record app_data_agent.model_catalog_entries%rowtype;
  price_record app_data_agent.model_price_versions%rowtype;
  fx_record app_data_agent.fx_rate_versions%rowtype;
  bill app_data_agent.model_bills%rowtype;
  cost_record record;
  operation app_data_agent.model_billing_operations%rowtype;
  input_hash text := platform.canonical_sha256(command);
  funding text;
  price_currency text;
  hold_payload jsonb := null;
  account_payload jsonb := null;
  result_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'model-billing-authorize@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.jsonb_typeof(command -> 'request_budget') <> 'object'
    or not (command -> 'request_budget') ?& array[
      'input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','tool_calls'
    ]
  then
    raise exception using errcode = '22023', message = 'MODEL_BILLING_AUTHORIZATION_INVALID';
  end if;
  select * into strict scope_record from platform.resolve_workspace_authority(
    requested_deployment_id, (command ->> 'workspace_id')::uuid, requested_principal_id, true
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_principal_id,
      command ->> 'idempotency_key'
    )::text, 0
  ));
  select * into operation from app_data_agent.model_billing_operations as existing
  where existing.app_id = scope_record.app_id and existing.environment = scope_record.environment
    and existing.actor_principal_id = requested_principal_id
    and existing.idempotency_key = command ->> 'idempotency_key'
  for update;
  if found then
    if operation.input_hash <> input_hash or operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'MODEL_BILLING_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;

  insert into app_data_agent.billing_runtime_state (app_id, environment, deployment_id)
  values (scope_record.app_id, scope_record.environment, requested_deployment_id)
  on conflict (app_id, environment, deployment_id) do nothing;
  select * into strict runtime from app_data_agent.billing_runtime_state as current_runtime
  where current_runtime.app_id = scope_record.app_id
    and current_runtime.environment = scope_record.environment
    and current_runtime.deployment_id = requested_deployment_id;

  perform pg_catalog.set_config('data_agent.app_id',scope_record.app_id::text,true);
  perform pg_catalog.set_config('data_agent.tenant_id',scope_record.tenant_id::text,true);
  perform pg_catalog.set_config('data_agent.environment',scope_record.environment,true);
  perform pg_catalog.set_config('data_agent.principal_id',requested_principal_id::text,true);
  perform pg_catalog.set_config('data_agent.deployment_id',requested_deployment_id::text,true);
  perform pg_catalog.set_config('data_agent.role',scope_record.capability_role,true);
  reservation_payload := app_data_agent.resolve_model_billing_reservation_authority(
    scope_record.app_id,scope_record.tenant_id,scope_record.environment,
    (command ->> 'reservation_id')::uuid,(command ->> 'run_id')::uuid,
    requested_principal_id
  );
  perform app_data_agent.require_model_billing_run_binding(
    scope_record.app_id,scope_record.tenant_id,scope_record.environment,
    (reservation_payload ->> 'run_id')::uuid,requested_principal_id,
    (command ->> 'datasource_id')::uuid,(command ->> 'conversation_id')::uuid
  );

  select * into strict model_record from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id and catalog.environment = scope_record.environment
    and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid
    and catalog.config_version = (command ->> 'expected_model_config_version')::bigint
    and catalog.status = 'ACTIVE';
  select * into strict price_record from app_data_agent.model_price_versions as price
  where price.app_id = scope_record.app_id and price.environment = scope_record.environment
    and price.provider = model_record.provider and price.model_id = model_record.model_id
    and price.effective_from <= pg_catalog.clock_timestamp()
    and (price.effective_to is null or price.effective_to > pg_catalog.clock_timestamp())
  order by price.effective_from desc limit 1;
  select pg_catalog.min(component.currency)::text into strict price_currency
  from app_data_agent.model_price_components as component
  where component.app_id = price_record.app_id and component.environment = price_record.environment
    and component.price_version_id = price_record.price_version_id
  having pg_catalog.count(*) > 0 and pg_catalog.count(distinct component.currency) = 1;
  if price_currency = 'CNY' then
    fx_record.fx_version_id := null;
    fx_record.rate := 1;
  else
    select * into strict fx_record from app_data_agent.fx_rate_versions as fx
    where fx.app_id = scope_record.app_id and fx.environment = scope_record.environment
      and fx.base_currency = price_currency and fx.quote_currency = 'CNY'
      and fx.effective_from <= pg_catalog.clock_timestamp()
      and (fx.effective_to is null or fx.effective_to > pg_catalog.clock_timestamp())
    order by fx.effective_from desc limit 1;
  end if;
  funding := case when scope_record.system_role = 'SUPER_ADMIN'
    then 'SYSTEM_FUNDED' else 'USER_CREDITS' end;

  insert into app_data_agent.model_bills (
    app_id, tenant_id, environment, bill_id, principal_id, invocation_id, reservation_id,
    run_id, conversation_id, datasource_id, model_profile_id, model_config_version,
    provider, model_id, funding_type, billing_mode, hold_id, price_version_id,
    fx_version_id, official_currency, fx_rate, request_budget
  ) values (
    scope_record.app_id, scope_record.tenant_id, scope_record.environment,
    (command ->> 'bill_id')::uuid, requested_principal_id,
    (command ->> 'invocation_id')::uuid,
    (reservation_payload ->> 'reservation_id')::uuid,
    (reservation_payload ->> 'run_id')::uuid,
    (command ->> 'conversation_id')::uuid, (command ->> 'datasource_id')::uuid,
    model_record.model_profile_id, model_record.config_version, model_record.provider,
    model_record.model_id, funding, runtime.mode,
    case when runtime.mode = 'ENFORCED' and funding = 'USER_CREDITS'
      then (command ->> 'bill_id')::uuid else null end,
    price_record.price_version_id, fx_record.fx_version_id, price_currency, fx_record.rate,
    command -> 'request_budget'
  ) returning * into bill;
  insert into app_data_agent.model_bill_price_components (
    app_id, environment, bill_id, component_id, kind, unit, unit_price, currency,
    tier_min_inclusive, tier_max_exclusive
  ) select component.app_id, component.environment, bill.bill_id, component.component_id,
    component.kind, component.unit, component.unit_price, component.currency,
    component.tier_min_inclusive, component.tier_max_exclusive
  from app_data_agent.model_price_components as component
  where component.app_id = price_record.app_id and component.environment = price_record.environment
    and component.price_version_id = price_record.price_version_id;
  select * into strict cost_record from app_data_agent.calculate_model_bill_cost(
    bill.app_id, bill.environment, bill.bill_id, bill.request_budget, 'CEIL'
  );
  if cost_record.microcredits <= 0 then
    raise exception using errcode = '22023', message = 'MODEL_BILLING_ZERO_RESERVATION_INVALID';
  end if;
  perform pg_catalog.set_config('data_agent.model_billing_projection_write', 'on', true);
  update app_data_agent.model_bills as current_bill set
    reserved_microcredits = cost_record.microcredits
  where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
    and current_bill.bill_id = bill.bill_id
  returning current_bill.* into bill;

  if bill.hold_id is not null then
    select app_data_agent.reserve_credit_hold(
      requested_deployment_id,
      requested_principal_id,
      pg_catalog.jsonb_build_object(
        'schema_version','credit-hold-reserve@1.0.0',
        'operation_id',bill.invocation_id,
        'idempotency_key','model-hold:' || bill.bill_id::text,
        'hold_id',bill.hold_id,
        'invocation_id',bill.invocation_id,
        'workspace_id',bill.tenant_id,
        'reserved_microcredits',bill.reserved_microcredits::text,
        'expected_account_version',command -> 'expected_account_version'
      )
    ) into strict hold_payload;
    account_payload := hold_payload -> 'account';
    hold_payload := hold_payload -> 'hold';
  end if;
  insert into app_data_agent.model_bill_events (
    app_id, environment, bill_id, event_sequence, event_kind, actor_principal_id, reason, details
  ) values (
    bill.app_id, bill.environment, bill.bill_id, 1, 'AUTHORIZED', requested_principal_id,
    'provider preflight authorized', pg_catalog.jsonb_build_object(
      'billing_mode',bill.billing_mode,'funding_type',bill.funding_type,
      'reserved_microcredits',bill.reserved_microcredits::text,
      'price_version_id',bill.price_version_id,'fx_version_id',bill.fx_version_id
    )
  );
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id',command ->> 'operation_id',
    'bill',app_data_agent.model_bill_payload(bill),
    'provider_call_allowed',true,
    'hold',hold_payload,
    'account',account_payload
  );
  insert into app_data_agent.model_billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    bill.app_id, bill.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'idempotency_key', 'AUTHORIZE', input_hash,
    command, result_payload
  );
  return result_payload;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'MODEL_BILLING_PRICE_OR_AUTHORITY_MISSING';
end
$function$;
-- ============================================================
-- 10631: Terminal settlement, release and review
-- ============================================================

create function app_data_agent.finalize_model_billing(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  bill app_data_agent.model_bills%rowtype;
  terminal_payload jsonb;
  hold_record app_data_agent.credit_holds%rowtype;
  account app_data_agent.credit_accounts%rowtype;
  operation app_data_agent.model_billing_operations%rowtype;
  cost_record record;
  input_hash text := platform.canonical_sha256(command);
  actual_usage jsonb := null;
  terminal_kind text;
  next_event bigint;
  review_marker text := null;
  balance_before bigint;
  hold_payload jsonb := null;
  account_payload jsonb := null;
  result_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'model-billing-finalize@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or command ->> 'terminal_kind' not in (
      'COMPLETED','FAILED_WITH_USAGE','CANCELLED_BEFORE_START','OUTCOME_UNKNOWN'
    )
  then
    raise exception using errcode = '22023', message = 'MODEL_BILLING_FINALIZE_INVALID';
  end if;
  terminal_kind := command ->> 'terminal_kind';
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_principal_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_principal_id,
      command ->> 'idempotency_key'
    )::text, 0
  ));
  select * into operation from app_data_agent.model_billing_operations as existing
  where existing.app_id = scope_record.app_id and existing.environment = scope_record.environment
    and existing.actor_principal_id = requested_principal_id
    and existing.idempotency_key = command ->> 'idempotency_key'
  for update;
  if found then
    if operation.input_hash <> input_hash or operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'MODEL_BILLING_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;
  select * into strict bill from app_data_agent.model_bills as current_bill
  where current_bill.app_id = scope_record.app_id
    and current_bill.environment = scope_record.environment
    and current_bill.bill_id = (command ->> 'bill_id')::uuid
    and (
      current_bill.principal_id = requested_principal_id
      or scope_record.system_role = 'SUPER_ADMIN'
    )
  for update;
  if bill.state <> 'RESERVED' then
    raise exception using errcode = '55000', message = 'MODEL_BILLING_ALREADY_TERMINAL';
  end if;

  perform pg_catalog.set_config('data_agent.app_id',bill.app_id::text,true);
  perform pg_catalog.set_config('data_agent.tenant_id',bill.tenant_id::text,true);
  perform pg_catalog.set_config('data_agent.environment',bill.environment,true);
  perform pg_catalog.set_config('data_agent.principal_id',bill.principal_id::text,true);
  terminal_payload := app_data_agent.resolve_model_billing_terminal_authority(
    bill.app_id,bill.tenant_id,bill.environment,bill.invocation_id,bill.reservation_id,
    bill.run_id,bill.principal_id,nullif(command ->> 'outcome_usage_record_id','')::uuid
  );

  if terminal_kind = 'CANCELLED_BEFORE_START' then
    if (terminal_payload ->> 'invocation_found')::boolean
      and terminal_payload ->> 'invocation_state' <> 'AUTHORIZED'
    then
      raise exception using errcode = '55000', message = 'MODEL_BILLING_CANCEL_AFTER_START_DENIED';
    end if;
  elsif terminal_kind = 'OUTCOME_UNKNOWN' then
    if not (terminal_payload ->> 'invocation_found')::boolean
      or terminal_payload ->> 'invocation_state' <> 'OUTCOME_UNKNOWN'
    then
      raise exception using errcode = '55000', message = 'MODEL_BILLING_OUTCOME_UNKNOWN_UNPROVEN';
    end if;
    review_marker := 'PROVIDER_OUTCOME_UNKNOWN';
  else
    if not (terminal_payload ->> 'invocation_found')::boolean
      or terminal_payload ->> 'invocation_state' not in ('COMPLETED','FAILED')
      or (terminal_kind = 'COMPLETED' and terminal_payload ->> 'invocation_state' <> 'COMPLETED')
      or (terminal_kind = 'FAILED_WITH_USAGE' and terminal_payload ->> 'invocation_state' <> 'FAILED')
    then
      raise exception using errcode = '55000', message = 'MODEL_BILLING_TERMINAL_AUTHORITY_MISMATCH';
    end if;
    if not (terminal_payload ->> 'usage_found')::boolean
      or terminal_payload ->> 'usage_outcome' <>
        (case terminal_kind when 'COMPLETED' then 'COMPLETED' else 'FAILED' end)
    then
      review_marker := 'IMMUTABLE_USAGE_MISSING';
    else
      actual_usage := pg_catalog.jsonb_build_object(
        'input_tokens',coalesce(
          terminal_payload -> 'actual' ->> 'provider_input_tokens',
          terminal_payload -> 'actual' ->> 'input_tokens'
        ),
        'output_tokens',coalesce(
          terminal_payload -> 'actual' ->> 'provider_output_tokens',
          terminal_payload -> 'actual' ->> 'output_tokens'
        ),
        'cache_read_tokens',coalesce(terminal_payload -> 'actual' ->> 'cache_read_tokens','0'),
        'cache_write_tokens',coalesce(terminal_payload -> 'actual' ->> 'cache_write_tokens','0'),
        'tool_calls',coalesce(terminal_payload -> 'actual' ->> 'tool_calls','0')
      );
      if exists (
        select 1 from pg_catalog.jsonb_each_text(actual_usage) as dimension(key, value)
        where dimension.value is null or dimension.value !~ '^(0|[1-9][0-9]*)$'
      ) then
        review_marker := 'USAGE_DIMENSIONS_INVALID';
      elsif exists (
        select 1 from pg_catalog.jsonb_each_text(actual_usage) as actual(key, value)
        where actual.value::numeric > (bill.request_budget ->> actual.key)::numeric
      ) then
        review_marker := 'ACTUAL_USAGE_OVER_BUDGET';
      elsif terminal_payload -> 'actual' ? 'billing_dimensions' and exists (
        select 1 from pg_catalog.jsonb_object_keys(
          terminal_payload -> 'actual' -> 'billing_dimensions'
        ) as dimension(key)
        where dimension.key not in (
          'input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','tool_calls'
        )
      ) then
        review_marker := 'UNKNOWN_BILLABLE_DIMENSION';
      else
        begin
          select * into strict cost_record from app_data_agent.calculate_model_bill_cost(
            bill.app_id, bill.environment, bill.bill_id, actual_usage, 'HALF_UP'
          );
        exception when others then
          review_marker := 'USAGE_OR_PRICE_SNAPSHOT_INVALID';
        end;
        if review_marker is null and cost_record.microcredits > bill.reserved_microcredits then
          review_marker := 'ACTUAL_COST_OVER_RESERVED';
        end if;
      end if;
    end if;
  end if;

  select coalesce(pg_catalog.max(event.event_sequence),0) + 1 into next_event
  from app_data_agent.model_bill_events as event
  where event.app_id = bill.app_id and event.environment = bill.environment
    and event.bill_id = bill.bill_id;
  perform pg_catalog.set_config('data_agent.model_billing_projection_write', 'on', true);

  if review_marker is not null then
    if bill.hold_id is not null then
      select * into strict hold_record from app_data_agent.credit_holds as current_hold
      where current_hold.app_id = bill.app_id and current_hold.environment = bill.environment
        and current_hold.hold_id = bill.hold_id and current_hold.state = 'ACTIVE'
      for update;
      perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
      update app_data_agent.credit_holds as current_hold set state = 'REVIEW_REQUIRED'
      where current_hold.app_id = hold_record.app_id
        and current_hold.environment = hold_record.environment
        and current_hold.hold_id = hold_record.hold_id
      returning current_hold.* into hold_record;
      insert into app_data_agent.credit_hold_events (
        app_id, environment, hold_id, event_sequence, event_kind, reserved_microcredits,
        actor_principal_id, reason
      ) select hold_record.app_id, hold_record.environment, hold_record.hold_id,
        coalesce(pg_catalog.max(event.event_sequence),0) + 1, 'REVIEW_REQUIRED',
        hold_record.reserved_microcredits, requested_principal_id, review_marker
      from app_data_agent.credit_hold_events as event
      where event.app_id = hold_record.app_id and event.environment = hold_record.environment
        and event.hold_id = hold_record.hold_id;
      select * into strict account from app_data_agent.credit_accounts as current_account
      where current_account.app_id = bill.app_id and current_account.environment = bill.environment
        and current_account.principal_id = bill.principal_id;
      hold_payload := app_data_agent.credit_hold_payload(hold_record);
      account_payload := app_data_agent.credit_account_payload(account);
    end if;
    update app_data_agent.model_bills as current_bill set
      state = 'REVIEW_REQUIRED', review_reason = review_marker
    where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
      and current_bill.bill_id = bill.bill_id
    returning current_bill.* into bill;
    insert into app_data_agent.model_bill_events (
      app_id, environment, bill_id, event_sequence, event_kind, actor_principal_id, reason, details
    ) values (
      bill.app_id,bill.environment,bill.bill_id,next_event,'REVIEW_REQUIRED',requested_principal_id,
      review_marker,pg_catalog.jsonb_build_object('terminal_kind',terminal_kind)
    );
  elsif terminal_kind = 'CANCELLED_BEFORE_START' then
    if bill.hold_id is not null then
      select * into strict hold_record from app_data_agent.credit_holds as current_hold
      where current_hold.app_id = bill.app_id and current_hold.environment = bill.environment
        and current_hold.hold_id = bill.hold_id and current_hold.state = 'ACTIVE'
      for update;
      select * into strict account from app_data_agent.credit_accounts as current_account
      where current_account.app_id = bill.app_id and current_account.environment = bill.environment
        and current_account.principal_id = bill.principal_id
      for update;
      perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
      update app_data_agent.credit_holds as current_hold set
        state = 'RELEASED', close_reason = 'cancelled before provider start',
        closed_at = pg_catalog.clock_timestamp()
      where current_hold.app_id = hold_record.app_id
        and current_hold.environment = hold_record.environment
        and current_hold.hold_id = hold_record.hold_id
      returning current_hold.* into hold_record;
      update app_data_agent.credit_accounts as current_account set
        active_held_microcredits = current_account.active_held_microcredits
          - hold_record.reserved_microcredits,
        version = current_account.version + 1,
        updated_at = pg_catalog.clock_timestamp()
      where current_account.app_id = account.app_id and current_account.environment = account.environment
        and current_account.principal_id = account.principal_id
      returning current_account.* into account;
      insert into app_data_agent.credit_hold_events (
        app_id, environment, hold_id, event_sequence, event_kind, reserved_microcredits,
        actor_principal_id, reason
      ) select hold_record.app_id, hold_record.environment, hold_record.hold_id,
        coalesce(pg_catalog.max(event.event_sequence),0) + 1, 'RELEASED',
        hold_record.reserved_microcredits, requested_principal_id, 'cancelled before provider start'
      from app_data_agent.credit_hold_events as event
      where event.app_id = hold_record.app_id and event.environment = hold_record.environment
        and event.hold_id = hold_record.hold_id;
      hold_payload := app_data_agent.credit_hold_payload(hold_record);
      account_payload := app_data_agent.credit_account_payload(account);
    end if;
    update app_data_agent.model_bills as current_bill set
      state = 'RELEASED', settled_at = pg_catalog.clock_timestamp()
    where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
      and current_bill.bill_id = bill.bill_id
    returning current_bill.* into bill;
    insert into app_data_agent.model_bill_events (
      app_id, environment, bill_id, event_sequence, event_kind, actor_principal_id, reason, details
    ) values (
      bill.app_id,bill.environment,bill.bill_id,next_event,'RELEASED',requested_principal_id,
      'cancelled before provider start',pg_catalog.jsonb_build_object('terminal_kind',terminal_kind)
    );
  else
    if bill.hold_id is not null then
      select * into strict hold_record from app_data_agent.credit_holds as current_hold
      where current_hold.app_id = bill.app_id and current_hold.environment = bill.environment
        and current_hold.hold_id = bill.hold_id and current_hold.state = 'ACTIVE'
      for update;
      select * into strict account from app_data_agent.credit_accounts as current_account
      where current_account.app_id = bill.app_id and current_account.environment = bill.environment
        and current_account.principal_id = bill.principal_id
      for update;
      balance_before := account.settled_microcredits;
      perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
      update app_data_agent.credit_holds as current_hold set
        state = 'SETTLED', close_reason = 'settled from immutable provider usage',
        closed_at = pg_catalog.clock_timestamp()
      where current_hold.app_id = hold_record.app_id
        and current_hold.environment = hold_record.environment
        and current_hold.hold_id = hold_record.hold_id
      returning current_hold.* into hold_record;
      update app_data_agent.credit_accounts as current_account set
        settled_microcredits = current_account.settled_microcredits - cost_record.microcredits,
        active_held_microcredits = current_account.active_held_microcredits
          - hold_record.reserved_microcredits,
        version = current_account.version + 1,
        updated_at = pg_catalog.clock_timestamp()
      where current_account.app_id = account.app_id and current_account.environment = account.environment
        and current_account.principal_id = account.principal_id
      returning current_account.* into account;
      if cost_record.microcredits > 0 then
        insert into app_data_agent.credit_ledger_entries (
          app_id, environment, entry_id, principal_id, workspace_id, kind,
          signed_microcredits, actor_principal_id, reason, idempotency_key,
          balance_before_microcredits, balance_after_microcredits, account_version
        ) values (
          bill.app_id,bill.environment,bill.bill_id,bill.principal_id,bill.tenant_id,'CHARGE',
          -cost_record.microcredits,requested_principal_id,'model invocation settlement',
          'bill-charge:' || bill.bill_id::text,balance_before,account.settled_microcredits,
          account.version
        );
      end if;
      insert into app_data_agent.credit_hold_events (
        app_id, environment, hold_id, event_sequence, event_kind, reserved_microcredits,
        actor_principal_id, reason
      ) select hold_record.app_id, hold_record.environment, hold_record.hold_id,
        coalesce(pg_catalog.max(event.event_sequence),0) + 1, 'SETTLED',
        hold_record.reserved_microcredits, requested_principal_id,
        'settled from immutable provider usage'
      from app_data_agent.credit_hold_events as event
      where event.app_id = hold_record.app_id and event.environment = hold_record.environment
        and event.hold_id = hold_record.hold_id;
      hold_payload := app_data_agent.credit_hold_payload(hold_record);
      account_payload := app_data_agent.credit_account_payload(account);
    end if;
    update app_data_agent.model_bills as current_bill set
      state = 'SETTLED', actual_usage = actual_usage,
      official_cost = cost_record.official_cost, cny_cost = cost_record.cny_cost,
      charged_microcredits = cost_record.microcredits,
      rounding_delta_microcredits = cost_record.rounding_delta_microcredits,
      settled_at = pg_catalog.clock_timestamp()
    where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
      and current_bill.bill_id = bill.bill_id
    returning current_bill.* into bill;
    insert into app_data_agent.model_bill_events (
      app_id, environment, bill_id, event_sequence, event_kind, actor_principal_id, reason, details
    ) values (
      bill.app_id,bill.environment,bill.bill_id,next_event,'SETTLED',requested_principal_id,
      'settled from immutable provider usage',pg_catalog.jsonb_build_object(
        'terminal_kind',terminal_kind,'charged_microcredits',bill.charged_microcredits::text,
        'released_microcredits',(bill.reserved_microcredits - bill.charged_microcredits)::text
      )
    );
  end if;

  result_payload := pg_catalog.jsonb_build_object(
    'operation_id',command ->> 'operation_id',
    'bill',app_data_agent.model_bill_payload(bill),
    'hold',hold_payload,
    'account',account_payload
  );
  insert into app_data_agent.model_billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    bill.app_id,bill.environment,(command ->> 'operation_id')::uuid,requested_principal_id,
    command ->> 'idempotency_key','FINALIZE',input_hash,command,result_payload
  );
  return result_payload;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'MODEL_BILLING_TERMINAL_AUTHORITY_MISSING';
end
$function$;
-- ============================================================
-- 10631: Super-admin review, reconciliation and deployment mode
-- ============================================================

create function app_data_agent.review_model_billing(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  bill app_data_agent.model_bills%rowtype;
  hold_record app_data_agent.credit_holds%rowtype;
  account app_data_agent.credit_accounts%rowtype;
  operation app_data_agent.model_billing_operations%rowtype;
  cost_record record;
  input_hash text := platform.canonical_sha256(command);
  next_event bigint;
  balance_before bigint;
  hold_payload jsonb := null;
  account_payload jsonb := null;
  result_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'model-billing-review@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.length(pg_catalog.btrim(command ->> 'reason')) not between 1 and 500
    or command ->> 'decision' not in ('SETTLE_VERIFIED','RELEASE')
    or (
      (command ->> 'decision' = 'SETTLE_VERIFIED' and pg_catalog.jsonb_typeof(command -> 'verified_usage') <> 'object')
      or (command ->> 'decision' = 'RELEASE' and command -> 'verified_usage' <> 'null'::jsonb)
    )
  then
    raise exception using errcode = '22023', message = 'MODEL_BILLING_REVIEW_INVALID';
  end if;
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_actor_principal_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id,scope_record.environment,requested_actor_principal_id,
      command ->> 'idempotency_key'
    )::text,0
  ));
  select * into operation from app_data_agent.model_billing_operations as existing
  where existing.app_id = scope_record.app_id and existing.environment = scope_record.environment
    and existing.actor_principal_id = requested_actor_principal_id
    and existing.idempotency_key = command ->> 'idempotency_key'
  for update;
  if found then
    if operation.input_hash <> input_hash or operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'MODEL_BILLING_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;
  select * into strict bill from app_data_agent.model_bills as current_bill
  where current_bill.app_id = scope_record.app_id and current_bill.environment = scope_record.environment
    and current_bill.bill_id = (command ->> 'bill_id')::uuid
    and current_bill.state = 'REVIEW_REQUIRED'
  for update;
  select coalesce(pg_catalog.max(event.event_sequence),0) + 1 into next_event
  from app_data_agent.model_bill_events as event
  where event.app_id = bill.app_id and event.environment = bill.environment
    and event.bill_id = bill.bill_id;
  perform pg_catalog.set_config('data_agent.model_billing_projection_write','on',true);

  if command ->> 'decision' = 'SETTLE_VERIFIED' then
    select * into strict cost_record from app_data_agent.calculate_model_bill_cost(
      bill.app_id,bill.environment,bill.bill_id,command -> 'verified_usage','HALF_UP'
    );
    if cost_record.microcredits > bill.reserved_microcredits then
      raise exception using errcode = '23514', message = 'MODEL_BILLING_REVIEW_EXCEEDS_HOLD';
    end if;
    if bill.hold_id is not null then
      select * into strict hold_record from app_data_agent.credit_holds as current_hold
      where current_hold.app_id = bill.app_id and current_hold.environment = bill.environment
        and current_hold.hold_id = bill.hold_id and current_hold.state = 'REVIEW_REQUIRED'
      for update;
      select * into strict account from app_data_agent.credit_accounts as current_account
      where current_account.app_id = bill.app_id and current_account.environment = bill.environment
        and current_account.principal_id = bill.principal_id
      for update;
      balance_before := account.settled_microcredits;
      perform pg_catalog.set_config('data_agent.billing_projection_write','on',true);
      update app_data_agent.credit_holds as current_hold set
        state = 'SETTLED', close_reason = command ->> 'reason',
        closed_at = pg_catalog.clock_timestamp()
      where current_hold.app_id = hold_record.app_id
        and current_hold.environment = hold_record.environment
        and current_hold.hold_id = hold_record.hold_id
      returning current_hold.* into hold_record;
      update app_data_agent.credit_accounts as current_account set
        settled_microcredits = current_account.settled_microcredits - cost_record.microcredits,
        active_held_microcredits = current_account.active_held_microcredits
          - hold_record.reserved_microcredits,
        version = current_account.version + 1,
        updated_at = pg_catalog.clock_timestamp()
      where current_account.app_id = account.app_id and current_account.environment = account.environment
        and current_account.principal_id = account.principal_id
      returning current_account.* into account;
      if cost_record.microcredits > 0 then
        insert into app_data_agent.credit_ledger_entries (
          app_id,environment,entry_id,principal_id,workspace_id,kind,signed_microcredits,
          actor_principal_id,reason,idempotency_key,balance_before_microcredits,
          balance_after_microcredits,account_version
        ) values (
          bill.app_id,bill.environment,bill.bill_id,bill.principal_id,bill.tenant_id,'CHARGE',
          -cost_record.microcredits,requested_actor_principal_id,command ->> 'reason',
          'bill-review:' || bill.bill_id::text,balance_before,account.settled_microcredits,account.version
        );
      end if;
      insert into app_data_agent.credit_hold_events (
        app_id,environment,hold_id,event_sequence,event_kind,reserved_microcredits,
        actor_principal_id,reason
      ) select hold_record.app_id,hold_record.environment,hold_record.hold_id,
        coalesce(pg_catalog.max(event.event_sequence),0) + 1,'SETTLED',
        hold_record.reserved_microcredits,requested_actor_principal_id,command ->> 'reason'
      from app_data_agent.credit_hold_events as event
      where event.app_id = hold_record.app_id and event.environment = hold_record.environment
        and event.hold_id = hold_record.hold_id;
      hold_payload := app_data_agent.credit_hold_payload(hold_record);
      account_payload := app_data_agent.credit_account_payload(account);
    end if;
    update app_data_agent.model_bills as current_bill set
      state = 'SETTLED',actual_usage = command -> 'verified_usage',
      official_cost = cost_record.official_cost,cny_cost = cost_record.cny_cost,
      charged_microcredits = cost_record.microcredits,
      rounding_delta_microcredits = cost_record.rounding_delta_microcredits,
      review_reason = null,settled_at = pg_catalog.clock_timestamp()
    where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
      and current_bill.bill_id = bill.bill_id
    returning current_bill.* into bill;
    insert into app_data_agent.model_bill_events (
      app_id,environment,bill_id,event_sequence,event_kind,actor_principal_id,reason,details
    ) values (
      bill.app_id,bill.environment,bill.bill_id,next_event,'REVIEW_SETTLED',
      requested_actor_principal_id,command ->> 'reason',pg_catalog.jsonb_build_object(
        'charged_microcredits',bill.charged_microcredits::text
      )
    );
  else
    if bill.hold_id is not null then
      select * into strict hold_record from app_data_agent.credit_holds as current_hold
      where current_hold.app_id = bill.app_id and current_hold.environment = bill.environment
        and current_hold.hold_id = bill.hold_id and current_hold.state = 'REVIEW_REQUIRED'
      for update;
      select * into strict account from app_data_agent.credit_accounts as current_account
      where current_account.app_id = bill.app_id and current_account.environment = bill.environment
        and current_account.principal_id = bill.principal_id
      for update;
      perform pg_catalog.set_config('data_agent.billing_projection_write','on',true);
      update app_data_agent.credit_holds as current_hold set
        state = 'RELEASED',close_reason = command ->> 'reason',
        closed_at = pg_catalog.clock_timestamp()
      where current_hold.app_id = hold_record.app_id
        and current_hold.environment = hold_record.environment
        and current_hold.hold_id = hold_record.hold_id
      returning current_hold.* into hold_record;
      update app_data_agent.credit_accounts as current_account set
        active_held_microcredits = current_account.active_held_microcredits
          - hold_record.reserved_microcredits,
        version = current_account.version + 1,
        updated_at = pg_catalog.clock_timestamp()
      where current_account.app_id = account.app_id and current_account.environment = account.environment
        and current_account.principal_id = account.principal_id
      returning current_account.* into account;
      insert into app_data_agent.credit_hold_events (
        app_id,environment,hold_id,event_sequence,event_kind,reserved_microcredits,
        actor_principal_id,reason
      ) select hold_record.app_id,hold_record.environment,hold_record.hold_id,
        coalesce(pg_catalog.max(event.event_sequence),0) + 1,'RELEASED',
        hold_record.reserved_microcredits,requested_actor_principal_id,command ->> 'reason'
      from app_data_agent.credit_hold_events as event
      where event.app_id = hold_record.app_id and event.environment = hold_record.environment
        and event.hold_id = hold_record.hold_id;
      hold_payload := app_data_agent.credit_hold_payload(hold_record);
      account_payload := app_data_agent.credit_account_payload(account);
    end if;
    update app_data_agent.model_bills as current_bill set
      state = 'RELEASED',review_reason = null,settled_at = pg_catalog.clock_timestamp()
    where current_bill.app_id = bill.app_id and current_bill.environment = bill.environment
      and current_bill.bill_id = bill.bill_id
    returning current_bill.* into bill;
    insert into app_data_agent.model_bill_events (
      app_id,environment,bill_id,event_sequence,event_kind,actor_principal_id,reason,details
    ) values (
      bill.app_id,bill.environment,bill.bill_id,next_event,'REVIEW_RELEASED',
      requested_actor_principal_id,command ->> 'reason','{}'::jsonb
    );
  end if;

  result_payload := pg_catalog.jsonb_build_object(
    'operation_id',command ->> 'operation_id','bill',app_data_agent.model_bill_payload(bill),
    'hold',hold_payload,'account',account_payload
  );
  insert into app_data_agent.model_billing_operations (
    app_id,environment,operation_id,actor_principal_id,idempotency_key,
    operation_kind,input_hash,input_payload,result_payload
  ) values (
    bill.app_id,bill.environment,(command ->> 'operation_id')::uuid,
    requested_actor_principal_id,command ->> 'idempotency_key','REVIEW',input_hash,command,result_payload
  );
  return result_payload;
end
$function$;

create function app_data_agent.reconcile_model_billing(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  runtime app_data_agent.billing_runtime_state%rowtype;
  workspace_record record;
  terminal_record record;
  terminal_count bigint := 0;
  terminal_bill_count bigint := 0;
  missing_count bigint := 0;
  duplicate_count bigint;
  review_count bigint;
  mismatch_count bigint;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id,requested_actor_principal_id);
  select * into strict runtime from app_data_agent.billing_runtime_state as current_runtime
  where current_runtime.app_id = scope_record.app_id
    and current_runtime.environment = scope_record.environment
    and current_runtime.deployment_id = requested_deployment_id;
  for workspace_record in
    select workspace.workspace_id
    from app_data_agent.workspaces as workspace
    where workspace.app_id = scope_record.app_id
      and workspace.environment = scope_record.environment
  loop
    perform pg_catalog.set_config('data_agent.app_id',scope_record.app_id::text,true);
    perform pg_catalog.set_config('data_agent.tenant_id',workspace_record.workspace_id::text,true);
    perform pg_catalog.set_config('data_agent.environment',scope_record.environment,true);
    perform pg_catalog.set_config(
      'data_agent.principal_id',requested_actor_principal_id::text,true
    );
    for terminal_record in
      select terminal.invocation_id
      from app_data_agent.list_model_billing_terminal_invocations(
        scope_record.app_id,workspace_record.workspace_id,scope_record.environment
      ) as terminal
    loop
      terminal_count := terminal_count + 1;
      if exists (
        select 1 from app_data_agent.model_bills as bill
        where bill.app_id = scope_record.app_id
          and bill.tenant_id = workspace_record.workspace_id
          and bill.environment = scope_record.environment
          and bill.invocation_id = terminal_record.invocation_id
          and bill.state in ('SETTLED','RELEASED','REVIEW_REQUIRED')
      ) then
        terminal_bill_count := terminal_bill_count + 1;
      else
        missing_count := missing_count + 1;
      end if;
    end loop;
  end loop;
  select coalesce(pg_catalog.sum(duplicates.count - 1),0)::bigint into duplicate_count
  from (
    select pg_catalog.count(*)::bigint as count from app_data_agent.model_bills as bill
    where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
    group by bill.invocation_id having pg_catalog.count(*) > 1
  ) as duplicates;
  select pg_catalog.count(*)::bigint into review_count
  from app_data_agent.model_bills as bill
  where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
    and bill.state = 'REVIEW_REQUIRED';
  select pg_catalog.count(*)::bigint into mismatch_count
  from app_data_agent.model_bills as bill
  left join app_data_agent.credit_holds as hold_record
    on hold_record.app_id = bill.app_id and hold_record.environment = bill.environment
   and hold_record.hold_id = bill.hold_id
  where bill.app_id = scope_record.app_id and bill.environment = scope_record.environment
    and bill.funding_type = 'USER_CREDITS' and bill.billing_mode = 'ENFORCED'
    and (
      hold_record.hold_id is null
      or (bill.state = 'RESERVED' and hold_record.state <> 'ACTIVE')
      or (bill.state = 'REVIEW_REQUIRED' and hold_record.state <> 'REVIEW_REQUIRED')
      or (bill.state = 'SETTLED' and hold_record.state <> 'SETTLED')
      or (bill.state = 'RELEASED' and hold_record.state <> 'RELEASED')
    );
  return pg_catalog.jsonb_build_object(
    'schema_version','model-billing-reconciliation@1.0.0','mode',runtime.mode,
    'terminal_model_invocations',terminal_count::text,'terminal_bills',terminal_bill_count::text,
    'missing_bills',missing_count::text,'duplicate_bills',duplicate_count::text,
    'open_review_findings',review_count::text,'hold_ledger_mismatches',mismatch_count::text,
    'ready_for_enforced',missing_count = 0 and duplicate_count = 0
      and review_count = 0 and mismatch_count = 0,
    'checked_at',pg_catalog.clock_timestamp()
  );
end
$function$;

create function app_data_agent.decide_billing_mode(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  runtime app_data_agent.billing_runtime_state%rowtype;
  operation app_data_agent.model_billing_operations%rowtype;
  reconciliation jsonb;
  input_hash text := platform.canonical_sha256(command);
  result_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'billing-mode-decision@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.length(pg_catalog.btrim(command ->> 'reason')) not between 1 and 500
    or command ->> 'target_mode' not in ('SHADOW','ENFORCED')
  then
    raise exception using errcode = '22023', message = 'BILLING_MODE_DECISION_INVALID';
  end if;
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id,requested_actor_principal_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id,scope_record.environment,requested_actor_principal_id,
      command ->> 'idempotency_key'
    )::text,0
  ));
  select * into operation from app_data_agent.model_billing_operations as existing
  where existing.app_id = scope_record.app_id and existing.environment = scope_record.environment
    and existing.actor_principal_id = requested_actor_principal_id
    and existing.idempotency_key = command ->> 'idempotency_key'
  for update;
  if found then
    if operation.input_hash <> input_hash or operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'MODEL_BILLING_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;
  select * into strict runtime from app_data_agent.billing_runtime_state as current_runtime
  where current_runtime.app_id = scope_record.app_id
    and current_runtime.environment = scope_record.environment
    and current_runtime.deployment_id = requested_deployment_id
  for update;
  if runtime.epoch <> (command ->> 'expected_epoch')::bigint then
    raise exception using errcode = '40001', message = 'BILLING_MODE_EPOCH_CONFLICT';
  end if;
  reconciliation := app_data_agent.reconcile_model_billing(
    requested_deployment_id,requested_actor_principal_id
  );
  if command ->> 'target_mode' = 'ENFORCED'
    and (reconciliation ->> 'ready_for_enforced')::boolean is not true
  then
    raise exception using errcode = '55000', message = 'BILLING_RECONCILIATION_REQUIRED';
  end if;
  perform pg_catalog.set_config('data_agent.model_billing_projection_write','on',true);
  update app_data_agent.billing_runtime_state as current_runtime set
    mode = command ->> 'target_mode',epoch = current_runtime.epoch + 1,
    approved_by = requested_actor_principal_id,approved_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
  where current_runtime.app_id = runtime.app_id and current_runtime.environment = runtime.environment
    and current_runtime.deployment_id = runtime.deployment_id
  returning current_runtime.* into runtime;
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id',command ->> 'operation_id',
    'state',pg_catalog.jsonb_build_object(
      'schema_version','billing-runtime-state@1.0.0','app_id',runtime.app_id,
      'environment',runtime.environment,'deployment_id',runtime.deployment_id,'mode',runtime.mode,
      'epoch',runtime.epoch,'approved_by',runtime.approved_by,'approved_at',runtime.approved_at,
      'updated_at',runtime.updated_at
    ),
    'reconciliation',reconciliation
  );
  insert into app_data_agent.model_billing_operations (
    app_id,environment,operation_id,actor_principal_id,idempotency_key,
    operation_kind,input_hash,input_payload,result_payload
  ) values (
    runtime.app_id,runtime.environment,(command ->> 'operation_id')::uuid,
    requested_actor_principal_id,command ->> 'idempotency_key','SET_MODE',input_hash,command,result_payload
  );
  return result_payload;
end
$function$;
-- ============================================================
-- 10631: Private ownership, forced RLS and exact RPC grants
-- ============================================================

alter table app_data_agent.billing_runtime_state owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bills owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bill_price_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bill_events owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_billing_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.billing_reconciliation_findings owner to data_agent_identity_rpc_owner;

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'billing_runtime_state','model_bills','model_bill_price_components','model_bill_events',
    'model_billing_operations','billing_reconciliation_findings'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_identity_rpc_owner using (true) with check (true)',
      relation_name || '_model_billing_rpc_policy',relation_name
    );
  end loop;
end
$rls$;

grant select,insert,update,delete on table
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
to data_agent_identity_rpc_owner;

alter function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) owner to data_agent_backend;
alter function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
revoke all on function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  to data_agent_identity_rpc_owner;

alter function app_data_agent.guard_model_billing_projection_mutation()
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.model_bill_payload(app_data_agent.model_bills)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.get_billing_runtime_state(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_own_model_bills(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_model_bills(uuid,uuid,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_model_billing_costs(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.authorize_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.finalize_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.review_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reconcile_model_billing(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.decide_billing_mode(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.guard_model_billing_projection_mutation() from public;
revoke all on function app_data_agent.model_bill_payload(app_data_agent.model_bills) from public;
revoke all on function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text) from public;
revoke all on function platform.get_billing_runtime_state(uuid,uuid) from public;
revoke all on function platform.list_own_model_bills(uuid,uuid) from public;
revoke all on function platform.list_model_bills(uuid,uuid,text) from public;
revoke all on function platform.list_model_billing_costs(uuid,uuid) from public;
revoke all on function app_data_agent.authorize_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.finalize_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.review_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.reconcile_model_billing(uuid,uuid) from public;
revoke all on function app_data_agent.decide_billing_mode(uuid,uuid,jsonb) from public;

grant execute on function platform.get_billing_runtime_state(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_own_model_bills(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_model_bills(uuid,uuid,text) to data_agent_backend;
grant execute on function platform.list_model_billing_costs(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.authorize_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.finalize_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.review_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.reconcile_model_billing(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.decide_billing_mode(uuid,uuid,jsonb) to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'billing_runtime_state','model_bills','model_bill_price_components','model_bill_events',
    'model_billing_operations','billing_reconciliation_findings'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'MODEL_BILLING_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text)','EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_COST_HELPER_EXPOSED';
  end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_model_billing_reservation_authority(uuid,uuid,text,uuid,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_model_billing_terminal_authority(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_RESEARCH_BRIDGE_EXPOSED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10631: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010631_app_data_agent_model_billing_settlement',
  'sha256:949216916bff7943361ae214fc60112b6ec9d07c326ff8048afd0c08435aaa7c'
);

commit;
