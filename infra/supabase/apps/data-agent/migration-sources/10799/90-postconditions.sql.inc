do $postconditions$
declare snapshot record;schema_name text;table_name text;after_count bigint;after_digest text;
  routine_name text;routine record;definition text;
begin
  for snapshot in select * from falcon24_10799_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',message='FALCON24_E7_RECOVERY_HISTORY_DRIFT'; end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_llm_execution_certification_stage'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner)='data_agent_u6_data_owner')
    or not exists(select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid=
        'app_data_agent.falcon24_llm_execution_certification_stage'::regclass
        and trigger.tgname='falcon24_llm_execution_stage_state_fence'
        and not trigger.tgisinternal)
  then raise exception using errcode='P0001',
    message='FALCON24_E7_STAGE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach routine_name in array array[
    'app_data_agent.stage_falcon24_llm_execution_certification(jsonb)',
    'app_data_agent.load_falcon24_llm_execution_certification_stage(uuid)',
    'app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb)',
    'app_data_agent.load_falcon24_e7_recovery_context(uuid)',
    'app_data_agent.activate_falcon24_authority(jsonb)']::text[] loop
    select procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    if routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_u6_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E7_RPC_POSTCONDITION_FAILED',detail=routine_name; end if;
  end loop;
  foreach routine_name in array array[
    'app_data_agent.list_provider_execution_profiles()']::text[] loop
    select procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    if routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_provider_invocation_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E7_PROFILE_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@4.0.0')=0
    or pg_catalog.strpos(definition,'app_data_agent.complete_falcon24_diagnostic')=0
    or pg_catalog.strpos(definition,'app_data_agent.activate_falcon24_authority_pre_e7')=0
    or pg_catalog.strpos(definition,'FROZEN_CLOSURE_CHANGE_REQUIRED')=0
    or pg_catalog.strpos(definition,'PROVIDER_PROFILE_NOT_AVAILABLE')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E7_ACTIVATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
