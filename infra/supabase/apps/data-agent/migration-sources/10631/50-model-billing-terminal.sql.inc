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
