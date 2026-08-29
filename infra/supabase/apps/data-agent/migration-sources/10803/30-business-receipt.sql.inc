create function app_data_agent.record_falcon24_four_layer_business_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;
  now_at timestamptz;rubric_check_ids jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-business-record@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','answer_hash','public_event_hash',
      'actual_profile_ids','accepted_artifact_refs','rubric_results','status','failure_code',
      'evaluated_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'answer_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'public_event_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'actual_profile_ids')<>'array'
    or pg_catalog.jsonb_typeof(receipt->'accepted_artifact_refs')<>'array'
    or pg_catalog.jsonb_typeof(receipt->'rubric_results')<>'array'
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_BUSINESS_RECEIPT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||receipt->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid
      and row.turn_ordinal=(receipt->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.business_receipt is not null then
    if turn.business_receipt_hash=receipt->>'receipt_hash'
      and turn.business_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'worker_build_hash'<>attempt.worker_build_hash
    or receipt->>'worker_generation_hash'<>attempt.worker_generation_hash
    or receipt->>'semantic_release_hash'<>attempt.semantic_release_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-business-receipt@1.0.0',false) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if attempt.status<>'RUNNING' or turn.status<>'CLAIMED'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  if not exists(select 1 from app_data_agent.runs run
      join app_data_agent.workspace_run_bindings binding
        on binding.app_id=run.app_id and binding.tenant_id=run.tenant_id
        and binding.environment=run.environment and binding.run_id=run.run_id
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=turn.run_id and run.question=turn.question
      and run.status not in('QUEUED','RUNNING','WAITING')
      and binding.principal_id=authority.principal_id
      and binding.conversation_id=turn.conversation_id)
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RUN_MISMATCH'; end if;
  if not app_data_agent.falcon24_four_layer_agent_contract_matches(
      turn.expected_agents,receipt->'actual_profile_ids')
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH'; end if;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(result->'check_id' order by ordinality),
      '[]'::jsonb) into strict rubric_check_ids
    from pg_catalog.jsonb_array_elements(receipt->'rubric_results')
      with ordinality rubric_result(result,ordinality);
  if rubric_check_ids<>turn.rubric->'required_checks'
    or (receipt->>'status'='PASS' and exists(select 1
      from pg_catalog.jsonb_array_elements(receipt->'rubric_results') result
      where result->>'status'<>'PASS'
        or result->>'evidence_hash'!~'^sha256:[0-9a-f]{64}$'))
    or exists(select 1 from pg_catalog.jsonb_array_elements(
      receipt->'accepted_artifact_refs') reference
      where reference->>'run_id'<>turn.run_id::text)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RUBRIC_CLOSURE_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    business_receipt_hash=receipt->>'receipt_hash',business_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'BUSINESS_PASSED'
      else 'BUSINESS_FAILED' end,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='CLAIMED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set
    status=case when receipt->>'status'='PASS' then status else 'FAILED' end,
    first_failure_turn_ordinal=case when receipt->>'status'='FAIL'
      then turn.turn_ordinal else null end,
    first_failure_run_id=case when receipt->>'status'='FAIL' then turn.run_id else null end,
    first_failure_code=case when receipt->>'status'='FAIL'
      then receipt->>'failure_code' else null end,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='RUNNING'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
