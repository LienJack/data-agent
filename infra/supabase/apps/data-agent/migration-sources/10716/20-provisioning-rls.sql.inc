create policy memberships_u6_provisioner_lock_select
on app_data_agent.memberships
for select to data_agent_u6_platform_lock_owner
using (pg_catalog.pg_has_role(session_user,'data_agent_u6_provisioner','SET'));
