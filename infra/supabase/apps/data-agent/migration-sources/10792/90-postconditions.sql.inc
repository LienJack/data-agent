do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic.semantic_successor_review_preparation',
    'semantic.semantic_successor_review_decision_document'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
      or not exists(select 1 from pg_catalog.pg_class as relation
        where relation.oid=pg_catalog.to_regclass(relation_name)
          and relation.relrowsecurity and relation.relforcerowsecurity)
      or pg_catalog.has_table_privilege('data_agent_backend',relation_name,'SELECT,INSERT,UPDATE,DELETE')
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_POSTCONDITION_FAILED',
      detail=relation_name; end if;
  end loop;

  if pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_review(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'semantic.human_record_semantic_review_decision(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)') is null
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.prepare_falcon24_successor_review(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.human_record_semantic_review_decision(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'semantic.prepare_falcon24_successor_review(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
