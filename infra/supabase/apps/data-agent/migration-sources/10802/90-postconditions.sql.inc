do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_finalization_failure_receipts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_finalization_failure_receipts'::regclass
        and trigger_row.tgname='falcon24_finalization_failure_immutable'
        and not trigger_row.tgisinternal)
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner','app_data_agent.falcon24_finalization_failure_receipts',
      'SELECT,INSERT,UPDATE')
  then raise exception using errcode='P0001',
    message='FALCON24_E10_FAILURE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_finalization_failure(uuid)',
    'app_data_agent.record_falcon24_finalization_failure(jsonb)',
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E10_FUNCTION_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'stage.app_id=authority.app_id')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_FROZEN_RESOLVER_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'current-provider-execution-certification@2.0.0')=0
    or pg_catalog.strpos(definition,'numeric<10')=0
    or pg_catalog.strpos(definition,
      'stage_source.activation_attempt_id=current_epoch_row.activation_attempt_id')=0
    or pg_catalog.strpos(definition,'stage.app_id=authority.app_id')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E10_VERSIONED_RESOLVER_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@7.0.0')=0
    or pg_catalog.strpos(definition,'activate_falcon24_authority_pre_e10(v3_command)')=0
    or pg_catalog.strpos(definition,'predecessor_finalization_failure_receipt')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E10_ACTIVATION_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10802_history_snapshot order by relation_name loop
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
      message='FALCON24_E10_VERSIONED_RESOLVER_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
