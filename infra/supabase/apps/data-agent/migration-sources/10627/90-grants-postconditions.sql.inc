-- ============================================================
-- 10627: Private ownership, exact grants, RLS and postconditions
-- ============================================================

revoke all on all tables in schema data_agent_auth
from public, anon, authenticated, service_role, data_agent_backend, data_agent_identity_rpc_owner;
grant usage on schema data_agent_auth to data_agent_auth_runtime, data_agent_identity_rpc_owner;
grant select, insert, update, delete on table
  data_agent_auth."user",
  data_agent_auth."session",
  data_agent_auth."account",
  data_agent_auth."verification"
to data_agent_auth_runtime;
grant select on table data_agent_auth."user" to data_agent_identity_rpc_owner;

alter table app_data_agent.app_users owner to data_agent_identity_rpc_owner;
alter table app_data_agent.workspaces owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_operation_receipts owner to data_agent_identity_rpc_owner;
alter table app_data_agent.identity_audit_log owner to data_agent_identity_rpc_owner;

alter table app_data_agent.app_users enable row level security;
alter table app_data_agent.app_users force row level security;
alter table app_data_agent.workspaces enable row level security;
alter table app_data_agent.workspaces force row level security;
alter table app_data_agent.identity_operations enable row level security;
alter table app_data_agent.identity_operations force row level security;
alter table app_data_agent.identity_operation_receipts enable row level security;
alter table app_data_agent.identity_operation_receipts force row level security;
alter table app_data_agent.identity_audit_log enable row level security;
alter table app_data_agent.identity_audit_log force row level security;

create policy app_users_identity_rpc_policy
  on app_data_agent.app_users for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy workspaces_identity_rpc_policy
  on app_data_agent.workspaces for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_operations_rpc_policy
  on app_data_agent.identity_operations for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_operation_receipts_rpc_policy
  on app_data_agent.identity_operation_receipts for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy identity_audit_log_rpc_policy
  on app_data_agent.identity_audit_log for all to data_agent_identity_rpc_owner
  using (true) with check (true);
create policy memberships_identity_rpc_policy
  on app_data_agent.memberships for all to data_agent_identity_rpc_owner
  using (true) with check (true);

grant usage on schema platform, app_data_agent to data_agent_identity_rpc_owner;
grant select on table
  platform.deployment_mappings,
  platform.app_environment_lifecycle
to data_agent_identity_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb) to data_agent_identity_rpc_owner;
grant execute on function platform.acquire_lifecycle_shared_lock(uuid,text)
  to data_agent_identity_rpc_owner;
grant select, insert, update on table app_data_agent.memberships
  to data_agent_identity_rpc_owner;

alter function app_data_agent.reject_identity_evidence_mutation()
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.identity_command_payload_is_valid(jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_session_principal(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_principal_workspaces(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)
  owner to data_agent_identity_rpc_owner;
alter function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) owner to data_agent_identity_rpc_owner;

revoke all on function app_data_agent.identity_command_payload_is_valid(jsonb) from public;
revoke all on function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text) from public;
revoke all on function app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text) from public;
revoke all on function platform.resolve_session_principal(uuid,uuid) from public;
revoke all on function platform.list_principal_workspaces(uuid,uuid) from public;
revoke all on function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean) from public;
revoke all on function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) from public;

grant execute on function app_data_agent.apply_identity_command(uuid,uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.complete_identity_side_effect(uuid,uuid,uuid,boolean,text)
  to data_agent_backend;
grant execute on function platform.resolve_session_principal(uuid,uuid)
  to data_agent_backend;
grant execute on function platform.list_principal_workspaces(uuid,uuid)
  to data_agent_backend;
grant execute on function platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)
  to data_agent_backend;
grant execute on function platform.revalidate_workspace_authority(
  uuid,uuid,text,uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,boolean
) to data_agent_backend;

revoke all on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.identity_operations,
  app_data_agent.identity_operation_receipts,
  app_data_agent.identity_audit_log
from public, anon, authenticated, service_role, data_agent_backend, data_agent_auth_runtime;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'app_users', 'workspaces', 'identity_operations',
    'identity_operation_receipts', 'identity_audit_log'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('app_data_agent.%I', relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  if pg_catalog.has_schema_privilege('data_agent_backend', 'data_agent_auth', 'USAGE')
    or pg_catalog.has_table_privilege('data_agent_backend', 'data_agent_auth.session', 'SELECT')
    or pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.bootstrap_super_admin(uuid,uuid,uuid,text,text,uuid,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_PRIVATE_SURFACE_EXPOSED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'data_agent_auth'
      and class.relname = 'session'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%impersonatedBy%IS NULL%'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_IMPERSONATION_NOT_DISABLED';
  end if;
  foreach function_name in array array[
    'resolve_session_principal', 'list_principal_workspaces',
    'resolve_workspace_authority', 'revalidate_workspace_authority',
    'apply_identity_command', 'complete_identity_side_effect', 'bootstrap_super_admin'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname in ('platform', 'app_data_agent')
      and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_identity_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_IDENTITY_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
