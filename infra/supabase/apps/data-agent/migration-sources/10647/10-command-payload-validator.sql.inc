create or replace function app_data_agent.command_payload_is_valid(
  requested_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload)
  then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(requested_payload) as payload_key(key)
    where payload_key.key not in (
      'kind',
      'mode',
      'question_version',
      'dataset_id',
      'secret_refs',
      'datasource_id',
      'conversation_id'
    )
  ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(requested_payload -> 'kind') is distinct from 'string'
    or requested_payload ->> 'kind'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  then
    return false;
  end if;
  if requested_payload ? 'mode' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'mode') is distinct from 'string'
    or requested_payload ->> 'mode' <> 'L2'
  ) then
    return false;
  end if;
  if requested_payload ? 'question_version' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'question_version')
      is distinct from 'string'
    or requested_payload ->> 'question_version'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'dataset_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'dataset_id') is distinct from 'string'
    or requested_payload ->> 'dataset_id'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs')
      is distinct from 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs')
        not between 1 and 32
    then
      return false;
    end if;
    for item in
      select element.value
      from pg_catalog.jsonb_array_elements(
        requested_payload -> 'secret_refs'
      ) as element(value)
    loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'string'
        or item #>> '{}'
          !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then
        return false;
      end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'datasource_id') is distinct from 'string'
    or requested_payload ->> 'datasource_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'conversation_id' and (
    not (requested_payload ? 'datasource_id')
    or pg_catalog.jsonb_typeof(requested_payload -> 'conversation_id') is distinct from 'string'
    or requested_payload ->> 'conversation_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;
  return true;
end
$function$;
