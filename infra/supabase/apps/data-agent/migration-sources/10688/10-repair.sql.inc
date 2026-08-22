do $repair$
declare
  function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.start_manual_semantic_authoring(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'platform.canonical_sha256')=0
    or pg_catalog.strpos(function_definition,'semantic.authoring_sha256')>0
  then raise exception using errcode='P0001',message='SEMANTIC_MANUAL_DIGEST_REPAIR_SOURCE_DRIFT'; end if;
  function_definition:=pg_catalog.replace(
    function_definition,'platform.canonical_sha256','semantic.authoring_sha256'
  );
  execute function_definition;

  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.self_review_and_publish_semantic_candidate(jsonb)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,'platform.canonical_sha256','')
  ))/pg_catalog.length('platform.canonical_sha256')<>4
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_DIGEST_REPAIR_SOURCE_DRIFT'; end if;
  function_definition:=pg_catalog.replace(
    function_definition,'platform.canonical_sha256','semantic.authoring_sha256'
  );
  execute function_definition;
end
$repair$;
