-- Preserve legacy payload validation while adding the only U2 production payload:
-- a strict, server-built Effective Config reference with no raw resources.
create or replace function app_data_agent.command_payload_is_valid(requested_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare item jsonb; payload_kind text;
begin
  if requested_payload is null or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload) then return false; end if;
  if requested_payload ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload ->> 'kind' = 'START_L2_RESEARCH'
    and pg_catalog.jsonb_typeof(requested_payload -> 'effective_config_ref') = 'object'
    and (requested_payload -> 'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*) = 3
      from pg_catalog.jsonb_object_keys(requested_payload -> 'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload #> '{effective_config_ref,config_id}')
    and requested_payload #>> '{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload #>> '{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
  then return true; end if;

  payload_kind := requested_payload ->> 'kind';
  if payload_kind not in ('START_L2_RESEARCH','START_QA_ANALYSIS') then return false; end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(requested_payload) payload_key(key)
    where payload_key.key not in ('kind','mode','question_version','dataset_id','secret_refs',
      'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
      'provider','model_id','datasource_binding_hash')) then return false; end if;
  if payload_kind = 'START_QA_ANALYSIS' and not (requested_payload ?& array[
    'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
    'provider','model_id','datasource_binding_hash']) then return false; end if;
  if requested_payload ? 'mode' and requested_payload ->> 'mode' <> 'L2' then return false; end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs') <> 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs') not between 1 and 32
    then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload -> 'secret_refs') loop
      if item #>> '{}' !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and requested_payload ->> 'datasource_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'conversation_id' and requested_payload ->> 'conversation_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'message_id' and requested_payload ->> 'message_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_profile_id' and requested_payload ->> 'model_profile_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_config_version'
    and requested_payload ->> 'model_config_version' !~ '^[1-9][0-9]*$' then return false; end if;
  if requested_payload ? 'provider' and requested_payload ->> 'provider'
    not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini') then return false; end if;
  if requested_payload ? 'model_id'
    and pg_catalog.length(requested_payload ->> 'model_id') not between 1 and 256 then return false; end if;
  if requested_payload ? 'datasource_binding_hash'
    and requested_payload ->> 'datasource_binding_hash' !~ '^sha256:[0-9a-f]{64}$' then return false; end if;
  return true;
end
$function$;
