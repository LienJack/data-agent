create function app_data_agent.falcon24_four_layer_attempt_state_fence()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_IMMUTABLE'; end if;
  if new.app_id<>old.app_id or new.tenant_id<>old.tenant_id
    or new.environment<>old.environment or new.principal_id<>old.principal_id
    or new.gate_id<>old.gate_id or new.attempt_id<>old.attempt_id
    or new.authority_epoch<>old.authority_epoch
    or new.authority_baseline_id<>old.authority_baseline_id
    or new.authority_baseline_hash<>old.authority_baseline_hash
    or new.authority_activation_attempt_id<>old.authority_activation_attempt_id
    or new.source_commit<>old.source_commit or new.worker_build_hash<>old.worker_build_hash
    or new.worker_generation_hash<>old.worker_generation_hash
    or new.web_build_hash<>old.web_build_hash or new.web_generation_hash<>old.web_generation_hash
    or new.semantic_release_hash<>old.semantic_release_hash
    or new.datasource_binding_hash<>old.datasource_binding_hash
    or new.model_config_hash<>old.model_config_hash
    or new.runtime_attestation_hash<>old.runtime_attestation_hash
    or new.manifest_hash<>old.manifest_hash or new.manifest_document<>old.manifest_document
    or new.created_at<>old.created_at or new.attempt_version<>old.attempt_version+1
    or new.next_turn_ordinal not in(old.next_turn_ordinal,old.next_turn_ordinal+1)
    or (old.first_failure_code is not null and (
      new.first_failure_turn_ordinal<>old.first_failure_turn_ordinal
      or new.first_failure_run_id<>old.first_failure_run_id
      or new.first_failure_code<>old.first_failure_code))
    or (old.terminal_receipt is not null and (
      new.terminal_receipt_hash<>old.terminal_receipt_hash
      or new.terminal_receipt<>old.terminal_receipt))
    or not ((new.status=old.status)
      or (old.status='READY' and new.status='RUNNING')
      or (old.status='RUNNING' and new.status in('READY','FINALIZING','FAILED'))
      or (old.status='FAILED' and new.status='FAILED')
      or (old.status='FINALIZING' and new.status='PASSED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_STATE_INVALID'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_four_layer_turn_state_fence()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TURN_IMMUTABLE'; end if;
  if new.app_id<>old.app_id or new.tenant_id<>old.tenant_id
    or new.environment<>old.environment or new.principal_id<>old.principal_id
    or new.attempt_id<>old.attempt_id or new.turn_ordinal<>old.turn_ordinal
    or new.turn_id<>old.turn_id or new.layer<>old.layer or new.scenario_id<>old.scenario_id
    or new.scenario_turn_index<>old.scenario_turn_index
    or new.conversation_group is distinct from old.conversation_group
    or new.conversation_mode<>old.conversation_mode or new.question<>old.question
    or new.question_hash<>old.question_hash or new.expected_agents<>old.expected_agents
    or new.rubric<>old.rubric or new.created_at<>old.created_at
    or new.turn_version<>old.turn_version+1
    or (old.conversation_id is not null and (
      new.conversation_id<>old.conversation_id
      or new.conversation_resource_version<>old.conversation_resource_version
      or new.run_id<>old.run_id or new.claim_command_hash<>old.claim_command_hash
      or new.claimed_at<>old.claimed_at))
    or (old.business_receipt is not null and (
      new.business_receipt_hash<>old.business_receipt_hash
      or new.business_receipt<>old.business_receipt))
    or (old.qa_ui_receipt is not null and (
      new.qa_ui_receipt_hash<>old.qa_ui_receipt_hash or new.qa_ui_receipt<>old.qa_ui_receipt))
    or (old.trace_ui_receipt is not null and (
      new.trace_ui_receipt_hash<>old.trace_ui_receipt_hash
      or new.trace_ui_receipt<>old.trace_ui_receipt))
    or (old.terminal_receipt is not null and (
      new.terminal_receipt_hash<>old.terminal_receipt_hash
      or new.terminal_receipt<>old.terminal_receipt))
    or not ((old.status='PLANNED' and new.status='CLAIMED')
      or (old.status='CLAIMED' and new.status in('BUSINESS_PASSED','BUSINESS_FAILED'))
      or (old.status='BUSINESS_PASSED' and new.status in('QA_PASSED','QA_FAILED'))
      or (old.status='QA_PASSED' and new.status in('TRACE_PASSED','TRACE_FAILED'))
      or (old.status='TRACE_PASSED' and new.status='PASSED')
      or (old.status in('BUSINESS_FAILED','QA_FAILED','TRACE_FAILED') and new.status='FAILED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TURN_STATE_INVALID'; end if;
  return new;
end
$function$;

create trigger falcon24_four_layer_attempt_state_fence
before update or delete on app_data_agent.falcon24_four_layer_gate_attempts
for each row execute function app_data_agent.falcon24_four_layer_attempt_state_fence();
create trigger falcon24_four_layer_turn_state_fence
before update or delete on app_data_agent.falcon24_four_layer_gate_turns
for each row execute function app_data_agent.falcon24_four_layer_turn_state_fence();

alter table app_data_agent.falcon24_four_layer_gate_attempts owner to data_agent_u6_data_owner;
alter table app_data_agent.falcon24_four_layer_gate_turns owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_four_layer_attempt_state_fence()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_four_layer_turn_state_fence()
  owner to data_agent_u6_data_owner;

alter function app_data_agent.falcon24_four_layer_receipt_identity_matches(
  jsonb,jsonb,jsonb,text,boolean) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_four_layer_agent_contract_matches(jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;

grant select,insert,update on table
  app_data_agent.falcon24_four_layer_gate_attempts,
  app_data_agent.falcon24_four_layer_gate_turns to data_agent_u6_rpc_owner;
grant select on table app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.qa_conversations,app_data_agent.runs,
  app_data_agent.workspace_run_bindings to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_four_layer_gate_attempts,
  app_data_agent.falcon24_four_layer_gate_turns
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.falcon24_four_layer_attempt_state_fence(),
  app_data_agent.falcon24_four_layer_turn_state_fence(),
  app_data_agent.falcon24_four_layer_receipt_identity_matches(jsonb,jsonb,jsonb,text,boolean),
  app_data_agent.falcon24_four_layer_agent_contract_matches(jsonb,jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb),
  app_data_agent.load_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.begin_falcon24_four_layer_gate(jsonb),
  app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.record_falcon24_four_layer_business_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function
  app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb),
  app_data_agent.load_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.begin_falcon24_four_layer_gate(jsonb),
  app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.record_falcon24_four_layer_business_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  to data_agent_backend;
