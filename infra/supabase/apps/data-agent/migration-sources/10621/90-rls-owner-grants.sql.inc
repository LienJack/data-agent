-- ============================================================
-- 10621: RLS, policy, ACL, and owner assignments for Published F9 tables
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 5 Published F9 tables
-- ============================================================

alter table app_data_agent.attribution_capability_directory owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_eligibility_decision owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_profile_request owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_safety_verdict owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_profile_projection owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 5 Published F9 tables
-- ============================================================

alter table app_data_agent.attribution_capability_directory enable row level security;
alter table app_data_agent.attribution_capability_directory force row level security;

alter table app_data_agent.attribution_eligibility_decision enable row level security;
alter table app_data_agent.attribution_eligibility_decision force row level security;

alter table app_data_agent.attribution_profile_request enable row level security;
alter table app_data_agent.attribution_profile_request force row level security;

alter table app_data_agent.attribution_safety_verdict enable row level security;
alter table app_data_agent.attribution_safety_verdict force row level security;

alter table app_data_agent.attribution_profile_projection enable row level security;
alter table app_data_agent.attribution_profile_projection force row level security;

-- ============================================================
-- Part 3: RLS policies for Published F9 tables
-- App/Tenant/Environment isolation
-- ============================================================

create policy attribution_capability_directory_tenant_isolation
  on app_data_agent.attribution_capability_directory
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_eligibility_decision_tenant_isolation
  on app_data_agent.attribution_eligibility_decision
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_profile_request_tenant_isolation
  on app_data_agent.attribution_profile_request
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_safety_verdict_tenant_isolation
  on app_data_agent.attribution_safety_verdict
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_profile_projection_tenant_isolation
  on app_data_agent.attribution_profile_projection
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on capability directory RPCs
grant execute on function app_data_agent.publish_capability_directory(uuid, uuid, text, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_capability_directory(uuid, uuid, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on eligibility decision RPCs
grant execute on function app_data_agent.record_eligibility_decision(uuid, uuid, text, uuid, text, jsonb, boolean, text, text, text, timestamptz) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_eligibility_decision(uuid, uuid, text, text, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on profile request RPCs
grant execute on function app_data_agent.create_profile_request(uuid, uuid, text, text, text, text, text) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.submit_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.triage_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.dedupe_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.link_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.decline_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.close_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.expire_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.withdraw_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on safety verdict RPCs
grant execute on function app_data_agent.record_safety_verdict(uuid, uuid, text, uuid, uuid, text, text, jsonb, text, text, boolean, integer) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_safety_verdict(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on profile projection RPCs
grant execute on function app_data_agent.create_profile_projection(uuid, uuid, text, uuid, text, text, jsonb, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.update_profile_projection(uuid, uuid, text, uuid, jsonb, jsonb, boolean) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_active_profile_projection(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on internal functions
grant execute on function app_data_agent.hash_f9_evidence(text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.lock_f9_fence(uuid, uuid, text) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_web_role;
grant usage on schema app_data_agent to data_agent_u6_worker_role;
