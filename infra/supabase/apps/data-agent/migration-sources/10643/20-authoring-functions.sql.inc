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
