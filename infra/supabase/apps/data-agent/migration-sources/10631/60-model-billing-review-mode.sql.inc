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
