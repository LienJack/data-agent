do $postconditions$
declare relation_name text;function_name text;
begin
  foreach relation_name in array array[
    'app_data_agent.falcon24_diagnostic_attempts',
    'app_data_agent.falcon24_diagnostic_receipts'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
      or not exists(select 1 from pg_catalog.pg_class row
        where row.oid=relation_name::pg_catalog.regclass and row.relrowsecurity and row.relforcerowsecurity)
    then raise exception using errcode='P0001',
      message='FALCON24_DIAGNOSTIC_POSTCONDITION_FAILED',detail=relation_name; end if;
  end loop;
  foreach function_name in array array[
    'app_data_agent.begin_falcon24_diagnostic(jsonb)',
    'app_data_agent.load_falcon24_diagnostic(jsonb)',
    'app_data_agent.complete_falcon24_diagnostic(jsonb)',
    'app_data_agent.begin_falcon24_qualification(jsonb)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
      or pg_catalog.has_function_privilege('public',function_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',function_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_DIAGNOSTIC_POSTCONDITION_FAILED',detail=function_name; end if;
  end loop;
  if pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_diagnostic_attempts','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_diagnostic_receipts','INSERT')
    or not exists(select 1 from pg_catalog.pg_attribute row
      where row.attrelid='app_data_agent.falcon24_qualifications'::pg_catalog.regclass
        and row.attname='diagnostic_receipt_hash' and not row.attisdropped)
  then raise exception using errcode='P0001',
    message='FALCON24_DIAGNOSTIC_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
