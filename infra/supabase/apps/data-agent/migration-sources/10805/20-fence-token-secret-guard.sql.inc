create or replace function app_data_agent.contains_potential_plaintext_secret(
  requested_value jsonb,
  requested_key text default ''
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  normalized_key text := pg_catalog.lower(coalesce(requested_key, ''));
  value_kind text;
  text_value text;
  child_key text;
  child_value jsonb;
  sensitive_key boolean;
  secret_reference_key boolean;
  secret_reference_collection_key boolean;
  non_credential_token_key boolean;
begin
  if requested_value is null then
    return false;
  end if;

  sensitive_key := normalized_key ~
    '(^|[_-])(secret|client[_-]?secret|consumer[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|provider[_-]?token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)($|[_-])';
  secret_reference_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs?$';
  secret_reference_collection_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs$';
  non_credential_token_key := normalized_key ~
    '^(snapshot|fence|fencing)_token$';
  value_kind := pg_catalog.jsonb_typeof(requested_value);
  if non_credential_token_key then
    if value_kind = 'null' then
      return false;
    end if;
    if value_kind <> 'string' then
      return true;
    end if;
    text_value := requested_value #>> '{}';
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if sensitive_key and not secret_reference_key then
    return true;
  end if;

  if secret_reference_key
    and value_kind <> 'string'
    and not (secret_reference_collection_key and value_kind = 'array')
  then
    return true;
  end if;
  if value_kind = 'string' then
    text_value := requested_value #>> '{}';
    if secret_reference_key then
      return text_value !~*
        '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    end if;
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if value_kind = 'array' then
    if secret_reference_collection_key
      and pg_catalog.jsonb_array_length(requested_value) = 0
    then
      return true;
    end if;
    for child_value in
      select element.value
      from pg_catalog.jsonb_array_elements(requested_value) as element(value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        requested_key
      ) then
        return true;
      end if;
    end loop;
    return false;
  end if;
  if value_kind = 'object' then
    for child_key, child_value in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(requested_value) as entry(key, value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        child_key
      ) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end
$function$;
