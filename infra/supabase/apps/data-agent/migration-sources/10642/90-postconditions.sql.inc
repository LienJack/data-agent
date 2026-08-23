do $postconditions$
declare
  policy_record record;
begin
  select policy.polcmd, policy.polroles, pg_catalog.pg_get_expr(
    policy.polwithcheck,
    policy.polrelid
  ) as check_expression
  into policy_record
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'app_data_agent.audit_log'::regclass
    and policy.polname = 'audit_log_semantic_authoring_rpc_insert';
  if not found
    or policy_record.polcmd <> 'a'
    or not ('data_agent_u6_rpc_owner'::regrole::oid = any(policy_record.polroles))
    or pg_catalog.strpos(
      policy_record.check_expression, 'SEMANTIC_AUTHORING_WORKER_CLAIMED'
    ) = 0
    or pg_catalog.strpos(
      policy_record.check_expression, 'SEMANTIC_AUTHORING_READY_FOR_REVIEW'
    ) = 0
    or pg_catalog.strpos(policy_record.check_expression, 'semantic_authoring_run') = 0
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_POLICY_INVALID';
  end if;
  if has_table_privilege(
    'data_agent_backend', 'app_data_agent.audit_log', 'INSERT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_BACKEND_PRIVILEGE_LEAK';
  end if;
  if not has_table_privilege(
    'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'INSERT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_RPC_PRIVILEGE_MISSING';
  end if;
end
$postconditions$;
