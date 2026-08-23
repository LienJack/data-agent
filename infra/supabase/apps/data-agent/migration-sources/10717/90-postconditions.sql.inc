do $postconditions$
declare
  using_definition text;
  check_definition text;
begin
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),
    pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)
  into strict using_definition,check_definition
  from pg_catalog.pg_policy as policy
  where policy.polrelid='app_data_agent.memberships'::pg_catalog.regclass
    and policy.polname='memberships_u6_provisioner_lock_update';
  if pg_catalog.strpos(using_definition,'data_agent_u6_provisioner')=0
    or pg_catalog.strpos(using_definition,'SESSION_USER')=0
    or check_definition<>'false'
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_ROW_LOCK_NOT_INSTALLED'; end if;
end
$postconditions$;
