do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_epoch_closure_failure_receipts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_epoch_closure_failure_receipts'::regclass
        and trigger_row.tgname='falcon24_epoch_closure_failure_immutable'
        and not trigger_row.tgisinternal)
  then raise exception using errcode='P0001',
    message='FALCON24_E8_CLOSURE_FAILURE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_epoch_closure_failure(uuid)',
    'app_data_agent.record_falcon24_epoch_closure_failure(jsonb)',
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.list_provider_execution_profiles()']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E8_FUNCTION_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_provider_execution_profiles()'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'list_provider_execution_profiles_pre_e8()')=0
    or pg_catalog.strpos(definition,'numeric<8')=0
    or pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=row.activation_attempt_id')=0
    or pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=stage.activation_attempt_id')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E8_PROVIDER_DISPATCH_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_provider_execution_profiles_pre_e8()'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=stage.activation_attempt_id')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E7_FROZEN_PROVIDER_READER_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10800_history_snapshot order by relation_name loop
    relation_name:=before_row.relation_name;
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_E8_PROVIDER_BINDING_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
