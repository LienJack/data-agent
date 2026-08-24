do $postconditions$
declare policy_qual text;
begin
  select qual into policy_qual from pg_catalog.pg_policies
  where schemaname='app_data_agent' and tablename='analysis_result_stages'
    and policyname='analysis_result_stages_rpc_lock' and cmd='UPDATE'
    and roles='{data_agent_u6_rpc_owner}' and with_check='false';
  if policy_qual is null
    or pg_catalog.strpos(policy_qual,'backend_run_object_matches')=0
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_DRIFT'; end if;
  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_result_stages','UPDATE')
    or not exists(select 1 from pg_catalog.pg_class
      where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass
        and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_BOUNDARY_DRIFT'; end if;
end
$postconditions$;
