-- ============================================================
-- 10643: Semantic authoring cross-runtime canonical digests
-- ============================================================
-- Depends on: 20260725010642_app_data_agent_semantic_authoring_audit

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_DIGEST_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_DIGEST_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010642_app_data_agent_semantic_authoring_audit';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_BASELINE_10642_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010643_app_data_agent_semantic_authoring_digest'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_MIGRATION_10643_ALREADY_RECORDED';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
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
-- 10639 predates the cross-runtime digest contract and rechecked TypeScript
-- digests with jsonb::text. Replace only those exact checks on the fixed baseline.
do $replace_authoring_digests$
declare
  signature text;
  function_oid regprocedure;
  function_definition text;
begin
  foreach signature in array array[
    'semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)',
    'semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)',
    'semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)',
    'semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
    'semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_FUNCTION_MISSING';
    end if;
    function_definition := pg_catalog.pg_get_functiondef(function_oid);
    if pg_catalog.strpos(function_definition, 'platform.canonical_sha256') = 0 then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_BASELINE_DRIFT';
    end if;
    execute pg_catalog.replace(
      function_definition,
      'platform.canonical_sha256',
      'semantic.authoring_sha256'
    );
  end loop;
end
$replace_authoring_digests$;
do $postconditions$
declare
  signature text;
  function_oid regprocedure;
  function_definition text;
  function_record record;
  fixture jsonb := pg_catalog.jsonb_build_object(
    'z', 2,
    'a', pg_catalog.jsonb_build_array(1, true, null, '中文')
  );
  fixture_canonical text := '{"a":[1,true,null,"中文"],"z":2}';
begin
  if semantic.authoring_canonical_json(fixture) <> fixture_canonical
    or semantic.authoring_sha256(fixture) <> 'sha256:' || pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(fixture_canonical, 'UTF8')),
      'hex'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_CANONICALIZATION_INVALID';
  end if;
  foreach signature in array array[
    'semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)',
    'semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)',
    'semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)',
    'semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
    'semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    function_definition := pg_catalog.pg_get_functiondef(function_oid);
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where procedure.oid = function_oid::oid;
    if pg_catalog.strpos(function_definition, 'platform.canonical_sha256') > 0
      or pg_catalog.strpos(function_definition, 'semantic.authoring_sha256') = 0
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
        'search_path=', 'search_path=""'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
  if has_function_privilege(
    'data_agent_backend', 'semantic.authoring_sha256(jsonb)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_DIGEST_BACKEND_PRIVILEGE_LEAK';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010643_app_data_agent_semantic_authoring_digest',
  'sha256:7d043dba5b8f39a45636ce3fa2f8c11a05e8798ff9bd34358f7106a25a724b07'
);

commit;
