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
