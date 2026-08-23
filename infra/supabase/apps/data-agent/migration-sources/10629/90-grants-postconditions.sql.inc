-- ============================================================
-- 10629: Private ownership, RLS, exact grants and postconditions
-- ============================================================

alter table app_data_agent.pricing_control_state owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_catalog_entries owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_config_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_sync_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_candidates owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_candidate_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_price_components owner to data_agent_identity_rpc_owner;
alter table app_data_agent.fx_rate_candidates owner to data_agent_identity_rpc_owner;
alter table app_data_agent.fx_rate_versions owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_control_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.pricing_audit_log owner to data_agent_identity_rpc_owner;

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'pricing_control_state','model_catalog_entries','model_config_versions',
    'pricing_sync_operations','model_price_candidates','model_price_candidate_components',
    'model_price_versions','model_price_components','fx_rate_candidates','fx_rate_versions',
    'pricing_control_operations','pricing_audit_log'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security', relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security', relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_identity_rpc_owner using (true) with check (true)',
      relation_name || '_pricing_rpc_policy', relation_name
    );
  end loop;
end
$rls$;

grant select on table platform.deployment_mappings, platform.app_environment_lifecycle
  to data_agent_identity_rpc_owner;
grant select on table app_data_agent.app_users to data_agent_identity_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_identity_rpc_owner;
grant select, insert, update, delete on table
  app_data_agent.pricing_control_state,
  app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log
to data_agent_identity_rpc_owner;

alter function app_data_agent.reject_pricing_history_mutation() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.close_pricing_version_interval() owner to data_agent_identity_rpc_owner;
alter function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_super_admin_scope(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_model_catalog(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_active_model_catalog(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_model_price_candidates(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_fx_rate_candidates(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.pricing_control_state,
  app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function platform.resolve_super_admin_scope(uuid,uuid) from public;
revoke all on function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb)
  from public;
revoke all on function platform.list_model_catalog(uuid,uuid) from public;
revoke all on function platform.list_active_model_catalog(uuid,uuid) from public;
revoke all on function platform.list_model_price_candidates(uuid,uuid) from public;
revoke all on function platform.list_fx_rate_candidates(uuid,uuid) from public;
revoke all on function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) from public;

grant execute on function platform.list_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_active_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_model_price_candidates(uuid,uuid) to data_agent_backend;
grant execute on function platform.list_fx_rate_candidates(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb) to data_agent_backend;
grant execute on function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb) to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'pricing_control_state','model_catalog_entries','model_config_versions',
    'pricing_sync_operations','model_price_candidates','model_price_candidate_components',
    'model_price_versions','model_price_components','fx_rate_candidates','fx_rate_versions',
    'pricing_control_operations','pricing_audit_log'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('app_data_agent.%I', relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.resolve_super_admin_scope(uuid,uuid)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_AUTHORITY_HELPER_EXPOSED';
  end if;
end
$postconditions$;
