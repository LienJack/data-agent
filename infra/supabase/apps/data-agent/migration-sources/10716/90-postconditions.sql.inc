do $postconditions$
declare policy_definition text;
begin
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid)
  into strict policy_definition
  from pg_catalog.pg_policy as policy
  where policy.polrelid='app_data_agent.memberships'::pg_catalog.regclass
    and policy.polname='memberships_u6_provisioner_lock_select';
  if pg_catalog.strpos(policy_definition,'data_agent_u6_provisioner')=0
    or pg_catalog.strpos(policy_definition,'SESSION_USER')=0
    or pg_catalog.strpos(policy_definition,'''SET''')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_RLS_NOT_INSTALLED'; end if;
end
$postconditions$;
