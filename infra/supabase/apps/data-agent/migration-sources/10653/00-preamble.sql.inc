-- ============================================================
-- 10653: Greenfield Effective Run Config PostgreSQL authority
-- Depends on: 20260725010652_app_data_agent_environment_model_sync_concurrency
-- Creates empty authority tables only: no import, backfill, or dual-write.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'EFFECTIVE_RUN_CONFIG_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'EFFECTIVE_RUN_CONFIG_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010652_app_data_agent_environment_model_sync_concurrency'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_RUN_CONFIG_BASELINE_10652_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner'
  ) then
    create role data_agent_effective_config_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);

-- U2/U3 wire hashes match packages/contracts canonicalizeJson. JSON sent by a
-- JS builder already contains ECMAScript's shortest decimal; jsonb expands that
-- decimal without changing its value. Normalize the exact decimal rather than
-- round-tripping through float8, whose shortest tie can differ from V8.
create function app_data_agent.u2_utf16_sort_key(p_value text)
returns bytea
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  result bytea := ''::bytea;
  code_point integer;
  supplementary integer;
  high_surrogate integer;
  low_surrogate integer;
  position integer;
begin
  for position in 1..pg_catalog.char_length(p_value) loop
    code_point := pg_catalog.ascii(pg_catalog.substr(p_value,position,1));
    if code_point <= 65535 then
      result := result || pg_catalog.decode(
        pg_catalog.lpad(pg_catalog.to_hex(code_point),4,'0'),'hex');
    else
      supplementary := code_point - 65536;
      high_surrogate := 55296 + supplementary / 1024;
      low_surrogate := 56320 + supplementary % 1024;
      result := result || pg_catalog.decode(
        pg_catalog.lpad(pg_catalog.to_hex(high_surrogate),4,'0') ||
        pg_catalog.lpad(pg_catalog.to_hex(low_surrogate),4,'0'),'hex');
    end if;
  end loop;
  return result;
end
$function$;

create function app_data_agent.u2_ecmascript_number(p_payload jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  rendered text;
  sign_prefix text := '';
  integer_part text;
  fraction_part text;
  exponent_value integer;
  digits text;
  leading_zero_count integer;
  decimal_position integer;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'number' then
    raise exception using errcode = '22023', message = 'U2_CANONICAL_JSON_NUMBER_INVALID';
  end if;
  rendered := p_payload::text;
  if pg_catalog.left(rendered,1) = '-' then
    sign_prefix := '-';
    rendered := pg_catalog.substr(rendered,2);
  end if;
  if pg_catalog.strpos(rendered,'.') = 0 then
    integer_part := rendered;
    fraction_part := '';
  else
    integer_part := pg_catalog.split_part(rendered,'.',1);
    fraction_part := pg_catalog.split_part(rendered,'.',2);
  end if;
  digits := integer_part || fraction_part;
  leading_zero_count := pg_catalog.length(digits) -
    pg_catalog.length(pg_catalog.ltrim(digits,'0'));
  digits := pg_catalog.rtrim(pg_catalog.ltrim(digits,'0'),'0');
  if digits = '' then
    return '0';
  end if;
  decimal_position := pg_catalog.length(integer_part) - leading_zero_count;
  exponent_value := decimal_position - 1;
  if exponent_value >= 21 or exponent_value <= -7 then
    return sign_prefix || pg_catalog.left(digits,1) ||
      case when pg_catalog.length(digits) > 1
        then '.' || pg_catalog.substr(digits,2) else '' end ||
      'e' || case when exponent_value >= 0 then '+' else '' end || exponent_value::text;
  end if;
  if decimal_position <= 0 then
    return sign_prefix || '0.' || pg_catalog.repeat('0',-decimal_position) || digits;
  end if;
  if decimal_position >= pg_catalog.length(digits) then
    return sign_prefix || digits ||
      pg_catalog.repeat('0',decimal_position - pg_catalog.length(digits));
  end if;
  return sign_prefix || pg_catalog.substr(digits,1,decimal_position) || '.' ||
    pg_catalog.substr(digits,decimal_position + 1);
end
$function$;

create function app_data_agent.u2_contract_canonical_json(p_payload jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  payload_type text := pg_catalog.jsonb_typeof(p_payload);
  result text;
begin
  if payload_type = 'number' then
    return app_data_agent.u2_ecmascript_number(p_payload);
  end if;
  if payload_type in ('null','boolean','string') then
    return app_data_agent.attribution_canonical_json(p_payload);
  end if;
  if payload_type = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      app_data_agent.u2_contract_canonical_json(item.value),
      ',' order by item.ordinality
    ), '') || ']'
    into result
    from pg_catalog.jsonb_array_elements(p_payload) with ordinality
      as item(value, ordinality);
    return result;
  end if;
  if payload_type = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_json(object_entry.key)::text || ':' ||
        app_data_agent.u2_contract_canonical_json(object_entry.value),
      ',' order by app_data_agent.u2_utf16_sort_key(object_entry.key)
    ), '') || '}'
    into result
    from pg_catalog.jsonb_each(p_payload) as object_entry(key, value);
    return result;
  end if;
  raise exception using errcode = '22023', message = 'U2_CANONICAL_JSON_DOMAIN_INVALID';
end
$function$;

-- Keep this separate from platform.canonical_sha256: older authorities depend
-- on PostgreSQL jsonb::text formatting and cannot be rewritten in place.
create function app_data_agent.u2_canonical_sha256(p_payload jsonb)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      app_data_agent.u2_contract_canonical_json(p_payload),
      'UTF8'
    )),
    'hex'
  )
$function$;

revoke all on function app_data_agent.u2_utf16_sort_key(text) from public;
revoke all on function app_data_agent.u2_ecmascript_number(jsonb) from public;
revoke all on function app_data_agent.u2_contract_canonical_json(jsonb) from public;
revoke all on function app_data_agent.u2_canonical_sha256(jsonb) from public;
