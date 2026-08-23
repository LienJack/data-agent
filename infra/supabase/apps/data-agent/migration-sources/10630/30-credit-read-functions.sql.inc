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
