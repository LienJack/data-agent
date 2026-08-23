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
