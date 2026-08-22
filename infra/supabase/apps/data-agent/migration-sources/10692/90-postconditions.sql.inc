do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','semantic.semantic_candidate_revision_save_idempotency','SELECT,INSERT,UPDATE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend','semantic.semantic_candidate_revision_save_idempotency','UPDATE'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_IDEMPOTENCY_LOCK_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
