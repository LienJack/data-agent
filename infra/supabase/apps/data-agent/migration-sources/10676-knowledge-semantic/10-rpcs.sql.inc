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
