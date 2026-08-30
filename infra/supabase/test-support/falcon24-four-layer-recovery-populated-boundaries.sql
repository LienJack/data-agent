-- Explicit populated E11 clone test, not a fresh-prefix fixture or formal evidence.
-- The driver must verify the dedicated NAS physical system_identifier before use.
-- Real failed history is read only; target/stage placeholders must never activate.
begin;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true),
  pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000e124',true),
  pg_catalog.set_config('data_agent.environment','local',true),
  pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true),
  pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000e125',true),
  pg_catalog.set_config('data_agent.role','owner',true),
  pg_catalog.set_config('app.semantic_domain','falcon24',true);

create function pg_temp.assert_recovery_rejected(candidate jsonb, expected_error text)
returns void language plpgsql as $function$
begin
  candidate:=(candidate-'command_hash')||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(candidate-'command_hash'));
  begin
    perform app_data_agent.activate_falcon24_authority(candidate);
    raise exception 'RECOVERY_BOUNDARY_UNEXPECTEDLY_ACCEPTED';
  exception when others then
    if sqlerrm<>expected_error then
      raise exception 'RECOVERY_BOUNDARY_EXPECTED_%,_GOT_%',expected_error,sqlerrm;
    end if;
  end;
end
$function$;

do $assertions$
declare command jsonb;candidate jsonb;parent_key text;field_name text;path text[];
  current_row app_data_agent.falcon24_current_authority_epoch%rowtype;
  failed_attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  failed_turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
  pointer_row semantic.semantic_active_pointer%rowtype;
  assertions integer:=0;
  invalid_error text:='FALCON24_FOUR_LAYER_RECOVERY_ACTIVATION_INVALID';
  receipt_error text:='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH';
begin
  select * into strict current_row from app_data_agent.falcon24_current_authority_epoch
    where app_id='00000000-0000-4000-8000-00000000da01'
      and tenant_id='00000000-0000-4000-8000-00000000e124' and environment='local';
  if current_row.authority_epoch<>'E11'
    or current_row.baseline_id<>'4afa8ded-1d65-5eea-90ee-d0b7c27031bb'
  then raise exception 'RECOVERY_BOUNDARY_REQUIRES_FROZEN_E11_CLONE'; end if;
  select * into strict failed_attempt from app_data_agent.falcon24_four_layer_gate_attempts
    where attempt_id='46b61e31-a57a-4d50-8202-8c592b323d7c';
  select * into strict failed_turn from app_data_agent.falcon24_four_layer_gate_turns
    where attempt_id=failed_attempt.attempt_id and turn_ordinal=failed_attempt.first_failure_turn_ordinal;
  select * into strict pointer_row from semantic.semantic_active_pointer
    where app_id=current_row.app_id and tenant_id=current_row.tenant_id
      and environment=current_row.environment and semantic_domain='falcon24';
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-activation-request@8.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',current_row.app_id,'tenant_id',current_row.tenant_id,
      'environment',current_row.environment,'semantic_domain','falcon24'),
    'authority_epoch','E12','attempt_id','00000000-0000-4000-8000-000000081401',
    'baseline_id','00000000-0000-4000-8000-000000081402',
    'expected_baseline_hash','sha256:'||repeat('1',64),
    'expected_current_authority',app_data_agent.falcon24_authority_binding_document(current_row),
    'expected_semantic_release',pg_catalog.jsonb_build_object('release_id',pointer_row.current_release_id,
      'generation',2,'release_digest',pointer_row.current_release_digest,
      'datasource_id','00000000-0000-4000-8000-000000081403'),
    'expected_versions',pg_catalog.jsonb_build_object('semantic_pointer',pointer_row.pointer_generation,
      'semantic_runtime',3,'workspace_defaults',4),
    'retained_semantic_proof_hash','sha256:'||repeat('2',64),
    'predecessor_four_layer_failure_receipt',pg_catalog.jsonb_build_object(
      'attempt_id',failed_attempt.attempt_id,'manifest_hash',failed_attempt.manifest_hash,
      'turn_ordinal',failed_turn.turn_ordinal,'run_id',failed_turn.run_id,
      'receipt_hash',failed_turn.terminal_receipt_hash,'failure_code',failed_attempt.first_failure_code),
    'llm_execution_stage_ref',pg_catalog.jsonb_build_object(
      'stage_id','00000000-0000-4000-8000-000000081404','proof_hash','sha256:'||repeat('3',64)));
  -- A correct real predecessor reaches the absent fresh stage, not receipt rejection.
  perform pg_temp.assert_recovery_rejected(command,'FALCON24_FOUR_LAYER_RECOVERY_LLM_STAGE_MISMATCH');
  assertions:=assertions+1;
  for field_name in select jsonb_object_keys(command) loop
    perform pg_temp.assert_recovery_rejected(command-field_name,invalid_error);
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,array[field_name],'null'::jsonb),invalid_error);
    assertions:=assertions+2;
  end loop;
  foreach parent_key in array array['scope','expected_current_authority','expected_semantic_release',
    'expected_versions','predecessor_four_layer_failure_receipt','llm_execution_stage_ref'] loop
    for field_name in select jsonb_object_keys(command->parent_key) loop
      path:=array[parent_key,field_name];
      perform pg_temp.assert_recovery_rejected(command#-path,invalid_error);
      perform pg_temp.assert_recovery_rejected(jsonb_set(command,path,'null'::jsonb),invalid_error);
      assertions:=assertions+2;
    end loop;
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,array[parent_key,'extra'],'true'::jsonb),invalid_error);
    assertions:=assertions+1;
  end loop;
  perform pg_temp.assert_recovery_rejected(command||'{"extra":true}',invalid_error);
  foreach field_name in array array['manifest_hash','receipt_hash'] loop
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,array['predecessor_four_layer_failure_receipt',field_name],
      to_jsonb('sha256:'||repeat('0',64))),receipt_error);
    assertions:=assertions+1;
  end loop;
  foreach field_name in array array['attempt_id','run_id'] loop
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,array['predecessor_four_layer_failure_receipt',field_name],
      '"00000000-0000-4000-8000-000000081499"'::jsonb),receipt_error);
    assertions:=assertions+1;
  end loop;
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{predecessor_four_layer_failure_receipt,turn_ordinal}',
    '1'::jsonb),receipt_error);
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{predecessor_four_layer_failure_receipt,failure_code}',
    '"FALCON24_OTHER_FAILURE"'::jsonb),receipt_error);
  -- A later failed attempt from another build is real but cannot replace the frozen predecessor.
  select jsonb_set(command,'{predecessor_four_layer_failure_receipt}',jsonb_build_object(
    'attempt_id',a.attempt_id,'manifest_hash',a.manifest_hash,'turn_ordinal',t.turn_ordinal,
    'run_id',t.run_id,'receipt_hash',t.terminal_receipt_hash,'failure_code',a.first_failure_code))
    into strict candidate from app_data_agent.falcon24_four_layer_gate_attempts a
    join app_data_agent.falcon24_four_layer_gate_turns t on t.attempt_id=a.attempt_id
      and t.turn_ordinal=a.first_failure_turn_ordinal
    where a.authority_epoch='E11' and a.status='FAILED'
      and a.source_commit<>failed_attempt.source_commit and t.status='FAILED' limit 1;
  perform pg_temp.assert_recovery_rejected(candidate,receipt_error);
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{scope,tenant_id}',
    '"00000000-0000-4000-8000-000000081499"'::jsonb),'FALCON24_FOUR_LAYER_RECOVERY_SCOPE_FORBIDDEN');
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{expected_current_authority,baseline_hash}',
    to_jsonb('sha256:'||repeat('0',64))),'FALCON24_FOUR_LAYER_RECOVERY_PREDECESSOR_MISMATCH');
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{expected_semantic_release,release_digest}',
    to_jsonb('sha256:'||repeat('0',64))),receipt_error);
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{authority_epoch}','"E13"'),invalid_error);
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{attempt_id}',
    to_jsonb(current_row.activation_attempt_id)),invalid_error);
  perform pg_temp.assert_recovery_rejected(jsonb_set(command,'{baseline_id}',to_jsonb(current_row.baseline_id)),invalid_error);
  assertions:=assertions+10;
  foreach candidate in array array['-1'::jsonb,'15'::jsonb,'0.5'::jsonb,'"0"'::jsonb] loop
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,
      '{predecessor_four_layer_failure_receipt,turn_ordinal}',candidate),invalid_error);
    assertions:=assertions+1;
  end loop;
  foreach candidate in array array['0'::jsonb,'-1'::jsonb,'1.5'::jsonb,'"3"'::jsonb,'9007199254740992'::jsonb] loop
    perform pg_temp.assert_recovery_rejected(jsonb_set(command,
      '{expected_versions,semantic_pointer}',candidate),invalid_error);
    assertions:=assertions+1;
  end loop;
  begin
    perform app_data_agent.activate_falcon24_authority(command||jsonb_build_object(
      'command_hash','sha256:'||repeat('0',64)));
    raise exception 'RECOVERY_TAMPERED_COMMAND_HASH_ACCEPTED';
  exception when sqlstate '22023' then
    if sqlerrm<>invalid_error then raise; end if;
  end;
  assertions:=assertions+1;
  if exists(select 1 from app_data_agent.falcon24_retained_recovery_activation_receipts)
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch
      where app_id=current_row.app_id and tenant_id=current_row.tenant_id and environment=current_row.environment
        and to_jsonb(falcon24_current_authority_epoch)<>to_jsonb(current_row))
  then raise exception 'RECOVERY_BOUNDARY_MUTATED_AUTHORITY'; end if;
  raise notice 'RECOVERY_POPULATED_BOUNDARIES_PASSED assertions=% real_failed_attempt=%',assertions,failed_attempt.attempt_id;
end
$assertions$;
rollback;
