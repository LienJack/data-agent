-- semantic_helper_consumer_repair_migration_checksum: sha256:ba459a8d6298cf0dc1c606a4c5c9ab192049d5557676aa735b67e858bac92186
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_HELPER_CONSUMER_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_HELPER_CONSUMER_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010762_app_data_agent_model_status_retirement_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_REPAIR_BASELINE_10762_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $helper_consumer_repair$
declare target pg_catalog.regprocedure; definition text; rewritten text; repaired_count integer:=0;
begin
  for target in
    select procedure.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.prokind='f'
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'app_data_agent.resolved_context_exact_keys'
      )>0
    order by procedure.oid::pg_catalog.regprocedure::text
  loop
    definition:=pg_catalog.pg_get_functiondef(target);
    rewritten:=pg_catalog.replace(
      definition,
      'app_data_agent.resolved_context_exact_keys',
      'app_data_agent.semantic_context_exact_keys'
    );
    if rewritten=definition then
      raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_SOURCE_MISMATCH';
    end if;
    execute rewritten;
    repaired_count:=repaired_count+1;
  end loop;
  if repaired_count<>13 then
    raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_COUNT_DRIFT';
  end if;
end
$helper_consumer_repair$;
do $postconditions$
begin
  if exists(
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.prokind='f'
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'app_data_agent.resolved_context_exact_keys'
      )>0
  ) or pg_catalog.to_regprocedure(
    'app_data_agent.resolved_context_exact_keys(jsonb,text[])'
  ) is not null
  then raise exception using errcode='P0001',message='SEMANTIC_HELPER_RETIRED_REFERENCE_REMAINS'; end if;

  if not pg_catalog.has_function_privilege(
    'data_agent_u14_extension_owner',
    'app_data_agent.semantic_context_exact_keys(jsonb,text[])',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_u20_profile_owner',
    'app_data_agent.semantic_context_exact_keys(jsonb,text[])',
    'EXECUTE'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_GRANT_MISSING'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010763_app_data_agent_semantic_helper_consumer_repair',
  'sha256:ba459a8d6298cf0dc1c606a4c5c9ab192049d5557676aa735b67e858bac92186');
commit;
