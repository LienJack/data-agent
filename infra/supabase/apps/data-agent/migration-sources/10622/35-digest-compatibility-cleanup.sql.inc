-- ============================================================
-- 10622: Remove the temporary pgcrypto parser shim
-- ============================================================
-- Historical 10620/10621 SQL bodies contain an invalid canonical helper and
-- qualify digest in pg_catalog. Rewrite the canonical helper and both hashes,
-- then remove only the compatibility aids explicitly tagged by 10619.
-- CREATE OR REPLACE preserves owner/ACL.

create or replace function app_data_agent.attribution_canonical_json(
  p_value jsonb
) returns text
  language plpgsql
  strict
  immutable
  set search_path = ''
as $function$
declare
  result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_json(object_entry.key)::text || ':' ||
            app_data_agent.attribution_canonical_json(object_entry.value),
          ',' order by object_entry.key
        ),
        ''
      ) || '}'
      into result
      from pg_catalog.jsonb_each(p_value) as object_entry(key, value);
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          app_data_agent.attribution_canonical_json(array_entry.value),
          ',' order by array_entry.ordinal
        ),
        ''
      ) || ']'
      into result
      from pg_catalog.jsonb_array_elements(p_value) with ordinality
        as array_entry(value, ordinal);
    when 'string' then
      result := pg_catalog.to_json(p_value #>> '{}')::text;
    when 'number' then
      result := p_value::text;
    when 'boolean' then
      result := p_value::text;
    when 'null' then
      result := 'null';
    else
      raise exception using
        errcode = '22023',
        message = 'ATTRIBUTION_CANONICAL_JSON_UNSUPPORTED_TYPE';
  end case;
  return result;
end
$function$;

create or replace function app_data_agent.attribution_sha256(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      p_domain::bytea || pg_catalog.decode('00', 'hex') ||
        app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  )
$function$;

create or replace function app_data_agent.hash_f9_evidence(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      p_domain::bytea || pg_catalog.decode('00', 'hex') ||
        app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  )
$function$;

do $cleanup$
declare
  digest_oid oid;
  body_guard_oid oid;
begin
  select procedure.oid
  into digest_oid
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'pg_catalog'
    and procedure.proname = 'digest'
    and procedure.pronargs = 2
    and pg_catalog.oidvectortypes(procedure.proargtypes) = 'bytea, text'
    and pg_catalog.obj_description(procedure.oid, 'pg_proc') =
      'data-agent:10619:temporary-pgcrypto-parser-shim';

  if found then
    execute 'drop function pg_catalog.digest(bytea, text)';
  end if;

  select event_trigger.oid
  into body_guard_oid
  from pg_catalog.pg_event_trigger as event_trigger
  where event_trigger.evtname = 'data_agent_10619_attribution_body_validation'
    and pg_catalog.obj_description(event_trigger.oid, 'pg_event_trigger') =
      'data-agent:10619:temporary-attribution-function-body-validation-guard';

  if found then
    execute 'drop event trigger data_agent_10619_attribution_body_validation';
    execute 'drop function app_data_agent.attribution_compatibility_function_body_guard()';
  end if;
end
$cleanup$;
