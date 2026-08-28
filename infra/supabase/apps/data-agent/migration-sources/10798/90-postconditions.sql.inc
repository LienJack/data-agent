do $postconditions$
declare snapshot record;schema_name text;table_name text;after_count bigint;after_digest text;
  routine_name text;routine record;definition text;
begin
  for snapshot in select * from falcon24_10798_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',message='FALCON24_E5_RETAINED_HISTORY_DRIFT'; end if;
  end loop;
  foreach routine_name in array array[
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.begin_falcon24_diagnostic(jsonb)',
    'app_data_agent.complete_falcon24_diagnostic(jsonb)',
    'app_data_agent.begin_falcon24_qualification(jsonb)']::text[] loop
    select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name,
      pg_catalog.pg_get_functiondef(procedure.oid) function_definition into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    definition:=routine.function_definition;
    if routine.provolatile is distinct from 'v' or routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_u6_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E5_RETAINED_AUTHORITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@3.0.0')=0
    or pg_catalog.strpos(definition,'semantic.lock_semantic_authority_fence')=0
    or pg_catalog.strpos(definition,'FALCON24_RETAINED_AUTHORITY_POLLUTED')=0
    or pg_catalog.strpos(definition,'update semantic.semantic_active_pointer')<>0
    or pg_catalog.strpos(definition,'update semantic.semantic_runtime_activation')<>0
    or pg_catalog.strpos(definition,'update app_data_agent.workspace_run_defaults')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E5_RETAINED_ACTIVATION_POSTCONDITION_FAILED'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.falcon24_diagnostic_attempts'::regclass
        and conname='falcon24_diagnostic_attempts_manifest_epoch_check')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.falcon24_diagnostic_receipts'::regclass
        and conname='falcon24_diagnostic_receipts_receipt_document_version_check')
  then raise exception using errcode='P0001',
    message='FALCON24_E5_DIAGNOSTIC_STORAGE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
