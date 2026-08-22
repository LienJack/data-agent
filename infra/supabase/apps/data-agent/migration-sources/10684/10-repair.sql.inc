do $repair$
declare
  function_signature constant regprocedure :=
    'app_data_agent.commit_knowledge_document(jsonb,jsonb)'::regprocedure;
  current_definition text;
  repaired_definition text;
begin
  current_definition:=pg_catalog.pg_get_functiondef(function_signature);
  if pg_catalog.strpos(current_definition,'attempt.principal_id::text')=0
    or pg_catalog.strpos(current_definition,'job.principal_id::text')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_BASELINE_CHANGED'; end if;
  repaired_definition:=pg_catalog.replace(
    current_definition,
    'attempt.principal_id::text',
    'job.principal_id::text'
  );
  if pg_catalog.strpos(repaired_definition,'attempt.principal_id::text')>0
    or pg_catalog.strpos(repaired_definition,'job.principal_id::text')=0
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_REWRITE_FAILED'; end if;
  execute repaired_definition;
end
$repair$;
