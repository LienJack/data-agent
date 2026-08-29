create function app_data_agent.finalize_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;
  now_at timestamptz;next_layer text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-finalize@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','business_receipt_hash',
      'qa_ui_receipt_hash','trace_ui_receipt_hash','status','failure_code','finalized_at',
      'receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAILED')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'business_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or (receipt->>'status'='PASS' and (
      receipt->>'qa_ui_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->>'trace_ui_receipt_hash'!~'^sha256:[0-9a-f]{64}$'))
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_TERMINAL_RECEIPT_INVALID'; end if;
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
  if turn.terminal_receipt is not null then
    if turn.terminal_receipt_hash=receipt->>'receipt_hash' and turn.terminal_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-turn-terminal-receipt@1.0.0',false) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if receipt->>'business_receipt_hash'<>turn.business_receipt_hash
    or receipt->'qa_ui_receipt_hash' is distinct from
      pg_catalog.coalesce(pg_catalog.to_jsonb(turn.qa_ui_receipt_hash),'null'::jsonb)
    or receipt->'trace_ui_receipt_hash' is distinct from
      pg_catalog.coalesce(pg_catalog.to_jsonb(turn.trace_ui_receipt_hash),'null'::jsonb)
    or (receipt->>'status'='PASS' and turn.status<>'TRACE_PASSED')
    or (receipt->>'status'='FAILED' and turn.status not in(
      'BUSINESS_FAILED','QA_FAILED','TRACE_FAILED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TERMINAL_CLOSURE_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    terminal_receipt_hash=receipt->>'receipt_hash',terminal_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'PASSED' else 'FAILED' end,
    completed_at=now_at,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal
    returning * into strict turn;
  if receipt->>'status'='PASS' then
    next_layer:=case
      when turn.turn_ordinal<4 then 'L1'
      when turn.turn_ordinal<6 then 'L2'
      when turn.turn_ordinal<8 then 'L3'
      when turn.turn_ordinal<14 then 'L4'
      else 'COMPLETE' end;
    update app_data_agent.falcon24_four_layer_gate_attempts set
      next_turn_ordinal=turn.turn_ordinal+1,current_layer=next_layer,
      status=case when turn.turn_ordinal=14 then 'FINALIZING' else 'READY' end,
      updated_at=now_at,attempt_version=attempt_version+1
      where app_id=attempt.app_id and tenant_id=attempt.tenant_id
        and environment=attempt.environment and principal_id=attempt.principal_id
        and attempt_id=attempt.attempt_id and status='RUNNING'
        and next_turn_ordinal=turn.turn_ordinal
      returning * into strict attempt;
  else
    update app_data_agent.falcon24_four_layer_gate_attempts set
      updated_at=now_at,attempt_version=attempt_version+1
      where app_id=attempt.app_id and tenant_id=attempt.tenant_id
        and environment=attempt.environment and principal_id=attempt.principal_id
        and attempt_id=attempt.attempt_id and status='FAILED'
      returning * into strict attempt;
  end if;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.finalize_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  now_at timestamptz;turn_receipt_hashes jsonb;receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','expected_attempt_version','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-attempt-finalize@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||command->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if attempt.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if attempt.status='PASSED' then return pg_catalog.to_jsonb(attempt); end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row.terminal_receipt_hash)
      order by row.turn_ordinal) into strict turn_receipt_hashes
    from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.principal_id=attempt.principal_id
      and row.attempt_id=attempt.attempt_id and row.status='PASSED';
  if attempt.status<>'FINALIZING' or attempt.next_turn_ordinal<>15
    or attempt.current_layer<>'COMPLETE'
    or pg_catalog.jsonb_array_length(turn_receipt_hashes)<>15
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_FINALIZATION_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-four-layer-attempt-terminal-receipt@1.0.0',
    'gate_id',attempt.gate_id,'attempt_id',attempt.attempt_id,
    'manifest_hash',attempt.manifest_hash,'worker_build_hash',attempt.worker_build_hash,
    'worker_generation_hash',attempt.worker_generation_hash,
    'web_build_hash',attempt.web_build_hash,'web_generation_hash',attempt.web_generation_hash,
    'semantic_release_hash',attempt.semantic_release_hash,
    'turn_receipt_hashes',turn_receipt_hashes,'status','PASS','failure_code',null,
    'finalized_at',now_at);
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  update app_data_agent.falcon24_four_layer_gate_attempts set status='PASSED',
    terminal_receipt_hash=receipt->>'receipt_hash',terminal_receipt=receipt,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='FINALIZING'
    returning * into strict attempt;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
