-- ============================================================
-- 10631: Private ownership, forced RLS and exact RPC grants
-- ============================================================

alter table app_data_agent.billing_runtime_state owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bills owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bill_price_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_bill_events owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_billing_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.billing_reconciliation_findings owner to data_agent_identity_rpc_owner;

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'billing_runtime_state','model_bills','model_bill_price_components','model_bill_events',
    'model_billing_operations','billing_reconciliation_findings'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_identity_rpc_owner using (true) with check (true)',
      relation_name || '_model_billing_rpc_policy',relation_name
    );
  end loop;
end
$rls$;

grant select,insert,update,delete on table
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
to data_agent_identity_rpc_owner;

alter function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) owner to data_agent_backend;
alter function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
revoke all on function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
) to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)
  to data_agent_identity_rpc_owner;

alter function app_data_agent.guard_model_billing_projection_mutation()
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.model_bill_payload(app_data_agent.model_bills)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.get_billing_runtime_state(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_own_model_bills(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_model_bills(uuid,uuid,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_model_billing_costs(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.authorize_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.finalize_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.review_model_billing(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reconcile_model_billing(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.decide_billing_mode(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.guard_model_billing_projection_mutation() from public;
revoke all on function app_data_agent.model_bill_payload(app_data_agent.model_bills) from public;
revoke all on function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text) from public;
revoke all on function platform.get_billing_runtime_state(uuid,uuid) from public;
revoke all on function platform.list_own_model_bills(uuid,uuid) from public;
revoke all on function platform.list_model_bills(uuid,uuid,text) from public;
revoke all on function platform.list_model_billing_costs(uuid,uuid) from public;
revoke all on function app_data_agent.authorize_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.finalize_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.review_model_billing(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.reconcile_model_billing(uuid,uuid) from public;
revoke all on function app_data_agent.decide_billing_mode(uuid,uuid,jsonb) from public;

grant execute on function platform.get_billing_runtime_state(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_own_model_bills(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_model_bills(uuid,uuid,text) to data_agent_backend;
grant execute on function platform.list_model_billing_costs(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.authorize_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.finalize_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.review_model_billing(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.reconcile_model_billing(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.decide_billing_mode(uuid,uuid,jsonb) to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'billing_runtime_state','model_bills','model_bill_price_components','model_bill_events',
    'model_billing_operations','billing_reconciliation_findings'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'MODEL_BILLING_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text)','EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_COST_HELPER_EXPOSED';
  end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_model_billing_reservation_authority(uuid,uuid,text,uuid,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_model_billing_terminal_authority(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_BILLING_RESEARCH_BRIDGE_EXPOSED';
  end if;
end
$postconditions$;
