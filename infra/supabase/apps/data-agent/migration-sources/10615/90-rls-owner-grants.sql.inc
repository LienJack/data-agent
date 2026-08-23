-- ============================================================
-- 10615: RLS, policy, ACL, and owner assignments for 10615 functions
-- ============================================================

-- Grant EXECUTE on activation RPCs to A8 Publisher role
grant execute on function semantic.activate_runtime(
  uuid, uuid, text, text, text, bigint, bigint, text, uuid
) to data_agent_u6_rpc_owner;

grant execute on function semantic.application_rollback(
  uuid, uuid, text, text, bigint, text, uuid
) to data_agent_u6_rpc_owner;

grant execute on function semantic.contract_legacy(
  uuid, uuid, text, text, bigint, uuid, uuid
) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on V2 published grounding bundle materializer to A8 Publisher role
grant execute on function semantic.commit_published_grounding_bundle_v2(
  uuid, uuid, text, text, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text
) to data_agent_u6_rpc_owner;

-- Schema USAGE already granted by 10610
