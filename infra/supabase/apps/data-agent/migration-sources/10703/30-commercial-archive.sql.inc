drop trigger app_users_ensure_credit_account on app_data_agent.app_users;

drop trigger model_price_versions_immutable on app_data_agent.model_price_versions;
drop trigger model_price_components_immutable on app_data_agent.model_price_components;
drop trigger fx_rate_versions_immutable on app_data_agent.fx_rate_versions;
drop trigger pricing_audit_log_immutable on app_data_agent.pricing_audit_log;
drop trigger credit_accounts_projection_guard on app_data_agent.credit_accounts;
drop trigger credit_holds_projection_guard on app_data_agent.credit_holds;
drop trigger credit_ledger_immutable on app_data_agent.credit_ledger_entries;
drop trigger credit_hold_events_immutable on app_data_agent.credit_hold_events;
drop trigger billing_operations_immutable on app_data_agent.billing_operations;
drop trigger billing_audit_immutable on app_data_agent.billing_audit_log;
drop trigger billing_runtime_state_projection_guard on app_data_agent.billing_runtime_state;
drop trigger model_bills_projection_guard on app_data_agent.model_bills;
drop trigger model_bill_price_components_immutable on app_data_agent.model_bill_price_components;
drop trigger model_bill_events_immutable on app_data_agent.model_bill_events;
drop trigger model_billing_operations_immutable on app_data_agent.model_billing_operations;
drop trigger billing_reconciliation_findings_immutable
on app_data_agent.billing_reconciliation_findings;

create function app_data_agent.reject_commercial_archive_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'COMMERCIAL_ARCHIVE_READ_ONLY';
end
$function$;

do $archive_triggers$
declare relation_name text;
begin
  foreach relation_name in array array[
    'pricing_control_state','pricing_sync_operations','model_price_candidates',
    'model_price_candidate_components','model_price_versions','model_price_components',
    'fx_rate_candidates','fx_rate_versions','pricing_control_operations','pricing_audit_log',
    'credit_accounts','credit_ledger_entries','credit_holds','credit_hold_events',
    'billing_operations','billing_audit_log','billing_runtime_state','model_bills',
    'model_bill_price_components','model_bill_events','model_billing_operations',
    'billing_reconciliation_findings'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before insert or update or delete on app_data_agent.%I for each row execute function app_data_agent.reject_commercial_archive_mutation()',
      relation_name || '_archive_read_only',
      relation_name
    );
  end loop;
end
$archive_triggers$;

revoke all on table
  app_data_agent.pricing_control_state,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log,
  app_data_agent.credit_accounts,
  app_data_agent.credit_ledger_entries,
  app_data_agent.credit_holds,
  app_data_agent.credit_hold_events,
  app_data_agent.billing_operations,
  app_data_agent.billing_audit_log,
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on sequence app_data_agent.billing_audit_log_audit_id_seq
from public, anon, authenticated, service_role, data_agent_backend;

drop function platform.list_model_price_candidates(uuid,uuid);
drop function platform.list_fx_rate_candidates(uuid,uuid);
drop function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb);
drop function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb);
drop function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb);
drop function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb);

drop function platform.get_own_credit_account(uuid,uuid);
drop function platform.list_own_credit_ledger(uuid,uuid);
drop function platform.list_credit_accounts(uuid,uuid);
drop function platform.list_credit_ledger(uuid,uuid,uuid);
drop function platform.list_billing_audit(uuid,uuid);
drop function app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb);
drop function app_data_agent.reserve_credit_hold(uuid,uuid,jsonb);
drop function app_data_agent.release_credit_hold(uuid,uuid,jsonb);
drop function app_data_agent.rebuild_credit_account_projection(uuid,uuid,jsonb);
drop function app_data_agent.reconcile_credit_account(uuid,uuid,uuid);
drop function app_data_agent.credit_account_payload(app_data_agent.credit_accounts);
drop function app_data_agent.credit_hold_payload(app_data_agent.credit_holds);
drop function platform.resolve_credit_user_scope(uuid,uuid);
drop function app_data_agent.ensure_credit_account_for_app_user();

drop function platform.get_billing_runtime_state(uuid,uuid);
drop function platform.list_own_model_bills(uuid,uuid);
drop function platform.list_model_bills(uuid,uuid,text);
drop function platform.list_model_billing_costs(uuid,uuid);
drop function app_data_agent.authorize_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.finalize_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.review_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.reconcile_model_billing(uuid,uuid);
drop function app_data_agent.decide_billing_mode(uuid,uuid,jsonb);
drop function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
);
drop function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
);
drop function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
);
drop function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text);
drop function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text);
drop function app_data_agent.model_bill_payload(app_data_agent.model_bills);

drop function app_data_agent.guard_billing_projection_mutation();
drop function app_data_agent.guard_model_billing_projection_mutation();
drop function app_data_agent.reject_billing_fact_mutation();
drop function app_data_agent.reject_pricing_history_mutation();
drop function app_data_agent.close_pricing_version_interval();

alter function app_data_agent.reject_commercial_archive_mutation()
  owner to data_agent_identity_rpc_owner;
revoke all on function app_data_agent.reject_commercial_archive_mutation() from public;
