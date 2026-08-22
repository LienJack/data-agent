do $postconditions$
begin
  if not exists(
    select 1 from pg_catalog.pg_policy policy
    where policy.polrelid='app_data_agent.audit_log'::pg_catalog.regclass
      and policy.polname='audit_log_semantic_manual_session_rpc_insert'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','app_data_agent.audit_log','INSERT'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_MANUAL_AUDIT_POLICY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
