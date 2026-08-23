begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='MODEL_AUTHENTICATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='MODEL_AUTHENTICATION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

alter table app_data_agent.model_catalog_entries
  add column api_authenticated_config_version bigint,
  add column api_authenticated_at timestamptz,
  add column api_authentication_response_count integer,
  add column api_authentication_idempotency_key text,
  add column api_authenticated_by uuid,
  add constraint model_catalog_api_authentication_shape check (
    (api_authenticated_config_version is null
      and api_authenticated_at is null
      and api_authentication_response_count is null
      and api_authentication_idempotency_key is null
      and api_authenticated_by is null)
    or
    (api_authenticated_config_version between 1 and 9007199254740991
      and api_authenticated_config_version <= config_version
      and api_authenticated_at is not null
      and api_authentication_response_count between 1 and 1000
      and length(api_authentication_idempotency_key) between 8 and 128
      and api_authenticated_by is not null)
  );

create function platform.record_model_api_authentication(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
) returns jsonb
language plpgsql volatile security definer set search_path='' as $function$
declare
  scope_record record;
  catalog app_data_agent.model_catalog_entries%rowtype;
  authenticated_at timestamptz:=pg_catalog.clock_timestamp();
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id,requested_principal_id);
  if command is null
    or pg_catalog.jsonb_typeof(command)<>'object'
    or command->>'schema_version'<>'model-api-authentication@1.0.0'
    or not command ?& array[
      'schema_version','model_profile_id','expected_config_version',
      'response_item_count','idempotency_key'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as command_key(key)
      where command_key.key not in (
        'schema_version','model_profile_id','expected_config_version',
        'response_item_count','idempotency_key'
      )
    )
    or length(command->>'idempotency_key') not between 8 and 128
    or command->>'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or (command->>'response_item_count')::integer not between 1 and 1000
  then raise exception using errcode='22023',message='MODEL_AUTHENTICATION_INPUT_INVALID'; end if;

  select * into catalog
  from app_data_agent.model_catalog_entries as model
  where model.app_id=scope_record.app_id
    and model.environment=scope_record.environment
    and model.model_profile_id=(command->>'model_profile_id')::uuid
  for update;
  if not found
    or catalog.config_version<>(command->>'expected_config_version')::bigint
    or catalog.status not in ('ACTIVE','UNBILLABLE')
    or not (
      (catalog.provider='deepseek' and catalog.model_id='deepseek-v4-flash')
      or (catalog.provider='kimi' and catalog.model_id='kimi-k3')
    )
  then raise exception using errcode='40001',message='MODEL_AUTHENTICATION_TARGET_STALE'; end if;

  if catalog.api_authentication_idempotency_key=command->>'idempotency_key' then
    if catalog.api_authenticated_config_version<>catalog.config_version
      or catalog.api_authentication_response_count<>(command->>'response_item_count')::integer
    then raise exception using errcode='23505',message='MODEL_AUTHENTICATION_IDEMPOTENCY_CONFLICT'; end if;
    authenticated_at:=catalog.api_authenticated_at;
  else
    update app_data_agent.model_catalog_entries as model set
      api_authenticated_config_version=model.config_version,
      api_authenticated_at=authenticated_at,
      api_authentication_response_count=(command->>'response_item_count')::integer,
      api_authentication_idempotency_key=command->>'idempotency_key',
      api_authenticated_by=requested_principal_id,
      updated_at=authenticated_at
    where model.app_id=catalog.app_id
      and model.environment=catalog.environment
      and model.model_profile_id=catalog.model_profile_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','model-certification-view@1.0.0',
    'model_profile_id',catalog.model_profile_id,
    'model_config_version',catalog.config_version,
    'provider',catalog.provider,
    'model_id',catalog.model_id,
    'state','PASS',
    'completed_at',authenticated_at
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='MODEL_AUTHENTICATION_INPUT_INVALID';
end
$function$;

create function platform.list_model_api_authentication_views(
  requested_deployment_id uuid,
  requested_principal_id uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare scope_record record;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  select deployment.app_id,deployment.environment into strict scope_record
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id=deployment.app_id and lifecycle.environment=deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id=deployment.app_id
   and app_user.environment=deployment.environment
   and app_user.principal_id=requested_principal_id
  where deployment.deployment_id=requested_deployment_id
    and deployment.is_active
    and deployment.revoked_at is null
    and lifecycle.lifecycle_state='ACTIVE'
    and app_user.status='ACTIVE';

  return coalesce((select pg_catalog.jsonb_agg(view_document order by view_document->>'provider')
    from (
      select pg_catalog.jsonb_build_object(
        'schema_version','model-certification-view@1.0.0',
        'model_profile_id',catalog.model_profile_id,
        'model_config_version',catalog.config_version,
        'provider',catalog.provider,
        'model_id',catalog.model_id,
        'state',case when catalog.api_authenticated_config_version=catalog.config_version
          then 'PASS' else 'NOT_CERTIFIED' end,
        'completed_at',case when catalog.api_authenticated_config_version=catalog.config_version
          then catalog.api_authenticated_at else null end
      ) as view_document
      from app_data_agent.model_catalog_entries as catalog
      where catalog.app_id=scope_record.app_id
        and catalog.environment=scope_record.environment
        and catalog.provider in ('deepseek','kimi')
    ) as views),'[]'::jsonb);
end
$function$;

alter function platform.record_model_api_authentication(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_model_api_authentication_views(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
revoke all on function platform.record_model_api_authentication(uuid,uuid,jsonb),
  platform.list_model_api_authentication_views(uuid,uuid) from public;
grant execute on function platform.record_model_api_authentication(uuid,uuid,jsonb),
  platform.list_model_api_authentication_views(uuid,uuid) to data_agent_backend;

do $postconditions$
begin
  if pg_catalog.to_regprocedure('platform.record_model_api_authentication(uuid,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('platform.list_model_api_authentication_views(uuid,uuid)') is null
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','platform.record_model_api_authentication(uuid,uuid,jsonb)','EXECUTE'
    )
  then raise exception using errcode='P0001',message='MODEL_AUTHENTICATION_POSTCONDITION_FAILED'; end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend','app_data_agent.model_catalog_entries','UPDATE'
  ) then raise exception using errcode='P0001',message='MODEL_AUTHENTICATION_TABLE_ACL_WIDENED'; end if;
end
$postconditions$;
