do $postconditions$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'for share;')>0
    or pg_catalog.strpos(function_definition,'semantic.lock_semantic_authority_fence')=0
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
