do $repair$
declare
  function_signature constant regprocedure :=
    'app_data_agent.create_knowledge_evidence_selection(jsonb)'::regprocedure;
  current_definition text;
  repaired_definition text;
begin
  current_definition:=pg_catalog.pg_get_functiondef(function_signature);
  if pg_catalog.strpos(current_definition,'ordinal bigint:=0')=0
    or pg_catalog.strpos(current_definition,'selection_ordinal bigint:=0')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_BASELINE_CHANGED'; end if;
  repaired_definition:=pg_catalog.replace(current_definition,'ordinal bigint:=0','selection_ordinal bigint:=0');
  repaired_definition:=pg_catalog.replace(
    repaired_definition,
    '(requested_selection->>''selection_id'')::uuid,ordinal,block.document_id',
    '(requested_selection->>''selection_id'')::uuid,selection_ordinal,block.document_id'
  );
  repaired_definition:=pg_catalog.replace(
    repaired_definition,
    'ordinal:=ordinal+1',
    'selection_ordinal:=selection_ordinal+1'
  );
  if repaired_definition~'\mordinal bigint:=0'
    or pg_catalog.strpos(repaired_definition,'selection_ordinal bigint:=0')=0
    or pg_catalog.strpos(repaired_definition,'::uuid,ordinal,block.document_id')>0
    or pg_catalog.strpos(repaired_definition,'    ordinal:=ordinal+1;')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_REWRITE_FAILED'; end if;
  execute repaired_definition;
end
$repair$;
