do $postconditions$
declare function_name text; definition text;
  public_functions constant text[]:=array[
    'begin_falcon24_e1_staging_session','record_falcon24_e1_staging_receipt',
    'stage_falcon24_e1_authority_baseline','begin_falcon24_e1_activation_attempt',
    'hold_falcon24_e1_activation_attempt','activate_falcon24_e1_authority',
    'load_falcon24_current_authority_epoch','load_falcon24_run_authority_binding']::text[];
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_staging_sessions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_e1_staging_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_e1_activation_attempts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_current_authority_epoch') is null
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch)
  then raise exception using errcode='P0001',message='FALCON24_E1_AUTHORITY_SCHEMA_DRIFT'; end if;

  foreach function_name in array public_functions loop
    if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent' and procedure.proname=function_name)<>1
    then raise exception using errcode='P0001',message='FALCON24_E1_FUNCTION_INVENTORY_DRIFT'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.proname=any(public_functions)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_E1_FUNCTION_SECURITY_DRIFT'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_e1_runtime_surface_is_empty()'::regprocedure
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'postgres'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
    or not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_e1_runtime_surface_is_empty()','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.falcon24_e1_runtime_surface_is_empty()','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_PREFLIGHT_SECURITY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
      'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
      function_row(function_oid)
    join pg_catalog.pg_proc procedure on procedure.oid=function_row.function_oid
    where pg_catalog.pg_get_userbyid(procedure.proowner)<>'postgres'
      or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[])
    or exists(select 1 from pg_catalog.unnest(array[
        'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
        'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
        function_row(function_oid)
      cross join pg_catalog.unnest(array[
        'anon','authenticated','service_role','data_agent_backend',
        'data_agent_job_authority']::text[]) role_name
      where pg_catalog.has_function_privilege(
        role_name,function_row.function_oid,'EXECUTE'))
    or exists(select 1 from pg_catalog.unnest(array[
        'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
        'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
      function_row(function_oid)
      join pg_catalog.pg_proc procedure on procedure.oid=function_row.function_oid
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) privilege
      where privilege.grantee=0 and privilege.privilege_type='EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_BINDING_TRIGGER_SECURITY_DRIFT'; end if;

  if (select pg_catalog.count(*) from information_schema.columns
    where table_schema='app_data_agent'
      and table_name in('runs','effective_run_config_receipts','artifacts',
        'falcon24_acceptance_campaigns','falcon24_qualifications')
      and column_name in('authority_epoch','authority_baseline_id','authority_baseline_hash',
        'authority_activation_attempt_id') and is_nullable='NO')<>20
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid in('app_data_agent.runs'::regclass,
        'app_data_agent.effective_run_config_receipts'::regclass,
        'app_data_agent.artifacts'::regclass,
        'app_data_agent.falcon24_acceptance_campaigns'::regclass,
        'app_data_agent.falcon24_qualifications'::regclass)
        and trigger_row.tgname in('runs_falcon24_e1_bind','effective_config_falcon24_e1_bind',
          'artifacts_falcon24_e1_bind','falcon24_campaign_e1_bind',
          'falcon24_qualification_e1_bind','runs_falcon24_e1_immutable',
          'effective_config_falcon24_e1_immutable','artifacts_falcon24_e1_immutable',
          'falcon24_campaign_e1_immutable','falcon24_qualification_e1_immutable')
        and not trigger_row.tgisinternal)<>10
  then raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_BINDING_DRIFT'; end if;

  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.activate_falcon24_e1_authority(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'falcon24_e1_runtime_surface_is_empty')=0
    or pg_catalog.strpos(definition,'status=''ACTIVATED''')=0
    or pg_catalog.strpos(definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.strpos(definition,'count(*)')=0
    or pg_catalog.strpos(definition,'production_gate<>''GO''')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_ACTIVATION_CLOSURE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_e1_runtime_surface_is_empty()'::regprocedure;
  if pg_catalog.strpos(definition,'information_schema.columns')=0
    or pg_catalog.strpos(definition,'column_name=''run_id''')=0
    or pg_catalog.strpos(definition,'table_type=''BASE TABLE''')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_INVENTORY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
      'falcon24_authority_baselines','falcon24_e1_activation_attempts',
      'falcon24_current_authority_epoch']::text[]) table_name
    cross join pg_catalog.unnest(array['SELECT','INSERT','UPDATE','DELETE']::text[]) privilege_name
    where pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.'||table_name,privilege_name))
    or exists(select 1 from pg_catalog.unnest(public_functions) name
      where not pg_catalog.has_function_privilege('data_agent_backend',
        'app_data_agent.'||name||case when name='load_falcon24_current_authority_epoch'
          then '()' else '(jsonb)' end,'EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_E1_AUTHORITY_GRANT_DRIFT'; end if;
end
$postconditions$;
