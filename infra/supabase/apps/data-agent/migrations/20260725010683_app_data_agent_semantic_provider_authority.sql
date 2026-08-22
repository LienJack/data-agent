-- semantic_provider_authority_migration_checksum: sha256:af639edec2913419f31ac97c6d5d29db3b952a7ab3ecd790be81ed85eaba7b99
-- 10683 persists the semantic-authoring Provider lifecycle before network egress.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_PROVIDER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROVIDER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010682_app_data_agent_semantic_self_publish')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_BASELINE_10682_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

alter table semantic.semantic_authoring_turn
  add column provider_request_id uuid,
  add column provider_attempt_id uuid,
  add column provider_payload_hash text check(provider_payload_hash is null or provider_payload_hash~'^sha256:[0-9a-f]{64}$'),
  add column provider_identity jsonb check(provider_identity is null or pg_catalog.jsonb_typeof(provider_identity)='object'),
  add column provider_status text check(provider_status is null or provider_status in
    ('INTENT_COMMITTED','DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED')),
  add column provider_terminal_kind text check(provider_terminal_kind is null or provider_terminal_kind in
    ('COMPLETED','FAILED','THROTTLED')),
  add column provider_observation_value text,
  add column provider_response_payload jsonb check(provider_response_payload is null or pg_catalog.jsonb_typeof(provider_response_payload)='object'),
  add column provider_intent_at timestamptz,
  add column provider_dispatched_at timestamptz,
  add column provider_response_observed_at timestamptz,
  add column provider_terminal_at timestamptz,
  add constraint semantic_authoring_provider_intent_closure check(
    (provider_status is null and provider_request_id is null and provider_attempt_id is null
      and provider_payload_hash is null and provider_identity is null and provider_intent_at is null)
    or (provider_status is not null and provider_request_id is not null and provider_attempt_id is not null
      and provider_payload_hash is not null and provider_identity is not null and provider_intent_at is not null)
  ),
  add constraint semantic_authoring_provider_dispatch_closure check(
    (provider_status='INTENT_COMMITTED')=(provider_dispatched_at is null)
    or provider_status is null
  ),
  add constraint semantic_authoring_provider_observation_closure check(
    (provider_status in ('RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED'))
      =(provider_response_observed_at is not null)
    or provider_status is null
  ),
  add constraint semantic_authoring_provider_terminal_closure check(
    (provider_status in ('COMPLETED','FAILED','THROTTLED'))
      =(provider_terminal_at is not null and provider_terminal_kind is not null and provider_response_payload is not null)
    or provider_status is null
  );

create unique index semantic_authoring_provider_request_unique
  on semantic.semantic_authoring_turn(app_id,tenant_id,environment,provider_request_id)
  where provider_request_id is not null;
create function semantic.commit_authoring_provider_intent(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid,p_attempt_id uuid,
  p_payload_hash text,p_provider_identity jsonb
) returns boolean language plpgsql volatile security definer set search_path='' as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_turn semantic.semantic_authoring_turn%rowtype;
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  if p_payload_hash!~'^sha256:[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(p_provider_identity)<>'object'
    or not app_data_agent.provider_json_object_has_exact_keys(
      p_provider_identity,array['provider','profile_id','profile_version','model_id']::text[])
  then raise exception using errcode='22023',message='SEMANTIC_PROVIDER_INTENT_INVALID'; end if;
  select * into v_run from semantic.semantic_authoring_run where app_id=p_app_id and tenant_id=p_tenant_id
    and environment=p_environment and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id
    and principal_id=p_principal_id for update;
  if not found or v_run.status<>'RUNNING' or v_run.lease_token is null
    or v_run.lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception using errcode='40001',message='SEMANTIC_PROVIDER_LEASE_STALE'; end if;
  select * into v_turn from semantic.semantic_authoring_turn where app_id=p_app_id and tenant_id=p_tenant_id
    and environment=p_environment and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id
    and turn_index=p_turn_index for update;
  if not found or v_turn.request_payload#>>'{request_id}'<>p_request_id::text
  then raise exception using errcode='22023',message='SEMANTIC_PROVIDER_REQUEST_MISMATCH'; end if;
  if v_turn.provider_status is not null then
    if v_turn.provider_request_id<>p_request_id or v_turn.provider_attempt_id<>p_attempt_id
      or v_turn.provider_payload_hash<>p_payload_hash or v_turn.provider_identity<>p_provider_identity
    then raise exception using errcode='23505',message='SEMANTIC_PROVIDER_INTENT_CONFLICT'; end if;
    return true;
  end if;
  update semantic.semantic_authoring_turn set provider_request_id=p_request_id,
    provider_attempt_id=p_attempt_id,provider_payload_hash=p_payload_hash,
    provider_identity=p_provider_identity,provider_status='INTENT_COMMITTED',
    provider_intent_at=pg_catalog.clock_timestamp()
  where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
    and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id and turn_index=p_turn_index;
  return true;
end
$function$;

create function semantic.mark_authoring_provider_dispatched(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid,p_attempt_id uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $function$
declare v_status text;
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  update semantic.semantic_authoring_turn set provider_status='DISPATCH_MARKED',
    provider_dispatched_at=pg_catalog.clock_timestamp()
  where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
    and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id and turn_index=p_turn_index
    and provider_request_id=p_request_id and provider_attempt_id=p_attempt_id
    and provider_status='INTENT_COMMITTED'
    and exists(select 1 from semantic.semantic_authoring_run r where r.app_id=p_app_id and r.tenant_id=p_tenant_id
      and r.environment=p_environment and r.semantic_domain=p_semantic_domain and r.authoring_run_id=p_authoring_run_id
      and r.principal_id=p_principal_id and r.status='RUNNING' and r.lease_token is not null
      and r.lease_expires_at>pg_catalog.clock_timestamp());
  if found then return true; end if;
  select provider_status into v_status from semantic.semantic_authoring_turn where app_id=p_app_id
    and tenant_id=p_tenant_id and environment=p_environment and semantic_domain=p_semantic_domain
    and authoring_run_id=p_authoring_run_id and turn_index=p_turn_index
    and provider_request_id=p_request_id and provider_attempt_id=p_attempt_id;
  if v_status in ('DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED') then return true; end if;
  raise exception using errcode='40001',message='SEMANTIC_PROVIDER_DISPATCH_CONFLICT';
end
$function$;

create function semantic.mark_authoring_provider_response_observed(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid,p_attempt_id uuid,
  p_terminal_kind text,p_observation_value text
) returns boolean language plpgsql volatile security definer set search_path='' as $function$
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  if p_terminal_kind not in ('COMPLETED','FAILED','THROTTLED') or p_observation_value is null
  then raise exception using errcode='22023',message='SEMANTIC_PROVIDER_OBSERVATION_INVALID'; end if;
  update semantic.semantic_authoring_turn set provider_status='RESPONSE_OBSERVED',
    provider_terminal_kind=p_terminal_kind,provider_observation_value=p_observation_value,
    provider_response_observed_at=pg_catalog.clock_timestamp()
  where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
    and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id and turn_index=p_turn_index
    and provider_request_id=p_request_id and provider_attempt_id=p_attempt_id
    and ((provider_status='DISPATCH_MARKED') or (provider_status='INTENT_COMMITTED' and p_terminal_kind='FAILED'));
  if not found then raise exception using errcode='40001',message='SEMANTIC_PROVIDER_OBSERVATION_CONFLICT'; end if;
  return true;
end
$function$;

create function semantic.commit_authoring_provider_terminal(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid,p_attempt_id uuid,
  p_terminal_kind text,p_response_payload jsonb
) returns boolean language plpgsql volatile security definer set search_path='' as $function$
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  if p_terminal_kind not in ('COMPLETED','FAILED','THROTTLED')
    or pg_catalog.jsonb_typeof(p_response_payload)<>'object'
  then raise exception using errcode='22023',message='SEMANTIC_PROVIDER_TERMINAL_INVALID'; end if;
  update semantic.semantic_authoring_turn set provider_status=p_terminal_kind,
    provider_response_payload=p_response_payload,provider_terminal_at=pg_catalog.clock_timestamp()
  where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
    and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id and turn_index=p_turn_index
    and provider_request_id=p_request_id and provider_attempt_id=p_attempt_id
    and provider_status='RESPONSE_OBSERVED' and provider_terminal_kind=p_terminal_kind;
  if not found then raise exception using errcode='40001',message='SEMANTIC_PROVIDER_TERMINAL_CONFLICT'; end if;
  return true;
end
$function$;
do $functions$
declare signature text;
begin
  foreach signature in array array[
    'semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)',
    'semantic.mark_authoring_provider_dispatched(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)',
    'semantic.mark_authoring_provider_response_observed(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,text)',
    'semantic.commit_authoring_provider_terminal(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)'
  ] loop
    execute pg_catalog.format('alter function %s owner to data_agent_u6_rpc_owner',signature);
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',signature);
    execute pg_catalog.format('grant execute on function %s to data_agent_backend',signature);
  end loop;
end
$functions$;

revoke all on semantic.semantic_authoring_turn from data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_table_privilege('data_agent_backend','semantic.semantic_authoring_turn','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'semantic.commit_authoring_provider_terminal(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_HARDENING_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010683_app_data_agent_semantic_provider_authority',
  'sha256:af639edec2913419f31ac97c6d5d29db3b952a7ab3ecd790be81ed85eaba7b99'
);
commit;
