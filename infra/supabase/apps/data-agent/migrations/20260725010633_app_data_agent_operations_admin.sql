-- operations_admin_migration_checksum: sha256:55e412e5bd87e4c4c1347257da4514c6858e3bc545f9675633c317b3758041ab
-- ============================================================
-- 10633: Workspace administration and operational health reads
-- Depends on: 20260725010632_app_data_agent_semantic_json_portability
-- Clean-install only. No legacy administration projection is supported.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'OPERATIONS_ADMIN_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'OPERATIONS_ADMIN_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010632_app_data_agent_semantic_json_portability'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_BASELINE_10632_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010633_app_data_agent_operations_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_MIGRATION_10633_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regprocedure('platform.resolve_super_admin_scope(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)') is null
    or pg_catalog.to_regclass('app_data_agent.billing_runtime_state') is null
  then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_BASELINE_AUTHORITY_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
-- ============================================================
-- 10633: Database-revalidated administration projections
-- ============================================================

create function platform.list_admin_users(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns table (projection jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(
    requested_deployment_id,
    requested_actor_principal_id
  );

  return query
  select pg_catalog.jsonb_build_object(
    'schema_version', 'admin-user-projection@1.0.0',
    'principal_id', app_user.principal_id,
    'auth_user_id', app_user.auth_user_id,
    'email', app_user.email,
    'display_name', app_user.display_name,
    'system_role', app_user.system_role,
    'status', app_user.status,
    'authz_epoch', app_user.authz_epoch,
    'active_memberships', (
      select pg_catalog.count(*)
      from app_data_agent.memberships as membership
      join app_data_agent.workspaces as workspace
        on workspace.app_id = membership.app_id
       and workspace.environment = membership.environment
       and workspace.workspace_id = membership.tenant_id
      where membership.app_id = app_user.app_id
        and membership.environment = app_user.environment
        and membership.principal_id = app_user.principal_id
        and membership.revoked_at is null
        and membership.membership_role <> 'demo'
        and workspace.lifecycle = 'ACTIVE'
    ),
    'created_at', app_user.created_at,
    'disabled_at', app_user.disabled_at
  )
  from app_data_agent.app_users as app_user
  where app_user.app_id = scope_record.app_id
    and app_user.environment = scope_record.environment
  order by
    case app_user.status when 'ACTIVE' then 0 else 1 end,
    case app_user.system_role when 'SUPER_ADMIN' then 0 else 1 end,
    app_user.display_name,
    app_user.principal_id;
end
$function$;

create function platform.list_admin_workspaces(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns table (projection jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(
    requested_deployment_id,
    requested_actor_principal_id
  );

  return query
  select pg_catalog.jsonb_build_object(
    'schema_version', 'admin-workspace-projection@1.0.0',
    'workspace_id', workspace.workspace_id,
    'slug', workspace.slug,
    'display_name', workspace.display_name,
    'lifecycle', workspace.lifecycle,
    'lifecycle_version', workspace.lifecycle_version,
    'active_members', pg_catalog.count(membership.principal_id) filter (
      where membership.revoked_at is null
        and membership.membership_role <> 'demo'
        and app_user.status = 'ACTIVE'
    ),
    'total_members', pg_catalog.count(membership.principal_id) filter (
      where membership.membership_role <> 'demo'
    ),
    'created_at', workspace.created_at,
    'archived_at', workspace.archived_at
  )
  from app_data_agent.workspaces as workspace
  left join app_data_agent.memberships as membership
    on membership.app_id = workspace.app_id
   and membership.environment = workspace.environment
   and membership.tenant_id = workspace.workspace_id
  left join app_data_agent.app_users as app_user
    on app_user.app_id = membership.app_id
   and app_user.environment = membership.environment
   and app_user.principal_id = membership.principal_id
  where workspace.app_id = scope_record.app_id
    and workspace.environment = scope_record.environment
  group by
    workspace.workspace_id,
    workspace.slug,
    workspace.display_name,
    workspace.lifecycle,
    workspace.lifecycle_version,
    workspace.created_at,
    workspace.archived_at
  order by
    case workspace.lifecycle when 'ACTIVE' then 0 else 1 end,
    workspace.display_name,
    workspace.workspace_id;
end
$function$;

create function platform.list_workspace_members(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_workspace_id uuid
)
returns table (projection jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_workspace_authority(
    requested_deployment_id,
    requested_workspace_id,
    requested_actor_principal_id,
    false
  );
  if not exists (
    select 1
    from app_data_agent.app_users as actor
    left join app_data_agent.memberships as actor_membership
      on actor_membership.app_id = actor.app_id
     and actor_membership.environment = actor.environment
     and actor_membership.principal_id = actor.principal_id
     and actor_membership.tenant_id = requested_workspace_id
     and actor_membership.revoked_at is null
     and actor_membership.membership_role <> 'demo'
    where actor.app_id = scope_record.app_id
      and actor.environment = scope_record.environment
      and actor.principal_id = requested_actor_principal_id
      and actor.status = 'ACTIVE'
      and (
        actor.system_role = 'SUPER_ADMIN'
        or actor_membership.workspace_role = 'WORKSPACE_ADMIN'
      )
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ADMIN_REQUIRED';
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'schema_version', 'admin-workspace-member-projection@1.0.0',
    'workspace_id', membership.tenant_id,
    'principal_id', app_user.principal_id,
    'email', app_user.email,
    'display_name', app_user.display_name,
    'system_role', app_user.system_role,
    'user_status', app_user.status,
    'role', membership.workspace_role,
    'source', membership.membership_source,
    'membership_version', membership.membership_version,
    'revoked_at', membership.revoked_at
  )
  from app_data_agent.memberships as membership
  join app_data_agent.app_users as app_user
    on app_user.app_id = membership.app_id
   and app_user.environment = membership.environment
   and app_user.principal_id = membership.principal_id
  where membership.app_id = scope_record.app_id
    and membership.environment = scope_record.environment
    and membership.tenant_id = requested_workspace_id
    and membership.membership_role <> 'demo'
    and membership.workspace_role is not null
  order by
    case when membership.revoked_at is null then 0 else 1 end,
    case membership.workspace_role
      when 'WORKSPACE_ADMIN' then 0
      when 'ANALYST' then 1
      else 2
    end,
    app_user.display_name,
    app_user.principal_id;
end
$function$;

create function platform.read_operations_health(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
  runtime_record app_data_agent.billing_runtime_state%rowtype;
  identity_count bigint;
  identity_last timestamptz;
  pricing_sync_count bigint;
  pricing_sync_last timestamptz;
  pricing_review_count bigint;
  pricing_review_last timestamptz;
  billing_review_count bigint;
  billing_review_last timestamptz;
  balance_count bigint;
  balance_last timestamptz;
  reconciliation_error_count bigint;
  reconciliation_warning_count bigint;
  reconciliation_last timestamptz;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(
    requested_deployment_id,
    requested_actor_principal_id
  );
  select * into strict runtime_record
  from app_data_agent.billing_runtime_state as runtime
  where runtime.app_id = scope_record.app_id
    and runtime.environment = scope_record.environment
    and runtime.deployment_id = requested_deployment_id;

  select pg_catalog.count(*), pg_catalog.max(operation.created_at)
  into identity_count, identity_last
  from app_data_agent.identity_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.status in ('PENDING', 'RETRY_REQUIRED');

  select pg_catalog.count(*), pg_catalog.max(operation.created_at)
  into pricing_sync_count, pricing_sync_last
  from app_data_agent.pricing_sync_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.status = 'FAILED'
    and operation.created_at >= pg_catalog.clock_timestamp() - interval '24 hours';

  select pg_catalog.count(*), pg_catalog.max(candidate.fetched_at)
  into pricing_review_count, pricing_review_last
  from (
    select price.fetched_at
    from app_data_agent.model_price_candidates as price
    where price.app_id = scope_record.app_id
      and price.environment = scope_record.environment
      and price.status = 'PENDING_REVIEW'
    union all
    select fx.fetched_at
    from app_data_agent.fx_rate_candidates as fx
    where fx.app_id = scope_record.app_id
      and fx.environment = scope_record.environment
      and fx.status = 'PENDING_REVIEW'
  ) as candidate;

  select pg_catalog.count(*), pg_catalog.max(bill.created_at)
  into billing_review_count, billing_review_last
  from app_data_agent.model_bills as bill
  where bill.app_id = scope_record.app_id
    and bill.environment = scope_record.environment
    and bill.state = 'REVIEW_REQUIRED';

  select pg_catalog.count(*), pg_catalog.max(account.updated_at)
  into balance_count, balance_last
  from app_data_agent.credit_accounts as account
  where account.app_id = scope_record.app_id
    and account.environment = scope_record.environment
    and (
      account.settled_microcredits < account.active_held_microcredits
      or account.available_microcredits < 0
    );

  select
    pg_catalog.count(*) filter (where finding.severity = 'ERROR'),
    pg_catalog.count(*) filter (where finding.severity = 'WARNING'),
    pg_catalog.max(finding.created_at)
  into reconciliation_error_count, reconciliation_warning_count, reconciliation_last
  from app_data_agent.billing_reconciliation_findings as finding
  where finding.app_id = scope_record.app_id
    and finding.environment = scope_record.environment;

  return pg_catalog.jsonb_build_object(
    'schema_version', 'operations-health@1.0.0',
    'generated_at', pg_catalog.clock_timestamp(),
    'billing_mode', runtime_record.mode,
    'billing_epoch', runtime_record.epoch,
    'gates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'IDENTITY_SIDE_EFFECTS',
        'status', case when identity_count > 0 then 'BLOCKED' else 'PASS' end,
        'count', identity_count,
        'reason_code', case
          when identity_count > 0 then 'IDENTITY_SIDE_EFFECTS_PENDING'
          else 'IDENTITY_SIDE_EFFECTS_CLEAR'
        end,
        'last_observed_at', identity_last
      ),
      pg_catalog.jsonb_build_object(
        'key', 'PRICING_SYNC',
        'status', case when pricing_sync_count > 0 then 'WARNING' else 'PASS' end,
        'count', pricing_sync_count,
        'reason_code', case
          when pricing_sync_count > 0 then 'PRICING_SYNC_FAILURES_RECENT'
          else 'PRICING_SYNC_HEALTHY'
        end,
        'last_observed_at', pricing_sync_last
      ),
      pg_catalog.jsonb_build_object(
        'key', 'PRICING_REVIEW',
        'status', case when pricing_review_count > 0 then 'WARNING' else 'PASS' end,
        'count', pricing_review_count,
        'reason_code', case
          when pricing_review_count > 0 then 'PRICING_REVIEW_PENDING'
          else 'PRICING_REVIEW_CLEAR'
        end,
        'last_observed_at', pricing_review_last
      ),
      pg_catalog.jsonb_build_object(
        'key', 'BILLING_REVIEW',
        'status', case when billing_review_count > 0 then 'BLOCKED' else 'PASS' end,
        'count', billing_review_count,
        'reason_code', case
          when billing_review_count > 0 then 'BILLING_REVIEW_REQUIRED'
          else 'BILLING_REVIEW_CLEAR'
        end,
        'last_observed_at', billing_review_last
      ),
      pg_catalog.jsonb_build_object(
        'key', 'BALANCE_INTEGRITY',
        'status', case when balance_count > 0 then 'BLOCKED' else 'PASS' end,
        'count', balance_count,
        'reason_code', case
          when balance_count > 0 then 'CREDIT_BALANCE_DRIFT'
          else 'CREDIT_BALANCE_INTEGRITY'
        end,
        'last_observed_at', balance_last
      ),
      pg_catalog.jsonb_build_object(
        'key', 'SHADOW_RECONCILIATION',
        'status', case
          when reconciliation_error_count > 0 then 'BLOCKED'
          when reconciliation_warning_count > 0 then 'WARNING'
          else 'PASS'
        end,
        'count', reconciliation_error_count + reconciliation_warning_count,
        'reason_code', case
          when reconciliation_error_count > 0 then 'SHADOW_RECONCILIATION_ERRORS'
          when reconciliation_warning_count > 0 then 'SHADOW_RECONCILIATION_WARNINGS'
          else 'SHADOW_RECONCILIATION_CLEAR'
        end,
        'last_observed_at', reconciliation_last
      )
    )
  );
end
$function$;
-- ============================================================
-- 10633: Exact execution grants and private raw relations
-- ============================================================

alter function platform.list_admin_users(uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_admin_workspaces(uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_workspace_members(uuid, uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.read_operations_health(uuid, uuid)
  owner to data_agent_identity_rpc_owner;

revoke all on function platform.list_admin_users(uuid, uuid) from public;
revoke all on function platform.list_admin_workspaces(uuid, uuid) from public;
revoke all on function platform.list_workspace_members(uuid, uuid, uuid) from public;
revoke all on function platform.read_operations_health(uuid, uuid) from public;

grant execute on function platform.list_admin_users(uuid, uuid) to data_agent_backend;
grant execute on function platform.list_admin_workspaces(uuid, uuid) to data_agent_backend;
grant execute on function platform.list_workspace_members(uuid, uuid, uuid)
  to data_agent_backend;
grant execute on function platform.read_operations_health(uuid, uuid)
  to data_agent_backend;

do $postconditions$
declare
  function_name text;
  function_record record;
begin
  foreach function_name in array array[
    'list_admin_users',
    'list_admin_workspaces',
    'list_workspace_members',
    'read_operations_health'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'platform'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_identity_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',')
        not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_admin_users(uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_admin_workspaces(uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_workspace_members(uuid,uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.read_operations_health(uuid,uuid)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_RPC_GRANT_MISSING';
  end if;

  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.app_users', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.workspaces', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_bills', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.credit_accounts', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_RAW_RELATION_EXPOSED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10633: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010633_app_data_agent_operations_admin',
  'sha256:55e412e5bd87e4c4c1347257da4514c6858e3bc545f9675633c317b3758041ab'
);

commit;
