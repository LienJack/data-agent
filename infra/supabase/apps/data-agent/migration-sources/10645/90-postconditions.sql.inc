do $postconditions$
declare
  policy_record record;
begin
  select policy.cmd, policy.roles, policy.qual, policy.with_check
  into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'semantic'
    and policy.tablename = 'semantic_candidate'
    and policy.policyname = 'semantic_candidate_authoring_review_update';

  if not found
    or policy_record.cmd <> 'UPDATE'
    or policy_record.roles <> array['data_agent_u6_rpc_owner']::name[]
    or pg_catalog.strpos(policy_record.qual, 'candidate_status = ''DRAFT''') = 0
    or pg_catalog.strpos(policy_record.with_check, 'candidate_status = ''REVIEW_SUBMITTED''') = 0
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'UPDATE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_REVIEW_POLICY_INVALID';
  end if;
end
$postconditions$;
