create function app_data_agent.hold_falcon24_authority_staging_session(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  authority record;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  requested_epoch text;
  requested_staging_id uuid;
  now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','expected_retained_assets_hash',
      'failure_code','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-hold-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or command->>'expected_retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_AUTHORITY_STAGING_HOLD_INVALID'; end if;

  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-staging:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch as row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;

  select * into session from app_data_agent.falcon24_authority_staging_sessions as row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.retained_assets_hash is distinct from command->>'expected_retained_assets_hash'
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_HOLD_MISMATCH'; end if;
  if exists(select 1 from app_data_agent.falcon24_authority_baselines as baseline
    where baseline.app_id=authority.app_id and baseline.tenant_id=authority.tenant_id
      and baseline.environment=authority.environment and baseline.staging_id=requested_staging_id
      and baseline.authority_epoch=requested_epoch)
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS'; end if;
  if session.status='HOLD' then
    if session.failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT'; end if;
  elsif session.status<>'STAGED' then
    raise exception using errcode='55000',
      message='FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL';
  else
    now_at:=pg_catalog.clock_timestamp();
    update app_data_agent.falcon24_authority_staging_sessions set
      status='HOLD',failure_code=command->>'failure_code',updated_at=now_at
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment and staging_id=requested_staging_id
        and authority_epoch=requested_epoch and status='STAGED'
      returning * into strict session;
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-hold@2.0.0',
    'authority_epoch',session.authority_epoch,
    'staging_id',session.staging_id,
    'retained_assets_hash',session.retained_assets_hash,
    'status',session.status,
    'failure_code',session.failure_code);
end
$function$;
