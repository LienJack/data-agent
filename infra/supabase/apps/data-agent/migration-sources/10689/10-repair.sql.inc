do $repair$
declare
  function_definition text;
  broken_expression constant text := 'pg_catalog.least(300, 5 * (job.failure_count + 1))';
  repaired_expression constant text := 'least(300::bigint, 5::bigint * (job.failure_count + 1))';
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.fail_relationship_index_attempt(uuid,uuid,text,uuid,text,uuid,bigint,uuid,text)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,broken_expression,'')
  ))/pg_catalog.length(broken_expression)<>1
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_SOURCE_DRIFT'; end if;
  execute pg_catalog.replace(function_definition,broken_expression,repaired_expression);
end
$repair$;
