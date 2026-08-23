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
