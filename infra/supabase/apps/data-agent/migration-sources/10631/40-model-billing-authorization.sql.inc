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
