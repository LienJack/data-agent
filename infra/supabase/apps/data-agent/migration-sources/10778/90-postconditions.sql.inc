do $postconditions$
declare
  command_definition text;
  acceptance_definition text;
  interruption_reply_definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.agent_dispatch_rollout_policies') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_deferred_receipts') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_execute_receipts') is not null
    or pg_catalog.to_regprocedure('app_data_agent.resolve_agent_dispatch_rollout_policy(text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.set_agent_dispatch_rollout_policy(text,bigint)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_profile_refs_are_canonical(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_plan_ref_is_valid(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_direct_receipt_is_valid(jsonb,text,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_plan_is_valid(jsonb,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_binding_is_valid(jsonb,jsonb,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_execute_receipt_is_valid(jsonb,jsonb,text)') is not null
  then
    raise exception using errcode='P0001',
      message='E1_LEGACY_RUNTIME_RETIREMENT_INCOMPLETE';
  end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into command_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into acceptance_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.reply_run_interruption(jsonb)'::regprocedure)
    into interruption_reply_definition;
  if pg_catalog.strpos(command_definition,'subagent_catalog_snapshot_is_valid')=0
    or pg_catalog.strpos(command_definition,'agent_dispatch')>0
    or pg_catalog.strpos(command_definition,'effective-config-team-lease@2.0.0')>0
    or pg_catalog.strpos(acceptance_definition,'commit_subagent_catalog_snapshot_internal')=0
    or pg_catalog.strpos(acceptance_definition,'effective-config-team-lease@3.0.0')=0
    or pg_catalog.strpos(acceptance_definition,'dispatch_admission')>0
    or pg_catalog.strpos(acceptance_definition,'shadow_dispatch_plan')>0
    or pg_catalog.strpos(acceptance_definition,'commit_agent_dispatch')>0
    or pg_catalog.strpos(interruption_reply_definition,'semantic_context_uuid_v8_from_hash')=0
    or pg_catalog.strpos(interruption_reply_definition,'resolved_context_uuid_v8_from_hash')>0
  then
    raise exception using errcode='P0001',
      message='E1_COMMAND_BOUNDARY_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
