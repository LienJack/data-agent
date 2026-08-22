do $repair$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,'for share;','')
  ))/pg_catalog.length('for share;')<>1
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_SOURCE_DRIFT'; end if;
  execute pg_catalog.replace(function_definition,'for share;',';');
end
$repair$;
