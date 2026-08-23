-- ============================================================
-- 10630: Atomic adjustment, hold and projection rebuild commands
-- ============================================================

create function app_data_agent.apply_credit_adjustment(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  target_user app_data_agent.app_users%rowtype;
  account app_data_agent.credit_accounts%rowtype;
  existing_operation app_data_agent.billing_operations%rowtype;
  input_hash text := platform.canonical_sha256(command);
  requested_idempotency_key text;
  target_principal_id uuid;
  delta bigint;
  expected_version bigint;
  new_settled bigint;
  result_payload jsonb;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_actor_principal_id);
  if command ->> 'schema_version' <> 'credit-adjustment@1.0.0'
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or command ->> 'signed_microcredits' !~ '^-?[1-9][0-9]*$'
    or pg_catalog.length(pg_catalog.btrim(command ->> 'reason')) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'CREDIT_ADJUSTMENT_INVALID';
  end if;
  requested_idempotency_key := command ->> 'idempotency_key';
  target_principal_id := (command ->> 'target_principal_id')::uuid;
  delta := (command ->> 'signed_microcredits')::bigint;
  expected_version := (command ->> 'expected_account_version')::bigint;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_actor_principal_id,
      requested_idempotency_key
    )::text, 0
  ));
  select * into existing_operation from app_data_agent.billing_operations as operation
  where operation.app_id = scope_record.app_id and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_actor_principal_id
    and operation.idempotency_key = requested_idempotency_key
  for update;
  if found then
    if existing_operation.input_hash <> input_hash or existing_operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'BILLING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  select * into strict target_user from app_data_agent.app_users as app_user
  where app_user.app_id = scope_record.app_id and app_user.environment = scope_record.environment
    and app_user.principal_id = target_principal_id and app_user.status = 'ACTIVE'
  for update;
  select * into strict account from app_data_agent.credit_accounts as current_account
  where current_account.app_id = scope_record.app_id
    and current_account.environment = scope_record.environment
    and current_account.principal_id = target_principal_id
  for update;
  if account.version <> expected_version then
    raise exception using errcode = '40001', message = 'CREDIT_ACCOUNT_VERSION_CONFLICT';
  end if;
  new_settled := account.settled_microcredits + delta;
  if new_settled < account.active_held_microcredits then
    raise exception using errcode = '23514', message = 'CREDIT_AVAILABLE_INSUFFICIENT';
  end if;
  perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
  update app_data_agent.credit_accounts as current_account set
    settled_microcredits = new_settled,
    version = current_account.version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where current_account.app_id = account.app_id
    and current_account.environment = account.environment
    and current_account.principal_id = account.principal_id
  returning current_account.* into account;
  insert into app_data_agent.credit_ledger_entries (
    app_id, environment, entry_id, principal_id, workspace_id, kind,
    signed_microcredits, actor_principal_id, reason, idempotency_key,
    balance_before_microcredits, balance_after_microcredits, account_version
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    account.principal_id, null, case when delta > 0 then 'GRANT' else 'ADJUSTMENT' end,
    delta, requested_actor_principal_id, command ->> 'reason', requested_idempotency_key,
    account.settled_microcredits - delta, account.settled_microcredits, account.version
  );
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', command ->> 'operation_id',
    'account', app_data_agent.credit_account_payload(account)
  );
  insert into app_data_agent.billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_actor_principal_id, requested_idempotency_key, 'ADJUST_CREDIT', input_hash, command,
    result_payload
  );
  insert into app_data_agent.billing_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    action, reason, details
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_actor_principal_id, account.principal_id, 'ADJUST_CREDIT',
    command ->> 'reason', pg_catalog.jsonb_build_object(
      'signed_microcredits', delta::text,
      'balance_before_microcredits', (account.settled_microcredits - delta)::text,
      'balance_after_microcredits', account.settled_microcredits::text,
      'account_version', account.version
    )
  );
  return result_payload;
end
$function$;

create function app_data_agent.reserve_credit_hold(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  account app_data_agent.credit_accounts%rowtype;
  hold_record app_data_agent.credit_holds%rowtype;
  existing_operation app_data_agent.billing_operations%rowtype;
  input_hash text := platform.canonical_sha256(command);
  requested_idempotency_key text;
  reserved_amount bigint;
  expected_version bigint;
  result_payload jsonb;
begin
  if command ->> 'schema_version' <> 'credit-hold-reserve@1.0.0'
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or command ->> 'reserved_microcredits' !~ '^[1-9][0-9]*$'
  then
    raise exception using errcode = '22023', message = 'CREDIT_HOLD_RESERVATION_INVALID';
  end if;
  select * into strict scope_record from platform.resolve_workspace_authority(
    requested_deployment_id, (command ->> 'workspace_id')::uuid, requested_principal_id, true
  );
  requested_idempotency_key := command ->> 'idempotency_key';
  reserved_amount := (command ->> 'reserved_microcredits')::bigint;
  expected_version := (command ->> 'expected_account_version')::bigint;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_principal_id,
      requested_idempotency_key
    )::text, 0
  ));
  select * into existing_operation from app_data_agent.billing_operations as operation
  where operation.app_id = scope_record.app_id and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = requested_idempotency_key
  for update;
  if found then
    if existing_operation.input_hash <> input_hash or existing_operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'BILLING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  select * into strict account from app_data_agent.credit_accounts as current_account
  where current_account.app_id = scope_record.app_id
    and current_account.environment = scope_record.environment
    and current_account.principal_id = requested_principal_id
  for update;
  if account.version <> expected_version then
    raise exception using errcode = '40001', message = 'CREDIT_ACCOUNT_VERSION_CONFLICT';
  end if;
  if account.available_microcredits < reserved_amount then
    raise exception using errcode = '23514', message = 'CREDIT_AVAILABLE_INSUFFICIENT';
  end if;
  if exists (
    select 1 from app_data_agent.credit_holds as existing_hold
    where existing_hold.app_id = scope_record.app_id
      and existing_hold.environment = scope_record.environment
      and (
        existing_hold.hold_id = (command ->> 'hold_id')::uuid
        or existing_hold.invocation_id = (command ->> 'invocation_id')::uuid
      )
  ) then
    raise exception using errcode = '23505', message = 'CREDIT_HOLD_ALREADY_EXISTS';
  end if;
  insert into app_data_agent.credit_holds (
    app_id, environment, hold_id, invocation_id, principal_id, workspace_id,
    reserved_microcredits
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'hold_id')::uuid,
    (command ->> 'invocation_id')::uuid, requested_principal_id,
    (command ->> 'workspace_id')::uuid, reserved_amount
  ) returning * into hold_record;
  insert into app_data_agent.credit_hold_events (
    app_id, environment, hold_id, event_sequence, event_kind, reserved_microcredits,
    actor_principal_id, reason
  ) values (
    hold_record.app_id, hold_record.environment, hold_record.hold_id, 1, 'RESERVED',
    hold_record.reserved_microcredits, requested_principal_id, 'model invocation reservation'
  );
  perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
  update app_data_agent.credit_accounts as current_account set
    active_held_microcredits = current_account.active_held_microcredits + reserved_amount,
    version = current_account.version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where current_account.app_id = account.app_id
    and current_account.environment = account.environment
    and current_account.principal_id = account.principal_id
  returning current_account.* into account;
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', command ->> 'operation_id',
    'account', app_data_agent.credit_account_payload(account),
    'hold', app_data_agent.credit_hold_payload(hold_record)
  );
  insert into app_data_agent.billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, requested_idempotency_key, 'RESERVE_HOLD', input_hash, command,
    result_payload
  );
  insert into app_data_agent.billing_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    action, reason, details
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, requested_principal_id, 'RESERVE_HOLD',
    'model invocation reservation', pg_catalog.jsonb_build_object(
      'hold_id', hold_record.hold_id,
      'workspace_id', hold_record.workspace_id,
      'reserved_microcredits', reserved_amount::text,
      'account_version', account.version
    )
  );
  return result_payload;
end
$function$;

create function app_data_agent.release_credit_hold(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  account app_data_agent.credit_accounts%rowtype;
  hold_record app_data_agent.credit_holds%rowtype;
  existing_operation app_data_agent.billing_operations%rowtype;
  input_hash text := platform.canonical_sha256(command);
  requested_idempotency_key text;
  expected_version bigint;
  result_payload jsonb;
  next_event_sequence bigint;
begin
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_principal_id);
  if command ->> 'schema_version' <> 'credit-hold-release@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.length(pg_catalog.btrim(command ->> 'reason')) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'CREDIT_HOLD_RELEASE_INVALID';
  end if;
  requested_idempotency_key := command ->> 'idempotency_key';
  expected_version := (command ->> 'expected_account_version')::bigint;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_principal_id,
      requested_idempotency_key
    )::text, 0
  ));
  select * into existing_operation from app_data_agent.billing_operations as operation
  where operation.app_id = scope_record.app_id and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = requested_idempotency_key
  for update;
  if found then
    if existing_operation.input_hash <> input_hash or existing_operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'BILLING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  select * into strict hold_record from app_data_agent.credit_holds as current_hold
  where current_hold.app_id = scope_record.app_id
    and current_hold.environment = scope_record.environment
    and current_hold.hold_id = (command ->> 'hold_id')::uuid
    and current_hold.principal_id = requested_principal_id
  for update;
  if hold_record.state <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'CREDIT_HOLD_NOT_ACTIVE';
  end if;
  select * into strict account from app_data_agent.credit_accounts as current_account
  where current_account.app_id = hold_record.app_id
    and current_account.environment = hold_record.environment
    and current_account.principal_id = hold_record.principal_id
  for update;
  if account.version <> expected_version then
    raise exception using errcode = '40001', message = 'CREDIT_ACCOUNT_VERSION_CONFLICT';
  end if;
  select coalesce(pg_catalog.max(event.event_sequence), 0) + 1 into next_event_sequence
  from app_data_agent.credit_hold_events as event
  where event.app_id = hold_record.app_id and event.environment = hold_record.environment
    and event.hold_id = hold_record.hold_id;
  perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
  update app_data_agent.credit_holds as current_hold set
    state = 'RELEASED', close_reason = command ->> 'reason',
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
  where current_account.app_id = account.app_id
    and current_account.environment = account.environment
    and current_account.principal_id = account.principal_id
  returning current_account.* into account;
  insert into app_data_agent.credit_hold_events (
    app_id, environment, hold_id, event_sequence, event_kind, reserved_microcredits,
    actor_principal_id, reason
  ) values (
    hold_record.app_id, hold_record.environment, hold_record.hold_id,
    next_event_sequence, 'RELEASED', hold_record.reserved_microcredits,
    requested_principal_id, command ->> 'reason'
  );
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', command ->> 'operation_id',
    'account', app_data_agent.credit_account_payload(account),
    'hold', app_data_agent.credit_hold_payload(hold_record)
  );
  insert into app_data_agent.billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, requested_idempotency_key, 'RELEASE_HOLD', input_hash, command,
    result_payload
  );
  insert into app_data_agent.billing_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    action, reason, details
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, requested_principal_id, 'RELEASE_HOLD',
    command ->> 'reason', pg_catalog.jsonb_build_object(
      'hold_id', hold_record.hold_id,
      'released_microcredits', hold_record.reserved_microcredits::text,
      'account_version', account.version
    )
  );
  return result_payload;
end
$function$;

create function app_data_agent.rebuild_credit_account_projection(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  account app_data_agent.credit_accounts%rowtype;
  existing_operation app_data_agent.billing_operations%rowtype;
  input_hash text := platform.canonical_sha256(command);
  requested_idempotency_key text;
  target_principal_id uuid;
  expected_version bigint;
  ledger_total bigint;
  hold_total bigint;
  changed boolean;
  result_payload jsonb;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_actor_principal_id);
  if command ->> 'schema_version' <> 'credit-projection-rebuild@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.length(pg_catalog.btrim(command ->> 'reason')) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'CREDIT_PROJECTION_REBUILD_INVALID';
  end if;
  requested_idempotency_key := command ->> 'idempotency_key';
  target_principal_id := (command ->> 'target_principal_id')::uuid;
  expected_version := (command ->> 'expected_account_version')::bigint;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, requested_actor_principal_id,
      requested_idempotency_key
    )::text, 0
  ));
  select * into existing_operation from app_data_agent.billing_operations as operation
  where operation.app_id = scope_record.app_id and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_actor_principal_id
    and operation.idempotency_key = requested_idempotency_key
  for update;
  if found then
    if existing_operation.input_hash <> input_hash or existing_operation.input_payload <> command then
      raise exception using errcode = '23505', message = 'BILLING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  select * into strict account from app_data_agent.credit_accounts as current_account
  where current_account.app_id = scope_record.app_id
    and current_account.environment = scope_record.environment
    and current_account.principal_id = target_principal_id
  for update;
  if account.version <> expected_version then
    raise exception using errcode = '40001', message = 'CREDIT_ACCOUNT_VERSION_CONFLICT';
  end if;
  select coalesce(pg_catalog.sum(entry.signed_microcredits), 0)::bigint into ledger_total
  from app_data_agent.credit_ledger_entries as entry
  where entry.app_id = account.app_id and entry.environment = account.environment
    and entry.principal_id = account.principal_id;
  select coalesce(pg_catalog.sum(hold_record.reserved_microcredits), 0)::bigint into hold_total
  from app_data_agent.credit_holds as hold_record
  where hold_record.app_id = account.app_id and hold_record.environment = account.environment
    and hold_record.principal_id = account.principal_id
    and hold_record.state in ('ACTIVE','REVIEW_REQUIRED');
  if ledger_total < hold_total then
    raise exception using errcode = '23514', message = 'CREDIT_RECONCILIATION_NEGATIVE_AVAILABLE';
  end if;
  changed := account.settled_microcredits <> ledger_total
    or account.active_held_microcredits <> hold_total;
  if changed then
    perform pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
    update app_data_agent.credit_accounts as current_account set
      settled_microcredits = ledger_total,
      active_held_microcredits = hold_total,
      version = current_account.version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where current_account.app_id = account.app_id
      and current_account.environment = account.environment
      and current_account.principal_id = account.principal_id
    returning current_account.* into account;
  end if;
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', command ->> 'operation_id',
    'changed', changed,
    'account', app_data_agent.credit_account_payload(account)
  );
  insert into app_data_agent.billing_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, input_payload, result_payload
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_actor_principal_id, requested_idempotency_key, 'REBUILD_PROJECTION', input_hash,
    command, result_payload
  );
  insert into app_data_agent.billing_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    action, reason, details
  ) values (
    account.app_id, account.environment, (command ->> 'operation_id')::uuid,
    requested_actor_principal_id, account.principal_id, 'REBUILD_PROJECTION',
    command ->> 'reason', pg_catalog.jsonb_build_object(
      'changed', changed,
      'ledger_settled_microcredits', ledger_total::text,
      'active_holds_microcredits', hold_total::text,
      'account_version', account.version
    )
  );
  return result_payload;
end
$function$;
