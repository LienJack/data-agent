do $postconditions$
declare manual_definition text; publish_definition text;
begin
  manual_definition:=pg_catalog.pg_get_functiondef(
    'semantic.start_manual_semantic_authoring(jsonb)'::pg_catalog.regprocedure
  );
  publish_definition:=pg_catalog.pg_get_functiondef(
    'semantic.self_review_and_publish_semantic_candidate(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(manual_definition,'platform.canonical_sha256')>0
    or pg_catalog.strpos(manual_definition,'semantic.authoring_sha256')=0
    or pg_catalog.strpos(publish_definition,'platform.canonical_sha256')>0
    or (pg_catalog.length(publish_definition)-pg_catalog.length(
      pg_catalog.replace(publish_definition,'semantic.authoring_sha256','')
    ))/pg_catalog.length('semantic.authoring_sha256')<>4
  then raise exception using errcode='P0001',message='SEMANTIC_AUTHORING_DIGEST_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
