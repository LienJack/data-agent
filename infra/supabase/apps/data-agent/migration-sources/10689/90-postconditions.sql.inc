do $postconditions$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.fail_relationship_index_attempt(uuid,uuid,text,uuid,text,uuid,bigint,uuid,text)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'pg_catalog.least(300, 5 * (job.failure_count + 1))')>0
    or pg_catalog.strpos(function_definition,'least(300::bigint, 5::bigint * (job.failure_count + 1))')=0
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
