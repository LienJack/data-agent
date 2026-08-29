create function app_data_agent.record_falcon24_four_layer_qa_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-qa-ui-record@1.0.0'
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
      'worker_generation_hash','semantic_release_hash','answer_hash','web_build_hash',
      'web_generation_hash','composer_submission_count','terminal_answer_visible',
      'error_banner','dom_snapshot_hash','screenshot_hash','status','failure_code',
      'observed_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'composer_submission_count'<>'1'
    or (receipt->>'status'='PASS' and (receipt->>'terminal_answer_visible'<>'true'
      or receipt->'error_banner'<>'null'::jsonb))
    or receipt->>'dom_snapshot_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'screenshot_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_QA_UI_RECEIPT_INVALID'; end if;
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
  if turn.qa_ui_receipt is not null then
    if turn.qa_ui_receipt_hash=receipt->>'receipt_hash' and turn.qa_ui_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'web_build_hash'<>attempt.web_build_hash
    or receipt->>'web_generation_hash'<>attempt.web_generation_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-qa-ui-receipt@1.0.0',true) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if turn.status='BUSINESS_FAILED' or attempt.status='FAILED'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_UI_AFTER_BUSINESS_FAILURE'; end if;
  if turn.status<>'BUSINESS_PASSED' or receipt->>'answer_hash'<>
    turn.business_receipt->>'answer_hash'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    qa_ui_receipt_hash=receipt->>'receipt_hash',qa_ui_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'QA_PASSED' else 'QA_FAILED' end,
    updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='BUSINESS_PASSED'
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

create function app_data_agent.record_falcon24_four_layer_trace_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-trace-ui-record@1.0.0'
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
      'worker_generation_hash','semantic_release_hash','web_build_hash','web_generation_hash',
      'answer_entry_clicked','exact_run_focused','public_event_hash',
      'accepted_artifact_refs_hash','dom_snapshot_hash','screenshot_hash','status',
      'failure_code','observed_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or (receipt->>'status'='PASS' and (receipt->>'answer_entry_clicked'<>'true'
      or receipt->>'exact_run_focused'<>'true'))
    or exists(select 1 from pg_catalog.unnest(array[
      'public_event_hash','accepted_artifact_refs_hash','dom_snapshot_hash',
      'screenshot_hash']::text[]) hash_key where receipt->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_TRACE_UI_RECEIPT_INVALID'; end if;
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
  if turn.trace_ui_receipt is not null then
    if turn.trace_ui_receipt_hash=receipt->>'receipt_hash' and turn.trace_ui_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'web_build_hash'<>attempt.web_build_hash
    or receipt->>'web_generation_hash'<>attempt.web_generation_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-trace-ui-receipt@1.0.0',true) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if turn.status<>'QA_PASSED' or attempt.status<>'RUNNING'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS'; end if;
  if receipt->>'public_event_hash'<>turn.business_receipt->>'public_event_hash'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    trace_ui_receipt_hash=receipt->>'receipt_hash',trace_ui_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'TRACE_PASSED' else 'TRACE_FAILED' end,
    updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='QA_PASSED'
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
