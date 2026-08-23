-- credit_ledger_migration_checksum: sha256:be6ed573350383734fc2422fdee71b76fc1e6c164d767c4be29b48713016cc67
-- ============================================================
-- 10630: Global user credit accounts and immutable ledger
-- ============================================================
-- Depends on: 20260725010629_app_data_agent_model_price_fx_control
-- Clean-install only. No legacy balance backfill is supported.
-- ============================================================

begin;

do $bootstrap$
declare baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'CREDIT_LEDGER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'CREDIT_LEDGER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010629_app_data_agent_model_price_fx_control';
  if not found then
    raise exception using errcode = 'P0001', message = 'CREDIT_LEDGER_BASELINE_10629_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010630_app_data_agent_credit_ledger'
  ) then
    raise exception using errcode = 'P0001', message = 'CREDIT_LEDGER_MIGRATION_10630_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.app_users') is null
    or pg_catalog.to_regclass('app_data_agent.workspaces') is null
    or pg_catalog.to_regprocedure('platform.resolve_super_admin_scope(uuid,uuid)') is null
  then
    raise exception using errcode = 'P0001', message = 'CREDIT_LEDGER_BASELINE_AUTHORITY_MISSING';
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
-- 10630: Credit projection, immutable facts and operation receipts
-- ============================================================

create table app_data_agent.credit_accounts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  settled_microcredits bigint not null default 0 check (settled_microcredits >= 0),
  active_held_microcredits bigint not null default 0 check (active_held_microcredits >= 0),
  available_microcredits bigint generated always as (
    settled_microcredits - active_held_microcredits
  ) stored,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, principal_id),
  foreign key (app_id, environment, principal_id)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  check (settled_microcredits >= active_held_microcredits)
);

create table app_data_agent.credit_ledger_entries (
  app_id uuid not null,
  environment text not null,
  entry_id uuid not null,
  principal_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('GRANT','ADJUSTMENT','CHARGE','REVERSAL')),
  signed_microcredits bigint not null check (signed_microcredits <> 0),
  actor_principal_id uuid not null,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 500),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  balance_before_microcredits bigint not null check (balance_before_microcredits >= 0),
  balance_after_microcredits bigint not null check (balance_after_microcredits >= 0),
  account_version bigint not null check (account_version >= 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, entry_id),
  unique (app_id, environment, actor_principal_id, idempotency_key),
  foreign key (app_id, environment, principal_id)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  foreign key (app_id, environment, actor_principal_id)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  foreign key (app_id, workspace_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  check (balance_after_microcredits = balance_before_microcredits + signed_microcredits),
  check (
    (kind in ('GRANT','REVERSAL') and signed_microcredits > 0)
    or (kind in ('ADJUSTMENT','CHARGE') and signed_microcredits < 0)
  )
);

create index credit_ledger_principal_timeline
  on app_data_agent.credit_ledger_entries (
    app_id, environment, principal_id, created_at desc, entry_id desc
  );

create table app_data_agent.credit_holds (
  app_id uuid not null,
  environment text not null,
  hold_id uuid not null,
  invocation_id uuid not null,
  principal_id uuid not null,
  workspace_id uuid not null,
  reserved_microcredits bigint not null check (reserved_microcredits > 0),
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE','SETTLED','RELEASED','REVIEW_REQUIRED')),
  close_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  closed_at timestamptz,
  primary key (app_id, environment, hold_id),
  unique (app_id, environment, invocation_id),
  foreign key (app_id, environment, principal_id)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  foreign key (app_id, workspace_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  check (
    (state in ('ACTIVE','REVIEW_REQUIRED') and closed_at is null)
    or (state in ('SETTLED','RELEASED') and closed_at is not null and close_reason is not null)
  )
);

create index credit_holds_active_principal
  on app_data_agent.credit_holds (app_id, environment, principal_id, created_at)
  where state in ('ACTIVE','REVIEW_REQUIRED');

create table app_data_agent.credit_hold_events (
  app_id uuid not null,
  environment text not null,
  hold_id uuid not null,
  event_sequence bigint not null check (event_sequence >= 1),
  event_kind text not null check (event_kind in ('RESERVED','SETTLED','RELEASED','REVIEW_REQUIRED')),
  reserved_microcredits bigint not null check (reserved_microcredits > 0),
  actor_principal_id uuid not null,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 500),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, hold_id, event_sequence),
  foreign key (app_id, environment, hold_id)
    references app_data_agent.credit_holds (app_id, environment, hold_id) on delete restrict,
  foreign key (app_id, environment, actor_principal_id)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict
);

create table app_data_agent.billing_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  operation_kind text not null check (
    operation_kind in (
      'ADJUST_CREDIT','RESERVE_HOLD','RELEASE_HOLD','SETTLE_HOLD',
      'MARK_REVIEW','RESOLVE_REVIEW','REBUILD_PROJECTION'
    )
  ),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_payload jsonb not null check (pg_catalog.jsonb_typeof(input_payload) = 'object'),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, operation_id),
  unique (app_id, environment, actor_principal_id, idempotency_key)
);

create table app_data_agent.billing_audit_log (
  app_id uuid not null,
  environment text not null,
  audit_id bigint generated always as identity,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  target_principal_id uuid not null,
  action text not null check (
    action in ('ADJUST_CREDIT','RESERVE_HOLD','RELEASE_HOLD','REBUILD_PROJECTION')
  ),
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 500),
  details jsonb not null check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, audit_id),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.billing_operations (app_id, environment, operation_id)
    on delete restrict
);

create function app_data_agent.reject_billing_fact_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'BILLING_FACT_IMMUTABLE';
end
$function$;

create function app_data_agent.guard_billing_projection_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  if pg_catalog.current_setting('data_agent.billing_projection_write', true) <> 'on' then
    raise exception using errcode = '42501', message = 'BILLING_PROJECTION_WRITE_REQUIRED';
  end if;
  return new;
end
$function$;

create trigger credit_accounts_projection_guard
before update or delete on app_data_agent.credit_accounts
for each row execute function app_data_agent.guard_billing_projection_mutation();

create trigger credit_holds_projection_guard
before update or delete on app_data_agent.credit_holds
for each row execute function app_data_agent.guard_billing_projection_mutation();

create trigger credit_ledger_immutable
before update or delete on app_data_agent.credit_ledger_entries
for each row execute function app_data_agent.reject_billing_fact_mutation();

create trigger credit_hold_events_immutable
before update or delete on app_data_agent.credit_hold_events
for each row execute function app_data_agent.reject_billing_fact_mutation();

create trigger billing_operations_immutable
before update or delete on app_data_agent.billing_operations
for each row execute function app_data_agent.reject_billing_fact_mutation();

create trigger billing_audit_immutable
before update or delete on app_data_agent.billing_audit_log
for each row execute function app_data_agent.reject_billing_fact_mutation();

insert into app_data_agent.credit_accounts (app_id, environment, principal_id)
select app_user.app_id, app_user.environment, app_user.principal_id
from app_data_agent.app_users as app_user
on conflict do nothing;

create function app_data_agent.ensure_credit_account_for_app_user()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
begin
  insert into app_data_agent.credit_accounts (app_id, environment, principal_id)
  values (new.app_id, new.environment, new.principal_id)
  on conflict do nothing;
  return new;
end
$function$;

create trigger app_users_ensure_credit_account
after insert on app_data_agent.app_users
for each row execute function app_data_agent.ensure_credit_account_for_app_user();
-- ============================================================
-- 10630: Credit read authority and deterministic reconciliation
-- ============================================================

create function platform.resolve_credit_user_scope(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (app_id uuid, environment text, system_role text)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  return query
  select deployment.app_id, deployment.environment, app_user.system_role
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state <> 'DELETED'
    and app_user.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'CREDIT_ACCOUNT_ACCESS_DENIED';
  end if;
end
$function$;

create function app_data_agent.credit_account_payload(
  account app_data_agent.credit_accounts
)
returns jsonb language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version', 'credit-account@1.0.0',
    'app_id', account.app_id,
    'environment', account.environment,
    'principal_id', account.principal_id,
    'settled_microcredits', account.settled_microcredits::text,
    'active_held_microcredits', account.active_held_microcredits::text,
    'available_microcredits', account.available_microcredits::text,
    'version', account.version,
    'updated_at', account.updated_at
  );
$function$;

create function app_data_agent.credit_hold_payload(
  hold_record app_data_agent.credit_holds
)
returns jsonb language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version', 'credit-hold@1.0.0',
    'app_id', hold_record.app_id,
    'environment', hold_record.environment,
    'hold_id', hold_record.hold_id,
    'invocation_id', hold_record.invocation_id,
    'principal_id', hold_record.principal_id,
    'workspace_id', hold_record.workspace_id,
    'reserved_microcredits', hold_record.reserved_microcredits::text,
    'state', hold_record.state,
    'created_at', hold_record.created_at,
    'closed_at', hold_record.closed_at
  );
$function$;

create function platform.get_own_credit_account(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.credit_accounts
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_principal_id);
  return query
  select account.* from app_data_agent.credit_accounts as account
  where account.app_id = scope_record.app_id
    and account.environment = scope_record.environment
    and account.principal_id = requested_principal_id;
end
$function$;

create function platform.list_own_credit_ledger(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.credit_ledger_entries
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_principal_id);
  return query
  select entry.* from app_data_agent.credit_ledger_entries as entry
  where entry.app_id = scope_record.app_id
    and entry.environment = scope_record.environment
    and entry.principal_id = requested_principal_id
  order by entry.created_at desc, entry.entry_id desc;
end
$function$;

create function platform.list_credit_accounts(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.credit_accounts
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select account.* from app_data_agent.credit_accounts as account
  where account.app_id = scope_record.app_id and account.environment = scope_record.environment
  order by account.updated_at desc, account.principal_id;
end
$function$;

create function platform.list_credit_ledger(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_target_principal_id uuid default null
)
returns setof app_data_agent.credit_ledger_entries
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select entry.* from app_data_agent.credit_ledger_entries as entry
  where entry.app_id = scope_record.app_id
    and entry.environment = scope_record.environment
    and (requested_target_principal_id is null or entry.principal_id = requested_target_principal_id)
  order by entry.created_at desc, entry.entry_id desc;
end
$function$;

create function platform.list_billing_audit(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.billing_audit_log
language plpgsql stable security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select audit.* from app_data_agent.billing_audit_log as audit
  where audit.app_id = scope_record.app_id and audit.environment = scope_record.environment
  order by audit.audit_id desc;
end
$function$;

create function app_data_agent.reconcile_credit_account(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_target_principal_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  scope_record record;
  account app_data_agent.credit_accounts%rowtype;
  ledger_total bigint;
  hold_total bigint;
begin
  select * into strict scope_record
  from platform.resolve_credit_user_scope(requested_deployment_id, requested_actor_principal_id);
  if requested_target_principal_id <> requested_actor_principal_id
    and scope_record.system_role <> 'SUPER_ADMIN'
  then
    raise exception using errcode = '42501', message = 'CREDIT_ACCOUNT_ACCESS_DENIED';
  end if;
  select * into strict account from app_data_agent.credit_accounts as current_account
  where current_account.app_id = scope_record.app_id
    and current_account.environment = scope_record.environment
    and current_account.principal_id = requested_target_principal_id;
  select coalesce(pg_catalog.sum(entry.signed_microcredits), 0)::bigint into ledger_total
  from app_data_agent.credit_ledger_entries as entry
  where entry.app_id = account.app_id and entry.environment = account.environment
    and entry.principal_id = account.principal_id;
  select coalesce(pg_catalog.sum(hold_record.reserved_microcredits), 0)::bigint into hold_total
  from app_data_agent.credit_holds as hold_record
  where hold_record.app_id = account.app_id and hold_record.environment = account.environment
    and hold_record.principal_id = account.principal_id
    and hold_record.state in ('ACTIVE','REVIEW_REQUIRED');
  return pg_catalog.jsonb_build_object(
    'schema_version', 'credit-reconciliation@1.0.0',
    'principal_id', account.principal_id,
    'projected_settled_microcredits', account.settled_microcredits::text,
    'ledger_settled_microcredits', ledger_total::text,
    'projected_held_microcredits', account.active_held_microcredits::text,
    'active_holds_microcredits', hold_total::text,
    'consistent', account.settled_microcredits = ledger_total
      and account.active_held_microcredits = hold_total,
    'account_version', account.version,
    'checked_at', pg_catalog.clock_timestamp()
  );
end
$function$;
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
-- ============================================================
-- 10630: Private ownership, forced RLS and exact RPC grants
-- ============================================================

alter table app_data_agent.credit_accounts owner to data_agent_identity_rpc_owner;
alter table app_data_agent.credit_ledger_entries owner to data_agent_identity_rpc_owner;
alter table app_data_agent.credit_holds owner to data_agent_identity_rpc_owner;
alter table app_data_agent.credit_hold_events owner to data_agent_identity_rpc_owner;
alter table app_data_agent.billing_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.billing_audit_log owner to data_agent_identity_rpc_owner;

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'credit_accounts','credit_ledger_entries','credit_holds','credit_hold_events',
    'billing_operations','billing_audit_log'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security', relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security', relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_identity_rpc_owner using (true) with check (true)',
      relation_name || '_billing_rpc_policy', relation_name
    );
  end loop;
end
$rls$;

grant select, insert, update, delete on table
  app_data_agent.credit_accounts,
  app_data_agent.credit_ledger_entries,
  app_data_agent.credit_holds,
  app_data_agent.credit_hold_events,
  app_data_agent.billing_operations,
  app_data_agent.billing_audit_log
to data_agent_identity_rpc_owner;
grant usage, select on sequence app_data_agent.billing_audit_log_audit_id_seq
  to data_agent_identity_rpc_owner;

alter function app_data_agent.reject_billing_fact_mutation() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.guard_billing_projection_mutation() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.ensure_credit_account_for_app_user() owner to data_agent_identity_rpc_owner;
alter function platform.resolve_credit_user_scope(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.credit_account_payload(app_data_agent.credit_accounts)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.credit_hold_payload(app_data_agent.credit_holds)
  owner to data_agent_identity_rpc_owner;
alter function platform.get_own_credit_account(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_own_credit_ledger(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_credit_accounts(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_credit_ledger(uuid,uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_billing_audit(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reconcile_credit_account(uuid,uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reserve_credit_hold(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.release_credit_hold(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.rebuild_credit_account_projection(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.credit_accounts,
  app_data_agent.credit_ledger_entries,
  app_data_agent.credit_holds,
  app_data_agent.credit_hold_events,
  app_data_agent.billing_operations,
  app_data_agent.billing_audit_log
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on sequence app_data_agent.billing_audit_log_audit_id_seq
from public, anon, authenticated, service_role, data_agent_backend;

revoke all on function app_data_agent.reject_billing_fact_mutation() from public;
revoke all on function app_data_agent.guard_billing_projection_mutation() from public;
revoke all on function app_data_agent.ensure_credit_account_for_app_user() from public;
revoke all on function platform.resolve_credit_user_scope(uuid,uuid) from public;
revoke all on function app_data_agent.credit_account_payload(app_data_agent.credit_accounts) from public;
revoke all on function app_data_agent.credit_hold_payload(app_data_agent.credit_holds) from public;
revoke all on function platform.get_own_credit_account(uuid,uuid) from public;
revoke all on function platform.list_own_credit_ledger(uuid,uuid) from public;
revoke all on function platform.list_credit_accounts(uuid,uuid) from public;
revoke all on function platform.list_credit_ledger(uuid,uuid,uuid) from public;
revoke all on function platform.list_billing_audit(uuid,uuid) from public;
revoke all on function app_data_agent.reconcile_credit_account(uuid,uuid,uuid) from public;
revoke all on function app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.reserve_credit_hold(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.release_credit_hold(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.rebuild_credit_account_projection(uuid,uuid,jsonb) from public;

grant execute on function platform.get_own_credit_account(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_own_credit_ledger(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_credit_accounts(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_credit_ledger(uuid,uuid,uuid) to data_agent_backend;
grant execute on function platform.list_billing_audit(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.reconcile_credit_account(uuid,uuid,uuid)
  to data_agent_backend;
grant execute on function app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.reserve_credit_hold(uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.release_credit_hold(uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.rebuild_credit_account_projection(uuid,uuid,jsonb)
  to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'credit_accounts','credit_ledger_entries','credit_holds','credit_hold_events',
    'billing_operations','billing_audit_log'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('app_data_agent.%I', relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'CREDIT_LEDGER_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.resolve_credit_user_scope(uuid,uuid)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'CREDIT_LEDGER_AUTHORITY_HELPER_EXPOSED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10630: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010630_app_data_agent_credit_ledger',
  'sha256:be6ed573350383734fc2422fdee71b76fc1e6c164d767c4be29b48713016cc67'
);

commit;
