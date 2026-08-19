-- ============================================================
-- 10634: PostgreSQL-executor-only local credential rotation
-- ============================================================

create function app_data_agent.sync_local_super_admin_credentials(
  requested_deployment_id uuid,
  requested_email text,
  requested_username text,
  requested_password_hash text,
  requested_workspace_slug text,
  requested_operation_id uuid,
  requested_idempotency_key text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
declare
  scope_record record;
  target record;
  target_count bigint;
  old_username text;
  now_at timestamptz := pg_catalog.clock_timestamp();
  input_payload jsonb;
  input_hash text;
  result_payload jsonb;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_local_superadmin_sync',true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_EXECUTOR_UNSAFE';
  end if;
  if requested_deployment_id is null or requested_operation_id is null
    or pg_catalog.length(requested_email) not between 3 and 320
    or requested_email <> pg_catalog.lower(requested_email)
    or pg_catalog.length(requested_username) not between 3 and 30
    or requested_username <> pg_catalog.lower(requested_username)
    or requested_username !~ '^[a-z0-9_.]+$'
    or pg_catalog.length(requested_password_hash) < 20
    or pg_catalog.length(requested_workspace_slug) not between 2 and 63
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID';
  end if;
  select deployment.app_id,deployment.environment into scope_record
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id=deployment.app_id and lifecycle.environment=deployment.environment
  where deployment.deployment_id=requested_deployment_id
    and deployment.is_active and deployment.revoked_at is null
    and deployment.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and deployment.environment='local'
    and lifecycle.lifecycle_state='ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_DEPLOYMENT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array('local-superadmin-sync',scope_record.app_id,scope_record.environment)::text,0
  ));
  select pg_catalog.count(*) into target_count
  from app_data_agent.app_users as app_user
  where app_user.app_id=scope_record.app_id
    and app_user.environment=scope_record.environment
    and app_user.system_role='SUPER_ADMIN' and app_user.status='ACTIVE';
  if target_count <> 1 then
    raise exception using errcode = '21000', message = 'DEV_SUPERADMIN_SYNC_AMBIGUOUS';
  end if;
  select app_user.principal_id,app_user.auth_user_id,app_user.username,
    workspace.workspace_id
  into strict target
  from app_data_agent.app_users as app_user
  join data_agent_auth."user" as auth_user
    on auth_user."id"=app_user.auth_user_id and auth_user."email"=app_user.email
  join app_data_agent.workspaces as workspace
    on workspace.app_id=app_user.app_id and workspace.environment=app_user.environment
   and workspace.slug=requested_workspace_slug and workspace.lifecycle='ACTIVE'
  join app_data_agent.memberships as membership
    on membership.app_id=workspace.app_id and membership.environment=workspace.environment
   and membership.tenant_id=workspace.workspace_id and membership.principal_id=app_user.principal_id
   and membership.revoked_at is null and membership.system_override
   and membership.workspace_role='WORKSPACE_ADMIN'
  where app_user.app_id=scope_record.app_id
    and app_user.environment=scope_record.environment
    and app_user.system_role='SUPER_ADMIN' and app_user.status='ACTIVE';
  if requested_email is distinct from (
    select app_user.email from app_data_agent.app_users as app_user
    where app_user.app_id=scope_record.app_id and app_user.environment=scope_record.environment
      and app_user.principal_id=target.principal_id
  ) then
    raise exception using errcode = '42501', message = 'DEV_SUPERADMIN_SYNC_EMAIL_MISMATCH';
  end if;
  if exists (
    select 1 from data_agent_auth."user" as auth_user
    where auth_user."username"=requested_username and auth_user."id"<>target.auth_user_id
  ) then
    raise exception using errcode = '23505', message = 'DEV_SUPERADMIN_SYNC_USERNAME_CONFLICT';
  end if;
  old_username := target.username;
  update data_agent_auth."user" set
    "username"=requested_username,
    "displayUsername"=requested_username,
    "updatedAt"=now_at
  where "id"=target.auth_user_id;
  update app_data_agent.app_users set
    username=requested_username,
    authz_epoch=authz_epoch+1,
    updated_at=now_at
  where app_id=scope_record.app_id and environment=scope_record.environment
    and principal_id=target.principal_id;
  update data_agent_auth."account" set "password"=requested_password_hash,"updatedAt"=now_at
  where "userId"=target.auth_user_id and "providerId"='credential';
  if not found then
    raise exception using errcode = 'P0002', message = 'DEV_SUPERADMIN_SYNC_CREDENTIAL_MISSING';
  end if;
  delete from data_agent_auth."session" where "userId"=target.auth_user_id;
  input_payload := pg_catalog.jsonb_build_object(
    'schema_version','local-superadmin-sync@1.0.0',
    'operation_id',requested_operation_id,
    'idempotency_key',requested_idempotency_key,
    'email',requested_email,
    'username_before',old_username,
    'username_after',requested_username,
    'workspace_slug',requested_workspace_slug,
    'credential_rotated',true
  );
  input_hash := platform.canonical_sha256(input_payload);
  result_payload := pg_catalog.jsonb_build_object(
    'schema_version','identity-operation-receipt@1.0.0',
    'operation_id',requested_operation_id,
    'actor_principal_id',target.principal_id,
    'target_principal_id',target.principal_id,
    'workspace_id',target.workspace_id,
    'command_kind','RESET_USER_PASSWORD',
    'status','SUCCEEDED',
    'input_hash',input_hash,
    'result_version','1',
    'reason_code','DEV_SUPERADMIN_SYNC_UPDATED',
    'created_at',now_at,
    'completed_at',now_at
  );
  insert into app_data_agent.identity_operations (
    app_id,environment,operation_id,actor_principal_id,idempotency_key,command_kind,
    input_payload,input_hash,target_principal_id,workspace_id,status,result_payload,completed_at
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,
    requested_idempotency_key,'RESET_USER_PASSWORD',input_payload,input_hash,target.principal_id,
    target.workspace_id,'SUCCEEDED',result_payload,now_at
  );
  insert into app_data_agent.identity_operation_receipts (
    app_id,environment,operation_id,actor_principal_id,attempt_no,status,reason_code,details
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,1,
    'SUCCEEDED','DEV_SUPERADMIN_SYNC_UPDATED',
    pg_catalog.jsonb_build_object('username_before',old_username,'username_after',requested_username)
  );
  insert into app_data_agent.identity_audit_log (
    app_id,environment,operation_id,actor_principal_id,target_principal_id,workspace_id,
    command_kind,reason_code,details
  ) values (
    scope_record.app_id,scope_record.environment,requested_operation_id,target.principal_id,
    target.principal_id,target.workspace_id,'RESET_USER_PASSWORD','DEV_SUPERADMIN_SYNC_UPDATED',
    pg_catalog.jsonb_build_object('username_before',old_username,'username_after',requested_username,
      'sessions_revoked',true,'credential_rotated',true)
  );
  return pg_catalog.jsonb_build_object(
    'action','UPDATED','principal_id',target.principal_id,'workspace_id',target.workspace_id,
    'username',requested_username,'receipt',result_payload
  );
end
$function$;
