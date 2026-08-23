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
