do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  foreach definition in array array[
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E9_CURRENT_PROFILE_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@6.0.0')=0
    or pg_catalog.strpos(definition,'activate_falcon24_authority_pre_e9(v3_command)')=0
    or pg_catalog.strpos(definition,'predecessor_diagnostic_receipt')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_ACTIVATION_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'stage.target_authority_epoch=current_epoch.authority_epoch')=0
    or pg_catalog.strpos(definition,
      'stage.activation_attempt_id=current_epoch.activation_attempt_id')=0
    or pg_catalog.strpos(definition,'stage.status=''PROMOTED''')=0
    or pg_catalog.strpos(definition,'artifact.is_active')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_CURRENT_PROFILE_RESOLVER_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10801_history_snapshot order by relation_name loop
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
      message='FALCON24_E9_CURRENT_PROFILE_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
