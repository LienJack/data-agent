do $postconditions$
declare commit_definition text;load_definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_ui_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_falcon24_e1_ui_receipts(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_SCHEMA_DRIFT'; end if;
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)'::regprocedure;
  select prosrc into strict load_definition from pg_catalog.pg_proc
    where oid='app_data_agent.load_falcon24_e1_ui_receipts(jsonb)'::regprocedure;
  if pg_catalog.strpos(commit_definition,'QUESTION_COMPOSER_SUBMIT_TO_RESULT')=0
    or pg_catalog.strpos(commit_definition,'RESULT_TRACE_ENTRY_TO_EXACT_RUN')=0
    or pg_catalog.strpos(commit_definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.strpos(commit_definition,'opened_artifact_refs')=0
    or pg_catalog.strpos(load_definition,'falcon24_current_authority_epoch')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_DEFINITION_STALE'; end if;
  if exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_e1_ui_receipts'::regclass
        and (not relation.relrowsecurity or not relation.relforcerowsecurity))
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_UI_RECEIPT_SECURITY_DRIFT'; end if;
end
$postconditions$;
