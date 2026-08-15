-- Match packages/contracts canonicalizeJson for the authoring payload domain:
-- UTF-8 JSON strings, C-sorted ASCII object keys, ordered arrays and finite integers.
create function semantic.authoring_canonical_json(p_payload jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_type text := pg_catalog.jsonb_typeof(p_payload);
  v_result text;
begin
  if v_type in ('null', 'boolean', 'number', 'string') then
    return p_payload::text;
  end if;
  if v_type = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      semantic.authoring_canonical_json(item.value), ',' order by item.ordinality
    ), '') || ']'
    into v_result
    from pg_catalog.jsonb_array_elements(p_payload) with ordinality as item(value, ordinality);
    return v_result;
  end if;
  if v_type = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(item.key)::text || ':' ||
        semantic.authoring_canonical_json(item.value),
      ',' order by item.key collate "C"
    ), '') || '}'
    into v_result
    from pg_catalog.jsonb_each(p_payload) as item(key, value);
    return v_result;
  end if;
  raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_CANONICAL_JSON_INVALID';
end;
$function$;

create function semantic.authoring_sha256(p_payload jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      semantic.authoring_canonical_json(p_payload),
      'UTF8'
    )),
    'hex'
  )
$function$;

alter function semantic.authoring_canonical_json(jsonb) owner to data_agent_u6_rpc_owner;
alter function semantic.authoring_sha256(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function semantic.authoring_canonical_json(jsonb) from public;
revoke all on function semantic.authoring_sha256(jsonb) from public;
grant execute on function semantic.authoring_canonical_json(jsonb) to data_agent_u6_rpc_owner;
grant execute on function semantic.authoring_sha256(jsonb) to data_agent_u6_rpc_owner;
