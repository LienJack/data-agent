drop function app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb);
drop function app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb);
drop function app_data_agent.set_agent_dispatch_rollout_policy(text,bigint);
drop function app_data_agent.resolve_agent_dispatch_rollout_policy(text);
drop function app_data_agent.agent_dispatch_execute_receipt_is_valid(jsonb,jsonb,text);
drop function app_data_agent.agent_dispatch_binding_is_valid(jsonb,jsonb,text);
drop function app_data_agent.agent_dispatch_plan_is_valid(jsonb,text);
drop function app_data_agent.agent_dispatch_direct_receipt_is_valid(jsonb,text,text);
drop function app_data_agent.agent_dispatch_plan_ref_is_valid(jsonb);
drop function app_data_agent.agent_dispatch_profile_refs_are_canonical(jsonb);

drop table app_data_agent.agent_dispatch_execute_receipts;
drop table app_data_agent.agent_dispatch_deferred_receipts;
drop table app_data_agent.agent_dispatch_rollout_policies;
