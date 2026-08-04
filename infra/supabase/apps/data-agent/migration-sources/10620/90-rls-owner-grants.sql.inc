-- ============================================================
-- 10620: RLS, policy, ACL, and owner assignments for attribution tables
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 7 attribution tables
-- ============================================================

alter table app_data_agent.attribution_owner_map_release owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_relationship_promotion_receipt owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_conclusion_policy owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_signer_assignment owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_verification_key_revision owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_active_pointer owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_nonce_ledger owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 7 attribution tables
-- ============================================================

alter table app_data_agent.attribution_owner_map_release enable row level security;
alter table app_data_agent.attribution_owner_map_release force row level security;

alter table app_data_agent.attribution_relationship_promotion_receipt enable row level security;
alter table app_data_agent.attribution_relationship_promotion_receipt force row level security;

alter table app_data_agent.attribution_conclusion_policy enable row level security;
alter table app_data_agent.attribution_conclusion_policy force row level security;

alter table app_data_agent.attribution_signer_assignment enable row level security;
alter table app_data_agent.attribution_signer_assignment force row level security;

alter table app_data_agent.attribution_verification_key_revision enable row level security;
alter table app_data_agent.attribution_verification_key_revision force row level security;

alter table app_data_agent.attribution_active_pointer enable row level security;
alter table app_data_agent.attribution_active_pointer force row level security;

alter table app_data_agent.attribution_nonce_ledger enable row level security;
alter table app_data_agent.attribution_nonce_ledger force row level security;

-- ============================================================
-- Part 3: RLS policies for attribution tables
-- App/Tenant/Environment isolation
-- ============================================================

create policy attribution_owner_map_release_tenant_isolation
  on app_data_agent.attribution_owner_map_release
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_relationship_promotion_receipt_tenant_isolation
  on app_data_agent.attribution_relationship_promotion_receipt
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_conclusion_policy_tenant_isolation
  on app_data_agent.attribution_conclusion_policy
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_signer_assignment_tenant_isolation
  on app_data_agent.attribution_signer_assignment
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_verification_key_revision_tenant_isolation
  on app_data_agent.attribution_verification_key_revision
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_active_pointer_tenant_isolation
  on app_data_agent.attribution_active_pointer
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_nonce_ledger_tenant_isolation
  on app_data_agent.attribution_nonce_ledger
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on owner map RPCs
grant execute on function app_data_agent.provision_owner_map_release(uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_owner_map_release(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_owner_map_release(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on relationship promotion RPCs
grant execute on function app_data_agent.commit_relationship_promotion_receipt(uuid, uuid, text, uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.verify_relationship_promotion(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on conclusion policy RPCs
grant execute on function app_data_agent.provision_conclusion_policy(uuid, uuid, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_conclusion_policy(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_conclusion_policy(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on signer assignment RPCs
grant execute on function app_data_agent.provision_signer_assignment(uuid, uuid, text, uuid, text, integer, text[], jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_signer_assignment(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_signer_assignment(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on verification key RPCs
grant execute on function app_data_agent.stage_verification_key(uuid, uuid, text, text, text, boolean) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.activate_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.compromise_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.retire_verification_key(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on active pointer RPCs
grant execute on function app_data_agent.get_active_pointer(uuid, uuid, text, app_data_agent.attribution_pointer_type) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.set_active_pointer(uuid, uuid, text, app_data_agent.attribution_pointer_type, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on nonce ledger RPC
grant execute on function app_data_agent.check_and_consume_nonce(uuid, uuid, text, text, text, timestamptz, text) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
do $attribution_roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_web_role') then
    create role data_agent_u6_web_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_worker_role') then
    create role data_agent_u6_worker_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
end
$attribution_roles$;

grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_web_role;
grant usage on schema app_data_agent to data_agent_u6_worker_role;
