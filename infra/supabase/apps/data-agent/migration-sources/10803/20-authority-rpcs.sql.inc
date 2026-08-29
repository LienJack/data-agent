create function app_data_agent.falcon24_four_layer_receipt_identity_matches(
  attempt_document jsonb,turn_document jsonb,receipt jsonb,expected_schema text,
  include_web_build boolean)
returns boolean language sql stable set search_path='' as $function$
  select receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and receipt->>'schema_version'=expected_schema
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    and receipt->>'gate_id'=attempt_document->>'gate_id'
    and receipt->>'attempt_id'=attempt_document->>'attempt_id'
    and receipt->>'manifest_hash'=attempt_document->>'manifest_hash'
    and receipt->>'turn_ordinal'=turn_document->>'turn_ordinal'
    and receipt->>'turn_id'=turn_document->>'turn_id'
    and receipt->>'layer'=turn_document->>'layer'
    and receipt->>'scenario_id'=turn_document->>'scenario_id'
    and receipt->>'scenario_turn_index'=turn_document->>'scenario_turn_index'
    and receipt->>'conversation_id'=turn_document->>'conversation_id'
    and receipt->>'conversation_resource_version'=
      turn_document->>'conversation_resource_version'
    and receipt->>'run_id'=turn_document->>'run_id'
    and receipt->>'question_hash'=turn_document->>'question_hash'
    and receipt->>'worker_build_hash'=attempt_document->>'worker_build_hash'
    and receipt->>'worker_generation_hash'=attempt_document->>'worker_generation_hash'
    and receipt->>'semantic_release_hash'=attempt_document->>'semantic_release_hash'
    and (not include_web_build or (
      receipt->>'web_build_hash'=attempt_document->>'web_build_hash'
      and receipt->>'web_generation_hash'=attempt_document->>'web_generation_hash'))
$function$;

create function app_data_agent.falcon24_four_layer_agent_contract_matches(
  expected_agents jsonb,actual_profile_ids jsonb)
returns boolean language sql immutable set search_path='' as $function$
  with actual as (
    select value profile_id,ordinality::integer position
    from pg_catalog.jsonb_array_elements_text(actual_profile_ids)
      with ordinality actual_entry(value,ordinality)
  ), required as (
    select value profile_id,ordinality::integer position
    from pg_catalog.jsonb_array_elements_text(expected_agents->'required_profile_ids')
      with ordinality required_entry(value,ordinality)
  ), required_positions as (
    select required.position,pg_catalog.min(actual.position) actual_position
    from required join actual using(profile_id) group by required.position
  )
  select pg_catalog.jsonb_typeof(expected_agents)='object'
    and pg_catalog.jsonb_typeof(actual_profile_ids)='array'
    and pg_catalog.jsonb_array_length(actual_profile_ids)
      between (expected_agents->>'min_agent_tasks')::integer
        and (expected_agents->>'max_agent_tasks')::integer
    and not exists(select 1 from actual
      where not (expected_agents->'allowed_profile_ids' ? profile_id))
    and case when expected_agents->>'mode'='EXACT'
      then actual_profile_ids=expected_agents->'required_profile_ids'
      else (select pg_catalog.count(*) from required_positions)=
          pg_catalog.jsonb_array_length(expected_agents->'required_profile_ids')
        and not exists(select 1 from required_positions current_position
          join required_positions previous_position
            on previous_position.position=current_position.position-1
          where current_position.actual_position<=previous_position.actual_position)
      end
$function$;

create function app_data_agent.load_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-attempt-load@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','turn_ordinal','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-load@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'turn_ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'turn_ordinal')::integer not between 0 and 14
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid
      and row.turn_ordinal=(command->>'turn_ordinal')::integer;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(turn);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.begin_falcon24_four_layer_gate(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;current_authority app_data_agent.falcon24_current_authority_epoch%rowtype;
  attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;manifest jsonb;
  now_at timestamptz;layer_counts integer[];
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-gate-begin@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  select array[pg_catalog.count(*) filter(where item->>'layer'='L1'),
      pg_catalog.count(*) filter(where item->>'layer'='L2'),
      pg_catalog.count(*) filter(where item->>'layer'='L3'),
      pg_catalog.count(*) filter(where item->>'layer'='L4')]::integer[]
    into strict layer_counts from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(manifest->'turns')='array'
        then manifest->'turns' else '[]'::jsonb end) item;
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','gate_id','attempt_id','authority_epoch','authority_baseline_id',
      'authority_baseline_hash','authority_activation_attempt_id','source_commit',
      'worker_build_hash','worker_generation_hash','web_build_hash','web_generation_hash',
      'semantic_release_hash','datasource_binding_hash','model_config_hash',
      'runtime_attestation_hash','turns','manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-four-layer-gate-manifest@1.0.0'
    or manifest->>'manifest_hash'<>app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_activation_attempt_id') is distinct from true
    or manifest->>'authority_epoch'!~'^E[1-9][0-9]*$'
    or manifest->>'gate_id'<>manifest->>'authority_epoch'||'-FL1'
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or exists(select 1 from pg_catalog.unnest(array[
      'authority_baseline_hash','worker_build_hash','worker_generation_hash','web_build_hash',
      'web_generation_hash','semantic_release_hash','datasource_binding_hash',
      'model_config_hash','runtime_attestation_hash','manifest_hash']::text[]) hash_key
      where manifest->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(manifest->'turns') is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest->'turns')<>15
    or layer_counts<>array[5,2,2,6]::integer[]
    or app_data_agent.u2_canonical_sha256(manifest->'turns')<>
      'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9'
    or app_data_agent.contains_potential_plaintext_secret(manifest)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into current_authority from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found or current_authority.authority_epoch<>manifest->>'authority_epoch'
    or current_authority.baseline_id::text<>manifest->>'authority_baseline_id'
    or current_authority.baseline_hash<>manifest->>'authority_baseline_hash'
    or current_authority.activation_attempt_id::text<>
      manifest->>'authority_activation_attempt_id'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_AUTHORITY_MISMATCH'; end if;

  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(manifest->>'attempt_id')::uuid for update;
  if found then
    if attempt.manifest_hash<>manifest->>'manifest_hash'
      or attempt.worker_build_hash<>manifest->>'worker_build_hash'
      or attempt.web_build_hash<>manifest->>'web_build_hash'
    then raise exception using errcode='55000',
      message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
  end if;
  if exists(select 1 from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.status in('READY','RUNNING','FINALIZING'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ACTIVE_ATTEMPT_EXISTS'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_four_layer_gate_attempts(
    app_id,tenant_id,environment,principal_id,gate_id,attempt_id,authority_epoch,
    authority_baseline_id,authority_baseline_hash,authority_activation_attempt_id,
    source_commit,worker_build_hash,worker_generation_hash,web_build_hash,
    web_generation_hash,semantic_release_hash,datasource_binding_hash,model_config_hash,
    runtime_attestation_hash,manifest_hash,manifest_document,status,current_layer,
    next_turn_ordinal,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'gate_id',(manifest->>'attempt_id')::uuid,manifest->>'authority_epoch',
    (manifest->>'authority_baseline_id')::uuid,manifest->>'authority_baseline_hash',
    (manifest->>'authority_activation_attempt_id')::uuid,manifest->>'source_commit',
    manifest->>'worker_build_hash',manifest->>'worker_generation_hash',
    manifest->>'web_build_hash',manifest->>'web_generation_hash',
    manifest->>'semantic_release_hash',manifest->>'datasource_binding_hash',
    manifest->>'model_config_hash',manifest->>'runtime_attestation_hash',
    manifest->>'manifest_hash',manifest,'READY','L1',0,now_at,now_at)
  returning * into strict attempt;
  insert into app_data_agent.falcon24_four_layer_gate_turns(
    app_id,tenant_id,environment,principal_id,attempt_id,turn_ordinal,turn_id,layer,
    scenario_id,scenario_turn_index,conversation_group,conversation_mode,question,
    question_hash,expected_agents,rubric,status,created_at,updated_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    attempt.attempt_id,(entry.ordinality-1)::integer,entry.item->>'turn_id',
    entry.item->>'layer',entry.item->>'scenario_id',
    (entry.item->>'scenario_turn_index')::integer,entry.item->>'conversation_group',
    entry.item->>'conversation_mode',entry.item->>'question',entry.item->>'question_hash',
    entry.item->'expected_agents',entry.item->'rubric','PLANNED',now_at,now_at
  from pg_catalog.jsonb_array_elements(manifest->'turns')
    with ordinality entry(item,ordinality);
  return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.claim_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
  previous_turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','turn_ordinal','conversation_id',
      'conversation_resource_version','run_id','idempotency_key',
      'expected_attempt_version','expected_turn_version','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-claim@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'conversation_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'idempotency_key') is distinct from 'string'
    or command->>'turn_ordinal'!~'^(0|[1-9][0-9]*)$'
    or command->>'conversation_resource_version'!~'^[1-9][0-9]*$'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||command->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid
      and row.turn_ordinal=(command->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.status<>'PLANNED' then
    if turn.claim_command_hash=command->>'command_hash'
      and turn.conversation_id::text=command->>'conversation_id'
      and turn.conversation_resource_version::text=command->>'conversation_resource_version'
      and turn.run_id::text=command->>'run_id'
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',
    message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if attempt.status<>'READY' or attempt.next_turn_ordinal<>turn.turn_ordinal
    or attempt.current_layer<>turn.layer
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and conversation.conversation_id=(command->>'conversation_id')::uuid
      and conversation.resource_version=(command->>'conversation_resource_version')::bigint)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer<>'L4' and exists(select 1
    from app_data_agent.falcon24_four_layer_gate_turns earlier
    where earlier.app_id=turn.app_id and earlier.tenant_id=turn.tenant_id
      and earlier.environment=turn.environment and earlier.principal_id=turn.principal_id
      and earlier.attempt_id=turn.attempt_id and earlier.turn_ordinal<turn.turn_ordinal
      and earlier.conversation_id=(command->>'conversation_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer='L4' and turn.scenario_turn_index=0 and exists(select 1
    from app_data_agent.falcon24_four_layer_gate_turns earlier
    where earlier.app_id=turn.app_id and earlier.tenant_id=turn.tenant_id
      and earlier.environment=turn.environment and earlier.principal_id=turn.principal_id
      and earlier.attempt_id=turn.attempt_id and earlier.turn_ordinal<turn.turn_ordinal
      and earlier.conversation_id=(command->>'conversation_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer='L4' and turn.scenario_turn_index>0 then
    select * into previous_turn from app_data_agent.falcon24_four_layer_gate_turns row
      where row.app_id=turn.app_id and row.tenant_id=turn.tenant_id
        and row.environment=turn.environment and row.principal_id=turn.principal_id
        and row.attempt_id=turn.attempt_id and row.conversation_group=turn.conversation_group
        and row.scenario_turn_index=turn.scenario_turn_index-1;
    if previous_turn.status<>'PASSED'
      or previous_turn.conversation_id::text<>command->>'conversation_id'
      or previous_turn.conversation_resource_version>=
        (command->>'conversation_resource_version')::bigint
    then raise exception using errcode='55000',
      message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set status='CLAIMED',
    conversation_id=(command->>'conversation_id')::uuid,
    conversation_resource_version=(command->>'conversation_resource_version')::bigint,
    run_id=(command->>'run_id')::uuid,claim_command_hash=command->>'command_hash',
    claimed_at=now_at,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='PLANNED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set status='RUNNING',
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='READY'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
