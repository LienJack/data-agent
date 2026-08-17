create or replace function app_data_agent.command_payload_is_valid(requested_payload jsonb)
returns boolean language plpgsql immutable set search_path='' as $function$
declare item jsonb; payload_kind text; expected_profiles text[]:=array[
  'governed-text2sql-agent','report-writing-agent','semantic-management-agent']; profile_index integer:=1;
begin
  if requested_payload is null or pg_catalog.jsonb_typeof(requested_payload)<>'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload) then return false; end if;
  if requested_payload ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*)=2 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload->>'kind'='START_L2_RESEARCH'
    and pg_catalog.jsonb_typeof(requested_payload->'effective_config_ref')='object'
    and (requested_payload->'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(
      requested_payload->'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload#>'{effective_config_ref,config_id}')
    and requested_payload#>>'{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload#>>'{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
  then return true; end if;
  if requested_payload ?& array['kind','effective_config_ref','profile_refs']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload->>'kind'='START_DATA_AGENT_TEAM'
    and pg_catalog.jsonb_typeof(requested_payload->'effective_config_ref')='object'
    and (requested_payload->'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(
      requested_payload->'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload#>'{effective_config_ref,config_id}')
    and requested_payload#>>'{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload#>>'{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(requested_payload->'profile_refs')='array'
    and pg_catalog.jsonb_array_length(requested_payload->'profile_refs')=3
  then
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload->'profile_refs') loop
      if (select pg_catalog.count(*)<>3 from pg_catalog.jsonb_object_keys(item))
        or not item ?& array['profile_id','revision','revision_hash']
        or item->>'profile_id'<>expected_profiles[profile_index]
        or item->>'revision' !~ '^[1-9][0-9]*$'
        or item->>'revision_hash' !~ '^sha256:[0-9a-f]{64}$'
      then return false; end if;
      profile_index:=profile_index+1;
    end loop;
    return true;
  end if;
  payload_kind:=requested_payload->>'kind';
  if payload_kind not in ('START_L2_RESEARCH','START_QA_ANALYSIS') then return false; end if;
  if exists(select 1 from pg_catalog.jsonb_object_keys(requested_payload) payload_key(key)
    where payload_key.key not in ('kind','mode','question_version','dataset_id','secret_refs',
      'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
      'provider','model_id','datasource_binding_hash')) then return false; end if;
  if payload_kind='START_QA_ANALYSIS' and not (requested_payload ?& array[
    'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
    'provider','model_id','datasource_binding_hash']) then return false; end if;
  if requested_payload ? 'mode' and requested_payload->>'mode'<>'L2' then return false; end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload->'secret_refs')<>'array'
      or pg_catalog.jsonb_array_length(requested_payload->'secret_refs') not between 1 and 32
    then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload->'secret_refs') loop
      if item#>>'{}' !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and requested_payload->>'datasource_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'conversation_id' and requested_payload->>'conversation_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'message_id' and requested_payload->>'message_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_profile_id' and requested_payload->>'model_profile_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_config_version'
    and requested_payload->>'model_config_version' !~ '^[1-9][0-9]*$' then return false; end if;
  if requested_payload ? 'provider' and requested_payload->>'provider'
    not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini') then return false; end if;
  if requested_payload ? 'model_id'
    and pg_catalog.length(requested_payload->>'model_id') not between 1 and 256 then return false; end if;
  if requested_payload ? 'datasource_binding_hash'
    and requested_payload->>'datasource_binding_hash' !~ '^sha256:[0-9a-f]{64}$' then return false; end if;
  return true;
end
$function$;

create function app_data_agent.current_agent_product_profile_refs()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare refs jsonb;
begin
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'profile_id',head.profile_id,'revision',head.active_revision,
    'revision_hash',head.active_revision_hash) order by head.profile_id) into refs
  from app_data_agent.agent_product_profile_heads head
  join app_data_agent.agent_product_profile_revisions revision
    on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.profile_id=head.profile_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
  where head.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
    and head.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
    and head.environment=pg_catalog.current_setting('data_agent.environment')
    and head.lifecycle='ENABLED' and revision.approval_status='APPROVED';
  if pg_catalog.jsonb_array_length(coalesce(refs,'[]'::jsonb))<>3
    or refs#>>'{0,profile_id}'<>'governed-text2sql-agent'
    or refs#>>'{1,profile_id}'<>'report-writing-agent'
    or refs#>>'{2,profile_id}'<>'semantic-management-agent'
  then return null; end if;
  return refs;
end
$function$;

create function app_data_agent.route_question_run_to_agent_team()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare profile_refs jsonb;
begin
  if new.payload_json->>'kind'='START_L2_RESEARCH'
    and new.payload_json ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*)=2 from pg_catalog.jsonb_object_keys(new.payload_json))
  then
    profile_refs:=app_data_agent.current_agent_product_profile_refs();
    if profile_refs is null then return new; end if;
    new.payload_json:=pg_catalog.jsonb_build_object(
      'kind','START_DATA_AGENT_TEAM','effective_config_ref',new.payload_json->'effective_config_ref',
      'profile_refs',profile_refs);
    new.payload_hash:=platform.canonical_sha256(new.payload_json);
  end if;
  return new;
end
$function$;

create trigger commands_route_question_run_to_agent_team
before insert on app_data_agent.commands for each row
execute function app_data_agent.route_question_run_to_agent_team();

alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
rename to assert_provider_active_worker_lease_pre_u20;

create function app_data_agent.assert_provider_active_worker_lease(requested_lease jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare legacy_lease jsonb;
begin
  if requested_lease->>'command_kind'='START_DATA_AGENT_TEAM' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
        'scope','principal_id','outbox_id','run_id','command_id','command_kind','attempt_id',
        'attempt_no','delivery_attempt_no','lease_duration_ms','worker_id','lease_token',
        'worker_fence','expires_at','payload']::text[])
      or requested_lease#>>'{payload,kind}'<>'START_DATA_AGENT_TEAM'
      or not app_data_agent.command_payload_is_valid(requested_lease->'payload')
    then raise exception using errcode='22023',message='PROVIDER_WORKER_LEASE_INVALID'; end if;
    legacy_lease:=pg_catalog.jsonb_set(requested_lease,'{command_kind}',
      '"START_L2_RESEARCH"'::jsonb,false);
    legacy_lease:=pg_catalog.jsonb_set(legacy_lease,'{payload}',pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH',
      'effective_config_ref',requested_lease#>'{payload,effective_config_ref}'),false);
    return app_data_agent.assert_provider_active_worker_lease_pre_u20(legacy_lease);
  end if;
  return app_data_agent.assert_provider_active_worker_lease_pre_u20(requested_lease);
end
$function$;

__U20_QUEUE_FUNCTION_OVERRIDES__
