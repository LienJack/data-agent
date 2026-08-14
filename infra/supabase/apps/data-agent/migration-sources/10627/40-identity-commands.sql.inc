-- ============================================================
-- 10627: Principal-scoped idempotent identity/workspace commands
-- ============================================================

create function app_data_agent.identity_command_payload_is_valid(requested_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  command_kind text;
begin
  if pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or not (requested_payload ?& array['schema_version', 'operation_id', 'idempotency_key', 'kind'])
    or requested_payload ->> 'schema_version' <> 'identity-command@1.0.0'
    or requested_payload ->> 'operation_id'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.length(requested_payload ->> 'idempotency_key') not between 8 and 128
    or requested_payload ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  then
    return false;
  end if;
  if requested_payload ? 'expected_version' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'expected_version') <> 'number'
    or requested_payload ->> 'expected_version' !~ '^[1-9][0-9]*$'
  ) then
    return false;
  end if;

  command_kind := requested_payload ->> 'kind';
  case command_kind
    when 'CREATE_USER' then
      return requested_payload ?& array['email', 'display_name', 'system_role']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'email', 'display_name', 'system_role'
      ] = '{}'::jsonb
        and pg_catalog.length(requested_payload ->> 'email') between 3 and 320
        and pg_catalog.length(pg_catalog.btrim(requested_payload ->> 'display_name')) between 1 and 128
        and requested_payload ->> 'system_role' in ('SUPER_ADMIN', 'USER');
    when 'DISABLE_USER', 'ENABLE_USER', 'RESET_USER_PASSWORD' then
      return requested_payload ?& array['principal_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'principal_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    when 'CREATE_WORKSPACE' then
      return requested_payload ?& array['workspace_id', 'slug', 'display_name']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'slug', 'display_name'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'slug' ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'
        and pg_catalog.length(pg_catalog.btrim(requested_payload ->> 'display_name')) between 1 and 128;
    when 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE' then
      return requested_payload ?& array['workspace_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    when 'UPSERT_WORKSPACE_MEMBER' then
      return requested_payload ?& array['workspace_id', 'principal_id', 'role']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'principal_id', 'role'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'role' in ('WORKSPACE_ADMIN', 'ANALYST', 'VIEWER');
    when 'REVOKE_WORKSPACE_MEMBER' then
      return requested_payload ?& array['workspace_id', 'principal_id', 'reason']
        and requested_payload - array[
        'schema_version', 'operation_id', 'idempotency_key', 'expected_version',
        'kind', 'workspace_id', 'principal_id', 'reason'
      ] = '{}'::jsonb
        and requested_payload ->> 'workspace_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and requested_payload ->> 'principal_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and pg_catalog.length(requested_payload ->> 'reason') between 1 and 500;
    else
      return false;
  end case;
end
$function$;

create function app_data_agent.apply_identity_command(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_auth_user_id uuid,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
<<apply_identity_command>>
declare
  resolved_app_id uuid;
  resolved_environment text;
  actor app_data_agent.app_users%rowtype;
  target app_data_agent.app_users%rowtype;
  workspace app_data_agent.workspaces%rowtype;
  existing_operation app_data_agent.identity_operations%rowtype;
  command_kind text;
  operation_id uuid;
  idempotency_key text;
  input_hash text;
  expected_version bigint;
  target_principal_id uuid;
  workspace_id uuid;
  target_role text;
  legacy_role text;
  operation_status text := 'SUCCEEDED';
  reason_code text := 'IDENTITY_OPERATION_SUCCEEDED';
  now_at timestamptz := pg_catalog.clock_timestamp();
  result_payload jsonb;
  actor_is_workspace_admin boolean := false;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.identity_command_payload_is_valid(requested_command) then
    raise exception using errcode = '22023', message = 'IDENTITY_COMMAND_INVALID';
  end if;

  command_kind := requested_command ->> 'kind';
  operation_id := (requested_command ->> 'operation_id')::uuid;
  idempotency_key := requested_command ->> 'idempotency_key';
  input_hash := platform.canonical_sha256(requested_command);
  expected_version := nullif(requested_command ->> 'expected_version', '')::bigint;
  target_principal_id := nullif(requested_command ->> 'principal_id', '')::uuid;
  workspace_id := nullif(requested_command ->> 'workspace_id', '')::uuid;

  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and lifecycle.lifecycle_state = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  select app_user.* into actor
  from app_data_agent.app_users as app_user
  where app_user.app_id = resolved_app_id
    and app_user.environment = resolved_environment
    and app_user.principal_id = requested_actor_principal_id
    and app_user.status = 'ACTIVE'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'APP_USER_DISABLED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        resolved_app_id, resolved_environment, requested_actor_principal_id, idempotency_key
      )::text,
      0
    )
  );
  select operation.* into existing_operation
  from app_data_agent.identity_operations as operation
  where operation.app_id = resolved_app_id
    and operation.environment = resolved_environment
    and operation.actor_principal_id = requested_actor_principal_id
    and operation.idempotency_key = apply_identity_command.idempotency_key
  for update;
  if found then
    if existing_operation.operation_id <> operation_id
      or existing_operation.input_hash <> input_hash
      or existing_operation.input_payload <> requested_command
    then
      raise exception using errcode = '23505', message = 'IDENTITY_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  insert into app_data_agent.identity_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    command_kind, input_payload, input_hash, target_principal_id, workspace_id, status
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id,
    idempotency_key, command_kind, requested_command, input_hash,
    target_principal_id, workspace_id, 'PENDING'
  );

  if command_kind in (
    'CREATE_USER', 'DISABLE_USER', 'ENABLE_USER', 'RESET_USER_PASSWORD',
    'CREATE_WORKSPACE', 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE'
  ) and actor.system_role <> 'SUPER_ADMIN' then
    raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
  end if;

  case command_kind
    when 'CREATE_USER' then
      if requested_auth_user_id is null or not exists (
        select 1 from data_agent_auth."user" as auth_user
        where auth_user."id" = requested_auth_user_id
          and auth_user."email" = requested_command ->> 'email'
      ) then
        raise exception using errcode = 'P0001', message = 'IDENTITY_OPERATION_RETRY_REQUIRED';
      end if;
      target_principal_id := operation_id;
      insert into app_data_agent.app_users (
        app_id, environment, principal_id, auth_user_id, email, display_name, system_role
      ) values (
        resolved_app_id, resolved_environment, target_principal_id, requested_auth_user_id,
        requested_command ->> 'email', requested_command ->> 'display_name',
        requested_command ->> 'system_role'
      );
      if requested_command ->> 'system_role' = 'SUPER_ADMIN' then
        insert into app_data_agent.memberships (
          app_id, tenant_id, environment, principal_id, membership_role,
          workspace_role, membership_source, system_override
        )
        select
          workspace_row.app_id, workspace_row.workspace_id, workspace_row.environment,
          target_principal_id, 'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
        from app_data_agent.workspaces as workspace_row
        where workspace_row.app_id = resolved_app_id
          and workspace_row.environment = resolved_environment
          and workspace_row.lifecycle = 'ACTIVE';
      end if;

    when 'DISABLE_USER' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      if target.system_role = 'SUPER_ADMIN' and target.status = 'ACTIVE' and (
        select pg_catalog.count(*) from app_data_agent.app_users as app_user
        where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
          and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE'
      ) <= 1 then
        raise exception using errcode = '42501', message = 'LAST_SUPER_ADMIN_REQUIRED';
      end if;
      update app_data_agent.app_users as target_user
      set status = 'DISABLED', disabled_at = now_at, authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;
      operation_status := 'RETRY_REQUIRED';
      reason_code := 'IDENTITY_OPERATION_RETRY_REQUIRED';

    when 'ENABLE_USER' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.app_users as target_user
      set status = 'ACTIVE', disabled_at = null, authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;

    when 'RESET_USER_PASSWORD' then
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and target.authz_epoch <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.app_users as target_user
      set authz_epoch = authz_epoch + 1, updated_at = now_at
      where target_user.app_id = resolved_app_id and target_user.environment = resolved_environment
        and target_user.principal_id = apply_identity_command.target_principal_id;
      operation_status := 'RETRY_REQUIRED';
      reason_code := 'IDENTITY_OPERATION_RETRY_REQUIRED';

    when 'CREATE_WORKSPACE' then
      insert into app_data_agent.workspaces (
        app_id, environment, workspace_id, slug, display_name, created_by_principal_id
      ) values (
        resolved_app_id, resolved_environment, workspace_id,
        requested_command ->> 'slug', requested_command ->> 'display_name',
        requested_actor_principal_id
      );
      insert into app_data_agent.memberships (
        app_id, tenant_id, environment, principal_id, membership_role,
        workspace_role, membership_source, system_override
      )
      select
        app_user.app_id, workspace_id, app_user.environment, app_user.principal_id,
        'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE';

    when 'ARCHIVE_WORKSPACE', 'RESTORE_WORKSPACE' then
      select workspace_row.* into workspace
      from app_data_agent.workspaces as workspace_row
      where workspace_row.app_id = resolved_app_id
        and workspace_row.environment = resolved_environment
        and workspace_row.workspace_id = apply_identity_command.workspace_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if expected_version is not null and workspace.lifecycle_version <> expected_version then
        raise exception using errcode = '40001', message = 'IDENTITY_OPERATION_CONFLICT';
      end if;
      update app_data_agent.workspaces as target_workspace
      set lifecycle = case command_kind when 'ARCHIVE_WORKSPACE' then 'ARCHIVED' else 'ACTIVE' end,
          archived_at = case command_kind when 'ARCHIVE_WORKSPACE' then now_at else null end,
          lifecycle_version = lifecycle_version + 1,
          updated_at = now_at
      where target_workspace.app_id = resolved_app_id
        and target_workspace.environment = resolved_environment
        and target_workspace.workspace_id = workspace.workspace_id;

    when 'UPSERT_WORKSPACE_MEMBER', 'REVOKE_WORKSPACE_MEMBER' then
      select workspace_row.* into workspace
      from app_data_agent.workspaces as workspace_row
      where workspace_row.app_id = resolved_app_id
        and workspace_row.environment = resolved_environment
        and workspace_row.workspace_id = apply_identity_command.workspace_id
        and workspace_row.lifecycle = 'ACTIVE'
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      select exists (
        select 1 from app_data_agent.memberships as membership
        where membership.app_id = resolved_app_id and membership.environment = resolved_environment
          and membership.tenant_id = apply_identity_command.workspace_id
          and membership.principal_id = requested_actor_principal_id
          and membership.membership_role = 'owner' and membership.revoked_at is null
      ) into actor_is_workspace_admin;
      if actor.system_role <> 'SUPER_ADMIN' and not actor_is_workspace_admin then
        raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
      end if;
      select app_user.* into target
      from app_data_agent.app_users as app_user
      where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
        and app_user.principal_id = apply_identity_command.target_principal_id
      for update;
      if not found then
        raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
      end if;
      if actor.system_role <> 'SUPER_ADMIN' and target.system_role = 'SUPER_ADMIN' then
        raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
      end if;
      if command_kind = 'UPSERT_WORKSPACE_MEMBER' then
        target_role := requested_command ->> 'role';
        if target.system_role = 'SUPER_ADMIN' and target_role <> 'WORKSPACE_ADMIN' then
          raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
        end if;
        legacy_role := case target_role
          when 'WORKSPACE_ADMIN' then 'owner'
          when 'ANALYST' then 'analyst'
          else 'viewer'
        end;
        insert into app_data_agent.memberships (
          app_id, tenant_id, environment, principal_id, membership_role,
          workspace_role, membership_source, system_override
        ) values (
          resolved_app_id, workspace_id, resolved_environment, target_principal_id,
          legacy_role, target_role,
          case when target.system_role = 'SUPER_ADMIN' then 'SYSTEM_ROLE' else 'EXPLICIT' end,
          target.system_role = 'SUPER_ADMIN'
        )
        on conflict (app_id, tenant_id, environment, principal_id)
        do update set
          membership_role = excluded.membership_role,
          workspace_role = excluded.workspace_role,
          membership_source = excluded.membership_source,
          system_override = excluded.system_override,
          membership_version = app_data_agent.memberships.membership_version + 1,
          revoked_at = null,
          updated_at = now_at;
      else
        if target.system_role = 'SUPER_ADMIN' then
          raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
        end if;
        update app_data_agent.memberships as target_membership
        set revoked_at = now_at,
            membership_version = membership_version + 1,
            updated_at = now_at
        where target_membership.app_id = resolved_app_id
          and target_membership.environment = resolved_environment
          and target_membership.tenant_id = apply_identity_command.workspace_id
          and target_membership.principal_id = apply_identity_command.target_principal_id
          and target_membership.revoked_at is null;
        if not found then
          raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
        end if;
      end if;
  end case;

  result_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'identity-operation-receipt@1.0.0',
    'operation_id', operation_id,
    'actor_principal_id', requested_actor_principal_id,
    'target_principal_id', target_principal_id,
    'workspace_id', workspace_id,
    'command_kind', command_kind,
    'status', operation_status,
    'input_hash', input_hash,
    'result_version', '1',
    'reason_code', reason_code,
    'created_at', now_at,
    'completed_at', now_at
  );
  update app_data_agent.identity_operations as identity_operation
  set target_principal_id = apply_identity_command.target_principal_id,
      workspace_id = apply_identity_command.workspace_id,
      status = apply_identity_command.operation_status,
      result_payload = apply_identity_command.result_payload,
      completed_at = now_at
  where identity_operation.app_id = resolved_app_id
    and identity_operation.environment = resolved_environment
    and identity_operation.operation_id = apply_identity_command.operation_id;
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id, 1,
    operation_status, reason_code,
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    workspace_id, command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, operation_id, requested_actor_principal_id,
    target_principal_id, workspace_id, command_kind, reason_code,
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  return result_payload;
end
$function$;

create function app_data_agent.complete_identity_side_effect(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  requested_operation_id uuid,
  succeeded boolean,
  requested_reason_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  resolved_app_id uuid;
  resolved_environment text;
  operation app_data_agent.identity_operations%rowtype;
  next_attempt integer;
  final_status text;
  final_result jsonb;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE')
    or succeeded is null
    or requested_reason_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
  then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join app_data_agent.app_users as actor
    on actor.app_id = deployment.app_id and actor.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active
    and actor.principal_id = requested_actor_principal_id
    and actor.system_role = 'SUPER_ADMIN' and actor.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ROLE_DENIED';
  end if;
  select operation_row.* into operation
  from app_data_agent.identity_operations as operation_row
  where operation_row.app_id = resolved_app_id
    and operation_row.environment = resolved_environment
    and operation_row.operation_id = requested_operation_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;
  final_status := case when succeeded then 'SUCCEEDED' else 'FAILED' end;
  if operation.status in ('SUCCEEDED', 'FAILED') then
    if operation.status <> final_status then
      raise exception using errcode = '23505', message = 'IDENTITY_OPERATION_CONFLICT';
    end if;
    return operation.result_payload;
  end if;
  select coalesce(pg_catalog.max(receipt.attempt_no), 0) + 1 into next_attempt
  from app_data_agent.identity_operation_receipts as receipt
  where receipt.app_id = resolved_app_id and receipt.environment = resolved_environment
    and receipt.operation_id = requested_operation_id;
  final_result := operation.result_payload || pg_catalog.jsonb_build_object(
    'status', final_status,
    'reason_code', requested_reason_code,
    'completed_at', now_at
  );
  update app_data_agent.identity_operations
  set status = final_status,
      result_payload = final_result,
      result_version = result_version + 1,
      completed_at = now_at
  where app_id = resolved_app_id and environment = resolved_environment
    and operation_id = requested_operation_id;
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_actor_principal_id, next_attempt, final_status, requested_reason_code,
    pg_catalog.jsonb_build_object('side_effect_completed', succeeded)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    workspace_id, command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_actor_principal_id, operation.target_principal_id, operation.workspace_id,
    operation.command_kind, requested_reason_code,
    pg_catalog.jsonb_build_object('side_effect_completed', succeeded)
  );
  return final_result;
end
$function$;

create function app_data_agent.bootstrap_super_admin(
  requested_deployment_id uuid,
  requested_auth_user_id uuid,
  requested_principal_id uuid,
  requested_email text,
  requested_display_name text,
  requested_operation_id uuid,
  requested_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  resolved_app_id uuid;
  resolved_environment text;
  now_at timestamptz := pg_catalog.clock_timestamp();
  input_payload jsonb;
  input_hash text;
  result_payload jsonb;
begin
  if session_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_superadmin_bootstrap', true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_BOOTSTRAP_DISABLED';
  end if;
  if requested_auth_user_id is null or requested_principal_id is null
    or requested_operation_id is null
    or pg_catalog.length(requested_email) not between 3 and 320
    or pg_catalog.length(pg_catalog.btrim(requested_display_name)) not between 1 and 128
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'IDENTITY_COMMAND_INVALID';
  end if;
  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and lifecycle.lifecycle_state = 'ACTIVE';
  if not found or not exists (
    select 1 from data_agent_auth."user" as auth_user
    where auth_user."id" = requested_auth_user_id and auth_user."email" = requested_email
  ) then
    raise exception using errcode = 'P0001', message = 'IDENTITY_OPERATION_RETRY_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array('superadmin-bootstrap', resolved_app_id, resolved_environment)::text,
      0
    )
  );
  if exists (
    select 1 from app_data_agent.app_users as app_user
    where app_user.app_id = resolved_app_id and app_user.environment = resolved_environment
      and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_ALREADY_BOOTSTRAPPED';
  end if;
  input_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'superadmin-bootstrap@1.0.0',
    'operation_id', requested_operation_id,
    'idempotency_key', requested_idempotency_key,
    'principal_id', requested_principal_id,
    'auth_user_id', requested_auth_user_id,
    'email', requested_email,
    'display_name', requested_display_name
  );
  input_hash := platform.canonical_sha256(input_payload);
  insert into app_data_agent.app_users (
    app_id, environment, principal_id, auth_user_id, email, display_name, system_role
  ) values (
    resolved_app_id, resolved_environment, requested_principal_id, requested_auth_user_id,
    requested_email, requested_display_name, 'SUPER_ADMIN'
  );
  insert into app_data_agent.memberships (
    app_id, tenant_id, environment, principal_id, membership_role,
    workspace_role, membership_source, system_override
  )
  select workspace.app_id, workspace.workspace_id, workspace.environment,
    requested_principal_id, 'owner', 'WORKSPACE_ADMIN', 'SYSTEM_ROLE', true
  from app_data_agent.workspaces as workspace
  where workspace.app_id = resolved_app_id and workspace.environment = resolved_environment
    and workspace.lifecycle = 'ACTIVE';
  result_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'identity-operation-receipt@1.0.0',
    'operation_id', requested_operation_id,
    'actor_principal_id', requested_principal_id,
    'target_principal_id', requested_principal_id,
    'workspace_id', null,
    'command_kind', 'CREATE_USER',
    'status', 'SUCCEEDED',
    'input_hash', input_hash,
    'result_version', '1',
    'reason_code', 'IDENTITY_OPERATION_SUCCEEDED',
    'created_at', now_at,
    'completed_at', now_at
  );
  insert into app_data_agent.identity_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    command_kind, input_payload, input_hash, target_principal_id, status,
    result_payload, completed_at
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, requested_idempotency_key, 'CREATE_USER', input_payload,
    input_hash, requested_principal_id, 'SUCCEEDED', result_payload, now_at
  );
  insert into app_data_agent.identity_operation_receipts (
    app_id, environment, operation_id, actor_principal_id, attempt_no,
    status, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, 1, 'SUCCEEDED', 'IDENTITY_OPERATION_SUCCEEDED',
    pg_catalog.jsonb_build_object('input_hash', input_hash)
  );
  insert into app_data_agent.identity_audit_log (
    app_id, environment, operation_id, actor_principal_id, target_principal_id,
    command_kind, reason_code, details
  ) values (
    resolved_app_id, resolved_environment, requested_operation_id,
    requested_principal_id, requested_principal_id, 'CREATE_USER',
    'IDENTITY_OPERATION_SUCCEEDED',
    pg_catalog.jsonb_build_object('bootstrap', true, 'input_hash', input_hash)
  );
  return result_payload;
end
$function$;
